/**
 * L4PA-1 — the server-side binding between an ATA learner and a Pocket trader.
 *
 * WHAT PROBLEM THIS SOLVES
 * The Pocket Partner API answers questions about a `user_id`. To ask it about
 * "this learner" the platform must first know, on the SERVER, which Pocket
 * trader that learner is. The learner is never asked: they cannot submit a
 * playerid, a user_id, a Pocket login or a clickid anywhere, because a
 * self-declared identity would let anyone point the $50 financial checkpoint at
 * a stranger's funded account.
 *
 * THE ONLY TRUSTED SOURCE
 * The identity arrives on an AUTHENTICATED Pocket registration postback
 * (`goal=reg`), whose `playerid` the operator confirmed is the same identifier
 * the Partner API calls `user_id`. That route already enforces a mandatory
 * header secret, timing-safe comparison, rate limiting and rejection of
 * URL-borne auth material (see pocketPostbackAuth.ts); binding happens strictly
 * inside that authenticated boundary and only after the clickid has been
 * resolved to a real learner.
 *
 * WHY NOT `ExchangeAccount.traderId`
 * See the PocketTraderIdentity model comment: that column is nullable,
 * non-unique, written by every postback goal and silently overwritten, and it
 * is itself one of the OR-branches the account lookup searches. It is an
 * attribution hint. This module deliberately does not read it, does not
 * backfill from it, and does not keep it in sync — the two facts are allowed to
 * disagree, and only this one authorises anything.
 *
 * CONFLICTS NEVER OVERWRITE
 * Every outcome below is either "the binding now exists exactly as claimed" or
 * "nothing changed". There is no code path that rebinds a learner to a new
 * trader or a trader to a new learner. Rebinding is an operator act with its own
 * review, not a side effect of an inbound HTTP request.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

/** The one provenance this phase writes. Matches the DB CHECK constraint. */
export const POCKET_IDENTITY_SOURCE_REGISTRATION = "registration_postback";

/**
 * Pocket trader IDs are strictly positive decimal integers. The upper bound is
 * `Number.MAX_SAFE_INTEGER` (16 digits) because the Partner API returns
 * `user_id` as a JSON NUMBER: an identifier beyond that range could not be
 * compared to the response without silent precision loss, so it is refused
 * rather than stored and later mis-matched.
 */
const MAX_POCKET_USER_ID_DIGITS = 16;
const CANONICAL_DECIMAL = /^[1-9][0-9]*$/;

/**
 * Reduce an untrusted identifier to its canonical decimal spelling, or reject.
 *
 * Canonicalisation is what makes the UNIQUE index meaningful: `"007"`, `" 7 "`,
 * `"+7"` and `"7"` must not be four different rows for one trader. Anything that
 * is not already an unpadded, unsigned, non-zero decimal integer within the
 * safe range is refused outright rather than coerced — a coerced identity is a
 * wrong identity, and this one authorises a financial gate.
 */
export function parsePocketUserId(raw: unknown): string | null {
  const text =
    typeof raw === "string"
      ? raw.trim()
      : typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
        ? String(raw)
        : null;

  if (text === null || text.length === 0 || text.length > MAX_POCKET_USER_ID_DIGITS) {
    return null;
  }
  if (!CANONICAL_DECIMAL.test(text)) {
    return null;
  }
  // Redundant given the digit bound, but stated explicitly so the safe-integer
  // guarantee the Partner API comparison relies on is enforced here, once.
  if (!Number.isSafeInteger(Number(text))) {
    return null;
  }
  return text;
}

/**
 * The complete outcome vocabulary. Every member is non-financial and safe to
 * record in an AuditLog reason field.
 *
 * `bound` and `already_bound` are distinguished because "we learned something
 * new" and "we were told what we already knew" are different operational facts,
 * and only the first should ever be surprising on a mature account.
 */
export type PocketIdentityBindOutcome =
  /** No binding existed; this claim created it. */
  | "bound"
  /** The identical binding already existed. Idempotent replay. */
  | "already_bound"
  /** The learner is already bound to a DIFFERENT Pocket trader. */
  | "conflict_learner_bound"
  /** The Pocket trader is already bound to a DIFFERENT learner. */
  | "conflict_trader_bound"
  /** The claimed identifier is absent, malformed, zero, signed or too large. */
  | "invalid_pocket_user_id"
  /** The clickid the claim arrived on is absent or malformed. */
  | "invalid_click_id";

export type PocketIdentityBindResult = {
  readonly outcome: PocketIdentityBindOutcome;
  /** True only when this call created the row. Never true for a replay. */
  readonly created: boolean;
};

