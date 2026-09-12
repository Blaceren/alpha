/**
 * ATA invite referral code carried on `/register?ref=...`.
 *
 * ## What this value is — and what it is NOT
 *
 * `ref` is an **ATA** referral code: the `User.referralCode` column, minted by
 * Backend and handed to a learner as `PUBLIC_APP_URL/register?ref=<code>`. The
 * registration owner exchanges it for the inviting user and, if the referral
 * bonus config is active, records a `Referral` row inside the registration
 * transaction.
 *
 * It is emphatically NOT any of:
 *   - an affiliate tracking code,
 *   - `ataClickId` / `externalAffiliateClickId` (AFD-3B, not implemented),
 *   - a Pocket `click_id` / `clickid` / `playerid`.
 *
 * It is never sent to Pocket, never used to pick a redirect target, and never
 * logged as part of a raw query string.
 *
 * ## Bounds
 *
 * The authoritative Backend field is
 * `referralCode: z.string().trim().min(1).max(100).optional()`. We mirror those
 * bounds exactly and additionally require a conservative code alphabet, because
 * every code Backend mints is a cuid and the only other codes in existence are
 * operator-assigned ASCII identifiers.
 *
 * A value we cannot vouch for is NOT forwarded. Registration then proceeds
 * without a referral and the page says so plainly — that is strictly better
 * than forwarding a value that is guaranteed to fail Backend validation and
 * block the account entirely.
 */

/** Backend's `.max(100)`, mirrored exactly. */
export const MAX_REFERRAL_CODE_LENGTH = 100;

/** cuid and every operator-assigned code in use fit inside this alphabet. */
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export type ReferralCodeResult =
  /** No `ref` in the URL at all. Registration without a referral is valid. */
  | { status: "absent"; code: null }
  /** Well-formed and within Backend's bounds. Safe to forward verbatim. */
  | { status: "valid"; code: string }
  /** Present but unusable. Not forwarded; the UI explains it was not applied. */
  | { status: "malformed"; code: null };

/**
 * Normalize a raw `ref` query value into a forwarding decision.
 *
 * Trims (Backend trims too, so we agree on the value before it is sent) and
 * validates length + alphabet. Never throws.
 */
export function sanitizeReferralCode(raw: string | null | undefined): ReferralCodeResult {
  if (raw === null || raw === undefined) return { status: "absent", code: null };

  const trimmed = raw.trim();
  if (trimmed === "") return { status: "absent", code: null };

  if (trimmed.length > MAX_REFERRAL_CODE_LENGTH) return { status: "malformed", code: null };
  if (!REFERRAL_CODE_PATTERN.test(trimmed)) return { status: "malformed", code: null };

  return { status: "valid", code: trimmed };
}

/**
 * Read `ref` from a query source, tolerating a repeated parameter.
 *
 * `URLSearchParams.get` already returns the FIRST occurrence, which is the
 * documented policy here: `?ref=a&ref=b` uses `a`. We do not concatenate,
 * prefer the last, or treat a repeat as an error — a repeat is simply not a
 * signal we act on.
 */
export function readReferralCode(params: URLSearchParams | null | undefined): ReferralCodeResult {
  if (!params) return { status: "absent", code: null };
  return sanitizeReferralCode(params.get("ref"));
}
