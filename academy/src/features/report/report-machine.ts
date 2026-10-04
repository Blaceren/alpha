/**
 * Pure state model for the L3 learner report workflow (no React, fully testable).
 *
 * Completion, approval and L3/L4 progression are ALWAYS derived from Backend
 * responses. This reducer never computes completion, never awards XP, never
 * writes L3 completion, and never treats local edits as authority. The server
 * `workflowVersion` is the CAS token; the reducer only tracks the expected value
 * and adopts the server's `resultingWorkflowVersion` after each accepted write.
 */
import type { NormalizedError } from "@/lib/api/errors";
import { buildReportDefinition, type ReportDefinitionModel } from "@/features/report/report-definition";
import { validateReport, type ReportFieldError } from "@/features/report/report-validation";
import type { ReportCommandResult, ReportContext } from "@/lib/report/types";

/** The 20 named states the workflow surfaces (spec §9). */
export type ReportUiStatus =
  | "DEFINITION_LOADING"
  | "NO_REPORT"
  | "DRAFT_CREATING"
  | "DRAFT_READY"
  | "DRAFT_DIRTY"
  | "DRAFT_SAVING"
  | "DRAFT_SAVED"
  | "SUBMITTING"
  | "PENDING_REVIEW"
  | "REVISION_REQUESTED"
  | "NEW_REVISION_CREATING"
  | "RESUBMITTING"
  | "APPROVED"
  | "LEVEL_COMPLETED"
  | "FLAG_DISABLED"
  | "STALE_REVISION"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "FATAL_ERROR";

export type ReportState = {
  status: ReportUiStatus;
  context: ReportContext | null;
  model: ReportDefinitionModel | null;
  /** Transient edit buffer; server draft is the truth (persisted via save). */
  values: Record<string, unknown>;
  /** CAS token expected by the next write (= current server workflowVersion). */
  expectedRevision: number;
  /** Whether the form is currently editable (draft or an in-progress correction). */
  editing: boolean;
  /** True once a rejected report's correction has begun (drives resubmit vs submit). */
  correcting: boolean;
  /** True after the first correction save landed (NEW_REVISION_CREATING → DRAFT_*). */
  savedCorrection: boolean;
  dirty: boolean;
  lastSavedAt: string | null;
  /** Client-side validation errors (submit-gating + summary). */
  fieldErrors: ReportFieldError[];
  /** True after a submit attempt with client errors (drives VALIDATION_ERROR). */
  showErrors: boolean;
  /** The Backend itself refused the submitted report as incomplete. */
  serverRefusal: boolean;
  error: NormalizedError | null;
  /** Idempotency key of the in-flight write (double-submit guard). */
  inFlight: string | null;
  /** Completion facts read back from an approval (never computed locally). */
  completion: { levelNumber: number | null; nextLevelNumber: number | null } | null;
};

export type ReportAction =
  | { type: "load_pending" }
  | { type: "load_ok"; context: ReportContext }
  | { type: "load_err"; error: NormalizedError }
  | { type: "edit"; stableKey: string; value: unknown }
  | { type: "save_pending"; requestId: string }
  | { type: "save_ok"; result: ReportCommandResult }
  | { type: "save_err"; error: NormalizedError }
  | { type: "submit_pending"; requestId: string }
  | { type: "submit_ok"; result: ReportCommandResult }
  | { type: "submit_err"; error: NormalizedError }
  | { type: "begin_correction" };

export function initialState(): ReportState {
  return {
    status: "DEFINITION_LOADING",
    context: null,
    model: null,
    values: {},
    expectedRevision: 0,
    editing: false,
    correcting: false,
    savedCorrection: false,
    dirty: false,
    lastSavedAt: null,
    fieldErrors: [],
    showErrors: false,
    serverRefusal: false,
    error: null,
    inFlight: null,
    completion: null,
  };
}

/** Map a normalized error to a bounded terminal/overlay status. */
export function statusForError(error: NormalizedError): Extract<ReportUiStatus, "FLAG_DISABLED" | "STALE_REVISION" | "NETWORK_ERROR" | "FATAL_ERROR"> {
  if (error.status === 404 || error.code === "NOT_FOUND") return "FLAG_DISABLED";
  if (error.code === "REPORT_REVISION_STALE") return "STALE_REVISION";
  if (error.retryable) return "NETWORK_ERROR";
  return "FATAL_ERROR";
}

/** Hydrate the machine from a freshly read server context. */
function hydrate(state: ReportState, context: ReportContext): ReportState {
  const model = buildReportDefinition(context);
  const submission = context.submission;
  const values = submission ? { ...submission.fieldValues } : {};
  const expectedRevision = submission ? submission.workflowVersion : 0;
  const base: ReportState = {
    ...initialState(),
    context,
    model,
    values,
    expectedRevision,
  };

  switch (context.kind) {
    case "available":
      return { ...base, status: "NO_REPORT", editing: true, values: {} };
    case "draft":
      return { ...base, status: "DRAFT_READY", editing: true, lastSavedAt: submission?.submittedAt ?? null };
    case "pending_review":
      return { ...base, status: "PENDING_REVIEW", editing: false };
    case "rejected":
      return { ...base, status: "REVISION_REQUESTED", editing: false };
    case "approved":
      return {
        ...base,
        status: "APPROVED",
        editing: false,
        completion: { levelNumber: context.level.levelNumber, nextLevelNumber: null },
      };
    default:
      return { ...base, status: "FATAL_ERROR" };
  }
}

