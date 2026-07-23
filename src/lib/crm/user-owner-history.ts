import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canViewOwnerHistory, type CrmPermission } from "@/lib/crm/roles";

// CRM Learner Owner History (OH-1) — the immutable, append-only record of every
// owner transition of one learner. Exactly one operation exists here: list a
// learner's transitions, newest first, keyset-paginated. There is no create,
// update or delete: rows are written only by the owner mutation, in its own
// transaction (see user-owner.ts). This module never writes.
//
// Read access requires `view_audit`. Transition type is DERIVED from the stored
// previous/next owner ids; no arbitrary action string is stored or returned.
//
// Contract: docs/CRM_USER_OWNER_HISTORY_OH1.md

export const CRM_OWNER_HISTORY_DEFAULT_LIMIT = 20;
export const CRM_OWNER_HISTORY_MAX_LIMIT = 50;
export const CRM_OWNER_HISTORY_CURSOR_MAX_LENGTH = 512;

/* -------------------------------------------------------------- typed errors */

// Typed 400 for anything the request got wrong. Carries no resource existence.
export class CrmOwnerHistoryInputError extends Error {
  readonly code = "invalid_input" as const;

  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "CrmOwnerHistoryInputError";
  }
}

// Typed 403. One shape for every missing `view_audit` — the envelope never names
// the role or the permission that was missing.
export class CrmOwnerHistoryForbiddenError extends Error {
  readonly code = "unauthorized" as const;
  readonly messageKey = "crm.users.owner_history.forbidden";

  constructor() {
    super("crm.users.owner_history.forbidden");
    this.name = "CrmOwnerHistoryForbiddenError";
  }
}

// Typed 404 — same one-shape-for-every-miss discipline as the owner route: a
// nonexistent, staff or system learner all collapse here, so the response can
// never be used to probe which ids belong to learners.
export class CrmOwnerHistoryNotFoundError extends Error {
  readonly code = "not_found" as const;
  readonly messageKey = "crm.users.owner_history.not_found";

  constructor() {
    super("crm.users.owner_history.not_found");
    this.name = "CrmOwnerHistoryNotFoundError";
  }
}

// Typed 500 for a stored row whose actor/previous/next display name is unusable,
// or a transition that is somehow neither assign/reassign/unassign. Fails closed
// rather than fabricating a label or an action.
export class CrmOwnerHistoryInternalError extends Error {
  readonly code = "internal" as const;
  readonly messageKey = "crm.users.owner_history.internal";

  constructor() {
    super("crm.users.owner_history.internal");
    this.name = "CrmOwnerHistoryInternalError";
  }
}

/* ------------------------------------------------------- authorization gate */

/** Listing owner history requires exactly `view_audit`. No `assign_owner`
 * fallback: a role that may reassign the owner still cannot read the log. */
export function assertCanViewOwnerHistory(permissions: readonly CrmPermission[]): void {
  if (!canViewOwnerHistory(permissions)) throw new CrmOwnerHistoryForbiddenError();
}

/* -------------------------------------------------------------- projections */

export type CrmOwnerTransition = "assigned" | "reassigned" | "unassigned";

export interface CrmOwnerHistoryActor {
  employeeId: string;
  displayName: string;
}

export interface CrmOwnerHistoryItem {
  historyId: string;
  transition: CrmOwnerTransition;
  ownerVersion: number;
  createdAt: string;
  actor: CrmOwnerHistoryActor;
  previousOwner: CrmOwnerHistoryActor | null;
  nextOwner: CrmOwnerHistoryActor | null;
}

export interface CrmOwnerHistoryPage {
  items: CrmOwnerHistoryItem[];
  nextCursor: string | null;
}

/* ---------------------------------------------------------- learner target */

/**
 * `role: "user"` is part of the WHERE, not a post-filter, so a staff, admin or
 * system account produces exactly the same empty result as a nonexistent id —
 * the 404 therefore cannot be used to probe which ids belong to employees. This
 * matches the current-owner and notes routes exactly.
 */
async function resolveLearnerTarget(userId: number): Promise<void> {
  const learner = await prisma.user.findFirst({
    where: { id: userId, role: "user" },
    select: { id: true },
  });
  if (!learner) throw new CrmOwnerHistoryNotFoundError();
}

/* ------------------------------------------------------------------ cursor */

// Versioned, opaque, carrying ONLY the ownerVersion keyset — no learner, actor,
// permission or session data. It is not signed: a cursor grants nothing, so
// tampering can only shift the page position or yield a 400. The version alone
// is a stable, unique, monotonic key per learner, so no second component is
// needed. A cursor CANNOT cross users because the userId comes from the path and
// the query is always filtered by it — a cursor minted for one learner applied
// to another simply positions within that other learner's own versions.
type OwnerHistoryCursor = { v: 1; ver: number };

