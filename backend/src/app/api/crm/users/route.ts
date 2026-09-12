import type { Prisma, UserStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { resolveFirstDepositConfirmations } from "@/lib/exchange/first-deposit-truth";
import { prisma } from "@/lib/prisma";

type Attribution = Record<string, string>;
type ValidationIssue = { field: string; message: string };

const MAX_SEARCH_LENGTH = 120;
const MAX_FILTER_LENGTH = 80;
const USER_STATUSES = new Set<UserStatus>(["active", "blocked"]);
const CHECKPOINT_FILTERS = new Set(["active", "completed", "frozen", "pending", "none"]);
const EVENT_TYPE_FILTERS = new Set([
  "registration",
  "email_confirmation",
  "first_deposit",
  "redeposit",
  "deposit",
  "withdrawal",
  "successful_withdrawal",
  "canceled_withdrawal",
  "commission",
]);
const COHORT_FILTERS = new Set([
  "inactive",
  "high_level",
  "stuck_checkpoint",
  "first_deposit_no_checkpoint",
  "registered_no_deposit",
  "active",
]);

/**
 * FDCONF-1 — the cohort classifier took the first-deposit fact as an ARGUMENT
 * rather than reading it off the account row.
 *
 * `first_deposit_no_checkpoint` and `registered_no_deposit` are the two cohorts
 * staff work from when they chase learners, and both were computed from the
 * stale legacy column. Every learner who deposited through the canonical Pocket
 * ingress was filed as `registered_no_deposit` — so the operational list of
 * "people who have not deposited yet" contained precisely the people who had.
 */
function cohortFor(
  user: {
    level: number;
    updatedAt: Date;
    checkpoint: { status: string } | null;
    exchangeAccount: { registrationStatus: boolean } | null;
  },
  firstDepositConfirmed: boolean,
) {
  const inactiveBefore = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  if (user.updatedAt < inactiveBefore) return "inactive";
  if (user.level >= 5) return "high_level";
  if (user.checkpoint?.status === "frozen") return "stuck_checkpoint";
  if (firstDepositConfirmed && user.checkpoint?.status !== "completed") return "first_deposit_no_checkpoint";
  if (user.exchangeAccount?.registrationStatus && !firstDepositConfirmed) return "registered_no_deposit";
  return "active";
}

function validationErrorResponse(details: ValidationIssue[]) {
  return NextResponse.json(
    { success: false, error: "VALIDATION_ERROR", details },
    { status: 400 },
  );
}

function readTextFilter(
  searchParams: URLSearchParams,
  field: string,
  details: ValidationIssue[],
  options: { maxLength?: number; lower?: boolean } = {},
) {
  const raw = searchParams.get(field);
  if (raw === null) return undefined;

  const value = raw.trim();
  if (!value || value === "all") return undefined;

  const maxLength = options.maxLength ?? MAX_FILTER_LENGTH;
  if (value.length > maxLength) {
    details.push({ field, message: `Must be ${maxLength} characters or less.` });
    return undefined;
  }

  return options.lower ? value.toLowerCase() : value;
}

function readEnumFilter<T extends string>(
  searchParams: URLSearchParams,
  field: string,
  allowed: Set<T>,
  details: ValidationIssue[],
) {
  const value = readTextFilter(searchParams, field, details, { lower: true });
  if (!value) return undefined;
  if (!allowed.has(value as T)) {
    details.push({ field, message: "Unsupported filter value." });
    return undefined;
  }
  return value as T;
}

function readPositiveIntFilter(searchParams: URLSearchParams, field: string, details: ValidationIssue[]) {
  const value = readTextFilter(searchParams, field, details, { maxLength: 8 });
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 1000) {
    details.push({ field, message: "Must be an integer between 1 and 1000." });
    return undefined;
  }

  return parsed;
}

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    const searchParams = new URL(request.url).searchParams;
    const validationDetails: ValidationIssue[] = [];
    const q = readTextFilter(searchParams, "q", validationDetails, { maxLength: MAX_SEARCH_LENGTH });
    const status = readEnumFilter(searchParams, "status", USER_STATUSES, validationDetails);
    const level = readPositiveIntFilter(searchParams, "level", validationDetails);
    const checkpoint = readEnumFilter(searchParams, "checkpoint", CHECKPOINT_FILTERS, validationDetails);
    const country = readTextFilter(searchParams, "country", validationDetails, { lower: true });
    const device = readTextFilter(searchParams, "device", validationDetails, { lower: true });
    const browser = readTextFilter(searchParams, "browser", validationDetails, { lower: true });
    const source = readTextFilter(searchParams, "source", validationDetails, { lower: true });
    const eventType = readEnumFilter(searchParams, "eventType", EVENT_TYPE_FILTERS, validationDetails);
    const cohort = readEnumFilter(searchParams, "cohort", COHORT_FILTERS, validationDetails);

    if (validationDetails.length > 0) {
      return validationErrorResponse(validationDetails);
    }

    const where: Prisma.UserWhereInput = {
      role: "user",
      ...(status ? { status } : {}),
      ...(level ? { level } : {}),
      ...(checkpoint && checkpoint !== "none" ? { checkpoint: { status: checkpoint } } : {}),
      ...(checkpoint === "none" ? { checkpoint: null } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q } },
              { name: { contains: q } },
              { exchangeAccount: { traderId: { contains: q } } },
              { exchangeAccount: { clickId: { contains: q } } },
            ],
          }
        : {}),
    };

    const users = await prisma.user.findMany({
      where,
      include: {
        checkpoint: true,
        exchangeAccount: {
          include: { postbackEvents: { orderBy: { createdAt: "desc" }, take: 50 } },
        },
        taskProgress: { where: { status: "active" }, include: { task: true }, take: 1 },
        invitedReferrals: true,
        invitedByReferral: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // FDCONF-1: one batched resolve for the page, then every row reads the
    // canonical answer. The legacy column is not consulted here any more.
    const firstDeposits = await resolveFirstDepositConfirmations(
      prisma,
      users.map((user) => user.id),
    );

    const items = users
      .map((user) => {
        const account = user.exchangeAccount;
        const firstDeposit = firstDeposits.get(user.id);
        const firstDepositConfirmed = firstDeposit?.confirmed ?? false;
        const attribution = (account?.attribution as Attribution | null) ?? {};
        const postbackEvents = account?.postbackEvents ?? [];
        const computedCohort = cohortFor(user, firstDepositConfirmed);
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
          level: user.level,
          xp: user.xp,
          currentStep: user.taskProgress[0]?.task.title ?? user.currentTask ?? "-",
          exchangeStatus: account?.status ?? "not_connected",
          registrationStatus: account?.registrationStatus ?? false,
          emailConfirmed: account?.emailConfirmed ?? false,
          firstDepositConfirmed,
          firstDepositConfirmedSource: firstDeposit?.source ?? "none",
          depositStatus: firstDepositConfirmed ? "confirmed" : "pending",
          // DEVMECH-1: CRM never receives a current trading balance.
          traderId: account?.traderId ?? null,
          clickId: account?.clickId ?? null,
          totalDeposits: account?.totalDeposits ?? 0,
          totalWithdrawals: account?.totalWithdrawals ?? 0,
          totalCommission: account?.totalCommission ?? 0,
          checkpointStatus: user.checkpoint?.status ?? "none",
          // DEVMECH-1: the legacy V1 checkpoint balance is retired and is
          // never exposed. L4 state comes from the curriculum read model.

          cohort: computedCohort,
          attribution,
          postbackEvents: postbackEvents.map((event) => ({
            id: event.id,
            eventType: event.normalizedEventType ?? event.eventType,
            amount: event.amount,
            currency: event.currency,
            status: event.status,
            createdAt: event.createdAt,
          })),
          referralSummary: {
            invited: user.invitedReferrals.length,
            invitedByUserId: user.invitedByReferral?.inviterUserId ?? null,
          },
          lastActiveAt: user.updatedAt,
        };
      })
      .filter((user) => !cohort || user.cohort === cohort)
      .filter((user) => !country || String(user.attribution.country ?? "").toLowerCase() === country)
      .filter((user) => !device || String(user.attribution.device_type ?? "").toLowerCase() === device)
      .filter((user) => !browser || String(user.attribution.browser ?? "").toLowerCase() === browser)
      .filter((user) => {
        if (!source) return true;
        return [user.attribution.site_id, user.attribution.cid, user.attribution.ac, user.attribution.sub_id1, user.attribution.promo]
          .some((value) => String(value ?? "").toLowerCase().includes(source));
      })
      .filter((user) => !eventType || user.postbackEvents.some((event) => event.eventType === eventType));

    await createAuditLog({
      userId: admin.id,
      action: "ADMIN_VIEWED_CRM",
      entityType: "User",
      metadata: { filters: Object.fromEntries(searchParams), count: items.length },
      request,
    });

    return NextResponse.json({ users: items });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
