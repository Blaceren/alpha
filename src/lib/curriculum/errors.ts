import type { CurriculumValidationIssue } from "@/lib/curriculum/types";

export type CurriculumDomainErrorCode =
  | "CURRICULUM_NOT_FOUND"
  | "CURRICULUM_NOT_DRAFT"
  | "CURRICULUM_NOT_PUBLISHED"
  | "CURRICULUM_INVALID"
  | "CURRICULUM_PUBLISHED_IMMUTABLE"
  | "CURRICULUM_ARCHIVED_IMMUTABLE"
  | "CURRICULUM_REPLACEMENT_REQUIRED"
  | "CURRICULUM_REPLACEMENT_MISMATCH"
  | "CURRICULUM_EFFECTIVE_FROM_FUTURE"
  | "CURRICULUM_ACTOR_FORBIDDEN";

export class CurriculumDomainError extends Error {
  readonly code: CurriculumDomainErrorCode;
  readonly issues: CurriculumValidationIssue[];

  constructor(
    code: CurriculumDomainErrorCode,
    message: string,
    issues: CurriculumValidationIssue[] = [],
  ) {
    super(message);
    this.name = "CurriculumDomainError";
    this.code = code;
    this.issues = issues;
  }
}

export function isCurriculumDomainError(
  error: unknown,
  code?: CurriculumDomainErrorCode,
): error is CurriculumDomainError {
  if (!(error instanceof CurriculumDomainError)) return false;
  return code === undefined || error.code === code;
}
