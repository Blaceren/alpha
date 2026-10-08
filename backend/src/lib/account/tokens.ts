/**
 * ACCOUNT RECOVERY — the one-time token behind a link in an email.
 *
 * WHAT A TOKEN IS. 32 random bytes, base64url, sent once in a link and stored
 * only as its SHA-256. The database can find the row a link names; it cannot
 * be turned back into a link.
 *
 * AT MOST ONE LIVE LINK OF A KIND. Issuing a link retires the learner's earlier
 * live links of the same kind, in the same transaction. A person who asked
 * three times has one link that works — the last one — which is also the one
 * at the top of their inbox.
 *
 * USED ONCE, AND THE DATABASE DECIDES WHO USED IT. Consumption is one UPDATE
 * guarded by "not used, not retired, not expired": two requests carrying the
 * same link cannot both win it. The caller runs it inside the transaction that
 * performs the action, so a link is spent exactly when its action commits.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const ACCOUNT_TOKEN_KINDS = ["password_reset", "email_change"] as const;
export type AccountTokenKind = (typeof ACCOUNT_TOKEN_KINDS)[number];

/** How long a link works. A reset is short; a new address may be read tomorrow. */
export const ACCOUNT_TOKEN_TTL_MS: Record<AccountTokenKind, number> = {
  password_reset: 60 * 60 * 1000,
  email_change: 24 * 60 * 60 * 1000,
};

/** 32 bytes in base64url are exactly 43 characters of this alphabet. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isAccountTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

export function hashAccountToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Retire every live link of one kind a learner has. */
export async function revokeAccountActionTokens(
  tx: Prisma.TransactionClient,
  userId: number,
  kind: AccountTokenKind,
  now: Date = new Date(),
): Promise<void> {
  await tx.accountActionToken.updateMany({
    where: { userId, kind, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
}

/** Issue a link's token. Returns the RAW token, which goes into the email and nowhere else. */
export async function issueAccountActionToken(
  tx: Prisma.TransactionClient,
  input: { userId: number; kind: AccountTokenKind; newEmail?: string | null; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  await revokeAccountActionTokens(tx, input.userId, input.kind, now);
  const raw = randomBytes(32).toString("base64url");
  await tx.accountActionToken.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      tokenHash: hashAccountToken(raw),
      newEmail: input.kind === "email_change" ? (input.newEmail ?? null) : null,
      expiresAt: new Date(now.getTime() + ACCOUNT_TOKEN_TTL_MS[input.kind]),
    },
  });
  return raw;
}

/**
 * Spend a link. Returns whose it was, or null when the link is unknown, of
 * another kind, already used, retired or expired — one answer for all five,
 * because the person holding a dead link needs to ask for a new one whichever
 * it was, and nobody else should learn which.
 */
export async function consumeAccountActionToken(
  tx: Prisma.TransactionClient,
  raw: unknown,
  kind: AccountTokenKind,
  now: Date = new Date(),
): Promise<{ userId: number; newEmail: string | null } | null> {
  if (!isAccountTokenShape(raw)) return null;
  const tokenHash = hashAccountToken(raw);
  const claimed = await tx.accountActionToken.updateMany({
    where: { tokenHash, kind, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) return null;
  return tx.accountActionToken.findUnique({
    where: { tokenHash },
    select: { userId: true, newEmail: true },
  });
}
