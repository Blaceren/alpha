import { Prisma } from "@prisma/client";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { canViewAffiliates, type CrmPermission } from "@/lib/crm/roles";

/**
 * AFD-2 — the administrative affiliate foundation.
 *
 * WHAT THIS MODULE IS NOT. It holds no traffic click, no anonymous visitor, no
 * external affiliate click id, no ataClickId, no attribution decision, no
 * conversion event, no Pocket identifier and no learner. Those arrive in AFD-3B
 * and AFD-4 and belong to their own owners. Everything here is configuration an
 * operator types in before any traffic exists.
 */

/* ------------------------------------------------------------------ bounds */

export const AFFILIATE_CODE_MIN = 3;
export const AFFILIATE_CODE_MAX = 64;
export const AFFILIATE_DISPLAY_NAME_MAX = 160;
export const AFFILIATE_TEXT_MAX = 2000;
export const AFFILIATE_PARAM_MAX = 32;
export const AFFILIATE_WINDOW_MIN = 1;
export const AFFILIATE_WINDOW_MAX = 365;
export const AFFILIATE_WINDOW_DEFAULT = 30;

export const AFFILIATE_DEFAULT_LIMIT = 25;
export const AFFILIATE_MAX_LIMIT = 100;
export const AFFILIATE_MAX_SEARCH_LENGTH = 100;
/** A create/update body larger than this is refused before it is parsed. */
export const AFFILIATE_MAX_BODY_BYTES = 16 * 1024;

/** Bounded retries for a public-code collision. Never a predictable fallback. */
const PUBLIC_CODE_ATTEMPTS = 5;

/* ------------------------------------------------------------------ errors */

export class AffiliateInputError extends Error {
  readonly code = "invalid_input" as const;
  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "AffiliateInputError";
  }
}

export class AffiliateNotFoundError extends Error {
  readonly code = "not_found" as const;
  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "AffiliateNotFoundError";
  }
}

export class AffiliateConflictError extends Error {
  readonly code = "conflict" as const;
  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "AffiliateConflictError";
  }
}

export class AffiliateForbiddenError extends Error {
  readonly code = "forbidden" as const;
  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "AffiliateForbiddenError";
  }
}

/* ----------------------------------------------------------- authorization */

/**
 * MUTATION gate. Unchanged from AFD-2 and deliberately NOT widened by AFD-5A:
 * creating, editing, activating, pausing and archiving an affiliate, a campaign
 * or a tracking link all still require exactly `manage_settings`.
 *
 * `view_affiliate_analytics` must never satisfy this check. That separation is
 * the whole point of the read-only analyst: hiding a button in the CRM is a
 * convenience, and this function is the actual enforcement.
 */
export function assertCanManageAffiliates(permissions: readonly CrmPermission[]): void {
  if (!permissions.includes("manage_settings")) {
    throw new AffiliateForbiddenError("crm.affiliates.forbidden");
  }
}

/**
 * READ gate, introduced by AFD-5A. AFD-2 shipped with `manage_settings` on both
 * reads and writes because no affiliate read permission existed; the comment it
 * left behind named this phase as the one that would add it.
 *
 * Satisfied by `view_affiliate_analytics` OR `manage_settings` — see
 * `canViewAffiliates`, which owns the rule. Splitting reads from writes here is
 * what lets an analyst open the section while every mutation route keeps
 * calling `assertCanManageAffiliates` and answering 403.
 */
export function assertCanReadAffiliates(permissions: readonly CrmPermission[]): void {
  if (!canViewAffiliates(permissions)) {
    throw new AffiliateForbiddenError("crm.affiliates.forbidden");
  }
}

/* -------------------------------------------------------------- public code */

/**
 * 160 bits of CSPRNG entropy rendered as 32 lowercase base32 characters.
 *
 * Base32 rather than hex so the code is short enough to paste and read aloud
 * without being sequential or guessable, and lowercase-only so a link that is
 * transcribed with different casing cannot become a second distinct code. This
 * is the ONLY producer of a publicCode; no request body can supply one.
 *
 * AFD-3B2 moved the encoder itself to src/lib/affiliate/random-id.ts, which is
 * now the single producer of every opaque affiliate identifier — public codes,
 * click ids, visitor ids and conversion event ids. The shape is unchanged.
 */
export function generatePublicCode(): string {
  return randomBase32Id();
}

/* -------------------------------------------------------------- validation */

