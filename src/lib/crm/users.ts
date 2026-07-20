import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CrmPermission } from "@/lib/crm/roles";

// CRM Users v1 — the first truthful production CRM data read.
//
// Everything here comes from canonical User columns. Fields the CRM mock has but
// the backend cannot yet source truthfully (owner, notes, financial projections,
// lifecycle/funding/engagement derivations, last meaningful action) are
// deliberately absent rather than emulated. See docs/CRM_USERS_V1.md.

export const CRM_USERS_DEFAULT_LIMIT = 25;
export const CRM_USERS_MAX_LIMIT = 100;
export const CRM_USERS_MAX_SEARCH_LENGTH = 100;
export const CRM_USERS_MAX_CURSOR_LENGTH = 512;

// Typed 400 for anything the request got wrong. Carries no resource existence.
export class CrmUsersInputError extends Error {
  readonly code = "invalid_input" as const;

  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "CrmUsersInputError";
  }
}

/* ------------------------------------------------------------ email masking */

/**
 * Deterministic email mask. Keeps just enough for an employee to recognise an
 * account they already know, without disclosing the address:
 *
 *   nina.chmiel@example.test -> n***@e***.test
 *
 * Deterministic on purpose: the same input always masks identically, so it can
 * be asserted in tests and never accidentally becomes a partial oracle that
 * differs between requests.
 */
export function maskEmail(email: string): string {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) {
    // Not a shape we can mask meaningfully — disclose nothing at all.
    return "***";
  }

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");

  const maskedLocal = `${local.slice(0, 1)}***`;
  if (dot <= 0 || dot === domain.length - 1) return `${maskedLocal}@***`;

  return `${maskedLocal}@${domain.slice(0, 1)}***${domain.slice(dot)}`;
}

/* ------------------------------------------------------------------ cursor */

// Versioned, opaque, and carrying ONLY the pagination tuple. No email, name,
// role, permission or session data — a cursor is a position, not a capability.
// It is not signed: it grants nothing, so tampering can only produce a
// different position or a 400, never additional access.
type UsersCursor = { v: 1; t: string; i: number };

export function encodeUsersCursor(createdAt: Date, id: number): string {
  const payload: UsersCursor = { v: 1, t: createdAt.toISOString(), i: id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeUsersCursor(raw: string): { createdAt: Date; id: number } {
  if (raw.length > CRM_USERS_MAX_CURSOR_LENGTH) {
    throw new CrmUsersInputError("crm.users.cursor_invalid");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    // Decoder exceptions never escape: a malformed cursor is plain 400 input.
    throw new CrmUsersInputError("crm.users.cursor_invalid");
  }

  const shape = z
    .object({ v: z.literal(1), t: z.string(), i: z.number().int() })
    .strict()
    .safeParse(parsed);
  if (!shape.success) throw new CrmUsersInputError("crm.users.cursor_invalid");

  const createdAt = new Date(shape.data.t);
  if (Number.isNaN(createdAt.getTime())) throw new CrmUsersInputError("crm.users.cursor_invalid");

  return { createdAt, id: shape.data.i };
}

/* ------------------------------------------------------------------- query */

const KNOWN_QUERY_KEYS = new Set(["limit", "cursor", "search"]);

export interface CrmUsersQuery {
  limit: number;
  cursor?: { createdAt: Date; id: number };
  search?: string;
}

/**
 * Strict query parsing. Unknown keys are rejected rather than ignored, so a
 * client that sends a filter this version does not implement gets told, instead
 * of silently receiving unfiltered data it believes is filtered.
 */
export function parseCrmUsersQuery(
  searchParams: URLSearchParams,
  permissions: readonly CrmPermission[],
): CrmUsersQuery {
  for (const key of searchParams.keys()) {
    if (!KNOWN_QUERY_KEYS.has(key)) throw new CrmUsersInputError("crm.users.unknown_query_key");
  }

  // limit — integer, bounded. Rejects 0, negatives, fractions and non-numerics.
  let limit = CRM_USERS_DEFAULT_LIMIT;
  const rawLimit = searchParams.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit.trim())) throw new CrmUsersInputError("crm.users.limit_invalid");
    const value = Number(rawLimit.trim());
    if (!Number.isInteger(value) || value < 1 || value > CRM_USERS_MAX_LIMIT) {
      throw new CrmUsersInputError("crm.users.limit_invalid");
    }
    limit = value;
  }

  // cursor — opaque; a cursor can never widen the requested page size.
  let cursor: CrmUsersQuery["cursor"];
  const rawCursor = searchParams.get("cursor");
  if (rawCursor !== null) {
    if (rawCursor.trim() === "") throw new CrmUsersInputError("crm.users.cursor_invalid");
    cursor = decodeUsersCursor(rawCursor);
  }

  // search — trimmed; empty-after-trim is treated exactly as absent.
  let search: string | undefined;
  const rawSearch = searchParams.get("search");
  if (rawSearch !== null) {
    const trimmed = rawSearch.trim();
    if (trimmed.length > CRM_USERS_MAX_SEARCH_LENGTH) {
      throw new CrmUsersInputError("crm.users.search_too_long");
    }
    if (trimmed.length > 0) {
      // Email search is itself a disclosure channel: without
      // view_identity_full_email, probing addresses would reveal which accounts
      // exist through result presence. Reject the email-shaped query outright
      // rather than quietly downgrading it to a name search.
      if (trimmed.includes("@") && !permissions.includes("view_identity_full_email")) {
        throw new CrmUsersInputError("crm.users.search_email_forbidden");
      }
      search = trimmed;
    }
  }

  return { limit, cursor, search };
}

