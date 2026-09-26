import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canAssignOwner,
  CRM_ELIGIBLE_OWNER_ROLES,
  type CrmPermission,
} from "@/lib/crm/roles";

// CRM Learner Owner v1 — one current owner per learner, or null. Three
// operations exist: read the current owner, list eligible candidates, and
// assign/replace/unassign. Ownership is informational only; it grants no
// authorization and changes no Notes, email, financial or learner-visibility
// rule.
//
// Contract: docs/CRM_USER_OWNER_V1.md

export const CRM_OWNER_CANDIDATES_DEFAULT_LIMIT = 50;
export const CRM_OWNER_CANDIDATES_MAX_LIMIT = 100;
export const CRM_OWNER_CURSOR_MAX_LENGTH = 512;
export const CRM_OWNER_EMPLOYEE_ID_MAX_LENGTH = 512;

/* -------------------------------------------------------------- typed errors */

// Typed 400 for anything the request got wrong. Carries no resource existence.
export class CrmOwnerInputError extends Error {
  readonly code = "invalid_input" as const;

  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "CrmOwnerInputError";
  }
}

// Typed 403. One shape for every missing `assign_owner` — the envelope never
// names the role or the permission that was missing.
export class CrmOwnerForbiddenError extends Error {
  readonly code = "unauthorized" as const;
  readonly messageKey = "crm.users.owner.forbidden";

  constructor() {
    super("crm.users.owner.forbidden");
    this.name = "CrmOwnerForbiddenError";
  }
}

// Typed 404. ONE shape for every miss: a nonexistent/staff/system learner AND a
// missing/ineligible/blocked candidate all collapse here, so the response can
// never be used to probe which ids belong to learners or to hidden employees.
export class CrmOwnerNotFoundError extends Error {
  readonly code = "not_found" as const;

  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "CrmOwnerNotFoundError";
  }
}

// Typed 409 — optimistic-concurrency conflict. A stale `expectedVersion`, a
// lost conditional update, or a concurrent first-create race all surface here.
export class CrmOwnerConflictError extends Error {
  readonly code = "conflict" as const;
  readonly messageKey = "crm.users.owner.conflict";

  constructor() {
    super("crm.users.owner.conflict");
    this.name = "CrmOwnerConflictError";
  }
}

// Typed 500 for a stored owner whose StaffProfile display name is unusable.
// Fails closed rather than fabricating a placeholder or exposing the raw id.
export class CrmOwnerInternalError extends Error {
  readonly code = "internal" as const;
  readonly messageKey = "crm.users.owner.internal";

  constructor() {
    super("crm.users.owner.internal");
    this.name = "CrmOwnerInternalError";
  }
}

/* ------------------------------------------------------- authorization gate */

/**
 * Candidate listing and PUT owner both require exactly `assign_owner`. Reading
 * the current owner deliberately does NOT call this — any valid StaffProfile may
 * read it. No StaffRole name is checked here: authorization is permission-based.
 */
export function assertCanAssignOwner(permissions: readonly CrmPermission[]): void {
  if (!canAssignOwner(permissions)) throw new CrmOwnerForbiddenError();
}

/* -------------------------------------------------------------- projections */

export interface CrmOwnerIdentity {
  employeeId: string;
  displayName: string;
}

export interface CrmOwnerState {
  owner: CrmOwnerIdentity | null;
  ownerVersion: number;
}

export interface CrmOwnerCandidate {
  employeeId: string;
  displayName: string;
}

export interface CrmOwnerCandidatesPage {
  items: CrmOwnerCandidate[];
  nextCursor: string | null;
}

/* ---------------------------------------------------------- learner target */

/**
 * `role: "user"` is part of the WHERE, not a post-filter, so a staff, admin or
 * system account produces exactly the same empty result as a nonexistent id —
 * the 404 therefore cannot be used to probe which ids belong to employees. The
 * UserRole axis is used purely as a target predicate here: it is never read as a
 * StaffRole and never grants anything.
 */
async function resolveLearnerTarget(userId: number): Promise<void> {
  const learner = await prisma.user.findFirst({
    where: { id: userId, role: "user" },
    select: { id: true },
  });
  if (!learner) throw new CrmOwnerNotFoundError("crm.users.owner.not_found");
}

