/**
 * AFD-5B2B — the opaque lead reference and the redacted identity contract.
 *
 * WHAT A LEAD IS. Exactly one `academy_registration` AffiliateConversionEvent,
 * and therefore exactly one learner the public registration owner created. The
 * lead is defined by that immutable ledger row rather than by mutable user
 * state — see `lead-sources.ts` — and so is its public name.
 *
 * WHY THE REFERENCE IS THE CONVERSION `eventId` AND NOT AN HMAC OF THE USER ID.
 * AFD-3B2 already generates `eventId` from `randomBase32Id()`: 160 CSPRNG bits,
 * globally unique, written once inside the registration transaction and never
 * updated. It is the established opaque-identifier owner of this platform, and
 * reusing it beats deriving a new reference from the User id on four counts:
 *
 *   • It is not DERIVED from the User id at all, so it is non-reversible in the
 *     information-theoretic sense rather than the computational one. There is
 *     no preimage to attack because there is no preimage.
 *   • It needs NO SECRET. An HMAC reference would have to read a signing key,
 *     and the only always-present key on this deployment is SESSION_SECRET —
 *     which this phase is required never to read. The attribution secret is not
 *     an option either: it exists only while attribution is switched on, and the
 *     lead drilldown must answer for direct leads on a deployment that never
 *     enabled attribution.
 *   • It is exactly as stable as the lead itself. The row is immutable and
 *     unique per learner, so the reference cannot drift, rotate or collide.
 *   • Tampering can only miss. The reference is looked up as a stored value on
 *     the very table that DEFINES the population, so a forged one selects
 *     nothing — there is no claim inside it for a client to rewrite.
 *
 * IT IS VERSIONED ANYWAY. The `v1_` prefix costs three characters and buys the
 * ability to change the scheme later without a silent reinterpretation: a `v2_`
 * reference reaching a `v1_` deployment is refused loudly rather than parsed
 * hopefully.
 *
 * WHAT THE REFERENCE IS NOT: not the numeric User id, not an email, not a Pocket
 * player id, not a Pocket click id, not an `ataClickId`, not an
 * `anonymousVisitorId`, and not a signed claim the holder can edit.
 */
import { maskEmail } from "@/lib/crm/users";

/** The only accepted version today. */
export const LEAD_ID_VERSION = 1;
export const LEAD_ID_PREFIX = `v${LEAD_ID_VERSION}_`;

/**
 * `v1_` plus the 32-character base32 body every affiliate identifier uses.
 * Anything longer is refused BEFORE a database round trip, so an oversized
 * value cannot be used to probe the lookup path.
 */
export const LEAD_ID_LENGTH = LEAD_ID_PREFIX.length + 32;
export const LEAD_ID_PATTERN = /^v1_[a-z2-7]{32}$/;

/** A generous ceiling applied before the pattern, purely to bound the parser. */
export const LEAD_ID_MAX_INPUT_LENGTH = 128;

export type LeadIdRejection =
  | "absent"
  | "too_long"
  | "unsupported_version"
  | "malformed";

export type LeadIdParse =
  | { readonly kind: "valid"; readonly eventId: string }
  | { readonly kind: "invalid"; readonly reason: LeadIdRejection };

/** Render the stored conversion `eventId` as the public lead reference. */
export function toLeadId(eventId: string): string {
  return `${LEAD_ID_PREFIX}${eventId}`;
}

/**
 * Parse a client-supplied reference back to the stored `eventId`.
 *
 * A FUTURE VERSION IS ITS OWN REJECTION, distinct from malformed. A deployment
 * that has been rolled back must refuse a reference whose scheme it does not
 * know rather than best-effort parse it, and reporting that distinctly is what
 * makes a partial rollout visible instead of mysterious.
 */
