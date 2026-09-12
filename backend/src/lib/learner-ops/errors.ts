/**
 * LEARNER-OPERATIONS-V1 — the domain error vocabulary.
 *
 * One closed set of codes, each mapped to exactly one HTTP status. A caller
 * never sees a raw exception, a Prisma error or a stack, and never learns
 * whether a resource it may not see exists — `LEARNER_OPS_CASE_NOT_FOUND` is
 * returned both when the case does not exist and when the caller may not read
 * it, which is what stops the API from being an existence oracle.
 */
export const LEARNER_OPS_ERROR_STATUS = {
  /* 400 — the request is malformed or asks for something the domain forbids. */
  LEARNER_OPS_INPUT_INVALID: 400,
  LEARNER_OPS_ILLEGAL_TRANSITION: 400,
  LEARNER_OPS_ANCHOR_REQUIRED: 400,
  LEARNER_OPS_ANCHOR_NOT_PERMITTED: 400,
  LEARNER_OPS_ALREADY_RESOLVED: 400,
  LEARNER_OPS_ESCALATION_ALREADY_RESOLVED: 400,
  LEARNER_OPS_ESCALATION_OPEN: 400,
  LEARNER_OPS_CANONICAL_REVIEW_OPEN: 400,
  LEARNER_OPS_QA_TARGET_NOT_COMPLETE: 400,

  /* 403 — authenticated, identified, and not permitted. */
  LEARNER_OPS_FORBIDDEN: 403,

  /* 404 — absent, or present and invisible to this caller. */
  LEARNER_OPS_CASE_NOT_FOUND: 404,
  LEARNER_OPS_QUEUE_NOT_FOUND: 404,
  LEARNER_OPS_ESCALATION_NOT_FOUND: 404,
  LEARNER_OPS_LEARNER_NOT_FOUND: 404,
  LEARNER_OPS_REASON_CODE_NOT_FOUND: 404,
  LEARNER_OPS_SLA_POLICY_NOT_FOUND: 404,
  LEARNER_OPS_KNOWLEDGE_NOT_FOUND: 404,
  LEARNER_OPS_VOC_NOT_FOUND: 404,
  LEARNER_OPS_STAFF_NOT_FOUND: 404,

  /* 409 — somebody else got there first. The caller should re-read and retry. */
  LEARNER_OPS_VERSION_CONFLICT: 409,
  LEARNER_OPS_ASSIGNMENT_CONFLICT: 409,
  LEARNER_OPS_DUPLICATE: 409,

  /* 503 — the capability is switched off, not broken. */
  LEARNER_OPS_DISABLED: 503,
} as const;

export type LearnerOpsErrorCode = keyof typeof LEARNER_OPS_ERROR_STATUS;

export class LearnerOpsError extends Error {
  readonly status: number;

  constructor(
    readonly code: LearnerOpsErrorCode,
    /**
     * Operator-facing detail. Never contains a secret, a password hash, a
     * session token or a full learner identity — it is echoed to the client.
     */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "LearnerOpsError";
    this.status = LEARNER_OPS_ERROR_STATUS[code];
  }
}

export function isLearnerOpsError(
  error: unknown,
  code?: LearnerOpsErrorCode,
): error is LearnerOpsError {
  if (!(error instanceof LearnerOpsError)) return false;
  return code === undefined || error.code === code;
}

export function learnerOpsFail(code: LearnerOpsErrorCode, detail?: string): never {
  throw new LearnerOpsError(code, detail);
}
