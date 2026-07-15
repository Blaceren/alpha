export type AssessmentValidationIssue = {
  code: string;
  entity: "assessment" | "question" | "localization";
  reference: string;
  message: string;
};

export type AssessmentDomainErrorCode =
  | "ASSESSMENT_DISABLED"
  | "ASSESSMENT_ACTOR_FORBIDDEN"
  | "ASSESSMENT_INPUT_INVALID"
  | "ASSESSMENT_LEVEL_NOT_FOUND"
  | "ASSESSMENT_VERSION_NOT_FOUND"
  | "ASSESSMENT_VERSION_CONFLICT"
  | "ASSESSMENT_VERSION_NOT_DRAFT"
  | "ASSESSMENT_PUBLISHED_IMMUTABLE"
  | "ASSESSMENT_ARCHIVED_IMMUTABLE"
  | "ASSESSMENT_QUESTION_NOT_FOUND"
  | "ASSESSMENT_QUESTION_CONFLICT"
  | "ASSESSMENT_LOCALIZATION_NOT_FOUND"
  | "ASSESSMENT_LOCALIZATION_CONFLICT"
  | "ASSESSMENT_PUBLICATION_INVALID"
  | "ASSESSMENT_REPLACEMENT_REQUIRED"
  | "ASSESSMENT_REPLACEMENT_MISMATCH"
  | "ASSESSMENT_BINDING_NOT_FOUND"
  | "ASSESSMENT_BINDING_CONFLICT"
  | "ASSESSMENT_VERSION_MISMATCH"
  | "ASSESSMENT_NOT_EMPTY"
  | "ASSESSMENT_NO_CHANGES"
  | "ASSESSMENT_INTERNAL_ERROR";

export class AssessmentDomainError extends Error {
  readonly code: AssessmentDomainErrorCode;
  readonly issues: AssessmentValidationIssue[];

  constructor(
    code: AssessmentDomainErrorCode,
    message: string,
    issues: AssessmentValidationIssue[] = [],
  ) {
    super(message);
    this.name = "AssessmentDomainError";
    this.code = code;
    this.issues = issues;
  }
}

export function isAssessmentDomainError(
  error: unknown,
  code?: AssessmentDomainErrorCode,
): error is AssessmentDomainError {
  if (!(error instanceof AssessmentDomainError)) return false;
  return code === undefined || error.code === code;
}