/* --------------------------------------------------------- candidate cursor */

// Versioned, opaque, carrying ONLY the (displayName, employeeId) keyset tuple —
// no learner, session or permission data. It is not signed: a cursor grants
// nothing, so tampering can only shift the page position or yield a 400.
type OwnerCandidateCursor = { v: 1; n: string; i: string };

export function encodeOwnerCandidateCursor(displayName: string, employeeId: string): string {
  const payload: OwnerCandidateCursor = { v: 1, n: displayName, i: employeeId };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeOwnerCandidateCursor(raw: string): { displayName: string; employeeId: string } {
  if (raw.length > CRM_OWNER_CURSOR_MAX_LENGTH) {
    throw new CrmOwnerInputError("crm.owner_candidates.cursor_invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new CrmOwnerInputError("crm.owner_candidates.cursor_invalid");
  }

  // `v` is a literal: a cursor minted by another version is rejected, never
  // reinterpreted under this version's field meanings.
  const shape = z
    .object({ v: z.literal(1), n: z.string().min(1), i: z.string().min(1) })
    .strict()
    .safeParse(parsed);
  if (!shape.success) throw new CrmOwnerInputError("crm.owner_candidates.cursor_invalid");

  return { displayName: shape.data.n, employeeId: shape.data.i };
}

/* ---------------------------------------------------------- candidate query */

const CANDIDATE_QUERY_KEYS = new Set(["limit", "cursor"]);

export interface CrmOwnerCandidatesQuery {
  limit: number;
  cursor?: { displayName: string; employeeId: string };
}

/**
 * Strict query parsing. Unknown keys — including `search`, `offset`, `page`,
 * `total`, `include` and `fields` — are rejected rather than ignored, so a
 * client can never believe a filter or expansion applied when none exists. A
 * repeated key is rejected too.
 */
export function parseCrmOwnerCandidatesQuery(searchParams: URLSearchParams): CrmOwnerCandidatesQuery {
  for (const key of searchParams.keys()) {
    if (!CANDIDATE_QUERY_KEYS.has(key)) {
      throw new CrmOwnerInputError("crm.owner_candidates.unknown_query_key");
    }
    if (searchParams.getAll(key).length > 1) {
      throw new CrmOwnerInputError("crm.owner_candidates.repeated_query_key");
    }
  }

  // limit — integer, bounded. Rejects 0, negatives, fractions and non-numerics.
  let limit = CRM_OWNER_CANDIDATES_DEFAULT_LIMIT;
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit.trim())) {
      throw new CrmOwnerInputError("crm.owner_candidates.limit_invalid");
    }
    const value = Number(rawLimit.trim());
    if (!Number.isInteger(value) || value < 1 || value > CRM_OWNER_CANDIDATES_MAX_LIMIT) {
      throw new CrmOwnerInputError("crm.owner_candidates.limit_invalid");
    }
    limit = value;
  }

  let cursor: CrmOwnerCandidatesQuery["cursor"];
  const rawCursor = searchParams.get("cursor");
  if (rawCursor !== null) {
    if (rawCursor.trim() === "") throw new CrmOwnerInputError("crm.owner_candidates.cursor_invalid");
    cursor = decodeOwnerCandidateCursor(rawCursor);
  }

  return { limit, cursor };
}

/* ------------------------------------------------------------- candidate list */

// Exactly the two columns the projection needs. No `include`, so no relation is
// ever loaded wholesale; the active-status predicate lives in `where` and never
// selects the learner-User row into memory.
const CANDIDATE_SELECT = {
  id: true,
  displayName: true,
} satisfies Prisma.StaffProfileSelect;

type SelectedCandidate = Prisma.StaffProfileGetPayload<{ select: typeof CANDIDATE_SELECT }>;

/**
 * List eligible owner candidates, keyset-paginated over (displayName ASC,
 * employeeId ASC). Eligibility is: StaffProfile-backed, related User active,
 * StaffRole in the fixed eligible set, and a nonblank displayName. A
 * whitespace-only display name is hidden (it is not a valid candidate), and the
 * empty string is additionally excluded at the database level.
 */
