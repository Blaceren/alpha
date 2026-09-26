import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CrmPermission } from "@/lib/crm/roles";

// CRM User Notes v1 — immutable, append-only internal staff commentary about a
// learner. Exactly two operations exist: list and create. There is no update,
// no delete, no individual-note route, and no Prisma update/delete call
// anywhere in this module.
//
// Contract: docs/CRM_USER_NOTES_V1.md

export const CRM_NOTES_DEFAULT_LIMIT = 25;
export const CRM_NOTES_MAX_LIMIT = 100;
export const CRM_NOTES_MAX_CURSOR_LENGTH = 512;

/** Body bound, counted in Unicode code points — never UTF-16 code units. */
export const CRM_NOTES_MAX_BODY_CODE_POINTS = 2000;

// Typed 400 for anything the request got wrong. Carries no resource existence.
export class CrmUserNotesInputError extends Error {
  readonly code = "invalid_input" as const;

  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "CrmUserNotesInputError";
  }
}

// Typed 403. One shape for every missing Notes permission — the envelope never
// names the role or the permission that was missing.
export class CrmUserNotesForbiddenError extends Error {
  readonly code = "unauthorized" as const;
  readonly messageKey = "crm.users.notes.forbidden";

  constructor() {
    super("crm.users.notes.forbidden");
    this.name = "CrmUserNotesForbiddenError";
  }
}

// Typed 404. One shape for every miss — see resolveLearnerTarget.
export class CrmUserNotesNotFoundError extends Error {
  readonly code = "not_found" as const;
  readonly messageKey = "crm.users.notes.not_found";

  constructor() {
    super("crm.users.notes.not_found");
    this.name = "CrmUserNotesNotFoundError";
  }
}

// Typed 500 for a note whose author row is unusable. Fails closed rather than
// inventing a placeholder name or falling back to exposing the author id.
export class CrmUserNotesAuthorError extends Error {
  readonly code = "internal" as const;
  readonly messageKey = "crm.users.notes.internal";

  constructor() {
    super("crm.users.notes.internal");
    this.name = "CrmUserNotesAuthorError";
  }
}

/* ------------------------------------------------------- authorization gate */

/**
 * Each operation checks its own exact permission. `create_user_notes`
 * deliberately does NOT imply `view_user_notes`: the production matrix happens
 * to grant both to the same four roles, but the two checks stay semantically
 * independent so either can be granted alone and tested alone.
 *
 * `edit_user_notes` grants neither — it stays reserved for the future edit,
 * delete, pin and visibility operations on an existing note.
 */
export function assertCanListNotes(permissions: readonly CrmPermission[]): void {
  if (!permissions.includes("view_user_notes")) throw new CrmUserNotesForbiddenError();
}

export function assertCanCreateNotes(permissions: readonly CrmPermission[]): void {
  if (!permissions.includes("create_user_notes")) throw new CrmUserNotesForbiddenError();
}

/* --------------------------------------------------------- normalize body */

/**
 * Pure body normalizer. Plain text only: the result is never parsed or rendered
 * as HTML or Markdown, and nothing is ever silently deleted or truncated —
 * malformed input is rejected, not repaired into something that looks valid.
 *
 * Order matters. Newlines are normalized first so a body of only "\r\n" trims
 * to empty and is rejected as blank rather than as a control character.
 */
export function normalizeNoteBody(raw: unknown): string {
  if (typeof raw !== "string") throw new CrmUserNotesInputError("crm.users.notes.body_invalid");

  // CRLF and lone CR collapse to LF, so the same text typed on any platform is
  // stored identically and counts identically against the bound.
  const unified = raw.replace(/\r\n?/g, "\n");

  // Unicode-aware trim: \s covers NBSP, ideographic space and friends.
  const trimmed = unified.trim();
  if (trimmed.length === 0) throw new CrmUserNotesInputError("crm.users.notes.body_blank");

  // Reject NUL and every other control character except newline and tab.
  // Internal spaces, tabs and newlines are preserved exactly.
  for (const char of trimmed) {
    const cp = char.codePointAt(0)!;
    if (char === "\n" || char === "\t") continue;
    // C0 (incl. NUL), DEL, and C1.
    if (cp <= 0x1f || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) {
      throw new CrmUserNotesInputError("crm.users.notes.body_control_char");
    }
  }

  // Count code points, not UTF-16 units, so an astral emoji counts as one.
  const codePoints = [...trimmed].length;
  if (codePoints > CRM_NOTES_MAX_BODY_CODE_POINTS) {
    throw new CrmUserNotesInputError("crm.users.notes.body_too_long");
  }

  return trimmed;
}