export function parseLeadId(raw: unknown): LeadIdParse {
  if (typeof raw !== "string" || raw === "") return { kind: "invalid", reason: "absent" };
  if (raw.length > LEAD_ID_MAX_INPUT_LENGTH) return { kind: "invalid", reason: "too_long" };

  const versionMatch = /^v(\d{1,3})_/.exec(raw);
  if (versionMatch && Number(versionMatch[1]) !== LEAD_ID_VERSION) {
    return { kind: "invalid", reason: "unsupported_version" };
  }

  if (!LEAD_ID_PATTERN.test(raw)) return { kind: "invalid", reason: "malformed" };
  return { kind: "valid", eventId: raw.slice(LEAD_ID_PREFIX.length) };
}

/* --------------------------------------------------------- identity states */

/**
 * `redacted` is what every list row and every default detail carries, INCLUDING
 * for a CRM administrator. `revealed` is reachable only through the single-lead
 * reveal owner, and only in that one response.
 */
export type LeadPiiState = "redacted" | "revealed";

export type RedactedLeadIdentity = {
  readonly leadId: string;
  readonly maskedEmail: string;
  readonly displayName: null;
  readonly piiState: "redacted";
};

/**
 * Normalize before masking.
 *
 * WHY NFKC AND A CONTROL-CHARACTER STRIP. A stored address may carry
 * zero-width joiners, bidirectional overrides or combining marks — none of them
 * visible, all of them capable of turning a mask into something that renders as
 * a different string in an operator's browser, or of smuggling hidden
 * characters into a CRM grid. Normalising to NFKC and dropping the invisible
 * ranges means the mask describes what an operator actually sees.
 *
 * This never widens disclosure: it runs BEFORE `maskEmail`, which then keeps a
 * single leading character of the local part regardless.
 */
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

export function normalizeForMasking(email: string): string {
  return email.normalize("NFKC").replace(INVISIBLE, "").trim();
}

/**
 * The redacted identity of one lead.
 *
 * WHAT SURVIVES MASKING, AND WHY THAT IS THE RIGHT AMOUNT. `maskEmail` — the
 * canonical CRM owner, reused rather than reimplemented — keeps the first
 * character of the local part, the first character of the domain and the public
 * suffix: `nina@example.invalid` becomes `n***@e***.invalid`. That is enough for
 * an operator to tell two records apart and to recognise an account they were
 * already handed, and far too little to reconstruct or enumerate an address.
 *
 * A ONE-CHARACTER LOCAL PART IS SAFE BY CONSTRUCTION rather than by a special
 * case: `a@example.invalid` masks to `a***@e***.invalid`, which discloses the
 * whole local part — but a single character is already the most the mask ever
 * reveals, so nothing extra escapes. The `***` is fixed-width and therefore
 * leaks no length.
 *
 * THE DISPLAY NAME IS DROPPED ENTIRELY, not masked. A real name is frequently
 * more identifying than the address it accompanies, and there is no partial
 * rendering of it that is both useful to an operator and safe.
 *
 * NOT A RECOVERABLE HASH. The output is a lossy fixed-shape rendering; it
 * carries no digest of the address, so it cannot be brute-forced back the way a
 * truncated hash of a low-entropy value can.
 */
export function redactedIdentity(leadId: string, email: string): RedactedLeadIdentity {
  return {
    leadId,
    maskedEmail: maskEmail(normalizeForMasking(email)),
    displayName: null,
    piiState: "redacted",
  };
}

/**
 * The ONLY shape that carries full identity, and the only one the reveal owner
 * may build.
 *
 * The field list is deliberately closed and matches what the existing CRM
 * identity contract already exposes to a holder of the PII permission: an
 * address and a display name. There is no phone, no address, no IP, no
 * User-Agent, no session data, no password metadata, no Pocket identifier, no
 * click identifier and no balance — none of them are parameters here, so none
 * of them can be added by a caller.
 */
export type RevealedLeadIdentity = {
  readonly leadId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly piiState: "revealed";
};

export function revealedIdentity(
  leadId: string,
  email: string,
  displayName: string | null,
): RevealedLeadIdentity {
  return { leadId, email, displayName, piiState: "revealed" };
}
