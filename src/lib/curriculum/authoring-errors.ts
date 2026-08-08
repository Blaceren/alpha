/**
 * PHASE-G0 — the authoring-foundation error vocabulary.
 *
 * Deliberately its own module rather than an extension of `content-errors.ts`
 * or `assessment-errors.ts`: these codes describe the EDITORIAL axis, which
 * spans content, assessment and video-production alike. Adding
 * `AUTHORING_SELF_APPROVAL_FORBIDDEN` to the content vocabulary would have made
 * it look like a content-specific rule when it is a product-wide one.
 */
export type AuthoringIssue = {
  code: string;
  path: string;
  message: string;
};

export type AuthoringErrorCode =
  /** The aggregate moved under the caller. The whole write is refused. */
  | "AUTHORING_REVISION_CONFLICT"
  /** The transition is not legal from the current editorial state. */
  | "AUTHORING_STATE_INVALID"
  /** An approved version may not be edited in place. */
  | "AUTHORING_APPROVED_IMMUTABLE"
  /** A submitted version may not be edited in place. */
  | "AUTHORING_SUBMITTED_IMMUTABLE"
  /** The approver is the actor whose work is being approved. */
  | "AUTHORING_SELF_APPROVAL_FORBIDDEN"
  /** Server-authoritative validation refused the version. */
  | "AUTHORING_VALIDATION_FAILED"
  | "AUTHORING_TARGET_NOT_FOUND"
  | "AUTHORING_INPUT_INVALID"
  /** A review note named zero targets, or more than one. */
  | "AUTHORING_NOTE_TARGET_INVALID"
  | "AUTHORING_NOTE_NOT_FOUND"
  | "AUTHORING_NOTE_ALREADY_RESOLVED"
  | "AUTHORING_ACTOR_FORBIDDEN"
  | "AUTHORING_DISABLED"
  | "AUTHORING_INTERNAL_ERROR";

export class AuthoringDomainError extends Error {
  readonly code: AuthoringErrorCode;
  readonly issues: AuthoringIssue[];
  /**
   * Present on `AUTHORING_REVISION_CONFLICT` only. The caller needs the revision
   * that actually won so the UI can offer "reload and re-apply" rather than a
   * bare failure — and so a client can never guess it by incrementing.
   */
  readonly actualRevision: number | null;

  constructor(
    code: AuthoringErrorCode,
    message: string,
    options: { issues?: AuthoringIssue[]; actualRevision?: number } = {},
  ) {
    super(message);
    this.name = "AuthoringDomainError";
    this.code = code;
    this.issues = options.issues ?? [];
    this.actualRevision = options.actualRevision ?? null;
  }
}

export function isAuthoringDomainError(
  error: unknown,
  code?: AuthoringErrorCode,
): error is AuthoringDomainError {
  if (!(error instanceof AuthoringDomainError)) return false;
  return code === undefined || error.code === code;
}

/** HTTP status for each code. 409 is reserved for genuine concurrency loss. */
export function authoringErrorStatus(code: AuthoringErrorCode): number {
  switch (code) {
    case "AUTHORING_REVISION_CONFLICT":
      return 409;
    case "AUTHORING_STATE_INVALID":
    case "AUTHORING_APPROVED_IMMUTABLE":
    case "AUTHORING_SUBMITTED_IMMUTABLE":
    case "AUTHORING_NOTE_ALREADY_RESOLVED":
      return 409;
    case "AUTHORING_SELF_APPROVAL_FORBIDDEN":
    case "AUTHORING_ACTOR_FORBIDDEN":
      return 403;
    case "AUTHORING_TARGET_NOT_FOUND":
    case "AUTHORING_NOTE_NOT_FOUND":
      return 404;
    case "AUTHORING_DISABLED":
      return 404;
    case "AUTHORING_VALIDATION_FAILED":
    case "AUTHORING_INPUT_INVALID":
    case "AUTHORING_NOTE_TARGET_INVALID":
      return 422;
    default:
      return 500;
  }
}
