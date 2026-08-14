/**
 * POCKET-DEP-RDEP-1 (§2/§3/§5) — ATA's own deterministic redeposit identity.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * WHAT CHANGED, AND WHO CHANGED IT. This platform previously refused to emit a
 * canonical `rdep` event at all, because Pocket publishes no per-deposit event
 * identifier and ATA would not invent one. That refusal was correct under the
 * old rule and it is NOT the rule any more: the product owner has explicitly
 * decided that an authenticated `goal=redep` delivery is authoritative evidence
 * that a redeposit occurred, and that ATA may derive its own deterministic
 * identity from the authenticated provider attributes.
 *
 * THIS IS NOT A PROVIDER GUARANTEE, AND MUST NEVER BE DESCRIBED AS ONE.
 * `deriveRedepositEventKey` produces an ATA key. Pocket does not promise it is
 * unique per deposit. The residual risk is stated in
 * `BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION` below, is documented in the audit
 * package, and is deliberately visible in this file so that a future engineer
 * reading only the code still learns it.
 *
 * WHY THE KEY IS A STRING NORMALISATION AND NOT AN INSTANT. The key needs
 * DETERMINISM; it does not need to know which clock produced the timestamp. Two
 * deliveries carrying the byte-identical `DATE_TIME` normalise to the same key
 * whatever zone that value is in, so the dedup contract holds even while the
 * zone is undeclared. The absolute instant is a separate question, answered by
 * `resolveRedepositOccurredAt`, which refuses to guess.
 *
 * WHY `clickid` IS NOT IN THE KEY. §2 is explicit and the code agrees: a click
 * is attribution context that repeats across a learner's whole journey. Putting
 * it in the identity would make the same deposit produce two canonical events if
 * the learner ever re-entered through a different link, which is the inverse of
 * what an identity is for.
 */

import { parsePocketDepositAmount } from "@/lib/exchange/pocketDepositAmount";
// The accepted, source-owned IANA facility. Reused rather than reimplemented:
// `localWallClockToUtc` already solves the two-pass DST problem correctly, and a
// second notion of "a valid zone" in this repository would be a defect in itself.
import { localWallClockToUtc, toLocalParts } from "@/lib/analytics/business-time";

/**
 * THE ACCEPTED RESIDUAL RISK, NAMED SO IT CANNOT BE MISTAKEN FOR A GUARANTEE.
 *
 * Two genuinely distinct redeposits by the same player, for the same exact
 * amount, bearing the same provider `DATE_TIME` at one-second precision, derive
 * the SAME key and are recorded as ONE canonical redeposit. The second is
 * treated as a retry of the first.
 *
 * That is a real, reachable case — an automated top-up, a double-click, two
 * fills inside one second — and it is ACCEPTED as a business trade-off, not
 * argued away.
 *
 * If a future engineer wants to remove this risk, the fix is a provider-issued
 * per-deposit identifier, NOT a different derivation. Adding `clickid`, a
 * payload hash, a receive time or a counter to this key makes retries stop
 * deduplicating, which turns one deposit into many and is strictly worse.
 */
export const BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION = {
  id: "BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION",
  decidedBy: "product owner, ATA-PREPROD-POCKET-DEP-RDEP-FINANCIAL-INGRESS-AND-ATTRIBUTION-1",
  claim: "an authenticated goal=redep delivery is authoritative evidence that a redeposit occurred",
  derivation: "provider + eventType + pocketPlayerId + normalised DATE_TIME + canonical amount",
  accepted:
    "two distinct redeposits by one player, same amount, same DATE_TIME second, collapse to one canonical event",
  notAClaimOf: "provider-guaranteed uniqueness",
  retryAssumption:
    "Pocket repeats the same DATE_TIME when it re-sends a delivery; not guaranteed in any documentation available to ATA",
} as const;

/** Bounded so a pathological value cannot reach the pattern or the database. */
const MAX_RAW_EVENT_TIME_LENGTH = 64;

/**
 * The two shapes ATA accepts for a provider event time.
 *
 * `bare` is what Pocket's `DATE_TIME` macro is documented to produce and is the
 * expected case. `zoned` is accepted because a value that states its own offset
 * is strictly better and refusing it would be perverse.
 */
const BARE_SECOND = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})$/;
const ZONED = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|z|[+-]\d{2}:?\d{2})$/;