/**
 * Parameter names an operator may never configure.
 *
 * Two separate reasons, both load-bearing. `ow`, `goal` and `playerid` belong to
 * the Pocket callback contract: letting a tracking link define a parameter by
 * those names would invite an operator to wire affiliate input into a place
 * where it could later be confused with provider input. The rest — credentials,
 * session material and redirect-shaped names — must never be accepted from a
 * query string at all, whatever a future route does with the configured name.
 */
export const AFFILIATE_PROTECTED_PARAMETERS: readonly string[] = [
  "ow",
  "goal",
  "playerid",
  "clickid_pocket",
  "password",
  "passwd",
  "token",
  "secret",
  "authorization",
  "auth",
  "cookie",
  "session",
  "csrf",
  "redirect",
  "redirect_uri",
  "url",
  "next",
  "target",
  "callback",
  "return",
  "return_url",
];

const CODE_PATTERN = /^[a-z0-9_-]+$/;
const PARAM_PATTERN = /^[a-z0-9_]+$/;
// Any C0/C1 control character, and the Unicode separators/format characters
// that let two different strings render identically.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff]/;

export function normalizeCode(raw: unknown, messageKey: string): string {
  if (typeof raw !== "string") throw new AffiliateInputError(messageKey);
  const trimmed = raw.trim();
  if (UNSAFE_TEXT.test(trimmed)) throw new AffiliateInputError(messageKey);

  // Lowercase with a fixed locale so a Turkish-locale runtime cannot map "I"
  // to a dotless i and produce a different code than every other environment.
  const lowered = trimmed.toLowerCase();

  if (lowered.length < AFFILIATE_CODE_MIN || lowered.length > AFFILIATE_CODE_MAX) {
    throw new AffiliateInputError(messageKey);
  }
  // Rejects every non-ASCII character, which is what keeps a Cyrillic "а" from
  // becoming a second affiliate that looks identical to a Latin "a".
  if (!CODE_PATTERN.test(lowered)) throw new AffiliateInputError(messageKey);

  return lowered;
}

export function normalizeDisplayName(raw: unknown, messageKey: string): string {
  if (typeof raw !== "string") throw new AffiliateInputError(messageKey);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > AFFILIATE_DISPLAY_NAME_MAX) {
    throw new AffiliateInputError(messageKey);
  }
  if (UNSAFE_TEXT.test(trimmed)) throw new AffiliateInputError(messageKey);
  return trimmed;
}

export function normalizeOptionalText(raw: unknown, messageKey: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new AffiliateInputError(messageKey);
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > AFFILIATE_TEXT_MAX) throw new AffiliateInputError(messageKey);
  if (UNSAFE_TEXT.test(trimmed)) throw new AffiliateInputError(messageKey);
  return trimmed;
}

export function normalizeWindowDays(raw: unknown, messageKey: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new AffiliateInputError(messageKey);
  }
  if (raw < AFFILIATE_WINDOW_MIN || raw > AFFILIATE_WINDOW_MAX) {
    throw new AffiliateInputError(messageKey);
  }
  return raw;
}

export function normalizeParameterName(raw: unknown, messageKey: string): string {
  if (typeof raw !== "string") throw new AffiliateInputError(messageKey);
  const lowered = raw.trim().toLowerCase();
  if (lowered.length < 1 || lowered.length > AFFILIATE_PARAM_MAX) {
    throw new AffiliateInputError(messageKey);
  }
  if (!PARAM_PATTERN.test(lowered)) throw new AffiliateInputError(messageKey);
  if (AFFILIATE_PROTECTED_PARAMETERS.includes(lowered)) {
    throw new AffiliateInputError("crm.affiliates.link.parameter_protected");
  }
  return lowered;
}

/**
 * Reject any key the caller is not allowed to write.
 *
 * This is what makes "client-supplied id", "client-supplied publicCode" and
 * "client-supplied createdAt" a single rule instead of three forgettable ones:
 * anything not explicitly writable is refused, so a field added to the schema
 * later is closed by default rather than silently assignable.
 */
export function assertOnlyKnownKeys(body: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AffiliateInputError("crm.affiliates.body_invalid");
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new AffiliateInputError("crm.affiliates.body_unknown_field");
    }
  }
  return record;
}

/* ------------------------------------------------------------- transitions */

export type AffiliateStatus = "active" | "paused" | "archived";
export type TrackingLinkStatus = "draft" | "active" | "paused" | "archived";

export const TRACKING_LINK_STATUSES: readonly TrackingLinkStatus[] = [
  "draft",
  "active",
  "paused",
  "archived",
];

const ENTITY_TRANSITIONS: Record<AffiliateStatus, readonly AffiliateStatus[]> = {
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  // Archive is terminal through the normal API. Reversing it would silently
  // resurrect an affiliate whose links an operator believes are dead.
  archived: [],
};

