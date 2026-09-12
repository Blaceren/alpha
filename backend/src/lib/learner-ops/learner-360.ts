/**
 * LEARNER-OPERATIONS-V1 — Learner 360.
 *
 * THE RULE THIS FILE EXISTS TO OBEY. Every value below is read from its
 * CANONICAL OWNER at request time and labelled with that owner. Nothing is
 * copied into a Learner Operations table, nothing is cached, and nothing is
 * inferred from something adjacent.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY EACH ONE WOULD BE A LIE.
 *
 *   BALANCE. The platform does not hold a learner's Pocket balance and the
 *   balance provider is disabled. Rendering a number here would mean inventing
 *   one or scraping it from a screenshot a learner sent.
 *
 *   P&L / TRADING PERFORMANCE. Never received, never stored, never derivable.
 *
 *   DEPOSIT AMOUNTS. The financial-event authority records THAT a qualifying
 *   event occurred and its provenance. Operations shows that fact and its
 *   source. It does not show a sum, because a sum would imply the platform
 *   reconciles the learner's money, which it does not.
 *
 *   A "HEALTH SCORE" or churn prediction. No causal model exists. A number with
 *   no authority behind it is the most dangerous kind of shadow truth, because
 *   it looks like knowledge.
 *
 * PERMISSION-SENSITIVE SECTIONS. The external/financial section is returned
 * only to a caller holding `view_exact_financials`, and the full email only to
 * one holding `view_identity_full_email` — reusing the field-level gates the
 * CRM user detail already applies rather than minting new ones.
 */
