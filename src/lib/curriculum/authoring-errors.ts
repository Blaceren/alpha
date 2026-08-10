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
  /**
   * PHASE-G2 SUCCESSOR — a named candidate version does not belong to the level
   * it was named for.
   *
   * ITS OWN CODE, not `AUTHORING_TARGET_NOT_FOUND`. The row usually EXISTS; what
   * is wrong is that it belongs to another level, and the two need different
   * reactions — a missing id is a typo, a foreign id is an attempt (however
   * accidental) to validate or approve one level's work as another's. Reporting
   * the second as the first would hide a cross-level mix-up behind a 404.
   */
  | "AUTHORING_CANDIDATE_INVALID"
  | "AUTHORING_INPUT_INVALID"
  /**
   * PHASE-G0 CORRECTION — a durable assessment bank could not be projected into
   * the accepted fingerprint shape. Raised rather than fingerprinting partial
   * data, because a hash over an incomplete read would claim a coherence check
   * that never happened.
   */
  | "AUTHORING_ASSESSMENT_PROJECTION_INVALID"
  /** The video contract is not linked to a durable AssessmentVersion. */
  | "AUTHORING_ASSESSMENT_LINK_MISSING"
  /** More than one candidate bank; the link refuses to guess. */
  | "AUTHORING_ASSESSMENT_LINK_AMBIGUOUS"
  /**
   * PHASE-G2 CORRECTION-2 — a durable link names a video production version
   * that belongs to a DIFFERENT level or curriculum version.
   *
   * Its own code rather than `AUTHORING_ASSESSMENT_LINK_AMBIGUOUS`, because the
   * remedy differs: ambiguous means "several plausible candidates, choose one";
   * this means the stored record is wrong and must be repaired before anything
   * may be derived from it. Nothing is chosen while it stands.
   */
  | "AUTHORING_ASSESSMENT_LINK_INVALID"
  /**
   * PHASE-G2 CORRECTION-2 — the canonical Blueprint source contract for a bank
   * exists but cannot be read, so no comparison is possible.
   *
   * Deliberately NOT reported as zero conflicts. "We could not find out whether
   * the two sides agree" is not "the two sides agree", and treating it as such
   * is what let an unparseable payload carry a conflicting bank to handoff.
   */
  | "AUTHORING_SOURCE_CONTRACT_UNREADABLE"
  /**
   * PHASE-G0 PUBLISH GATE — a runtime publication was attempted on a version no
   * human has editorially approved.
   *
   * It is deliberately its own code rather than `AUTHORING_STATE_INVALID`: the
   * remedy is completely different. A state-invalid transition means the caller
   * asked for something the lifecycle does not offer; this means the lifecycle
   * step is legal but the PRODUCT precondition is missing, and the answer is
   * "get it reviewed", not "try a different call".
   */
  | "AUTHORING_APPROVAL_REQUIRED"
  /** A review note named zero targets, or more than one. */
  | "AUTHORING_NOTE_TARGET_INVALID"
  | "AUTHORING_NOTE_NOT_FOUND"
  | "AUTHORING_NOTE_ALREADY_RESOLVED"
  | "AUTHORING_ACTOR_FORBIDDEN"
  /**
   * PHASE-G1 — a preview payload carried something a learner frame may not.
   *
   * Its own code because it is not an input error the caller can fix by sending
   * different values: it means the payload BUILDER produced a shape containing
   * an answer key, which is a platform defect and must fail closed rather than
   * be reported as a validation nit.
   */
  | "AUTHORING_PREVIEW_UNSAFE"
  /** A level in a package-handoff request still carries handoff blockers. */
  | "AUTHORING_HANDOFF_BLOCKED"
  /** More than one APPROVED version of the same aggregate on one level. */
  | "AUTHORING_HANDOFF_AMBIGUOUS"
  /** An approved level no longer passes server-authoritative validation. */
  | "AUTHORING_HANDOFF_INVALID"
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
    // 409, not 403: the caller may well hold publish authority. What is wrong is
    // the RESOURCE's state, and it becomes right the moment a reviewer approves.
    case "AUTHORING_APPROVAL_REQUIRED":
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
    // 422 rather than 404: the request is well formed and the row may well
    // exist — it simply is not a version of the level the caller named, which
    // makes it an unprocessable request about a real object.
    case "AUTHORING_CANDIDATE_INVALID":
    case "AUTHORING_NOTE_TARGET_INVALID":
    case "AUTHORING_ASSESSMENT_PROJECTION_INVALID":
    case "AUTHORING_ASSESSMENT_LINK_AMBIGUOUS":
      return 422;
    case "AUTHORING_ASSESSMENT_LINK_MISSING":
      return 409;
    // CORRECTION-2. Both are 409 for the same reason the handoff refusals are:
    // the request is well formed and the caller may hold every permission — what
    // is wrong is the durable STATE, and it becomes right when the linkage or the
    // stored contract is repaired. Neither is a client input error, and neither
    // may be retried around.
    case "AUTHORING_ASSESSMENT_LINK_INVALID":
    case "AUTHORING_SOURCE_CONTRACT_UNREADABLE":
      return 409;
    // A handoff refusal is 409, not 422: the request itself is well formed and
    // the caller may hold every permission. What is wrong is the STATE of the
    // curriculum, and it becomes right when the blocking work is approved.
    case "AUTHORING_HANDOFF_BLOCKED":
    case "AUTHORING_HANDOFF_AMBIGUOUS":
      return 409;
    case "AUTHORING_HANDOFF_INVALID":
      return 422;
    // 500. A learner frame that turned out to carry an answer key is a platform
    // defect, and a 4xx would invite a client to retry its way around it.
    case "AUTHORING_PREVIEW_UNSAFE":
      return 500;
    default:
      return 500;
  }
}