/**
 * AFD-3B2 adds `active` to the link lifecycle.
 *
 * TWO EDGES ARE MISSING ON PURPOSE.
 *
 * `active → draft` is forbidden. Draft means "this link has never been able to
 * carry traffic", and a link that HAS carried traffic can never truthfully
 * return to that state. Pausing is the honest way to stop a live link, and it
 * says so: `paused` preserves the fact that the link was once live, which is
 * what an operator reconciling a payout needs to see.
 *
 * `archived → anything` is forbidden, unchanged from AFD-2. Un-archiving would
 * resurrect a link whose code an affiliate may still be publishing.
 *
 * `paused → draft` remains legal, because a link that was paused straight out of
 * draft never carried traffic. That edge existed before this phase and is not
 * widened here — a link reaching `paused` from `active` can still take it, and
 * that is a deliberate accepted looseness rather than an oversight: the phase's
 * integrity guarantees rest on the click and attribution rows, which no status
 * change can alter, not on the link's current status.
 */
const LINK_TRANSITIONS: Record<TrackingLinkStatus, readonly TrackingLinkStatus[]> = {
  draft: ["active", "paused", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "draft", "archived"],
  archived: [],
};

export function assertEntityTransition(from: AffiliateStatus, to: AffiliateStatus): void {
  if (from === to) throw new AffiliateInputError("crm.affiliates.status_unchanged");
  if (!ENTITY_TRANSITIONS[from].includes(to)) {
    throw new AffiliateInputError("crm.affiliates.status_transition_invalid");
  }
}

export function assertLinkTransition(from: TrackingLinkStatus, to: TrackingLinkStatus): void {
  if (from === to) throw new AffiliateInputError("crm.affiliates.status_unchanged");
  if (!LINK_TRANSITIONS[from].includes(to)) {
    throw new AffiliateInputError("crm.affiliates.status_transition_invalid");
  }
}

/**
 * The stable, explicit refusal to activate a link on a deployment where
 * acquisition attribution is switched off.
 *
 * AFD-2 refused activation because the machinery did not exist. AFD-3B2 builds
 * the machinery, so the refusal changes meaning: activation is now a real
 * operation that this particular deployment has not turned on. The code changed
 * with the meaning rather than being kept for compatibility, because a CRM that
 * rendered "activation is not available yet" for a deployment that simply has a
 * flag off would be telling an operator the wrong thing.
 *
 * Deliberately NOT a silent coercion to draft: an operator who asked for
 * `active` must learn that the request was refused rather than watch it succeed
 * and quietly produce something else.
 */
export class AffiliateAttributionDisabledError extends Error {
  readonly code = "AFFILIATE_ATTRIBUTION_DISABLED" as const;
  readonly messageKey = "crm.affiliates.link.attribution_disabled";
  constructor() {
    super("AFFILIATE_ATTRIBUTION_DISABLED");
    this.name = "AffiliateAttributionDisabledError";
  }
}

/**
 * Everything that must be true before a link may be set `active`.
 *
 * WHY THESE AND NOT MORE. Each condition below is one that would otherwise make
 * an active link a lie: a link whose affiliate is paused would accept clicks
 * nobody will be paid for, a link with an unsupported landing key would have
 * nowhere to send a visitor, and a link with no valid window would snapshot a
 * window that can never make a click eligible. Conditions that a link can
 * recover from on its own — a campaign that is later paused, the feature switch
 * being turned off — are NOT checked here, because they are answered fresh on
 * every request by `effectiveAvailability`. Freezing them at activation time
 * would mean a paused parent silently kept serving.
 */
export type LinkActivationRefusal =
  | "attribution_disabled"
  | "partner_not_active"
  | "campaign_not_active"
  | "landing_key_unsupported"
  | "public_code_invalid"
  | "parameter_mapping_invalid"
  | "attribution_window_invalid";

export type LinkActivationCandidate = {
  readonly publicCode: string;
  readonly landingKey: string;
  readonly partnerStatus: AffiliateStatus;
  readonly campaignStatus: AffiliateStatus | null;
  readonly externalClickParameter: string;
  readonly subParameters: readonly (string | null)[];
  readonly attributionWindowDays: number | null;
  readonly partnerDefaultAttributionWindowDays: number;
};

export const SUPPORTED_LANDING_KEYS: readonly string[] = ["academy_registration"];