export type NormalisedProviderEventTime =
  | {
      readonly ok: true;
      /** Deterministic, zone-independent. This is what enters the key. */
      readonly canonical: string;
      /** Whether the value stated its own zone. */
      readonly zone: "declared_by_sender" | "absent";
      /** The exact bytes received, bounded. Kept so a zone can be applied later. */
      readonly raw: string;
    }
  | { readonly ok: false; readonly reason: ProviderEventTimeRejection };

export type ProviderEventTimeRejection =
  | "absent"
  | "too_long"
  | "malformed"
  | "impossible_date";

/**
 * Normalise a provider `DATE_TIME` into a deterministic canonical form.
 *
 * REJECTS RATHER THAN REPAIRS. An impossible date (`2026-02-30`), a malformed
 * shape, a missing value or an over-long one is refused. §4 forbids substituting
 * a receive time, `now()`, `firstReceivedAt` or a payload hash, so there is no
 * fallback in this function at all — the caller fails closed.
 *
 * DETERMINISM IS THE POINT. `2026-08-14 15:30:00`, `2026-08-14T15:30:00` and
 * `2026-08-14t15:30:00` are the same instant written three ways and all
 * normalise to `2026-08-14T15:30:00`, so a retry that differs only in
 * separator still deduplicates. Nothing else is folded: a value carrying an
 * offset keeps it, because two different offsets are two different instants.
 */
export function normaliseProviderEventTime(
  raw: string | undefined | null,
): NormalisedProviderEventTime {
  if (raw === undefined || raw === null) return { ok: false, reason: "absent" };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "absent" };
  if (trimmed.length > MAX_RAW_EVENT_TIME_LENGTH) return { ok: false, reason: "too_long" };

  const zoned = ZONED.exec(trimmed);
  const bare = zoned ? null : BARE_SECOND.exec(trimmed);
  const match = zoned ?? bare;
  if (!match) return { ok: false, reason: "malformed" };

  const [, year, month, day, hour, minute, second] = match;

  // A calendar check, not a `Date` round trip: `new Date('2026-02-30')` rolls
  // forward to March and would silently accept an impossible date.
  if (!isRealCalendarInstant(year, month, day, hour, minute, second)) {
    return { ok: false, reason: "impossible_date" };
  }

  const base = `${year}-${month}-${day}T${hour}:${minute}:${second}`;

  if (zoned) {
    // Canonicalise only the SPELLING of the offset, never its value: `+0200`
    // and `+02:00` are one offset, `Z` and `+00:00` are one offset.
    const offset = zoned[7];
    const canonicalOffset =
      offset === "Z" || offset === "z"
        ? "Z"
        : offset.includes(":")
          ? offset
          : `${offset.slice(0, 3)}:${offset.slice(3)}`;
    return {
      ok: true,
      canonical: `${base}${canonicalOffset === "+00:00" ? "Z" : canonicalOffset}`,
      zone: "declared_by_sender",
      raw: trimmed,
    };
  }

  return { ok: true, canonical: base, zone: "absent", raw: trimmed };
}

function isRealCalendarInstant(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
): boolean {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);

  if (mo < 1 || mo > 12) return false;
  if (h > 23 || mi > 59 || s > 59) return false;

  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d >= 1 && d <= daysInMonth;
}

export type RedepositKeyInput = {
  readonly pocketPlayerId: string;
  readonly rawEventTime: string | undefined | null;
  readonly rawAmount: string | undefined | null;
};

export type RedepositKeyResult =
  | {
      readonly ok: true;
      readonly key: string;
      readonly normalisedAmount: string;
      readonly eventTime: Extract<NormalisedProviderEventTime, { ok: true }>;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "player_missing"
        | `event_time_${ProviderEventTimeRejection}`
        | "amount_rejected";
    };

/** The version prefix. A future derivation change must not collide with this one. */
export const REDEPOSIT_KEY_VERSION = "v1";

/**
 * Derive the canonical ATA redeposit identity.
 *
 * SHAPE: `v1:pocket:redeposit:<playerId>:<canonicalEventTime>:<canonicalAmount>`
 *
 * Every component is already validated and canonical before it arrives here, so
 * the key is a join rather than a second parser. The version prefix exists so
 * that if the derivation ever legitimately changes, old and new keys cannot
 * silently collide in the same unique index.
 *
 * FAIL CLOSED. §4 makes `DATE_TIME` required: with no usable event time there is
 * no key, and with no key the caller must not write a canonical business event.
 */