export type PocketIdentityDb = Pick<PrismaClient, "pocketTraderIdentity">;

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

const MAX_CLICK_ID_LENGTH = 200;

export type BindPocketTraderIdentityInput = {
  readonly userId: number;
  /** Untrusted value straight off the postback query string. */
  readonly pocketUserId: unknown;
  /** The clickid already resolved to this learner by the caller. */
  readonly clickId: string;
  readonly db: PocketIdentityDb;
  readonly now?: Date;
};

/**
 * Bind a learner to a Pocket trader, or explain why nothing changed.
 *
 * CONCURRENCY. The read-then-write below is a fast path, not the guarantee. Two
 * simultaneous registration postbacks can both see "no binding" and both
 * attempt the insert; the DATABASE decides, because `userId` and `pocketUserId`
 * are both UNIQUE. The loser catches P2002, re-reads, and reports
 * `already_bound` when the winner wrote the identical fact or the matching
 * conflict when it did not. That is why the insert is never an upsert: an upsert
 * would resolve the race by overwriting, which is precisely the behaviour this
 * table exists to prevent.
 */
export async function bindPocketTraderIdentity(
  input: BindPocketTraderIdentityInput,
): Promise<PocketIdentityBindResult> {
  const pocketUserId = parsePocketUserId(input.pocketUserId);
  if (pocketUserId === null) {
    return { outcome: "invalid_pocket_user_id", created: false };
  }

  const clickId = typeof input.clickId === "string" ? input.clickId.trim() : "";
  if (clickId.length === 0 || clickId.length > MAX_CLICK_ID_LENGTH) {
    return { outcome: "invalid_click_id", created: false };
  }

  const settled = await classifyExisting(input.db, input.userId, pocketUserId);
  if (settled) return settled;

  try {
    await input.db.pocketTraderIdentity.create({
      data: {
        userId: input.userId,
        pocketUserId,
        clickId,
        source: POCKET_IDENTITY_SOURCE_REGISTRATION,
        ...(input.now ? { boundAt: input.now } : {}),
      },
    });
    return { outcome: "bound", created: true };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    // Lost the race. Whatever the winner wrote is now the authoritative fact,
    // and it is re-read rather than assumed: the winner may have written the
    // same binding (a replay) or a different one (a conflict).
    const raced = await classifyExisting(input.db, input.userId, pocketUserId);
    return raced ?? { outcome: "conflict_learner_bound", created: false };
  }
}

/**
 * Decide the outcome from what is already stored, or `null` when nothing is.
 *
 * Learner-side conflict is checked before trader-side because a learner already
 * bound to trader B being offered trader A is a statement about THIS learner,
 * and reporting it as "that trader belongs to someone else" would be misleading
 * in the case where both are true.
 */
async function classifyExisting(
  db: PocketIdentityDb,
  userId: number,
  pocketUserId: string,
): Promise<PocketIdentityBindResult | null> {
  const [byLearner, byTrader] = await Promise.all([
    db.pocketTraderIdentity.findUnique({
      where: { userId },
      select: { pocketUserId: true },
    }),
    db.pocketTraderIdentity.findUnique({
      where: { pocketUserId },
      select: { userId: true },
    }),
  ]);

  if (byLearner) {
    return byLearner.pocketUserId === pocketUserId
      ? { outcome: "already_bound", created: false }
      : { outcome: "conflict_learner_bound", created: false };
  }
  if (byTrader) {
    return { outcome: "conflict_trader_bound", created: false };
  }
  return null;
}

/**
 * The trusted Pocket user ID for a learner, or `null` when none is bound.
 *
 * This is the ONLY way the checkpoint provider learns who to ask about. It takes
 * a learner id — never a caller-supplied identifier — so there is no parameter
 * through which a request could nominate a different Pocket account.
 */
export async function resolvePocketTraderIdentity(
  userId: number,
  db: PocketIdentityDb,
): Promise<string | null> {
  const row = await db.pocketTraderIdentity.findUnique({
    where: { userId },
    select: { pocketUserId: true },
  });
  return row?.pocketUserId ?? null;
}

/**
 * Bounded, non-financial audit metadata for a binding attempt.
 *
 * The Pocket identifier itself is NOT included: an AuditLog row is a broadly
 * readable operational record, and a trader identifier there would spread a
 * third-party account identity across the platform for no operational gain. The
 * outcome name is what an operator needs; the binding row is where the identity
 * lives.
 */
export function pocketIdentityAuditMetadata(
  result: PocketIdentityBindResult,
): Prisma.InputJsonValue {
  return { outcome: result.outcome, created: result.created };
}
