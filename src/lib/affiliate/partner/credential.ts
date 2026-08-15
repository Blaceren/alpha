/**
 * AFFILIATE-PLATFORM-V1 §17 — the partner credential lifecycle.
 *
 * bcrypt AT COST 10, the same construction and cost the learner credential
 * already uses. Not a new scheme: introducing a second password format would
 * mean two things to audit, two things to rotate and two chances to get the
 * comparison wrong, for no gain.
 *
 * AUTHENTICATION IS CONSTANT-WORK BY CONSTRUCTION. An unknown email compares
 * the supplied password against a fixed decoy digest instead of returning
 * early, so the response time of "no such partner login" and "wrong password"
 * do not differ by a bcrypt round. Both then produce one identical bounded
 * refusal, so nothing distinguishes them to a caller either.
 *
 * NO PASSWORD IS EVER LOGGED, AUDITED, ECHOED OR INCLUDED IN AN ERROR. The only
 * value that leaves this module is a digest.
 */
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export const PARTNER_PASSWORD_BCRYPT_COST = 10;

/**
 * The password policy, stated once.
 *
 * A LENGTH FLOOR AND A VARIETY FLOOR, and no composition theatre. Requiring a
 * symbol and a digit produces `Password1!`; requiring twelve characters and
 * eight distinct ones does not have an obvious cheapest answer.
 */
export const PARTNER_PASSWORD_MIN_LENGTH = 12;
export const PARTNER_PASSWORD_MAX_LENGTH = 200;
const PARTNER_PASSWORD_MIN_DISTINCT_CHARS = 8;

export type PartnerPasswordRejection =
  | "too_short"
  | "too_long"
  | "low_variety"
  | "contains_email";

/**
 * A digest of a value no login will ever supply, used as the comparison target
 * when the email is unknown.
 *
 * IT IS COMPUTED ONCE AT MODULE LOAD, from random bytes, so it is neither a
 * constant somebody could recognise in a heap dump nor a per-request cost.
 */
const DECOY_DIGEST = bcrypt.hashSync(
  crypto.randomBytes(32).toString("base64"),
  PARTNER_PASSWORD_BCRYPT_COST,
);

export function describePartnerPasswordRejection(
  password: string,
  email: string,
): PartnerPasswordRejection | null {
  if (password.length < PARTNER_PASSWORD_MIN_LENGTH) return "too_short";
  if (password.length > PARTNER_PASSWORD_MAX_LENGTH) return "too_long";
  if (new Set(password).size < PARTNER_PASSWORD_MIN_DISTINCT_CHARS) return "low_variety";
  const local = email.split("@")[0] ?? "";
  if (local.length >= 3 && password.toLowerCase().includes(local.toLowerCase())) {
    return "contains_email";
  }
  return null;
}

export async function hashPartnerPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PARTNER_PASSWORD_BCRYPT_COST);
}

/**
 * Normalise an email for storage and lookup.
 *
 * LOWERCASE AND TRIMMED, and that is the whole rule. No plus-address stripping
 * and no dot folding: those are provider-specific policies, and applying them
 * would silently merge two addresses a partner considers distinct. The storage
 * CHECK refuses any value this function would not have produced.
 */
export function normalisePartnerEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type PartnerAuthenticationOutcome =
  | { readonly kind: "authenticated"; readonly partnerUserId: number; readonly sessionEpoch: number }
  /** Unknown email, wrong password, disabled login or non-active partner. */
  | { readonly kind: "refused" };

/**
 * Authenticate an email and password.
 *
 * ONE OUTCOME FOR EVERY FAILURE. Unknown address, wrong password, disabled
 * principal and paused partner are four different facts, and a caller learns
 * none of them: distinguishing "no such account" from "wrong password" turns
 * this endpoint into a partner-directory oracle, and distinguishing "disabled"
 * would tell a dismissed employee exactly what happened.
 *
 * THE PARTNER'S STATUS IS CHECKED HERE TOO, not only at request time. Minting a
 * session for a paused partner and then refusing every subsequent request with
 * 403 would be a working login that leads to a dead console.
 */
export async function authenticatePartnerUser(
  email: string,
  password: string,
  db: Db = prisma,
): Promise<PartnerAuthenticationOutcome> {
  const normalised = normalisePartnerEmail(email);

  const row = await db.affiliatePartnerUser.findUnique({
    where: { email: normalised },
    select: {
      id: true,
      passwordHash: true,
      status: true,
      sessionEpoch: true,
      partner: { select: { status: true } },
    },
  });

  // ALWAYS RUN THE COMPARISON. Returning early on an unknown address would make
  // the absence of an account measurable by a stopwatch.
  const digest = row?.passwordHash ?? DECOY_DIGEST;
  const passwordMatches = await bcrypt.compare(password, digest);

  if (row === null) return { kind: "refused" };
  if (!passwordMatches) return { kind: "refused" };
  if (row.status !== "active") return { kind: "refused" };
  if (row.partner.status !== "active") return { kind: "refused" };

  return { kind: "authenticated", partnerUserId: row.id, sessionEpoch: row.sessionEpoch };
}

/**
 * Change a partner human's own password.
 *
 * THE EPOCH IS BUMPED IN THE SAME UPDATE. Every token issued before this
 * moment stops verifying, including the one the caller is holding — which is
 * why the route re-issues a session immediately afterwards. A password change
 * that left old sessions alive would be the exact failure the epoch exists for.
 */
export async function changePartnerPassword(
  db: Db,
  input: { partnerUserId: number; newPasswordHash: string; now: Date },
): Promise<number> {
  const updated = await db.affiliatePartnerUser.update({
    where: { id: input.partnerUserId },
    data: {
      passwordHash: input.newPasswordHash,
      passwordUpdatedAt: input.now,
      sessionEpoch: { increment: 1 },
    },
    select: { sessionEpoch: true },
  });
  return updated.sessionEpoch;
}
