/**
 * PREPROD ACTIVATION AUTHORIZATION — the refusal vocabulary.
 *
 * Every refusal names exactly which precondition failed. That matters more here
 * than in most modules: the operator running an activation has one manifest and
 * a dozen independent things that must all still be true, and "authorization
 * failed" would send them re-deriving all twelve. The code says which one moved.
 *
 * THERE IS NO CODE FOR "PROCEED ANYWAY". This enum is the complete set of
 * answers other than success, and none of them is a warning.
 */

export type PreprodActivationErrorCode =
  // ---- manifest identity
  | "MANIFEST_UNREADABLE"
  | "MANIFEST_MALFORMED"
  | "MANIFEST_SHA_MISMATCH"
  | "MANIFEST_SCHEMA_UNSUPPORTED"
  // ---- who and where
  | "ENVIRONMENT_NOT_PREPROD"
  | "HOST_MISMATCH"
  | "RISK_POLICY_UNSUPPORTED"
  // ---- the database being mutated
  | "TARGET_NOT_SANCTIONED"
  | "TARGET_PATH_MISMATCH"
  | "TARGET_IDENTITY_MISMATCH"
  | "TARGET_DIGEST_MISMATCH"
  | "TARGET_MIGRATION_MISMATCH"
  | "TARGET_UNREADABLE"
  // ---- the rollback artifact
  | "BACKUP_MANIFEST_MALFORMED"
  | "BACKUP_ARTIFACT_MISSING"
  | "BACKUP_ARTIFACT_DIGEST_MISMATCH"
  | "BACKUP_ARTIFACT_SIZE_MISMATCH"
  | "BACKUP_ARTIFACT_PERMISSIVE"
  | "BACKUP_INTEGRITY_FAILED"
  | "BACKUP_FOREIGN_KEYS_FAILED"
  | "BACKUP_MIGRATION_MISMATCH"
  | "BACKUP_SOURCE_DIGEST_MISMATCH"
  // ---- the reviewed inputs
  | "BACKEND_BASELINE_MISMATCH"
  | "PRODUCT_CHECKPOINT_MISMATCH"
  | "PACKAGE_MISMATCH"
  | "OVERLAY_MISMATCH"
  | "OVERLAY_PROVENANCE_MISMATCH"
  // ---- the environment around the database
  | "RELEASE_MISMATCH"
  | "FLAG_BASELINE_MISMATCH"
  // ---- what the database already contains
  | "CURRICULUM_STARTING_STATE_MISMATCH"
  | "UNEXPECTED_SOURCE_AUTHORITY"
  | "UNEXPECTED_REVIEW_NOTE"
  | "UNEXPECTED_EDITORIAL_STATE"
  | "UNEXPECTED_HISTORICAL_PRINCIPAL"
  // ---- the reviewed publication sequence
  | "CONTENT_PLAN_MISMATCH"
  // ---- sequencing
  | "OPERATION_NOT_AUTHORIZED"
  | "STAGE_NOT_AUTHORIZED"
  | "STAGE_OUT_OF_ORDER"
  | "STAGE_STATE_UNKNOWN"
  | "STAGE_ALREADY_COMPLETE"
  // ---- the capability itself
  //
  // `GRANT_NOT_AUTHENTIC` is what the protected-database guard raises when it is
  // handed something grant-SHAPED that this process never issued. The
  // independent audit demonstrated that an object literal with the right public
  // fields was accepted as authority; there is now a runtime registry, and this
  // is the refusal for anything that is not in it.
  | "GRANT_NOT_AUTHENTIC"
  | "GRANT_TARGET_MISMATCH"
  | "GRANT_OPERATION_MISMATCH"
  // ---- rehearsal
  | "REHEARSAL_FAILED"
  // ---- concurrency
  | "ACTIVATION_LOCK_HELD"
  | "ACTIVATION_LOCK_UNWRITABLE";

export class PreprodActivationError extends Error {
  readonly code: PreprodActivationErrorCode;
  /** What was expected, rendered for a human. Never a secret. */
  readonly expected: string | null;
  /** What was found instead. Never a secret. */
  readonly actual: string | null;

  constructor(
    code: PreprodActivationErrorCode,
    message: string,
    detail: { expected?: string | null; actual?: string | null } = {},
  ) {
    super(message);
    this.name = "PreprodActivationError";
    this.code = code;
    this.expected = detail.expected ?? null;
    this.actual = detail.actual ?? null;
  }
}

export function isPreprodActivationError(
  error: unknown,
  code?: PreprodActivationErrorCode,
): error is PreprodActivationError {
  if (!(error instanceof PreprodActivationError)) return false;
  return code === undefined || error.code === code;
}

/** Throw when `expected` and `actual` differ, with both rendered in the message. */
export function requireEqual(
  code: PreprodActivationErrorCode,
  label: string,
  expected: string | number,
  actual: string | number,
): void {
  if (String(expected) === String(actual)) return;
  throw new PreprodActivationError(
    code,
    `${label} does not match the reviewed manifest: expected ${String(expected)}, found ${String(actual)}`,
    { expected: String(expected), actual: String(actual) },
  );
}
