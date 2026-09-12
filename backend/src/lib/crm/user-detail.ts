import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CrmPermission } from "@/lib/crm/roles";
import { maskEmail } from "@/lib/crm/users";

// CRM User Detail v1 — a learner account detail FOUNDATION, not a complete
// User 360. It carries only canonical User columns. The CRM mock's User 360
// aggregate (attention/priority, lifecycle/funding/engagement states, owner,
// notes, timeline, recommendations, financials) has no backend source and is
// deliberately absent rather than emulated. See docs/CRM_USER_DETAIL_V1.md.

/** Prisma/SQLite `Int` upper bound. Ids above this cannot exist. */
export const PRISMA_INT_MAX = 2_147_483_647;

/**
 * Canonical positive decimal id: no sign, no leading zero, no decimal point,
 * no exponent, no whitespace. The digit bound keeps a hostile path segment from
 * reaching Number() at all; the range check then rejects anything Prisma's Int
 * column could never hold.
 */
const USER_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

// Typed 400. Carries no resource existence.
export class CrmUserDetailInputError extends Error {
  readonly code = "invalid_input" as const;

  constructor(readonly messageKey: string) {
    super(messageKey);
    this.name = "CrmUserDetailInputError";
  }
}

// Typed 404. One shape for every miss — see resolveCrmUserDetail.
export class CrmUserDetailNotFoundError extends Error {
  readonly code = "not_found" as const;
  readonly messageKey = "crm.users.detail.not_found";

  constructor() {
    super("crm.users.detail.not_found");
    this.name = "CrmUserDetailNotFoundError";
  }
}

/** Parse the `userId` path segment. Never reads a query parameter. */
export function parseCrmUserId(raw: string): number {
  if (!USER_ID_PATTERN.test(raw)) {
    throw new CrmUserDetailInputError("crm.users.detail.user_id_invalid");
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > PRISMA_INT_MAX) {
    throw new CrmUserDetailInputError("crm.users.detail.user_id_invalid");
  }

  return value;
}

/**
 * This endpoint takes no query parameters at all. An unknown key is rejected
 * rather than ignored, so a caller cannot believe an `include`/`expand`/field
 * selector applied when nothing of the sort exists.
 */
export function assertNoQueryParams(searchParams: URLSearchParams): void {
  for (const _key of searchParams.keys()) {
    void _key;
    throw new CrmUserDetailInputError("crm.users.detail.unknown_query_key");
  }
}

/* -------------------------------------------------------------- projection */

export interface CrmUserDetail {
  userId: string;
  displayName: string;
  email: { value: string; visibility: "full" | "masked" };
  status: "active" | "blocked";
  level: number;
  xp: number;
  emailConfirmed: boolean;
  createdAt: string;
}

/** Honest fallback when a learner has no usable name. Never the email. */
export const CRM_USER_DETAIL_DISPLAY_NAME_FALLBACK = "Пользователь";

/**
 * Exactly the columns the projection needs. `role` is deliberately absent: the
 * learner predicate lives in `where`, so the internal UserRole is never even
 * loaded, let alone serialized. passwordHash, pendingEmail, referralCode,
 * updatedAt, currentTask, leaderboardExcluded, selectedAchievementId and every
 * relation are unreachable by construction.
 */
const USER_DETAIL_SELECT = {
  id: true,
  name: true,
  email: true,
  status: true,
  level: true,
  xp: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type SelectedUserDetail = Prisma.UserGetPayload<{ select: typeof USER_DETAIL_SELECT }>;

/** Explicit projector — a Prisma row is never spread into the response. */
function toDetail(user: SelectedUserDetail, canSeeFullEmail: boolean): CrmUserDetail {
  const name = user.name.trim();
  return {
    userId: String(user.id),
    displayName: name.length > 0 ? name : CRM_USER_DETAIL_DISPLAY_NAME_FALLBACK,
    email: canSeeFullEmail
      ? { value: user.email, visibility: "full" }
      : { value: maskEmail(user.email), visibility: "masked" },
    status: user.status,
    level: user.level,
    xp: user.xp,
    emailConfirmed: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * One query, one learner.
 *
 * `role: "user"` is part of the WHERE, not a post-filter, so a staff or system
 * account produces exactly the same empty result as a nonexistent id — the 404
 * therefore cannot be used to probe which ids belong to employees. The
 * UserRole axis is used purely as a listing predicate here and is never read as
 * a StaffRole and never grants anything.
 */
export async function resolveCrmUserDetail(
  userId: number,
  permissions: readonly CrmPermission[],
): Promise<CrmUserDetail> {
  const user = await prisma.user.findFirst({
    where: { id: userId, role: "user" },
    select: USER_DETAIL_SELECT,
  });

  if (!user) throw new CrmUserDetailNotFoundError();

  return toDetail(user, permissions.includes("view_identity_full_email"));
}