export function describeLinkActivationRefusal(
  candidate: LinkActivationCandidate,
  attributionEnabled: boolean,
): LinkActivationRefusal | null {
  if (!attributionEnabled) return "attribution_disabled";
  if (candidate.partnerStatus !== "active") return "partner_not_active";
  if (candidate.campaignStatus !== null && candidate.campaignStatus !== "active") {
    return "campaign_not_active";
  }
  if (!SUPPORTED_LANDING_KEYS.includes(candidate.landingKey)) return "landing_key_unsupported";
  if (!/^[a-z2-7]{32}$/.test(candidate.publicCode)) return "public_code_invalid";

  // Re-validated rather than trusted: a mapping stored before a bound changed,
  // or one written by a path that predates the current validator, must not go
  // live. The names are checked as a COMPLETE set so a duplicate pair is caught.
  const names = [candidate.externalClickParameter, ...candidate.subParameters];
  const present = names.filter((name): name is string => name !== null);
  if (present.length === 0) return "parameter_mapping_invalid";
  for (const name of present) {
    if (!PARAM_PATTERN.test(name) || name.length > AFFILIATE_PARAM_MAX) {
      return "parameter_mapping_invalid";
    }
    if (AFFILIATE_PROTECTED_PARAMETERS.includes(name)) return "parameter_mapping_invalid";
  }
  if (new Set(present).size !== present.length) return "parameter_mapping_invalid";

  const window = candidate.attributionWindowDays ?? candidate.partnerDefaultAttributionWindowDays;
  if (!Number.isInteger(window) || window < AFFILIATE_WINDOW_MIN || window > AFFILIATE_WINDOW_MAX) {
    return "attribution_window_invalid";
  }

  return null;
}

/**
 * The effective attribution window a click made through this link would
 * snapshot. Resolved in exactly one place so the CRM DTO, the activation check
 * and the public route can never disagree about it.
 */
export function effectiveAttributionWindowDays(
  linkWindow: number | null,
  partnerDefault: number,
): number {
  return linkWindow ?? partnerDefault;
}

/* --------------------------------------------------- effective availability */

/**
 * Stored status answers "what did an operator set". Effective availability
 * answers "could this be used", which for a child also depends on its parents.
 * Both are exposed, because collapsing them would either hide an operator's
 * choice or hide the reason a link is unusable.
 */
export function effectiveAvailability(
  own: AffiliateStatus | TrackingLinkStatus,
  parents: readonly AffiliateStatus[],
): "available" | "paused" | "archived" {
  if (own === "archived") return "archived";
  if (parents.some((p) => p === "archived")) return "archived";
  if (own === "paused") return "paused";
  if (parents.some((p) => p === "paused")) return "paused";
  // A draft link is not yet usable, but it is not paused either; `paused` is the
  // honest rendering of "an operator has not made this available".
  if (own === "draft") return "paused";
  return "available";
}

/**
 * The single question the public acquisition route asks: may this link create a
 * qualified click RIGHT NOW.
 *
 * Three independent facts, all re-read per request and none of them cached on
 * the link row. That is what makes the emergency stop real: turning the feature
 * off, or pausing the affiliate, makes every one of its links stop serving
 * immediately, without a migration, without a batch job and WITHOUT silently
 * rewriting any child's stored status. An operator who later re-enables finds
 * exactly the statuses they set.
 */
export function isLinkEffectivelyActive(input: {
  linkStatus: TrackingLinkStatus;
  partnerStatus: AffiliateStatus;
  campaignStatus: AffiliateStatus | null;
  attributionEnabled: boolean;
}): boolean {
  if (!input.attributionEnabled) return false;
  if (input.linkStatus !== "active") return false;
  const parents: AffiliateStatus[] = [input.partnerStatus];
  if (input.campaignStatus !== null) parents.push(input.campaignStatus);
  return effectiveAvailability(input.linkStatus, parents) === "available";
}

/* -------------------------------------------------------- query parameters */

export type AffiliateListQuery = {
  limit: number;
  offset: number;
  status?: string;
  code?: string;
  search?: string;
  affiliatePartnerId?: number;
  affiliateCampaignId?: number;
  publicCode?: string;
};

/**
 * Parse and bound a list query.
 *
 * `getAll` on every key: a duplicated `?status=active&status=archived` must be
 * an explicit rejection, never a silent "first one wins" that returns a
 * different page than the operator believes they asked for.
 */
