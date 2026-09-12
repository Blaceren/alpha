/**
 * COMMUNITY-V1 — the closed error vocabulary.
 *
 * Modelled on `learner-ops/errors.ts`: a code the client can switch on, an
 * optional detail written by THIS codebase, and never a Zod issue, a Prisma
 * message, a stack, a SQL fragment, a filesystem path, a role name or a
 * permission name. An unauthorized caller must not be able to read the shape of
 * the permission model out of an error body.
 */
export const COMMUNITY_ERROR_STATUS = {
  COMMUNITY_UNAUTHENTICATED: 401,
  COMMUNITY_FORBIDDEN: 403,
  COMMUNITY_SPACE_NOT_FOUND: 404,
  COMMUNITY_DISCUSSION_NOT_FOUND: 404,
  COMMUNITY_REPLY_NOT_FOUND: 404,
  COMMUNITY_VALIDATION: 400,
  COMMUNITY_DUPLICATE: 409,
  COMMUNITY_ALREADY_REPORTED: 409,
  COMMUNITY_CONTENT_REMOVED: 409,
  COMMUNITY_RATE_LIMITED: 429,
  COMMUNITY_INTERNAL: 500,
} as const;

export type CommunityErrorCode = keyof typeof COMMUNITY_ERROR_STATUS;

export class CommunityError extends Error {
  readonly code: CommunityErrorCode;
  readonly status: number;
  readonly detail: string | null;

  constructor(code: CommunityErrorCode, detail?: string) {
    super(code);
    this.name = "CommunityError";
    this.code = code;
    this.status = COMMUNITY_ERROR_STATUS[code];
    this.detail = detail ?? null;
  }
}

export function isCommunityError(error: unknown): error is CommunityError {
  return error instanceof CommunityError;
}