export function deriveRedepositEventKey(input: RedepositKeyInput): RedepositKeyResult {
  const player = input.pocketPlayerId?.trim() ?? "";
  if (player.length === 0 || !/^[1-9][0-9]{0,15}$/.test(player)) {
    return { ok: false, reason: "player_missing" };
  }

  const eventTime = normaliseProviderEventTime(input.rawEventTime);
  if (!eventTime.ok) return { ok: false, reason: `event_time_${eventTime.reason}` };

  const amount = parsePocketDepositAmount(input.rawAmount ?? undefined);
  if (!amount.ok) return { ok: false, reason: "amount_rejected" };

  return {
    ok: true,
    key: [REDEPOSIT_KEY_VERSION, "pocket", "redeposit", player, eventTime.canonical, amount.normalized].join(":"),
    normalisedAmount: amount.normalized,
    eventTime,
  };
}

/**
 * WHY THERE IS NO GLOBAL PROVIDER TIMEZONE HERE ANY MORE.
 *
 * An earlier revision of this module made a canonical redeposit depend on an
 * operator declaring one zone for all Pocket traffic. That model is wrong, and
 * the product owner has replaced it: Pocket's `DATE_TIME` is rendered in a zone
 * that can vary by user, by account and by registration GEO. ONE global zone
 * would therefore be a fabrication applied uniformly — the worst kind, because
 * it looks authoritative and is wrong per-row rather than obviously absent.
 *
 * The real 2026-08-14 observation — a Warsaw-context registration whose
 * `DATE_TIME` sat at UTC+02:00 — is SUPPORTING EVIDENCE FOR THAT VARIABILITY.
 * It is not authority for a global `Europe/Warsaw`.
 *
 * WHAT THE PROVIDER ACTUALLY GIVES US, and it is enough:
 *   provider, player, exact amount, and a provider-local wall clock.
 * Those four facts identify and describe a redeposit. An unknown zone does not
 * make any of them untrue, so it must not reject the event.
 *
 * SO THE ABSOLUTE INSTANT IS OPTIONAL AND HONEST ABOUT ITSELF. It is populated
 * ONLY when the delivery states its own offset. Otherwise it stays null and the
 * status says why. Nothing here derives an instant from a country, an IP, a
 * browser, a server clock or an operator's location — §4 forbids each of those,
 * and VPNs, travel, DST and multi-zone countries are why.
 */

export type ProviderEventTemporalAuthority =
  /** No usable event time at all. Canonical business mutation must fail closed. */
  | "absent"
  /**
   * A provider-local wall clock, with no zone anybody can vouch for. The
   * redeposit is fully valid; only its absolute instant is unknown.
   */
  | "local_only"
  /**
   * The delivery stated its own offset, so the instant is the provider's own
   * claim rather than an ATA inference.
   */
  | "absolute_from_sender";

export type RedepositTemporal = {
  readonly authority: ProviderEventTemporalAuthority;
  /** The exact bytes received. Always kept when anything usable arrived. */
  readonly raw: string;
  /** Normalised provider-local wall clock. What the dedup key is built from. */
  readonly local: string;
  /** The absolute instant, ONLY when the sender declared its own offset. */
  readonly absolute: Date | null;
};

/**
 * Describe a redeposit's time as truthfully as the delivery allows.
 *
 * NEVER returns a guessed instant. `absolute` is null unless the provider
 * itself stated an offset, and the caller records `authority` beside it so a
 * reader can never mistake "we do not know" for "it happened then".
 */
export function resolveRedepositTemporal(
  eventTime: Extract<NormalisedProviderEventTime, { ok: true }>,
): RedepositTemporal {
  if (eventTime.zone === "declared_by_sender") {
    return {
      authority: "absolute_from_sender",
      raw: eventTime.raw,
      // The wall-clock half, without the offset, so the dedup key stays
      // zone-independent even for a delivery that happens to carry one.
      local: eventTime.canonical.replace(/(Z|[+-]\d{2}:\d{2})$/, ""),
      absolute: new Date(eventTime.canonical),
    };
  }

  return {
    authority: "local_only",
    raw: eventTime.raw,
    local: eventTime.canonical,
    absolute: null,
  };
}
