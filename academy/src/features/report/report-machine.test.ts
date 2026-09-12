import { describe, it, expect } from "vitest";
import { reducer, initialState, canSubmit, statusForError, type ReportState } from "@/features/report/report-machine";
import { buildContext, buildSubmission, validValues } from "@/features/report/test-fixtures";
import type { ReportCommandResult } from "@/lib/report/types";
import { makeError } from "@/lib/api/errors";

function load(kind: Parameters<typeof buildContext>[0], submission: Parameters<typeof buildContext>[1]): ReportState {
  return reducer(initialState(), { type: "load_ok", context: buildContext(kind, submission) });
}

const cmd = (over: Partial<ReportCommandResult> = {}): ReportCommandResult => ({
  kind: "saved", created: false, retry: false, acceptedRevision: 1,
  resultingWorkflowVersion: 1, appliedAt: "2026-06-02T00:00:00.000Z",
  submission: buildSubmission({ status: "draft", workflowVersion: 1 }),
  ...over,
});

describe("report machine — definition + draft", () => {
  it("starts in DEFINITION_LOADING", () => {
    expect(initialState().status).toBe("DEFINITION_LOADING");
  });

  it("available context → NO_REPORT, editable, empty values, expectedRevision 0", () => {
    const s = load("available", null);
    expect(s.status).toBe("NO_REPORT");
    expect(s.editing).toBe(true);
    expect(s.expectedRevision).toBe(0);
    expect(s.values).toEqual({});
  });

  it("editing marks dirty and clears prior errors", () => {
    let s = load("available", null);
    s = reducer(s, { type: "edit", stableKey: "trade1-instrument", value: "EURUSD" });
    expect(s.dirty).toBe(true);
    expect(s.status).toBe("DRAFT_DIRTY");
    expect(s.values["trade1-instrument"]).toBe("EURUSD");
  });

  it("ignores edits to unknown keys and edits when not editing", () => {
    let s = load("pending_review", buildSubmission({ status: "pending_review" }));
    s = reducer(s, { type: "edit", stableKey: "trade1-instrument", value: "X" });
    expect(s.status).toBe("PENDING_REVIEW"); // unchanged (not editing)
    let a = load("available", null);
    const before = a.values;
    a = reducer(a, { type: "edit", stableKey: "nope", value: "X" });
    expect(a.values).toBe(before);
  });

  it("first save shows DRAFT_CREATING then DRAFT_SAVED and adopts resultingWorkflowVersion", () => {
    let s = load("available", null);
    s = reducer(s, { type: "edit", stableKey: "trade1-instrument", value: "EURUSD" });
    s = reducer(s, { type: "save_pending", requestId: "ata-rpt-save-1" });
    expect(s.status).toBe("DRAFT_CREATING");
    expect(s.inFlight).toBe("ata-rpt-save-1");
    s = reducer(s, { type: "save_ok", result: cmd({ created: true, resultingWorkflowVersion: 1 }) });
    expect(s.status).toBe("DRAFT_SAVED");
    expect(s.dirty).toBe(false);
    expect(s.expectedRevision).toBe(1);
    expect(s.inFlight).toBeNull();
  });

  it("bounds a double save: a second save_pending while in flight is ignored", () => {
    let s = load("available", null);
    s = reducer(s, { type: "edit", stableKey: "trade1-instrument", value: "EURUSD" });
    s = reducer(s, { type: "save_pending", requestId: "key-1" });
    const afterFirst = s;
    s = reducer(s, { type: "save_pending", requestId: "key-2" });
    expect(s).toBe(afterFirst); // no change; still first key
    expect(s.inFlight).toBe("key-1");
  });

  it("refresh recovery: reloading a draft restores server values + expectedRevision", () => {
    const submission = buildSubmission({ status: "draft", workflowVersion: 3, fieldValues: { "trade1-instrument": "GBPUSD" } });
    const s = load("draft", submission);
    expect(s.status).toBe("DRAFT_READY");
    expect(s.values["trade1-instrument"]).toBe("GBPUSD");
    expect(s.expectedRevision).toBe(3);
  });

  it("maps a stale revision error to STALE_REVISION", () => {
    let s = load("draft", buildSubmission({ status: "draft", workflowVersion: 1 }));
    s = reducer(s, { type: "save_pending", requestId: "k" });
    s = reducer(s, { type: "save_err", error: makeError("CONFLICT", { status: 409, code: "REPORT_REVISION_STALE" }) });
    expect(s.status).toBe("STALE_REVISION");
    expect(s.inFlight).toBeNull();
  });
});