/* ------------------------------------------------------------------ cursor */

// Versioned, opaque, carrying ONLY the pagination tuple — no learner, author,
// permission or session data. It is not signed: a cursor grants nothing, so
// tampering can only produce a different position or a 400, never more access.
type NotesCursor = { v: 1; t: string; i: string };

export function encodeNotesCursor(createdAt: Date, id: string): string {
  const payload: NotesCursor = { v: 1, t: createdAt.toISOString(), i: id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeNotesCursor(raw: string): { createdAt: Date; id: string } {
  if (raw.length > CRM_NOTES_MAX_CURSOR_LENGTH) {
    throw new CrmUserNotesInputError("crm.users.notes.cursor_invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    // Decoder exceptions never escape: a malformed cursor is plain 400 input.
    throw new CrmUserNotesInputError("crm.users.notes.cursor_invalid");
  }

  // `v` is a literal: a cursor minted by another version is rejected, never
  // reinterpreted under this version's field meanings.
  const shape = z
    .object({ v: z.literal(1), t: z.string(), i: z.string().min(1) })
    .strict()
    .safeParse(parsed);
  if (!shape.success) throw new CrmUserNotesInputError("crm.users.notes.cursor_invalid");

  const createdAt = new Date(shape.data.t);
  if (Number.isNaN(createdAt.getTime())) {
    throw new CrmUserNotesInputError("crm.users.notes.cursor_invalid");
  }

  return { createdAt, id: shape.data.i };
}

/* ------------------------------------------------------------- GET query */

const KNOWN_QUERY_KEYS = new Set(["limit", "cursor"]);

export interface CrmUserNotesQuery {
  limit: number;
  cursor?: { createdAt: Date; id: string };
}

/**
 * Strict query parsing. Unknown keys — including `offset`, `page`, `total`,
 * `include`, `expand` and `fields` — are rejected rather than ignored, so a
 * client can never believe a filter or expansion applied when none exists.
 * A repeated key is rejected too: silently taking the first value would let
 * `?limit=1&limit=100` mean something different to client and server.
 */
export function parseCrmUserNotesQuery(searchParams: URLSearchParams): CrmUserNotesQuery {
  for (const key of searchParams.keys()) {
    if (!KNOWN_QUERY_KEYS.has(key)) {
      throw new CrmUserNotesInputError("crm.users.notes.unknown_query_key");
    }
    if (searchParams.getAll(key).length > 1) {
      throw new CrmUserNotesInputError("crm.users.notes.repeated_query_key");
    }
  }

  // limit — integer, bounded. Rejects 0, negatives, fractions and non-numerics.
  let limit = CRM_NOTES_DEFAULT_LIMIT;
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit.trim())) {
      throw new CrmUserNotesInputError("crm.users.notes.limit_invalid");
    }
    const value = Number(rawLimit.trim());
    if (!Number.isInteger(value) || value < 1 || value > CRM_NOTES_MAX_LIMIT) {
      throw new CrmUserNotesInputError("crm.users.notes.limit_invalid");
    }
    limit = value;
  }

  // cursor — opaque; a cursor carries a position only and can never widen the
  // requested page size.
  let cursor: CrmUserNotesQuery["cursor"];
  const rawCursor = searchParams.get("cursor");
  if (rawCursor !== null) {
    if (rawCursor.trim() === "") throw new CrmUserNotesInputError("crm.users.notes.cursor_invalid");
    cursor = decodeNotesCursor(rawCursor);
  }

  return { limit, cursor };
}

/** POST takes no query parameters at all. Any key is a 400. */
export function assertNoNotesQueryParams(searchParams: URLSearchParams): void {
  for (const _key of searchParams.keys()) {
    void _key;
    throw new CrmUserNotesInputError("crm.users.notes.unknown_query_key");
  }
}

/* --------------------------------------------------------- POST body shape */

