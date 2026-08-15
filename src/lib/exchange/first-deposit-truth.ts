/**
 * FDCONF-1 — the ONE answer to "has this learner's first deposit been
 * confirmed?", and the only place any surface may get it.
 *
 * ---------------------------------------------------------------------------
 * THE DRIFT THIS EXISTS TO END
 *
 * `ExchangeAccount.firstDepositConfirmed` is a LEGACY column. It is written by
 * the legacy exchange postback processor and by nothing else — in particular the
 * canonical Pocket first-deposit owner (`ingestPocketFirstDeposit`) deliberately
 * does not write it, because a deposit is recorded as a canonical
 * `PocketProviderEvent` and projected into `AffiliateConversionEvent`, and
 * duplicating that fact into a mutable boolean would create a second thing to
 * be wrong.
 *
 * The result, measured on live PREPROD before this module existed, was a
 * disagreement in BOTH directions and an overlap of exactly zero:
 *
 *     legacy TRUE  · canonical FTD present     0 learners
 *     legacy TRUE  · canonical FTD ABSENT      2 learners   (27, 33)
 *     legacy FALSE · canonical FTD present     4 learners   (62, 63, 64, 66)
 *     legacy FALSE · canonical FTD absent     16 learners
 *
 * A learner with a real, qualified, commission-bearing first deposit was being
 * told "Первый депозит подтверждён: нет".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A DUAL WRITE, AND WHY IT IS NOT CANONICAL-ONLY EITHER
 *
 * MIRRORING the canonical event into the legacy column would have made the flag
 * green while leaving two writers of one fact — the exact shape of the bug,
 * re-created one layer down. It is not done, and the canonical owner still does
 * not write that column.
 *
 * READING THE CANONICAL LEDGER ALONE would have silently REVOKED confirmation
 * from learners 27 and 33, whose deposits predate the canonical ledger and whose
 * only surviving evidence is the legacy row. That is rewriting history to tidy
 * up, which §43 forbids. Their deposits happened; the ledger that would have
 * recorded them did not exist yet.
 *
 * SO THE COLUMN IS RETIRED AS AN AUTHORITY AND DEMOTED TO EVIDENCE. There is one
 * resolver, it states which evidence it used, and the canonical ledger always
 * wins when it has an opinion.
 *
 * HOW CLOSED THE LEGACY SET ACTUALLY IS — stated precisely rather than
 * flatteringly, because "closed" is the claim this design rests on:
 *
 *   • NO REMOTE OR PROVIDER-AUTHENTICATED PATH can add to it. The GET Pocket
 *     receiver dispatches `goal=reg` only. The POST receiver's
 *     `isGrowthV1PostbackType` admits an ABSENT `type` only, so `First Deposit`
 *     is refused, and the `eventType` enum it still honours (`deposit`, `trade`,
 *     `balance`, `account_connected`, `account_rejected`) does not normalise to
 *     `first_deposit` — so holding POSTBACK_SECRET does not reach this column.
 *   • ONE PATH REMAINS, AND IT IS AN OPERATOR ACT: the admin postback simulator
 *     (`POST /api/exchange/postbacks/simulate`, `requireAdmin` + CSRF). That is
 *     an ATA staff tool on a synthetic surface, not an ingress. It is named here
 *     rather than pretended away, and it is the reason this comment says the set
 *     is closed to the OUTSIDE rather than closed absolutely.
 *
 * A fallback the network can still grow would be a second source of truth. One
 * only a deliberate operator action can grow is a migration remnant with a
 * shrinking population, which is what this is.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NEVER CONSULTED, AND WHY EACH WOULD BE WRONG
 *
 *   balance             a current trading balance is not a deposit history, and
 *                       this platform is forbidden to hold one at all
 *   totalDeposits       a cumulative sum can be non-zero for a learner whose
 *                       FIRST deposit was never the event that set it
 *   depositAmount       same, and it is legacy accounting rather than an event
 *   checkpoint state    a deposit is not a checkpoint completion (§11), and
 *                       inferring either from the other is how the two truths
 *                       got tangled in the first place
 *   P&L                 not a deposit under any reading
 *
 * No backfill is performed and no migration is added. The answer is derived at
 * read time from evidence that already exists, so there is nothing to keep in
 * sync and nothing to get wrong later.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * WHICH EVIDENCE ANSWERED THE QUESTION.
 *
 * Returned to every caller and rendered wherever staff can see it, so legacy
 * evidence can never again be presented as though the canonical ledger had
 * vouched for it.
 */
export type FirstDepositConfirmationSource =
  /** An `AffiliateConversionEvent` of type `first_deposit` exists for this learner. */
  | "canonical_conversion"
  /** No canonical event; the closed legacy set says this learner deposited. */
  | "legacy_account_record"
  /** Neither. The learner has not deposited. */
  | "none";

export type FirstDepositConfirmation = {
  readonly confirmed: boolean;
  readonly source: FirstDepositConfirmationSource;
  /**
   * When the canonical event says it happened. NULL for the legacy source on
   * purpose: the legacy column carries no instant of its own, and `updatedAt`
   * is the moment the row last changed for any reason. Inventing a date from it
   * would be exactly the inference this module refuses everywhere else.
   */
  readonly occurredAt: Date | null;
};

const NOT_CONFIRMED: FirstDepositConfirmation = {
  confirmed: false,
  source: "none",
  occurredAt: null,
};

/**
 * Resolve the confirmation for MANY learners in two queries.
 *
 * Batched because the CRM user list and the admin account list both need it for
 * a page of learners at a time, and a per-row resolver would have made the
 * correct thing the slow thing — which is how surfaces end up reading the raw
 * column again.
 */
export async function resolveFirstDepositConfirmations(
  db: Db,
  userIds: readonly number[],
): Promise<Map<number, FirstDepositConfirmation>> {
  const resolved = new Map<number, FirstDepositConfirmation>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return resolved;

  // THE CANONICAL LEDGER FIRST. `occurredAt` ascending so that a learner who
  // somehow held more than one row would report the earliest — although the
  // UNIQUE(eventType, sourceOwner, sourceEventId) index and the partial UNIQUE
  // on the provider event make a second first deposit unrepresentable.
  const conversions = await db.affiliateConversionEvent.findMany({
    where: { userId: { in: ids }, eventType: "first_deposit" },
    select: { userId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });

  for (const row of conversions) {
    if (resolved.has(row.userId)) continue;
    resolved.set(row.userId, {
      confirmed: true,
      source: "canonical_conversion",
      occurredAt: row.occurredAt,
    });
  }

  // THE CLOSED LEGACY SET, consulted only for learners the canonical ledger has
  // no opinion about.
  const undecided = ids.filter((id) => !resolved.has(id));
  if (undecided.length > 0) {
    const legacy = await db.exchangeAccount.findMany({
      where: { userId: { in: undecided }, firstDepositConfirmed: true },
      select: { userId: true },
    });
    for (const row of legacy) {
      resolved.set(row.userId, {
        confirmed: true,
        source: "legacy_account_record",
        occurredAt: null,
      });
    }
  }

  for (const id of ids) {
    if (!resolved.has(id)) resolved.set(id, NOT_CONFIRMED);
  }

  return resolved;
}

/** The single-learner form. Same rules, same precedence, no second code path. */
export async function resolveFirstDepositConfirmation(
  db: Db,
  userId: number,
): Promise<FirstDepositConfirmation> {
  const map = await resolveFirstDepositConfirmations(db, [userId]);
  return map.get(userId) ?? NOT_CONFIRMED;
}