export async function listCrmOwnerCandidates(
  query: CrmOwnerCandidatesQuery,
): Promise<CrmOwnerCandidatesPage> {
  const cursorWhere: Prisma.StaffProfileWhereInput = query.cursor
    ? {
        OR: [
          { displayName: { gt: query.cursor.displayName } },
          { displayName: query.cursor.displayName, id: { gt: query.cursor.employeeId } },
        ],
      }
    : {};

  const rows = await prisma.staffProfile.findMany({
    where: {
      staffRole: { in: [...CRM_ELIGIBLE_OWNER_ROLES] },
      user: { status: "active" },
      displayName: { not: "" },
      ...(query.cursor ? cursorWhere : {}),
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: CANDIDATE_SELECT,
  });

  // Hide any whitespace-only display name that slipped past the empty-string
  // predicate: such a row is a data fault, not a valid candidate.
  const usable = rows.filter((r): r is SelectedCandidate => r.displayName.trim().length > 0);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? usable.slice(0, query.limit) : usable;
  const last = page[page.length - 1];

  return {
    items: page.map((r) => ({ employeeId: r.id, displayName: r.displayName.trim() })),
    nextCursor:
      hasMore && last ? encodeOwnerCandidateCursor(last.displayName.trim(), last.id) : null,
  };
}

/* ------------------------------------------------------------ current owner */

// The stored row plus the live owner display name — resolved through the
// relation, never snapshotted. The owner read is NOT filtered by active status
// or eligible role, so a previously assigned owner who later became blocked, or
// whose role is no longer eligible, remains visible.
const OWNER_STATE_SELECT = {
  ownerId: true,
  version: true,
  owner: { select: { displayName: true } },
} satisfies Prisma.CrmUserOwnerSelect;

type SelectedOwnerState = Prisma.CrmUserOwnerGetPayload<{ select: typeof OWNER_STATE_SELECT }>;

/** Project a stored owner-state row into the public state. Fails closed on a
 * blank owner display name rather than fabricating a label or leaking the id. */
function toOwnerState(row: SelectedOwnerState): CrmOwnerState {
  if (row.ownerId === null) {
    return { owner: null, ownerVersion: row.version };
  }
  const displayName = row.owner?.displayName.trim() ?? "";
  if (displayName.length === 0) throw new CrmOwnerInternalError();
  return {
    owner: { employeeId: row.ownerId, displayName },
    ownerVersion: row.version,
  };
}

/**
 * Read the current owner. Absence of a row is the pristine, never-mutated state:
 * owner null, version 0. A row with ownerId null and version > 0 is a
 * previously-mutated but currently-unassigned state.
 */
export async function resolveCrmUserOwner(userId: number): Promise<CrmOwnerState> {
  await resolveLearnerTarget(userId);

  const row = await prisma.crmUserOwner.findUnique({
    where: { userId },
    select: OWNER_STATE_SELECT,
  });

  if (!row) return { owner: null, ownerVersion: 0 };
  return toOwnerState(row);
}

/* --------------------------------------------------------- mutation parsing */

// Strict: exactly two keys. `actor`, `userId`, `role`, `email`, `reason`,
// `comment`, `force` and every other field are rejected rather than ignored —
// the actor is taken from the session, never from the request body.
const ownerMutationBodySchema = z
  .object({
    ownerEmployeeId: z.string().nullable(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export interface CrmOwnerMutation {
  ownerEmployeeId: string | null;
  expectedVersion: number;
}

export function parseCrmOwnerMutationBody(raw: unknown): CrmOwnerMutation {
  const parsed = ownerMutationBodySchema.safeParse(raw);
  // Zod issues never escape: the caller learns the shape was wrong, not which
  // internal validator complained.
  if (!parsed.success) throw new CrmOwnerInputError("crm.users.owner.body_invalid");

  const ownerEmployeeId: string | null = parsed.data.ownerEmployeeId;
  if (ownerEmployeeId !== null) {
    // Compared exactly against the stored id — never trimmed or normalized —
    // but a blank or oversized value is a plain 400 before it can reach a query.
    if (ownerEmployeeId.trim().length === 0) {
      throw new CrmOwnerInputError("crm.users.owner.owner_employee_id_invalid");
    }
    if (ownerEmployeeId.length > CRM_OWNER_EMPLOYEE_ID_MAX_LENGTH) {
      throw new CrmOwnerInputError("crm.users.owner.owner_employee_id_invalid");
    }
  }

  return { ownerEmployeeId, expectedVersion: parsed.data.expectedVersion };
}

/** PUT takes no query parameters at all. Any key is a 400. */
export function assertNoOwnerQueryParams(searchParams: URLSearchParams): void {
  for (const _key of searchParams.keys()) {
    void _key;
    throw new CrmOwnerInputError("crm.users.owner.unknown_query_key");
  }
}

/* --------------------------------------------------- candidate validation */

/**
 * Resolve a StaffProfile that may be newly assigned as owner: it must exist,
 * hold an eligible StaffRole, back an active User, and have a nonblank display
 * name. Any failure collapses to the identical candidate 404, so the caller
 * cannot tell "no such employee" from "exists but ineligible/blocked". Returns
 * the live display name for the response.
 */
async function resolveAssignableCandidate(
  tx: Prisma.TransactionClient,
  employeeId: string,
): Promise<string> {
  const candidate = await tx.staffProfile.findFirst({
    where: {
      id: employeeId,
      staffRole: { in: [...CRM_ELIGIBLE_OWNER_ROLES] },
      user: { status: "active" },
    },
    select: { displayName: true },
  });
  const displayName = candidate?.displayName.trim() ?? "";
  if (displayName.length === 0) throw new CrmOwnerNotFoundError("crm.users.owner.candidate_not_found");
  return displayName;
}

/* -------------------------------------------------------- owner history write */

interface OwnerHistoryInsert {
  userId: number;
  actorStaffId: string;
  previousOwnerId: string | null;
  nextOwnerId: string | null;
  ownerVersion: number;
}

/**
 * Insert exactly one immutable owner-history row within the caller's owner
 * transaction. Every field is server-derived — the actor comes from the session,
 * the previous/next owners and the resulting version are computed by the mutation
 * — so nothing here is ever taken from the request body. The DB CHECK rejects a
 * null→null or A→A transition and the unique (userId, ownerVersion) index rejects
 * a duplicate resulting version; either surfaces as the transaction's failure and
 * rolls back the owner change with it.
 */
async function recordOwnerHistory(
  tx: Prisma.TransactionClient,
  insert: OwnerHistoryInsert,
): Promise<void> {
  await tx.crmUserOwnerHistory.create({
    data: {
      userId: insert.userId,
      actorStaffId: insert.actorStaffId,
      previousOwnerId: insert.previousOwnerId,
      nextOwnerId: insert.nextOwnerId,
      ownerVersion: insert.ownerVersion,
    },
    select: { id: true },
  });
}

/* ----------------------------------------------------------- mutation */

/**
 * Assign, replace or unassign the current owner under optimistic concurrency.
 *
 * Lifecycle (versions monotonic, never reset, row never deleted):
 *   pristine (no row) → owner null, version 0
 *   first assign      → owner A, version 1  (row created)
 *   replace           → owner B, version 2
 *   unassign          → owner null, version 3  (row RETAINED, ownerId null)
 *   reassign          → owner A, version 4
 *
 * `expectedVersion` must match the current version (0 when no row exists) or the
 * call is a 409 that writes nothing. Setting the same desired state with a
 * matching version is a no-op that neither increments the version nor touches
 * updatedAt — and, for a same-owner no-op, does NOT revalidate candidacy, so a
 * current owner who later became blocked stays put without an idempotent call
 * turning into a fresh assignment.
 *
 * OH-1 — Owner History: every REAL transition (assign-from-unowned, replace,
 * unassign) writes exactly one immutable CrmUserOwnerHistory row inside THIS
 * same transaction. `actorStaffId` is the authenticated StaffProfile and is
 * supplied by the caller from the session, never from the request body. A no-op,
 * a pristine unassign and a stale/losing concurrent write produce no row. If the
 * history insert fails (unique userId+ownerVersion clash, CHECK violation) the
 * whole transaction rolls back, so the current owner and its history can never
 * disagree. The row is derived entirely from server state: previous owner, next
 * owner and resulting version are computed here, never accepted from the client.
 */
export async function assignCrmUserOwner(
  userId: number,
  actorStaffId: string,
  mutation: CrmOwnerMutation,
): Promise<CrmOwnerState> {
  await resolveLearnerTarget(userId);

  const { ownerEmployeeId: desired, expectedVersion } = mutation;

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.crmUserOwner.findUnique({
        where: { userId },
        select: { ownerId: true, version: true },
      });

      /* -------- pristine: no row exists yet (version 0 by definition) -------- */
      if (!current) {
        // Any nonzero expected version is stale against a pristine learner.
        if (expectedVersion !== 0) throw new CrmOwnerConflictError();

        // Desired unassigned == pristine: a true no-op. Write nothing, create no
        // row and no history, so the learner stays pristine at version 0.
        if (desired === null) return { owner: null, ownerVersion: 0 };

        // First real assignment: validate the candidate, then create at v1. A
        // concurrent first-create loses the unique-PK race and maps to 409.
        const displayName = await resolveAssignableCandidate(tx, desired);
        const created = await tx.crmUserOwner.create({
          data: { userId, ownerId: desired, version: 1 },
          select: { version: true },
        });
        // One history row for the assign-from-unowned transition, same tx.
        await recordOwnerHistory(tx, {
          userId,
          actorStaffId,
          previousOwnerId: null,
          nextOwnerId: desired,
          ownerVersion: created.version,
        });
        return { owner: { employeeId: desired, displayName }, ownerVersion: created.version };
      }

      /* --------------------------- a row exists --------------------------- */
      if (expectedVersion !== current.version) throw new CrmOwnerConflictError();

      // Same desired state as current: no-op. No increment, no updatedAt touch,
      // no candidacy revalidation and no history row. Resolve the CURRENT owner's
      // live name (even if now blocked/ineligible) for the response.
      if (desired === current.ownerId) {
        if (desired === null) return { owner: null, ownerVersion: current.version };
        const same = await tx.staffProfile.findUnique({
          where: { id: desired },
          select: { displayName: true },
        });
        const displayName = same?.displayName.trim() ?? "";
        if (displayName.length === 0) throw new CrmOwnerInternalError();
        return { owner: { employeeId: desired, displayName }, ownerVersion: current.version };
      }

      // A real change. Validate a non-null new owner first (identical 404 on
      // miss/ineligible/blocked); unassignment needs no candidate.
      let displayName: string | null = null;
      if (desired !== null) {
        displayName = await resolveAssignableCandidate(tx, desired);
      }

      // Conditional update guarded on the version we read. If a concurrent
      // transaction already advanced the version, this matches zero rows → 409
      // (a lost update is never silently applied).
      const updated = await tx.crmUserOwner.updateMany({
        where: { userId, version: current.version },
        data: { ownerId: desired, version: { increment: 1 } },
      });
      if (updated.count === 0) throw new CrmOwnerConflictError();

      const nextVersion = current.version + 1;
      // One history row for the replace or unassign transition, same tx. The
      // unique (userId, ownerVersion) index is the backstop for a race that
      // somehow reached the same resulting version twice — it maps to 409 below.
      await recordOwnerHistory(tx, {
        userId,
        actorStaffId,
        previousOwnerId: current.ownerId,
        nextOwnerId: desired,
        ownerVersion: nextVersion,
      });
      return desired === null
        ? { owner: null, ownerVersion: nextVersion }
        : { owner: { employeeId: desired, displayName: displayName! }, ownerVersion: nextVersion };
    });
  } catch (error) {
    // Concurrency signals become a 409, never a 500 — these are exactly the
    // lost-update / racing-writer cases the contract requires as conflicts:
    //   P2002 — a concurrent first-create lost the unique-PK race.
    //   P2034 — a transaction write conflict / deadlock between racing writers.
    if (
      error instanceof PrismaNS.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2034")
    ) {
      throw new CrmOwnerConflictError();
    }
    throw error;
  }
}