export function encodeOwnerHistoryCursor(ownerVersion: number): string {
  const payload: OwnerHistoryCursor = { v: 1, ver: ownerVersion };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeOwnerHistoryCursor(raw: string): { ownerVersion: number } {
  if (raw.length > CRM_OWNER_HISTORY_CURSOR_MAX_LENGTH) {
    throw new CrmOwnerHistoryInputError("crm.users.owner_history.cursor_invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new CrmOwnerHistoryInputError("crm.users.owner_history.cursor_invalid");
  }

  // `v` is a literal: a cursor minted by another version is rejected, never
  // reinterpreted under this version's field meanings. `ver` is a non-negative
  // integer keyset value.
  const shape = z
    .object({ v: z.literal(1), ver: z.number().int().nonnegative() })
    .strict()
    .safeParse(parsed);
  if (!shape.success) throw new CrmOwnerHistoryInputError("crm.users.owner_history.cursor_invalid");

  return { ownerVersion: shape.data.ver };
}

/* ------------------------------------------------------------- GET query */

const KNOWN_QUERY_KEYS = new Set(["limit", "cursor"]);

export interface CrmOwnerHistoryQuery {
  limit: number;
  cursor?: { ownerVersion: number };
}

/**
 * Strict query parsing. Unknown keys — including `offset`, `page`, `total`,
 * `include`, `expand`, `userId` and `fields` — are rejected rather than ignored,
 * so a client can never believe a filter, an expansion or a cross-user override
 * applied when none exists. A repeated key is rejected too.
 */
export function parseCrmOwnerHistoryQuery(searchParams: URLSearchParams): CrmOwnerHistoryQuery {
  for (const key of searchParams.keys()) {
    if (!KNOWN_QUERY_KEYS.has(key)) {
      throw new CrmOwnerHistoryInputError("crm.users.owner_history.unknown_query_key");
    }
    if (searchParams.getAll(key).length > 1) {
      throw new CrmOwnerHistoryInputError("crm.users.owner_history.repeated_query_key");
    }
  }

  // limit — integer, bounded. Rejects 0, negatives, fractions and non-numerics.
  let limit = CRM_OWNER_HISTORY_DEFAULT_LIMIT;
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit.trim())) {
      throw new CrmOwnerHistoryInputError("crm.users.owner_history.limit_invalid");
    }
    const value = Number(rawLimit.trim());
    if (!Number.isInteger(value) || value < 1 || value > CRM_OWNER_HISTORY_MAX_LIMIT) {
      throw new CrmOwnerHistoryInputError("crm.users.owner_history.limit_invalid");
    }
    limit = value;
  }

  let cursor: CrmOwnerHistoryQuery["cursor"];
  const rawCursor = searchParams.get("cursor");
  if (rawCursor !== null) {
    if (rawCursor.trim() === "") {
      throw new CrmOwnerHistoryInputError("crm.users.owner_history.cursor_invalid");
    }
    cursor = decodeOwnerHistoryCursor(rawCursor);
  }

  return { limit, cursor };
}

/* -------------------------------------------------------------- projection */

// Exactly the columns the projection needs, with each staff display name pulled
// in the same query via nested selects. No `include`, so no relation is loaded
// wholesale, and the raw actor/previous/next ids are never selected into the
// response shape.
const HISTORY_SELECT = {
  id: true,
  ownerVersion: true,
  createdAt: true,
  previousOwnerId: true,
  nextOwnerId: true,
  actor: { select: { id: true, displayName: true } },
  previousOwner: { select: { id: true, displayName: true } },
  nextOwner: { select: { id: true, displayName: true } },
} satisfies Prisma.CrmUserOwnerHistorySelect;

type SelectedHistory = Prisma.CrmUserOwnerHistoryGetPayload<{ select: typeof HISTORY_SELECT }>;

/** Fail closed on a blank staff name rather than fabricating a label or leaking
 * an id under a fabricated caption. */
function toActor(profile: { id: string; displayName: string } | null): CrmOwnerHistoryActor {
  const displayName = profile?.displayName.trim() ?? "";
  if (!profile || displayName.length === 0) throw new CrmOwnerHistoryInternalError();
  return { employeeId: profile.id, displayName };
}

/** Derive the transition type from the stored ids — never a stored action. The
 * DB CHECK guarantees exactly one of the three shapes, so null→null is a data
 * fault that fails closed. */
function deriveTransition(previousOwnerId: string | null, nextOwnerId: string | null): CrmOwnerTransition {
  if (previousOwnerId === null && nextOwnerId !== null) return "assigned";
  if (previousOwnerId !== null && nextOwnerId === null) return "unassigned";
  if (previousOwnerId !== null && nextOwnerId !== null) return "reassigned";
  throw new CrmOwnerHistoryInternalError();
}

/** Explicit projector — a Prisma row is never spread into the response. */
function toHistoryItem(row: SelectedHistory): CrmOwnerHistoryItem {
  return {
    historyId: row.id,
    transition: deriveTransition(row.previousOwnerId, row.nextOwnerId),
    ownerVersion: row.ownerVersion,
    createdAt: row.createdAt.toISOString(),
    actor: toActor(row.actor),
    previousOwner: row.previousOwner ? toActor(row.previousOwner) : null,
    nextOwner: row.nextOwner ? toActor(row.nextOwner) : null,
  };
}

/* ------------------------------------------------------------------- list */

/**
 * Keyset pagination over ownerVersion DESC, filtered by userId. ownerVersion is
 * unique and monotonic per learner, so it is a stable single-column keyset with
 * no tie-breaker and no OFFSET drift. No total is computed or returned.
 */
export async function listCrmUserOwnerHistory(
  userId: number,
  query: CrmOwnerHistoryQuery,
): Promise<CrmOwnerHistoryPage> {
  await resolveLearnerTarget(userId);

  // The cursor's version is applied together with the userId filter, so it can
  // only ever position within THIS learner's own history — never another's.
  const cursorWhere: Prisma.CrmUserOwnerHistoryWhereInput = query.cursor
    ? { ownerVersion: { lt: query.cursor.ownerVersion } }
    : {};

  const rows = await prisma.crmUserOwnerHistory.findMany({
    where: { userId, ...cursorWhere },
    orderBy: { ownerVersion: "desc" },
    take: query.limit + 1,
    select: HISTORY_SELECT,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toHistoryItem),
    nextCursor: hasMore && last ? encodeOwnerHistoryCursor(last.ownerVersion) : null,
  };
}
