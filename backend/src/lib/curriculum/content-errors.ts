export type ContentValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ContentDomainErrorCode =
  | "CONTENT_DISABLED"
  | "CONTENT_ACTOR_FORBIDDEN"
  | "CONTENT_INPUT_INVALID"
  | "CONTENT_LEVEL_NOT_FOUND"
  | "CONTENT_VERSION_NOT_FOUND"
  | "CONTENT_VERSION_CONFLICT"
  | "CONTENT_VERSION_NOT_DRAFT"
  | "CONTENT_PUBLISHED_IMMUTABLE"
  | "CONTENT_ARCHIVED_IMMUTABLE"
  | "CONTENT_PUBLICATION_INVALID"
  | "CONTENT_REPLACEMENT_REQUIRED"
  | "CONTENT_REPLACEMENT_MISMATCH"
  | "CONTENT_LOCALIZATION_NOT_FOUND"
  | "CONTENT_LOCALIZATION_CONFLICT"
  | "CONTENT_ASSET_NOT_FOUND"
  | "CONTENT_ASSET_CONFLICT"
  | "CONTENT_BINDING_NOT_FOUND"
  | "CONTENT_BINDING_CONFLICT"
  | "CONTENT_VERSION_MISMATCH"
  | "CONTENT_NOT_EMPTY"
  | "CONTENT_NO_CHANGES"
  | "CONTENT_INTERNAL_ERROR";

export class ContentDomainError extends Error {
  readonly code: ContentDomainErrorCode;
  readonly issues: ContentValidationIssue[];

  constructor(
    code: ContentDomainErrorCode,
    message: string,
    issues: ContentValidationIssue[] = [],
  ) {
    super(message);
    this.name = "ContentDomainError";
    this.code = code;
    this.issues = issues;
  }
}

export function isContentDomainError(
  error: unknown,
  code?: ContentDomainErrorCode,
): error is ContentDomainError {
  if (!(error instanceof ContentDomainError)) return false;
  return code === undefined || error.code === code;
}
