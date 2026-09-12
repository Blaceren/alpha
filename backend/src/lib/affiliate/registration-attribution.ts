/**
 * AFD-3B2 — binding an acquisition journey to a new learner, once and forever.
 *
 * THE ONE-SENTENCE CONTRACT. When a public registration succeeds, the server
 * looks at the anonymous journey the browser presented, decides which affiliate
 * click (if any) earned it, freezes that answer, and writes exactly one
 * conversion event — attributed or direct — in the same transaction as the user.
 *
 * WHAT NEVER HAPPENS HERE. Registration never fails because of attribution. A
 * missing cookie, a forged cookie, an expired cookie, a journey with no eligible
 * click and a journey somebody already spent all produce the same outcome for
 * the person registering: an account. Attribution is a measurement, and a
 * measurement that can refuse a customer is a defect, not a control.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { readAttributionCookie } from "@/lib/affiliate/attribution-cookie";
import {
  isAffiliateAttributionEnabled,
  requireAttributionSecret,
} from "@/lib/affiliate/attribution-config";
import {
  verifyAttributionToken,
  type AttributionTokenRejection,
} from "@/lib/affiliate/attribution-token";
import { randomBase32Id } from "@/lib/affiliate/random-id";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The single owner name this phase writes into the conversion ledger. */
export const REGISTRATION_SOURCE_OWNER = "auth_register" as const;

/**
 * The idempotency key for a registration conversion.
 *
 * DERIVED FROM THE USER ID, NOT THE EMAIL. An email address is mutable and, once
 * an account is deleted, re-registrable — so keying on it would let a second,
 * genuinely different learner collide with a first learner's conversion, or let
 * one learner produce two by changing their address. The user id is issued by
 * the database inside the same transaction, is never reused, and makes "one
 * academy_registration per registered user" mean exactly that.
 */
export function registrationSourceEventId(userId: number): string {
  return `user:${userId}`;
}

export type AttributionSkipReason =
  | "feature_disabled"
  | "no_cookie"
  | `invalid_token:${AttributionTokenRejection}`
  | "no_eligible_click";

export type AcquisitionSelection = {
  readonly anonymousVisitorId: string;
  readonly firstTouchClickId: number;
  readonly lastTouchClickId: number;
  readonly selectedClickId: number;
  readonly trackingLinkId: number;
  readonly affiliatePartnerId: number;
  readonly affiliateCampaignId: number | null;
  readonly affiliateCodeSnapshot: string;
  readonly campaignCodeSnapshot: string | null;
  readonly trackingLinkPublicCodeSnapshot: string;
};

export type AttributionResolution =
  | { readonly kind: "unattributed"; readonly reason: AttributionSkipReason }
  | { readonly kind: "attributed"; readonly selection: AcquisitionSelection };

type ClickReader = Pick<PrismaClient, "affiliateClick">;

/**
 * Find the eligible clicks for one visitor journey.
 *
 * ELIGIBILITY, IN FULL. A click is eligible when it is `qualified` (so never a
 * prefetch and never a click by someone already signed in), belongs to THIS
 * visitor, happened at or before now, and is still inside the window it
 * snapshotted at the time.
 *
 * NOTE WHAT IS NOT REQUIRED. The tracking link does not have to still be active,
 * the campaign does not have to still be running and the affiliate does not have
 * to still be a partner. The click was valid when it happened and the affiliate
 * earned whatever it earned then; letting a later pause erase it would let us
 * stop paying by flipping a switch.
 *
 * WHY THE QUERY IS SHAPED LIKE THIS. Eligibility compares a timestamp against a
 * per-ROW window, which no single indexed range can express. Rather than fetch
 * an unbounded journey and filter in memory — which is either wrong when capped
 * or unbounded when not — the distinct window values are read first (there are
 * at most a handful in practice and at most 365 by CHECK), and each becomes its
 * own exact range. The result is precise, has no cap, and reads two indexed rows.
 */