// Strict: exactly one key. `authorId`, `employeeId`, `authorDisplayName`,
// `createdAt`, `visibility` and every other field are rejected rather than
// ignored — the author is taken from the session, never from the request.
const notesCreateBodySchema = z.object({ body: z.string() }).strict();

export function parseCrmUserNoteCreateBody(raw: unknown): string {
  const parsed = notesCreateBodySchema.safeParse(raw);
  // Zod issues never escape: the caller learns the shape was wrong, not which
  // internal validator produced the complaint.
  if (!parsed.success) throw new CrmUserNotesInputError("crm.users.notes.body_invalid");
  return normalizeNoteBody(parsed.data.body);
}

/* -------------------------------------------------------------- projection */

export interface CrmUserNoteItem {
  noteId: string;
  body: string;
  authorDisplayName: string;
  createdAt: string;
}

export interface CrmUserNotesPage {
  items: CrmUserNoteItem[];
  nextCursor: string | null;
}

/**
 * Exactly the columns the projection needs, with the author's display name
 * pulled in the same query via a nested select. `authorId` is deliberately not
 * selected: it is never projected, so it cannot leak by accident. There is no
 * `include` anywhere, so no relation is ever loaded wholesale.
 */
const NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  author: { select: { displayName: true } },
} satisfies Prisma.CrmUserNoteSelect;

type SelectedNote = Prisma.CrmUserNoteGetPayload<{ select: typeof NOTE_SELECT }>;

/** Explicit projector — a Prisma row is never spread into the response. */
function toNoteItem(note: SelectedNote): CrmUserNoteItem {
  const displayName = note.author.displayName.trim();
  // Fail closed. A blank author name is a data fault, not something to paper
  // over with a fabricated label or by falling back to the author id.
  if (displayName.length === 0) throw new CrmUserNotesAuthorError();

  return {
    noteId: note.id,
    body: note.body,
    authorDisplayName: displayName,
    createdAt: note.createdAt.toISOString(),
  };
}

/* ---------------------------------------------------------- learner target */

/**
 * `role: "user"` is part of the WHERE, not a post-filter, so a staff, admin or
 * system account produces exactly the same empty result as a nonexistent id —
 * the 404 therefore cannot be used to probe which ids belong to employees. The
 * UserRole axis is used purely as a target predicate here: it is never read as
 * a StaffRole and never grants anything.
 *
 * This is a bounded existence check that selects one column, deliberately kept
 * separate from the notes query so a hidden target returns 404 rather than a
 * fabricated empty list.
 */
async function resolveLearnerTarget(userId: number): Promise<void> {
  const learner = await prisma.user.findFirst({
    where: { id: userId, role: "user" },
    select: { id: true },
  });
  if (!learner) throw new CrmUserNotesNotFoundError();
}

/* ------------------------------------------------------------------- list */

/**
 * Keyset pagination over (createdAt DESC, id DESC). Both columns are stable for
 * a given row — notes are immutable, so a page boundary can never drift the way
 * an OFFSET would — and the cuid id breaks ties when two notes share a
 * createdAt. No total is computed or returned.
 */
export async function listCrmUserNotes(
  userId: number,
  query: CrmUserNotesQuery,
): Promise<CrmUserNotesPage> {
  await resolveLearnerTarget(userId);

  const cursorWhere: Prisma.CrmUserNoteWhereInput = query.cursor
    ? {
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      }
    : {};

  // One query for the page, author display names included via nested select.
  // No per-note author lookup exists, so there is no N+1.
  const rows = await prisma.crmUserNote.findMany({
    where: { userId, ...(query.cursor ? cursorWhere : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: NOTE_SELECT,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map(toNoteItem),
    nextCursor: hasMore && last ? encodeNotesCursor(last.createdAt, last.id) : null,
  };
}

/* ----------------------------------------------------------------- create */

/**
 * Append a note. `authorId` comes only from the authenticated StaffProfile —
 * never from the request body, query or a header. The created row is the sole
 * side effect: no AuditLog write, no notification, no counter.
 */
export async function createCrmUserNote(
  userId: number,
  authorId: string,
  body: string,
): Promise<CrmUserNoteItem> {
  await resolveLearnerTarget(userId);

  const created = await prisma.crmUserNote.create({
    data: { userId, authorId, body },
    select: NOTE_SELECT,
  });

  return toNoteItem(created);
}
