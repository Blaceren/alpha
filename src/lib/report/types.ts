/**
 * Wire DTOs for the Backend learner REPORT contract, plus narrow runtime type
 * guards. Mirrors `src/lib/assessment/types.ts`: explicit guards validate exactly
 * the fields the Academy consumes and nothing more.
 *
 * The Backend report definition is AUTHORITATIVE. The Academy renders the form
 * from `ReportPresentation.assignment.fields` — it never hardcodes the 43-field
 * schema, never computes completion, and never decides approval. All server
 * validation remains final.
 *
 * Attachments are intentionally absent from every type here: the flag is OFF and
 * the learner UI exposes no attachment affordance.
 */

/** Field types the Backend report definition can declare. */
export type ReportFieldType =
  | "short_text"
  | "long_text"
  | "url"
  | "integer"
  | "boolean"
  | "single_choice"
  | "multi_choice";

/** The exhaustive set the Academy renderer supports. An unknown type fails visibly. */
export const SUPPORTED_FIELD_TYPES: readonly ReportFieldType[] = [
  "short_text",
  "long_text",
  "url",
  "integer",
  "boolean",
  "single_choice",
  "multi_choice",
];

/** Bounded declarative conditional-requiredness rule (RC-1). */
export type ReportRequiredWhen = {
  fieldCode: string;
  operator: "equals";
  value: boolean | string | number | null;
};

/** Validation bounds as returned by the Backend `validation` JSON (per type). */
export type ReportFieldValidation = {
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  maxSelections?: number;
};

export type ReportChoice = { code: string; label: string };

/** One field definition to render (Backend `SafeReportPresentation.fields[]`). */
export type ReportFieldDefinition = {
  stableKey: string;
  type: ReportFieldType;
  required: boolean;
  sortOrder: number;
  validation: ReportFieldValidation | null;
  requiredWhen: ReportRequiredWhen | null;
  choices: ReportChoice[];
  label: string;
  helpText: string;
  placeholder: string;
};

export type ReportLevelInfo = {
  levelNumber: number;
  stableCode: string;
  type: "report";
  title: string;
  shortDescription: string;
  learningObjective: string;
};

export type ReportAssignmentInfo = {
  versionNumber: number;
  locale: string;
  title: string;
  instructions: string;
  successCriteriaSummary: string;
  submitLabel: string;
  fields: ReportFieldDefinition[];
};

/** The learner-facing presentation (definition + assignment copy). */
export type ReportPresentation = {
  level: ReportLevelInfo;
  assignment: ReportAssignmentInfo;
};

export type ReportRejection = {
  reasonCode: string;
  reasonTitle: string;
  humanComment: string;
  correctiveAction: string;
  reviewedAt: string;
};

export type ReportRevisionSummary = {
  revisionNumber: number;
  kind: "draft_autosave" | "initial_submission" | "resubmission";
  createdAt: string;
  submittedAt: string | null;
};

export type ReportStatus = "draft" | "pending_review" | "approved" | "rejected";

/** The current submission state (Backend `SafeReportSubmission`). */
export type ReportSubmission = {
  status: ReportStatus;
  workflowVersion: number;
  activeRevisionNumber: number | null;
  submittedRevisionNumber: number | null;
  approvedRevisionNumber: number | null;
  fieldValues: Record<string, unknown>;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  rejection: ReportRejection | null;
  history: ReportRevisionSummary[];
};

/** Discriminated result of the definition/status read (route 1). */
export type ReportContextKind =
  | "available"
  | "draft"
  | "pending_review"
  | "rejected"
  | "approved";

export type ReportContext = ReportPresentation & {
  kind: ReportContextKind;
  submission: ReportSubmission | null;
};

/** Result of a save/submit/resubmit write (Backend `SafeReportCommandResult`). */
export type ReportCommandResult = {
  kind: "saved" | "submitted" | "resubmitted";
  created: boolean;
  retry: boolean;
  acceptedRevision: number;
  resultingWorkflowVersion: number;
  appliedAt: string;
  submission: ReportSubmission;
};

