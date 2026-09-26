/**
 * AFFILIATE-PLATFORM-V1 §6/§13/§14 — THE ONLY WRITER OF PARTNER MONEY.
 *
 * ONE QUALIFYING FTD -> AT MOST ONE QUALIFICATION -> AT MOST ONE COMMISSION.
 * That sentence is the whole domain, and every line below exists to make some
 * way of violating it unrepresentable rather than merely unlikely.
 *
 * ---------------------------------------------------------------------------
 * THE FIVE PRECONDITIONS, AND WHY EACH IS A REFUSAL RATHER THAN A DEFAULT
 *
 *   1. eventType === 'first_deposit'.
 *      A REDEPOSIT NEVER QUALIFIES. §5 and §41 are explicit, and this is where
 *      it is enforced: the function accepts one event type and refuses every
 *      other, so no amount of wiring a redeposit path to this owner could mint
 *      a second CPA. A registration cannot qualify either — REG is a
 *      statistical conversion, not a commercial one.
 *
 *   2. The conversion carries a FROZEN attribution.
 *      Read, never computed. §15: attribution is decided at registration, and a
 *      deposit RESOLVES it. Nothing here selects a click, consults the current
 *      cookie, or looks at which campaign is active now.
 *
 *   3. The attribution names a partner AND a campaign.
 *      A conversion attributed to a link with no campaign has no commercial
 *      owner, because the campaign is where the price lives. It produces NO
 *      qualification. It is not an error and not a defect: it is a link that
 *      was never given commercial terms, and inventing a partner or a default
 *      price for it would be exactly the guess §6 forbids.
 *
 *   4. The campaign has an ACTIVE terms version.
 *      No active price means no agreed price. Falling back to the most recent
 *      superseded version would be ATA deciding a commercial term on a
 *      partner's behalf.
 *
 *   5. The switch is on.
 *      §36. Read at the moment of the deposit so a deploy can carry the code
 *      without arming it.
 *
 * EVERY REFUSAL IS NAMED AND RETURNED. The caller records which one happened,
 * so "this deposit produced no commission" is always answerable with a reason
 * rather than with a shrug.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WHOLE THING IS ONE TRANSACTION, AND WHY IT IS NOT THE DEPOSIT'S
 *
 * The qualification and the commission are written together: a qualification
 * with no commission is a promise nobody will pay, and a commission with no
 * qualification is money with no reason. They commit or they do not.
 *
 * But that transaction is NOT the transaction that recorded the deposit. §28's
 * principle — conversion truth commits independently of what it triggers —
 * applies here for a stronger reason than it does for postbacks: the deposit is
 * a FACT ABOUT A LEARNER'S MONEY and must survive any failure in ATA's
 * commercial arithmetic. So `qualifyFirstDeposit` is called after the deposit
 * has committed, it swallows nothing silently but it fails alone, and a deposit
 * whose qualification failed is recoverable by running the owner again —
 * because it is idempotent.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCY IS THE UNIQUE INDEX, NOT A PRE-CHECK
 *
 * A `findFirst` before the insert would be a race with a window in it. The
 * insert is attempted, and a UNIQUE(conversionEventId) collision is read as
 * "someone else already qualified this", which is the correct and final answer.
 * The pre-read that also exists is a fast path for the common case, not the
 * guarantee.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { isCpaQualificationEnabled } from "@/lib/affiliate/platform-config";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Why a first deposit produced no partner money. Every value is a FACT about
 * the deposit or the configuration, never an error condition.
 */
export type CpaQualificationRefusal =
  | "qualification_disabled"
  | "conversion_not_found"
  | "not_a_first_deposit"
  | "unattributed"
  | "no_commercial_campaign"
  | "no_active_terms";

export type CpaQualificationResult =
  | {
      readonly outcome: "qualified";
      readonly qualificationId: number;
      readonly commissionId: number;
      readonly amount: string;
      readonly currencyCode: string;
    }
  /** Already qualified. The canonical answer to a retry, and not a failure. */
  | { readonly outcome: "already_qualified"; readonly qualificationId: number }
  | { readonly outcome: "not_qualified"; readonly reason: CpaQualificationRefusal };

/**
 * Qualify one first-deposit conversion, if every precondition holds.
 *
 * TAKES A CONVERSION ROW ID, NOT A USER OR A PLAYER. The conversion is the
 * canonical statement that a first deposit happened and who it is attributed
 * to; re-deriving either from a learner id would be a second opinion about a
 * fact that already has an owner.
 */
