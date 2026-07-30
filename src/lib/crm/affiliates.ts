import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CrmPermission } from "@/lib/crm/roles";

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
 * AFD-2 uses `manage_settings` for BOTH reads and writes.
 *
 * TEMPORARY AND DELIBERATE. No affiliate-analytics read permission exists yet,
 * and AFD-1 established that inventing one here would mean editing the locked
 * CRM permission matrix — an explicit contract change that belongs to AFD-5,
 * where `view_affiliate_analytics` is introduced and granted to `analyst`.
 * Until then the narrow, admin-only grant is the honest choice: it under-grants
 * rather than over-grants, and no learner-facing behaviour depends on it.
 */
export function assertCanManageAffiliates(permissions: readonly CrmPermission[]): void {
  if (!permissions.includes("manage_settings")) {
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
 */
export function generatePublicCode(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = crypto.randomBytes(20); // 160 bits
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  return out;
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
export type TrackingLinkStatus = "draft" | "paused" | "archived";

const ENTITY_TRANSITIONS: Record<AffiliateStatus, readonly AffiliateStatus[]> = {
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  // Archive is terminal through the normal API. Reversing it would silently
  // resurrect an affiliate whose links an operator believes are dead.
  archived: [],
};

const LINK_TRANSITIONS: Record<TrackingLinkStatus, readonly TrackingLinkStatus[]> = {
  draft: ["paused", "archived"],
  paused: ["draft", "archived"],
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
 * The stable, explicit refusal to activate a link before AFD-3B.
 *
 * Deliberately NOT a silent coercion to draft: an operator who asked for
 * `active` must learn that activation does not exist yet, rather than watch the
 * request succeed and quietly produce something else. The error is its own
 * code so a future CRM can render a specific explanation.
 */
export class AffiliateLinkActivationUnavailableError extends Error {
  readonly code = "AFFILIATE_LINK_ACTIVATION_NOT_AVAILABLE" as const;
  readonly messageKey = "crm.affiliates.link.activation_not_available";
  constructor() {
    super("AFFILIATE_LINK_ACTIVATION_NOT_AVAILABLE");
    this.name = "AffiliateLinkActivationUnavailableError";
  }
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
  // A draft link is not yet usable, but it is not paused either; AFD-2 has no
  // usable link at all, so `paused` is the honest rendering of "not available".
  if (own === "draft") return "paused";
  return "available";
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