describe("report machine — submit", () => {
  it("blocks submit while invalid and enters VALIDATION_ERROR without a network write", () => {
    let s = load("available", null); // empty → invalid
    expect(canSubmit(s)).toBe(false);
    s = reducer(s, { type: "submit_pending", requestId: "k" });
    expect(s.status).toBe("VALIDATION_ERROR");
    expect(s.inFlight).toBeNull(); // no request identity claimed
    expect(s.fieldErrors.length).toBeGreaterThan(0);
    expect(s.showErrors).toBe(true);
  });

  it("permits submit when valid, then reaches PENDING_REVIEW read-only", () => {
    let s = load("draft", buildSubmission({ status: "draft", workflowVersion: 1, fieldValues: validValues() }));
    // adopt the server values as the edit buffer
    expect(canSubmit(s)).toBe(true);
    s = reducer(s, { type: "submit_pending", requestId: "ata-rpt-submit-1" });
    expect(s.status).toBe("SUBMITTING");
    s = reducer(s, { type: "submit_ok", result: cmd({ kind: "submitted", resultingWorkflowVersion: 2, submission: buildSubmission({ status: "pending_review", workflowVersion: 2, submittedRevisionNumber: 1 }) }) });
    expect(s.status).toBe("PENDING_REVIEW");
    expect(s.editing).toBe(false);
    expect(s.expectedRevision).toBe(2);
  });

  it("guards a double submit via inFlight", () => {
    let s = load("draft", buildSubmission({ status: "draft", workflowVersion: 1, fieldValues: validValues() }));
    s = reducer(s, { type: "submit_pending", requestId: "k1" });
    const after = s;
    s = reducer(s, { type: "submit_pending", requestId: "k2" });
    expect(s).toBe(after);
    expect(s.inFlight).toBe("k1");
  });
});

describe("report machine — revision requested → resubmit", () => {
  it("shows REVISION_REQUESTED read-only with feedback", () => {
    const rejected = buildSubmission({
      status: "rejected", workflowVersion: 2, submittedRevisionNumber: 1,
      fieldValues: validValues(),
      rejection: { reasonCode: "missing-evidence", reasonTitle: "Нет доказательств", humanComment: "Добавьте детали", correctiveAction: "Опишите точку входа", reviewedAt: "t" },
    });
    const s = load("rejected", rejected);
    expect(s.status).toBe("REVISION_REQUESTED");
    expect(s.editing).toBe(false);
    expect(s.context!.submission!.rejection!.reasonTitle).toBe("Нет доказательств");
  });

  it("begin_correction seeds an editable correction and resubmit flows through RESUBMITTING", () => {
    const rejected = buildSubmission({ status: "rejected", workflowVersion: 2, submittedRevisionNumber: 1, fieldValues: validValues() });
    let s = load("rejected", rejected);
    s = reducer(s, { type: "begin_correction" });
    expect(s.editing).toBe(true);
    expect(s.correcting).toBe(true);
    expect(s.values["trade1-instrument"]).toBe("EURUSD");
    // first correction save shows NEW_REVISION_CREATING
    s = reducer(s, { type: "edit", stableKey: "trade1-instrument", value: "GBPUSD" });
    s = reducer(s, { type: "save_pending", requestId: "k" });
    expect(s.status).toBe("NEW_REVISION_CREATING");
    s = reducer(s, { type: "save_ok", result: cmd({ resultingWorkflowVersion: 3 }) });
    expect(s.savedCorrection).toBe(true);
    // resubmit
    s = reducer(s, { type: "submit_pending", requestId: "ata-rpt-resubmit-1" });
    expect(s.status).toBe("RESUBMITTING");
    s = reducer(s, { type: "submit_ok", result: cmd({ kind: "resubmitted", resultingWorkflowVersion: 4, submission: buildSubmission({ status: "pending_review", workflowVersion: 4, submittedRevisionNumber: 2 }) }) });
    expect(s.status).toBe("PENDING_REVIEW");
    expect(s.correcting).toBe(false);
  });
});

describe("report machine — approval / completion", () => {
  it("approved context → APPROVED, read-only, records completion facts (no XP field)", () => {
    const approved = buildSubmission({ status: "approved", workflowVersion: 4, approvedRevisionNumber: 2, submittedRevisionNumber: 2, fieldValues: validValues() });
    const s = load("approved", approved);
    expect(s.status).toBe("APPROVED");
    expect(s.editing).toBe(false);
    expect(s.completion?.levelNumber).toBe(3);
    // the learner report contract carries NO xp field — the machine never invents one
    expect(JSON.stringify(s)).not.toContain("xpAwarded");
    expect(JSON.stringify(s)).not.toContain("xpTransaction");
  });
});

describe("statusForError", () => {
  it("404 / NOT_FOUND → FLAG_DISABLED", () => {
    expect(statusForError(makeError("VALIDATION_ERROR", { status: 404 }))).toBe("FLAG_DISABLED");
    expect(statusForError(makeError("UNKNOWN_ERROR", { code: "NOT_FOUND" }))).toBe("FLAG_DISABLED");
  });
  it("network is retryable → NETWORK_ERROR; other → FATAL_ERROR", () => {
    expect(statusForError(makeError("NETWORK_ERROR"))).toBe("NETWORK_ERROR");
    expect(statusForError(makeError("VALIDATION_ERROR", { status: 400 }))).toBe("FATAL_ERROR");
  });
});