export async function qualifyFirstDeposit(
  db: PrismaClient,
  conversionEventId: number,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<CpaQualificationResult> {
  if (!isCpaQualificationEnabled(env)) {
    return { outcome: "not_qualified", reason: "qualification_disabled" };
  }

  const conversion = await db.affiliateConversionEvent.findUnique({
    where: { id: conversionEventId },
    select: {
      id: true,
      eventType: true,
      attributionId: true,
      affiliatePartnerId: true,
      affiliateCampaignId: true,
      trackingLinkId: true,
      affiliateCodeSnapshot: true,
      campaignCodeSnapshot: true,
      cpaQualification: { select: { id: true } },
    },
  });

  if (conversion === null) {
    return { outcome: "not_qualified", reason: "conversion_not_found" };
  }
  if (conversion.cpaQualification !== null) {
    return { outcome: "already_qualified", qualificationId: conversion.cpaQualification.id };
  }
  // THE REDEPOSIT GATE. One comparison, and it is the reason a redeposit can
  // never mint a second CPA no matter how it is wired.
  if (conversion.eventType !== "first_deposit") {
    return { outcome: "not_qualified", reason: "not_a_first_deposit" };
  }
  if (
    conversion.attributionId === null ||
    conversion.affiliatePartnerId === null ||
    conversion.affiliateCodeSnapshot === null
  ) {
    return { outcome: "not_qualified", reason: "unattributed" };
  }
  if (conversion.affiliateCampaignId === null || conversion.campaignCodeSnapshot === null) {
    return { outcome: "not_qualified", reason: "no_commercial_campaign" };
  }

  // THE ACTIVE PRICE. `findFirst` on a column pair the partial unique index
  // guarantees is at most one row — the index is the constraint, this is the
  // read.
  const terms = await db.affiliateCampaignTerms.findFirst({
    where: { affiliateCampaignId: conversion.affiliateCampaignId, status: "active" },
    select: { id: true, version: true, cpaAmount: true, cpaCurrency: true },
  });

  if (terms === null) {
    return { outcome: "not_qualified", reason: "no_active_terms" };
  }

  const partnerId = conversion.affiliatePartnerId;
  const campaignId = conversion.affiliateCampaignId;
  const attributionId = conversion.attributionId;

  try {
    return await db.$transaction(async (tx) => {
      const qualification = await tx.affiliateCpaQualification.create({
        data: {
          publicId: randomBase32Id(),
          conversionEventId: conversion.id,
          affiliatePartnerId: partnerId,
          affiliateCampaignId: campaignId,
          attributionId,
          trackingLinkId: conversion.trackingLinkId,
          termsId: terms.id,
          // THE SNAPSHOT. Copied, not joined. §11: changing the campaign's CPA
          // from 100 to 150 later must not rewrite this row, and it cannot —
          // the version it names is immutable and these values are its own.
          termsVersionSnapshot: terms.version,
          cpaAmountSnapshot: terms.cpaAmount,
          cpaCurrencySnapshot: terms.cpaCurrency,
          affiliateCodeSnapshot: conversion.affiliateCodeSnapshot!,
          campaignCodeSnapshot: conversion.campaignCodeSnapshot!,
          qualifiedAt: now,
        },
        select: { id: true },
      });

      const commission = await tx.affiliateCommission.create({
        data: {
          publicId: randomBase32Id(),
          qualificationId: qualification.id,
          affiliatePartnerId: partnerId,
          // THE COMMISSION AMOUNT IS THE CPA, NOT THE DEPOSIT. This is the
          // single most consequential assignment in the platform: the
          // conversion's `providerAmount` is deliberately not in scope in this
          // block, so it cannot be typed here by accident.
          amount: terms.cpaAmount,
          currencyCode: terms.cpaCurrency,
        },
        select: { id: true },
      });

      return {
        outcome: "qualified" as const,
        qualificationId: qualification.id,
        commissionId: commission.id,
        amount: terms.cpaAmount,
        currencyCode: terms.cpaCurrency,
      };
    });
  } catch (error) {
    // THE RACE, AND ITS ONLY CORRECT RESOLUTION. Two concurrent callers both
    // passed every precondition; one won the unique index. The loser did not
    // fail — it learned the answer.
    if (isQualificationCollision(error)) {
      const existing = await db.affiliateCpaQualification.findUnique({
        where: { conversionEventId },
        select: { id: true },
      });
      if (existing !== null) {
        return { outcome: "already_qualified", qualificationId: existing.id };
      }
    }
    throw error;
  }
}

/**
 * Is this the "already qualified" collision, and not some other unique failure?
 *
 * MATCHED ON THE CONSTRAINT TARGET, not on the code alone. The same transaction
 * also carries two `publicId` uniques, and a random-id collision is a
 * completely different event that must not be silently reported as a duplicate
 * qualification.
 */
export function isQualificationCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return false;
  return JSON.stringify(candidate.meta ?? {}).includes("conversionEventId");
}

/**
 * Qualify without failing the caller.
 *
 * FOR THE DEPOSIT PATH, WHICH MUST NOT BE ROLLED BACK BY COMMERCIAL
 * ARITHMETIC. A learner's deposit is a fact about their money; ATA's CPA
 * bookkeeping is a fact about ATA's contracts. If the second one throws, the
 * first one stays true, and running this owner again later reaches the same
 * answer because it is idempotent.
 *
 * THE FAILURE IS NOT SWALLOWED SILENTLY — it is returned as an outcome the
 * caller records, so a deposit with no commission always has a stated reason.
 */
export async function qualifyFirstDepositSafely(
  conversionEventId: number,
  now: Date = new Date(),
  db: PrismaClient = prisma,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CpaQualificationResult | { readonly outcome: "failed" }> {
  try {
    return await qualifyFirstDeposit(db, conversionEventId, now, env);
  } catch {
    return { outcome: "failed" };
  }
}