/* --------------------------------- guards --------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isReportFieldType(value: unknown): value is ReportFieldType {
  return typeof value === "string" && (SUPPORTED_FIELD_TYPES as readonly string[]).includes(value);
}

function isRequiredWhen(value: unknown): value is ReportRequiredWhen {
  if (value === null) return true;
  if (!isObject(value)) return false;
  if (typeof value.fieldCode !== "string" || value.operator !== "equals") return false;
  const v = value.value;
  return v === null || typeof v === "boolean" || typeof v === "string" || typeof v === "number";
}

function isChoice(value: unknown): value is ReportChoice {
  return isObject(value) && typeof value.code === "string" && typeof value.label === "string";
}

/**
 * A field with an UNKNOWN type is a valid DTO shape but an unsupported render
 * target. The guard accepts any string `type` here so the adapter can surface it
 * as a visible, safe failure rather than silently dropping the field.
 */
function isFieldShape(value: unknown): value is ReportFieldDefinition {
  return (
    isObject(value) &&
    typeof value.stableKey === "string" &&
    typeof value.type === "string" &&
    typeof value.required === "boolean" &&
    typeof value.sortOrder === "number" &&
    isRequiredWhen(value.requiredWhen ?? null) &&
    Array.isArray(value.choices) &&
    value.choices.every(isChoice) &&
    typeof value.label === "string" &&
    typeof value.helpText === "string" &&
    typeof value.placeholder === "string" &&
    // Defence in depth: the learner definition must not carry a reviewer answer key.
    !("correctAnswer" in value) &&
    !("score" in value)
  );
}

/** The Backend wraps payloads in `{ data: … }`; unwrap defensively. */
export function unwrapData(value: unknown): unknown {
  if (isObject(value) && "data" in value) return (value as { data: unknown }).data;
  return value;
}

function isPresentationShape(data: Record<string, unknown>): boolean {
  const level = data.level;
  const assignment = data.assignment;
  if (!isObject(level) || !isObject(assignment)) return false;
  if (level.type !== "report") return false;
  if (typeof level.levelNumber !== "number" || typeof level.stableCode !== "string") return false;
  if (!Array.isArray(assignment.fields) || !assignment.fields.every(isFieldShape)) return false;
  if (typeof assignment.submitLabel !== "string") return false;
  return true;
}

const CONTEXT_KINDS: readonly string[] = ["available", "draft", "pending_review", "rejected", "approved"];

function isSubmissionShape(value: unknown): value is ReportSubmission {
  if (!isObject(value)) return false;
  if (value.status !== "draft" && value.status !== "pending_review" && value.status !== "approved" && value.status !== "rejected") return false;
  if (typeof value.workflowVersion !== "number") return false;
  if (!isObject(value.fieldValues)) return false;
  if (!Array.isArray(value.history)) return false;
  return true;
}

export function isReportContext(value: unknown): value is ReportContext {
  const data = unwrapData(value);
  if (!isObject(data)) return false;
  if (typeof data.kind !== "string" || !CONTEXT_KINDS.includes(data.kind)) return false;
  if (!isPresentationShape(data)) return false;
  const submission = data.submission ?? null;
  if (submission !== null && !isSubmissionShape(submission)) return false;
  // A stateful kind must carry a submission; `available` must not.
  if (data.kind === "available" && submission !== null) return false;
  if (data.kind !== "available" && submission === null) return false;
  return true;
}

export function isReportCommandResult(value: unknown): value is ReportCommandResult {
  const data = unwrapData(value);
  if (!isObject(data)) return false;
  if (data.kind !== "saved" && data.kind !== "submitted" && data.kind !== "resubmitted") return false;
  if (typeof data.created !== "boolean" || typeof data.retry !== "boolean") return false;
  if (typeof data.acceptedRevision !== "number" || typeof data.resultingWorkflowVersion !== "number") return false;
  if (!isSubmissionShape(data.submission)) return false;
  return true;
}

export function reportContextData(value: unknown): ReportContext {
  return unwrapData(value) as ReportContext;
}

export function reportCommandData(value: unknown): ReportCommandResult {
  return unwrapData(value) as ReportCommandResult;
}