/** Recompute the "clean" editing status from dirty/saved flags. */
function editingStatus(state: ReportState): ReportUiStatus {
  if (state.dirty) return "DRAFT_DIRTY";
  if (state.lastSavedAt) return "DRAFT_SAVED";
  return "DRAFT_READY";
}

export function reducer(state: ReportState, action: ReportAction): ReportState {
  switch (action.type) {
    case "load_pending":
      return { ...state, status: "DEFINITION_LOADING", error: null };

    case "load_ok":
      return hydrate(state, action.context);

    case "load_err":
      return { ...state, status: statusForError(action.error), error: action.error };

    case "edit": {
      if (!state.editing) return state;
      if (!state.model?.byKey.has(action.stableKey)) return state;
      const values = { ...state.values, [action.stableKey]: action.value };
      return {
        ...state,
        values,
        dirty: true,
        status: "DRAFT_DIRTY",
        showErrors: false,
        serverRefusal: false,
        error: null,
      };
    }

    case "begin_correction": {
      // From REVISION_REQUESTED: seed an editable correction from the last values.
      if (state.status !== "REVISION_REQUESTED" || !state.context?.submission) return state;
      return {
        ...state,
        editing: true,
        correcting: true,
        savedCorrection: false,
        dirty: false,
        values: { ...state.context.submission.fieldValues },
        status: "DRAFT_READY",
        showErrors: false,
        error: null,
      };
    }

    case "save_pending": {
      if (!state.editing || state.inFlight) return state; // double-write guard
      const creatingFirstDraft = !state.context?.submission && !state.correcting;
      const status: ReportUiStatus = state.correcting && !state.savedCorrection
        ? "NEW_REVISION_CREATING"
        : creatingFirstDraft
          ? "DRAFT_CREATING"
          : "DRAFT_SAVING";
      return { ...state, status, inFlight: action.requestId, error: null };
    }

    case "save_ok": {
      const submission = action.result.submission;
      return {
        ...state,
        context: state.context ? { ...state.context, submission } : state.context,
        expectedRevision: action.result.resultingWorkflowVersion,
        dirty: false,
        savedCorrection: state.correcting ? true : state.savedCorrection,
        lastSavedAt: action.result.appliedAt,
        status: "DRAFT_SAVED",
        inFlight: null,
        error: null,
      };
    }

    case "save_err":
      return { ...state, status: statusForError(action.error), error: action.error, inFlight: null };

    case "submit_pending": {
      if (!state.editing || state.inFlight || !state.model) return state; // double-submit guard
      const errors = validateReport(state.model, state.values);
      if (errors.length > 0) {
        return { ...state, status: "VALIDATION_ERROR", fieldErrors: errors, showErrors: true, serverRefusal: false };
      }
      return {
        ...state,
        status: state.correcting ? "RESUBMITTING" : "SUBMITTING",
        inFlight: action.requestId,
        fieldErrors: [],
        error: null,
      };
    }

    case "submit_ok": {
      const submission = action.result.submission;
      /* WHAT THE BACKEND SAID HAPPENED, not what a submit usually means. A
         report a person reviews comes back `pending_review`. A report the
         platform accepts by itself comes back ALREADY `approved` — the
         submission was the acceptance — and calling that «ожидает проверки»
         would leave a finished level looking like a waiting one until the
         learner reloaded the page. */
      const accepted = submission.status === "approved";
      return {
        ...state,
        context: state.context
          ? { ...state.context, kind: accepted ? "approved" : "pending_review", submission }
          : state.context,
        expectedRevision: action.result.resultingWorkflowVersion,
        status: accepted ? "APPROVED" : "PENDING_REVIEW",
        completion: accepted
          ? { levelNumber: state.context?.level.levelNumber ?? null, nextLevelNumber: null }
          : state.completion,
        editing: false,
        correcting: false,
        dirty: false,
        inFlight: null,
        error: null,
      };
    }

    case "submit_err": {
      /* THE SERVER LOOKED AT THE REPORT AND FOUND IT INCOMPLETE. The client
         checks the same rules first, so this is rare — and when it happens it
         is not an outage. The form stays on the screen with the draft the
         learner wrote, and says the report was not accepted, instead of being
         replaced by «не удалось загрузить отчёт». */
      if (action.error.code === "REPORT_DRAFT_INPUT_INVALID" && state.editing) {
        return {
          ...state,
          status: "VALIDATION_ERROR",
          fieldErrors: [],
          showErrors: true,
          serverRefusal: true,
          error: action.error,
          inFlight: null,
        };
      }
      return { ...state, status: statusForError(action.error), error: action.error, inFlight: null };
    }

    default:
      return state;
  }
}

/** Recompute the resting editing status after a transient overlay clears. */
export function restingEditingStatus(state: ReportState): ReportUiStatus {
  return editingStatus(state);
}

/** True when submit/resubmit is permitted (editable, not in flight, client-valid). */
export function canSubmit(state: ReportState): boolean {
  if (!state.editing || state.inFlight || !state.model) return false;
  return validateReport(state.model, state.values).length === 0;
}
