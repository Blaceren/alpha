/**
 * AFD-5B2B — keyset cursors for the lead list.
 *
 * WHY KEYSET AND NOT OFFSET. An offset re-walks the whole prefix on every page
 * and, worse, silently skips or repeats rows when the underlying set shifts
 * between requests. A lead list is read while registrations are still arriving,
 * so an operator paging through it with OFFSET would miss leads and never know.
 * A keyset cursor names the exact position it left off at, so a row inserted
 * behind the cursor cannot displace anything ahead of it.
 *
 * A CURSOR IS A POSITION, NOT A CAPABILITY. It carries a sort key, a null-bucket
 * flag, a row id and a fingerprint of the active filters — no email, no name, no
 * user id, no permission and no session material. It is therefore NOT signed,
 * exactly like the CRM users cursor: tampering can only move the caller to a
 * different position within rows they were already entitled to read, or produce
 * a 400. It can never widen access, because access is decided before the cursor
 * is ever decoded.
 *
 * IT IS BOUND TO ITS QUERY. The fingerprint covers every resolved filter, both
 * periods and the sort. Changing any of them while replaying a cursor is a 400
 * rather than a quietly wrong page — a cursor taken from a "Beta, confirmed"
 * page and replayed against "Alpha, all" would otherwise resume at a position
 * that means nothing in the new ordering.
 */
import crypto from "node:crypto";
import { AffiliateInputError } from "@/lib/crm/affiliates";

export const LEAD_CURSOR_VERSION = 1;
export const LEAD_CURSOR_MAX_LENGTH = 512;

/**
 * The decoded position.
 *
 * `nullBucket` exists because three of the six sorts order by a column that is
 * legitimately absent — a direct lead has no acquisition instant, a lead that
 * never reached Pocket has no binding, and most leads have no deposit. Those
 * rows are collected into a second bucket that always sorts LAST, in both
 * directions, so "no value" is never confused with "the smallest value" and the
 * ordering does not flip meaning when the caller reverses direction.
 */
export type LeadCursor = {
  readonly nullBucket: boolean;
  /** Null exactly when `nullBucket` is true. */
  readonly sortValue: Date | null;
  readonly rowId: number;
};

type CursorWire = {
  v: number;
  f: string;
  n: 0 | 1;
  t: string | null;
  i: number;
};

/**
 * A stable digest of everything that shapes the ordering.
 *
 * Built from an ALREADY-RESOLVED, canonically ordered description, never from
 * the raw query string: `?preset=today&affiliatePartnerId=3` and
 * `?affiliatePartnerId=3&preset=today` are the same query and must produce the
 * same fingerprint. Truncated to 16 hex characters — this detects an accidental
 * or deliberate mismatch, and it is not a security boundary, so a full digest
 * would only make the cursor longer.
 */
export function cursorFingerprint(canonicalQuery: string): string {
  return crypto
    .createHash("sha256")
    .update(`ata.afd5b2b.lead-cursor.v${LEAD_CURSOR_VERSION}:${canonicalQuery}`)
    .digest("hex")
    .slice(0, 16);
}

export function encodeLeadCursor(cursor: LeadCursor, fingerprint: string): string {
  const wire: CursorWire = {
    v: LEAD_CURSOR_VERSION,
    f: fingerprint,
    n: cursor.nullBucket ? 1 : 0,
    t: cursor.sortValue === null ? null : cursor.sortValue.toISOString(),
    i: cursor.rowId,
  };
  return Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
}

/**
 * Decode and validate. Every failure is the same bounded 400.
 *
 * STRICT SCHEMA: exactly five keys, exactly these names, exactly these types.
 * An extra key is a refusal rather than something to ignore — a cursor carrying
 * a field this version does not understand is not a cursor this version issued,
 * and parsing it hopefully is how a rolled-back deployment starts returning
 * subtly wrong pages.
 *
 * The fingerprint is compared with a plain equality: it authenticates nothing,
 * it only detects a mismatch, so there is no timing channel worth defending.
 */
export function decodeLeadCursor(raw: string, expectedFingerprint: string): LeadCursor {
  const reject = (): never => {
    throw new AffiliateInputError("crm.leads.cursor_invalid");
  };

  if (raw.length > LEAD_CURSOR_MAX_LENGTH) reject();

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
  } catch {
    // Decoder exceptions never escape: a malformed cursor is plain bad input,
    // and its content is never quoted back to the caller.
    return reject();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) reject();
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "f,i,n,t,v") reject();

  if (record.v !== LEAD_CURSOR_VERSION) reject();
  if (typeof record.f !== "string") reject();
  if (record.f !== expectedFingerprint) {
    // A DISTINCT code, because "your cursor is corrupt" and "your cursor belongs
    // to a different query" send an operator to completely different places.
    throw new AffiliateInputError("crm.leads.cursor_filter_mismatch");
  }
  if (record.n !== 0 && record.n !== 1) reject();
  if (!Number.isSafeInteger(record.i) || (record.i as number) < 1) reject();

  const nullBucket = record.n === 1;
  if (nullBucket) {
    if (record.t !== null) reject();
    return { nullBucket: true, sortValue: null, rowId: record.i as number };
  }

  if (typeof record.t !== "string") reject();
  const value = new Date(record.t as string);
  if (Number.isNaN(value.getTime())) reject();
  // Round-trip check: only the exact ISO rendering this encoder produces is
  // accepted, so two spellings of one instant cannot become two positions.
  if (value.toISOString() !== record.t) reject();

  return { nullBucket: false, sortValue: value, rowId: record.i as number };
}