export function parseAffiliateListQuery(
  searchParams: URLSearchParams,
  knownKeys: readonly string[],
): AffiliateListQuery {
  for (const key of new Set(searchParams.keys())) {
    if (!knownKeys.includes(key)) throw new AffiliateInputError("crm.affiliates.query_unknown");
    if (searchParams.getAll(key).length > 1) {
      throw new AffiliateInputError("crm.affiliates.query_duplicated");
    }
  }

  let limit = AFFILIATE_DEFAULT_LIMIT;
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit.trim())) throw new AffiliateInputError("crm.affiliates.limit_invalid");
    const value = Number(rawLimit.trim());
    if (!Number.isInteger(value) || value < 1 || value > AFFILIATE_MAX_LIMIT) {
      throw new AffiliateInputError("crm.affiliates.limit_invalid");
    }
    limit = value;
  }

  let offset = 0;
  const rawOffset = searchParams.get("offset");
  if (rawOffset !== null) {
    if (!/^\d+$/.test(rawOffset.trim())) throw new AffiliateInputError("crm.affiliates.offset_invalid");
    const value = Number(rawOffset.trim());
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new AffiliateInputError("crm.affiliates.offset_invalid");
    }
    offset = value;
  }

  const query: AffiliateListQuery = { limit, offset };

  const status = searchParams.get("status");
  if (status !== null) {
    if (!["active", "paused", "archived", "draft"].includes(status)) {
      throw new AffiliateInputError("crm.affiliates.status_invalid");
    }
    query.status = status;
  }

  const code = searchParams.get("code");
  if (code !== null) query.code = normalizeCode(code, "crm.affiliates.code_invalid");

  const publicCode = searchParams.get("publicCode");
  if (publicCode !== null) {
    const lowered = publicCode.trim().toLowerCase();
    if (!/^[a-z2-7]{32}$/.test(lowered)) {
      throw new AffiliateInputError("crm.affiliates.link.public_code_invalid");
    }
    query.publicCode = lowered;
  }

  const search = searchParams.get("search");
  if (search !== null) {
    const trimmed = search.trim();
    if (trimmed.length > AFFILIATE_MAX_SEARCH_LENGTH) {
      throw new AffiliateInputError("crm.affiliates.search_invalid");
    }
    if (trimmed !== "") query.search = trimmed;
  }

  for (const [key, field] of [
    ["affiliatePartnerId", "affiliatePartnerId"],
    ["affiliateCampaignId", "affiliateCampaignId"],
  ] as const) {
    const raw = searchParams.get(key);
    if (raw !== null) {
      if (!/^\d+$/.test(raw.trim())) throw new AffiliateInputError("crm.affiliates.id_invalid");
      const value = Number(raw.trim());
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new AffiliateInputError("crm.affiliates.id_invalid");
      }
      query[field] = value;
    }
  }

  return query;
}

export function parseAffiliatePathId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new AffiliateInputError("crm.affiliates.id_invalid");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AffiliateInputError("crm.affiliates.id_invalid");
  }
  return value;
}

/* -------------------------------------------------------------- conflicts */

/**
 * Map a unique-constraint violation to a stable conflict.
 *
 * The Prisma error is never re-thrown and never inspected beyond its code: its
 * message can quote the conflicting row, and this path must not be the way a
 * stored value reaches a log or a response.
 */
export function asConflict(error: unknown, messageKey: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new AffiliateConflictError(messageKey);
  }
  // A foreign-key failure here means the referenced partner, campaign or
  // creator does not exist, or the campaign belongs to a different partner —
  // the composite FK renders both as the same honest "not found".
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    throw new AffiliateNotFoundError("crm.affiliates.reference_not_found");
  }
  throw error;
}

/**
 * Create a tracking link, retrying a bounded number of times if the generated
 * public code collides. After the bound it fails loudly rather than degrading
 * to anything predictable.
 */
export async function withUniquePublicCode<R>(
  // The CALLER performs the create, so Prisma's `select` inference is natural
  // and this helper needs no cast. It owns only the retry policy.
  create: (publicCode: string) => Promise<R>,
): Promise<R> {
  for (let attempt = 0; attempt < PUBLIC_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await create(generatePublicCode());
    } catch (error) {
      const isCodeCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        JSON.stringify(error.meta ?? {}).includes("publicCode");
      // Any other failure is not a collision and must not be retried — retrying
      // a genuine conflict would just produce the same error five times.
      if (!isCodeCollision) asConflict(error, "crm.affiliates.link.conflict");
      if (attempt === PUBLIC_CODE_ATTEMPTS - 1) {
        throw new AffiliateConflictError("crm.affiliates.link.public_code_exhausted");
      }
    }
  }
  // Unreachable: the loop either returns or throws. Present so the function has
  // no implicit undefined path.
  throw new AffiliateConflictError("crm.affiliates.link.public_code_exhausted");
}