/* -------------------------------------------------------------- projection */

export interface CrmUserListItem {
  userId: string;
  displayName: string;
  email: { value: string; visibility: "full" | "masked" };
  status: "active" | "blocked";
  level: number;
  emailConfirmed: boolean;
  createdAt: string;
}

/** Honest fallback when a learner has no usable name. Never the email. */
export const CRM_USERS_DISPLAY_NAME_FALLBACK = "Пользователь";

// Exactly the columns needed for projection, search and the pagination tuple.
// Nothing else is read, so passwordHash, tokens and relations cannot leak even
// by accident.
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  level: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toListItem(user: SelectedUser, canSeeFullEmail: boolean): CrmUserListItem {
  const name = user.name.trim();
  return {
    userId: String(user.id),
    displayName: name.length > 0 ? name : CRM_USERS_DISPLAY_NAME_FALLBACK,
    email: canSeeFullEmail
      ? { value: user.email, visibility: "full" }
      : { value: maskEmail(user.email), visibility: "masked" },
    status: user.status,
    level: user.level,
    emailConfirmed: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------- query */

export interface CrmUsersPage {
  items: CrmUserListItem[];
  nextCursor: string | null;
}

/**
 * Keyset pagination over (createdAt DESC, id DESC). Both columns are stable for
 * a given row, so a page boundary cannot drift the way an OFFSET would, and id
 * breaks ties when two accounts share a createdAt.
 */
export async function listCrmUsers(
  query: CrmUsersQuery,
  permissions: readonly CrmPermission[],
): Promise<CrmUsersPage> {
  const canSeeFullEmail = permissions.includes("view_identity_full_email");

  const searchWhere: Prisma.UserWhereInput = query.search
    ? {
        OR: [
          { name: { contains: query.search } },
          // Only reachable with view_identity_full_email — parse rejects an
          // email-shaped query otherwise.
          ...(canSeeFullEmail ? [{ email: { contains: query.search } }] : []),
        ],
      }
    : {};

  const cursorWhere: Prisma.UserWhereInput = query.cursor
    ? {
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      }
    : {};

  const rows = await prisma.user.findMany({
    where: {
      // Learner axis. Mirrors the existing accepted CRM users surface
      // (/api/crm/users), which lists role: "user" accounts. This is the
      // UserRole axis used purely as a listing filter — it is never read as a
      // StaffRole and never grants anything.
      role: "user",
      ...(query.search ? searchWhere : {}),
      ...(query.cursor ? cursorWhere : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: USER_SELECT,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toListItem(row, canSeeFullEmail)),
    nextCursor: hasMore && last ? encodeUsersCursor(last.createdAt, last.id) : null,
  };
}