import type { CrmPermission } from "@/lib/crm/roles";
import { resolveFirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";
import { LEARNER_OPS_ACTIVE_STATUSES } from "@/lib/learner-ops/contract";
import { learnerOpsFail } from "@/lib/learner-ops/errors";
import { prisma } from "@/lib/prisma";

/**
 * Every field carries the owner that answered for it. The CRM renders this, so
 * an operator can always see WHICH system said a thing — which is the whole
 * difference between a projection and a shadow truth.
 */
export type Sourced<T> = { readonly value: T; readonly source: string };

function sourced<T>(value: T, source: string): Sourced<T> {
  return { value, source };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || !local) return "—";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export type Learner360 = Awaited<ReturnType<typeof getLearner360>>;

export async function getLearner360(input: {
  userId: number;
  permissions: readonly CrmPermission[];
}) {
  const held = new Set(input.permissions);
  const canSeeFullEmail = held.has("view_identity_full_email");
  const canSeeFinancial = held.has("view_exact_financials");

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      emailVerifiedAt: true,
    },
  });
  if (!user) learnerOpsFail("LEARNER_OPS_LEARNER_NOT_FOUND");

  // ------------------------------------------------------- enrollment
  const enrollment = await prisma.userCurriculumEnrollment.findFirst({
    where: { userId: input.userId, status: { in: ["active", "completed"] } },
    orderBy: [{ status: "asc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      curriculumVersionId: true,
      curriculumVersion: { select: { code: true, status: true, versionNumber: true } },
    },
  });

  // ------------------------------------------------- progression state
  // Read straight from the progression owner. Learner Operations computes no
  // progress of its own and stores none.
  const progress = enrollment
    ? await prisma.userLevelProgress.findMany({
        where: { enrollmentId: enrollment.id },
        select: {
          id: true,
          status: true,
          levelDefinition: { select: { levelNumber: true, title: true, type: true } },
        },
        orderBy: [{ levelDefinitionId: "asc" }],
      })
    : [];

  const completed = progress.filter((row) => row.status === "completed");
  const pendingReview = progress.filter((row) => row.status === "pending_review");
  const inProgress = progress.filter((row) => row.status === "in_progress");

  // THE DENOMINATOR COMES FROM THE CURRICULUM, NOT FROM PROGRESS ROWS.
  //
  // LO-360-PROGRESS-DENOMINATOR-1. This used to be `progress.length`, which is
  // the number of `UserLevelProgress` rows that have been MATERIALISED — and
  // those are created as a learner starts each level. A freshly enrolled
  // learner therefore has none, and the panel read `0 из 0 уровней`: not false,
  // but it says "this curriculum has no levels" when it means "this learner has
  // started none of them".
  //
  // The canonical total is the count of `LevelDefinition` rows belonging to the
  // curriculum version the ENROLMENT names. It is per-version and must stay
  // that way: `ata-v2` v1 and v2 carry 4 levels each and v4 carries 100, so a
  // global constant would be wrong for any learner on an older version. Nothing
  // is hardcoded and no progress row is created to obtain a number.
  const totalLevels = enrollment
    ? await prisma.levelDefinition.count({
        where: { curriculumVersionId: enrollment.curriculumVersionId },
      })
    : 0;

  // ---------------------------------------------------------- reports
  const reportSubmissions = await prisma.reportSubmission.findMany({
    where: { userId: input.userId },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      levelDefinition: { select: { levelNumber: true } },
    },
    orderBy: [{ id: "desc" }],
    take: 5,
  });

  // ------------------------------------------- operational case history
  const cases = await prisma.learnerOpsCase.findMany({
    where: { userId: input.userId },
    select: {
      id: true,
      reference: true,
      type: true,
      status: true,
      priority: true,
      subject: true,
      openedAt: true,
      resolvedAt: true,
      reopenCount: true,
      assignedStaff: { select: { displayName: true } },
    },
    orderBy: [{ openedAt: "desc" }],
    take: 20,
  });

  // ---------------------------------------------------- notifications
  const notifications = await prisma.notification.findMany({
    where: { userId: input.userId },
    select: { id: true, type: true, createdAt: true, readAt: true },
    orderBy: [{ createdAt: "desc" }],
    take: 10,
  });

  // -------------------------------- external / Pocket identity + finance
  //
  // The identity row says whether the learner is LINKED. It never says how much
  // money exists. When the registration callback has not arrived, the honest
  // answer is "pending", and this returns exactly that rather than guessing
  // from anything adjacent.
  const pocketIdentity = await prisma.pocketTraderIdentity.findUnique({
    where: { userId: input.userId },
    select: { pocketUserId: true, boundAt: true, source: true },
  });

  // THE CANONICAL FIRST-DEPOSIT AUTHORITY, and the only way this domain is
  // permitted to ask the question.
  //
  // `resolveFirstDepositConfirmation` (FDCONF-1) is the single resolver: it
  // prefers the canonical conversion ledger, falls back to the closed legacy
  // set for learners whose deposits predate that ledger, and REPORTS WHICH
  // EVIDENCE IT USED. Reading `ExchangeAccount.firstDepositConfirmed` directly
  // here — or querying the ledger myself — would re-create the exact
  // two-writers-of-one-fact drift that module was built to end, and would have
  // told four live PREPROD learners with real deposits that they had none.
  const firstDeposit = canSeeFinancial
    ? await resolveFirstDepositConfirmation(prisma, input.userId)
    : null;

  const financialCheckpoints = canSeeFinancial
    ? await prisma.checkpointVerificationAttempt.findMany({
        where: { enrollmentId: enrollment?.id ?? -1 },
        select: {
          id: true,
          outcome: true,
          createdAt: true,
          levelDefinition: { select: { levelNumber: true } },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 5,
      })
    : [];

  return {
    identity: {
      id: user.id,
      name: user.name,
      // The masked address is the default, and the full one is a permission.
      email: sourced(canSeeFullEmail ? user.email : maskEmail(user.email), "platform.identity"),
      emailMasked: !canSeeFullEmail,
      status: sourced(user.status, "platform.identity"),
      role: user.role,
      registeredAt: user.createdAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    },
    enrollment: enrollment
      ? sourced(
          {
            id: enrollment.id,
            status: enrollment.status,
            curriculumCode: enrollment.curriculumVersion.code,
            curriculumStatus: enrollment.curriculumVersion.status,
            curriculumVersionNumber: enrollment.curriculumVersion.versionNumber,
          },
          "curriculum.enrollment",
        )
      : null,
    progression: sourced(
      {
        completedLevels: completed.length,
        totalLevels,
        /**
         * How many progress rows exist. Kept as its own field rather than
         * being confused with the total: it is a useful operational fact
         * ("has this learner started anything?") and it is NOT the size of the
         * curriculum.
         */
        startedLevels: progress.length,
        currentLevel:
          inProgress[0]?.levelDefinition
            ? {
                levelNumber: inProgress[0].levelDefinition.levelNumber,
                title: inProgress[0].levelDefinition.title,
                type: inProgress[0].levelDefinition.type,
              }
            : null,
        pendingReview: pendingReview.map((row) => ({
          progressId: row.id,
          levelNumber: row.levelDefinition.levelNumber,
          title: row.levelDefinition.title,
          type: row.levelDefinition.type,
        })),
      },
      "curriculum.progression",
    ),
    reports: sourced(
      reportSubmissions.map((row) => ({
        submissionId: row.id,
        status: row.status,
        levelNumber: row.levelDefinition?.levelNumber ?? null,
        submittedAt: row.submittedAt?.toISOString() ?? null,
      })),
      "curriculum.report",
    ),
    operations: sourced(
      cases.map((row) => ({
        id: row.id,
        reference: row.reference,
        type: row.type,
        status: row.status,
        priority: row.priority,
        subject: row.subject,
        assignedTo: row.assignedStaff?.displayName ?? null,
        openedAt: row.openedAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        reopenCount: row.reopenCount,
        active: (LEARNER_OPS_ACTIVE_STATUSES as readonly string[]).includes(row.status),
      })),
      "learner_ops.case",
    ),
    notifications: sourced(
      notifications.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
        read: row.readAt !== null,
      })),
      "platform.notification",
    ),
    external: {
      // Visible to every operator: knowing WHETHER a learner is linked is
      // ordinary support context and carries no financial detail.
      pocketIdentity: sourced(
        pocketIdentity
          ? {
              state: "linked" as const,
              playerId: pocketIdentity.pocketUserId,
              linkedAt: pocketIdentity.boundAt.toISOString(),
              source: pocketIdentity.source,
            }
          : { state: "pending" as const, playerId: null, linkedAt: null, source: null },
        "pocket.trader_identity",
      ),
      // Financial facts are gated, and are BOOLEAN facts with provenance.
      financial: canSeeFinancial
        ? sourced(
            {
              firstDepositConfirmed: firstDeposit?.confirmed ?? false,
              firstDepositAt: firstDeposit?.occurredAt?.toISOString() ?? null,
              // The resolver's own provenance, passed through verbatim so the
              // CRM can show WHICH evidence answered rather than implying the
              // canonical ledger always did.
              firstDepositEvidence: firstDeposit?.source ?? "none",
              // No amount. Not omitted by accident — see the header.
              checkpoints: financialCheckpoints.map((row) => ({
                levelNumber: row.levelDefinition?.levelNumber ?? null,
                outcome: row.outcome,
                at: row.createdAt.toISOString(),
              })),
            },
            "exchange.first_deposit_truth",
          )
        : null,
      financialVisible: canSeeFinancial,
    },
  };
}