export async function selectEligibleClicks(
  db: ClickReader,
  anonymousVisitorId: string,
  now: Date,
): Promise<{ firstTouchClickId: number; lastTouchClickId: number } | null> {
  const windows = await db.affiliateClick.groupBy({
    by: ["effectiveAttributionWindowDays"],
    where: { anonymousVisitorId, classification: "qualified", occurredAt: { lte: now } },
  });
  if (windows.length === 0) return null;

  const eligible: Prisma.AffiliateClickWhereInput = {
    anonymousVisitorId,
    classification: "qualified",
    OR: windows.map(({ effectiveAttributionWindowDays }) => ({
      effectiveAttributionWindowDays,
      occurredAt: {
        lte: now,
        // Strictly greater: a click whose window has exactly run out is spent.
        gt: new Date(now.getTime() - effectiveAttributionWindowDays * DAY_MS),
      },
    })),
  };

  // The tie-breaker is the row id in the SAME direction as the timestamp, so two
  // clicks recorded in the same millisecond still order deterministically and
  // first touch and last touch cannot both resolve to the same row by accident.
  const [first, last] = await Promise.all([
    db.affiliateClick.findFirst({
      where: eligible,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
    db.affiliateClick.findFirst({
      where: eligible,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
  ]);

  if (!first || !last) return null;
  return { firstTouchClickId: first.id, lastTouchClickId: last.id };
}

/**
 * Resolve what, if anything, this registration request should be attributed to.
 *
 * Runs BEFORE the registration transaction opens. Reads only — nothing here
 * writes, so a request that never reaches a commit leaves nothing behind.
 */
export async function resolveRegistrationAttribution(
  db: Pick<PrismaClient, "affiliateClick" | "affiliateTrackingLink">,
  request: Request,
  now: Date = new Date(),
): Promise<AttributionResolution> {
  if (!isAffiliateAttributionEnabled()) {
    return { kind: "unattributed", reason: "feature_disabled" };
  }

  const token = readAttributionCookie(request.headers.get("cookie"));
  if (token === null) return { kind: "unattributed", reason: "no_cookie" };

  const verification = verifyAttributionToken(token, requireAttributionSecret(), now);
  if (verification.kind === "invalid") {
    return { kind: "unattributed", reason: `invalid_token:${verification.reason}` };
  }

  const touches = await selectEligibleClicks(db, verification.payload.anonymousVisitorId, now);
  if (touches === null) return { kind: "unattributed", reason: "no_eligible_click" };

  // The selected click IS the last touch in this phase. Stated as an assignment
  // rather than implied by reusing one variable, because AFD-5 may introduce a
  // model where they differ and the two must already be distinct concepts.
  const selectedClickId = touches.lastTouchClickId;

  const selected = await db.affiliateClick.findUniqueOrThrow({
    where: { id: selectedClickId },
    select: {
      trackingLink: {
        select: {
          id: true,
          publicCode: true,
          affiliatePartnerId: true,
          affiliateCampaignId: true,
          partner: { select: { code: true } },
          campaign: { select: { code: true } },
        },
      },
    },
  });
  const link = selected.trackingLink;

  return {
    kind: "attributed",
    selection: {
      anonymousVisitorId: verification.payload.anonymousVisitorId,
      firstTouchClickId: touches.firstTouchClickId,
      lastTouchClickId: touches.lastTouchClickId,
      selectedClickId,
      trackingLinkId: link.id,
      affiliatePartnerId: link.affiliatePartnerId,
      affiliateCampaignId: link.affiliateCampaignId,
      // Captured NOW, at the moment of conversion, because a payout report read
      // next year must still show the code the affiliate had today.
      affiliateCodeSnapshot: link.partner.code,
      campaignCodeSnapshot: link.campaign?.code ?? null,
      trackingLinkPublicCodeSnapshot: link.publicCode,
    },
  };
}

type AttributionWriter = Pick<
  Prisma.TransactionClient,
  "affiliateAttribution" | "affiliateConversionEvent"
>;

/**
 * Freeze the attribution. Called inside the registration transaction, after the
 * user exists and before it commits.
 *
 * The uniqueness on `anonymousVisitorId` is what a replayed token collides with.
 * That collision is deliberately NOT caught here: swallowing it inside the
 * transaction would leave the transaction aborted on SQLite while the caller
 * believed it had recovered. The caller re-runs the whole transaction without
 * attribution instead, which is the only way both registrations can legally
 * succeed and exactly one of them can own the journey.
 */
export async function freezeAttribution(
  tx: AttributionWriter,
  userId: number,
  selection: AcquisitionSelection,
  now: Date,
): Promise<number> {
  const created = await tx.affiliateAttribution.create({
    data: {
      userId,
      anonymousVisitorId: selection.anonymousVisitorId,
      firstTouchClickId: selection.firstTouchClickId,
      lastTouchClickId: selection.lastTouchClickId,
      selectedClickId: selection.selectedClickId,
      attributionModel: "last_eligible_affiliate_click",
      selectionReason: "registration_cookie",
      selectedAt: now,
      frozenAt: now,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Write the one conversion event for this registration.
 *
 * ALWAYS EXACTLY ONE, INCLUDING FOR A DIRECT REGISTRATION. A ledger that only
 * recorded attributed conversions could never answer "what share of signups did
 * affiliates bring", because the denominator would be missing — and a direct
 * signup with no row would be indistinguishable from one the ledger dropped.
 *
 * IN THE SAME TRANSACTION AS THE USER, deliberately. If this insert fails, the
 * user is rolled back too. That is the strict choice, and it is the right one
 * for a ledger a payout is computed from: a learner who exists with no
 * conversion row is a silent accounting hole that nothing downstream can detect,
 * whereas a failed registration is loud, retryable and immediately visible.
 */
export async function recordRegistrationConversion(
  tx: AttributionWriter,
  input: {
    userId: number;
    attributionId: number | null;
    selection: AcquisitionSelection | null;
    occurredAt: Date;
  },
): Promise<{ conversionEventId: number }> {
  const attributed = input.attributionId !== null && input.selection !== null;

  const created = await tx.affiliateConversionEvent.create({
    data: {
      eventId: randomBase32Id(),
      eventType: "academy_registration",
      userId: input.userId,
      attributionId: attributed ? input.attributionId : null,
      selectedClickId: attributed ? input.selection!.selectedClickId : null,
      affiliatePartnerId: attributed ? input.selection!.affiliatePartnerId : null,
      affiliateCampaignId: attributed ? input.selection!.affiliateCampaignId : null,
      trackingLinkId: attributed ? input.selection!.trackingLinkId : null,
      affiliateCodeSnapshot: attributed ? input.selection!.affiliateCodeSnapshot : null,
      campaignCodeSnapshot: attributed ? input.selection!.campaignCodeSnapshot : null,
      trackingLinkPublicCodeSnapshot: attributed
        ? input.selection!.trackingLinkPublicCodeSnapshot
        : null,
      sourceOwner: REGISTRATION_SOURCE_OWNER,
      sourceEventId: registrationSourceEventId(input.userId),
      occurredAt: input.occurredAt,
    },
    select: { id: true },
  });

  // AFFILIATE-PLATFORM-V1 §25/§39. The conversion row id, handed back so the
  // partner's outbound REG notification can be enqueued AFTER this transaction
  // commits. It is deliberately not enqueued here: an outbound delivery must
  // never be able to roll back a registration.
  return { conversionEventId: created.id };
}

/**
 * Is this failure the "somebody already spent that journey" collision?
 *
 * Matched on the constraint target rather than on the error code alone, because
 * the same transaction also carries `AffiliateAttribution.userId`, the
 * conversion `eventId` and the conversion source key — and only the visitor
 * collision is recoverable by retrying without attribution. Treating any P2002
 * as recoverable would silently drop a conversion event on a genuine duplicate.
 */
export function isVisitorAlreadyAttributed(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return false;
  const target = JSON.stringify(candidate.meta ?? {});
  return target.includes("anonymousVisitorId");
}
