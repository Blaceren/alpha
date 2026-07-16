export type ReportValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ReportDomainErrorCode =
  | "REPORT_DISABLED"
  | "REPORT_ACTOR_FORBIDDEN"
  | "REPORT_INPUT_INVALID"
  | "REPORT_LEVEL_NOT_FOUND"
  | "REPORT_LEVEL_TYPE_INVALID"
  | "REPORT_ASSIGNMENT_NOT_FOUND"
  | "REPORT_ASSIGNMENT_CONFLICT"
  | "REPORT_ASSIGNMENT_NOT_DRAFT"
  | "REPORT_PUBLISHED_IMMUTABLE"
  | "REPORT_ARCHIVED_IMMUTABLE"
  | "REPORT_PUBLICATION_INVALID"
  | "REPORT_REPLACEMENT_REQUIRED"
  | "REPORT_REPLACEMENT_MISMATCH"
  | "REPORT_LOCALIZATION_NOT_FOUND"
  | "REPORT_FIELD_NOT_FOUND"
  | "REPORT_FIELD_LOCALIZATION_NOT_FOUND"
  | "REPORT_RUBRIC_NOT_FOUND"
  | "REPORT_RUBRIC_CONFLICT"
  | "REPORT_CRITERION_NOT_FOUND"
  | "REPORT_CRITERION_LOCALIZATION_NOT_FOUND"
  | "REPORT_SCALE_OPTION_NOT_FOUND"
  | "REPORT_SCALE_LOCALIZATION_NOT_FOUND"
  | "REPORT_REASON_NOT_FOUND"
  | "REPORT_REASON_LOCALIZATION_NOT_FOUND"
  | "REPORT_BINDING_NOT_FOUND"
  | "REPORT_BINDING_CONFLICT"
  | "REPORT_VERSION_MISMATCH"
  | "REPORT_NOT_EMPTY"
  | "REPORT_NO_CHANGES"
  | "REPORT_INTERNAL_ERROR";

export class ReportDomainError extends Error {
  readonly code: ReportDomainErrorCode;
  readonly issues: ReportValidationIssue[];

  constructor(
    code: ReportDomainErrorCode,
    message: string,
    issues: ReportValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ReportDomainError";
    this.code = code;
    this.issues = issues;
  }
}

export function isReportDomainError(
  error: unknown,
  code?: ReportDomainErrorCode,
): error is ReportDomainError {
  if (!(error instanceof ReportDomainError)) return false;
  return code === undefined || error.code === code;
}
