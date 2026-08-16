/**
 * THE CANONICAL REPORT VOCABULARY (§17) — one named regression.
 *
 * WHY THIS FILE EXISTS SEPARATELY. The report machine's behaviour is covered in
 * report-machine.test.ts, and the surface's rendering in level-report.test.tsx.
 * What neither states in ONE place is the CONTRACT this phase closed:
 *
 *   draft · pending_review · rejected · approved
 *
 * with `rejected` as the canonical revision-requested state, and a rejected
 * report presenting as an EDITABLE revision that resubmits rather than submits.
 *
 * The human decision for this phase was that code-level canonical resolution is
 * sufficient and a browser screenshot of a rejected report is not required —
 * PREPROD holds no rejected report, and manufacturing one would mean mutating
 * historical evidence. This test is the evidence that decision rests on, so it
 * asserts the vocabulary and the revision presentation directly rather than
 * leaving them implied by tests about other things.
 */
import { describe, expect, it } from "vitest";
import { canSubmit, initialState, reducer, type ReportState } from "@/features/report/report-machine";
import { buildContext, buildSubmission, validValues } from "@/features/report/test-fixtures";
import type { ReportContextKind } from "@/lib/report/types";

/** The canonical states, in lifecycle order. Adding one is a contract change. */
const CANONICAL_STATES = ["draft", "pending_review", "rejected", "approved"] as const;

function load(kind: ReportContextKind): ReportState {
  const submission =
    kind === "available"
      ? null
      : buildSubmission({ status: kind === "draft" ? "draft" : kind, fieldValues: validValues(), workflowVersion: 1 });
  return reducer(initialState(), { type: "load_ok", context: buildContext(kind, submission) });
}

describe("canonical report vocabulary", () => {
  it("every canonical state hydrates to a distinct, non-error UI status", () => {
    const statuses = CANONICAL_STATES.map((kind) => load(kind).status);
    expect(statuses).toEqual(["DRAFT_READY", "PENDING_REVIEW", "REVISION_REQUESTED", "APPROVED"]);
    // Distinct: four states must not collapse into three.
    expect(new Set(statuses).size).toBe(4);
    for (const status of statuses) expect(status).not.toBe("FATAL_ERROR");
  });

  it("`rejected` IS the revision-requested state — there is no fifth name", () => {
    expect(load("rejected").status).toBe("REVISION_REQUESTED");
  });

  it("only draft is editable on arrival; the other three are read-only", () => {
    expect(load("draft").editing).toBe(true);
    expect(load("pending_review").editing).toBe(false);
    expect(load("rejected").editing).toBe(false);
    expect(load("approved").editing).toBe(false);
  });
});

describe("rejected → editable revision → resubmit", () => {
  it("a rejected report can begin a correction, and that correction is editable", () => {
    const rejected = load("rejected");
    expect(rejected.editing).toBe(false);

    const correcting = reducer(rejected, { type: "begin_correction" });
    expect(correcting.editing).toBe(true);
    // Seeded from what the learner already wrote — a revision is not a blank form.
    expect(correcting.values).toEqual(rejected.context!.submission!.fieldValues);
  });

  it("a correction is flagged as a correction, which is what selects RESUBMIT", () => {
    // `state.correcting` is the only thing that distinguishes the resubmit
    // command from the submit command in level-report.tsx. Offering `submit` on
    // a returned report would call the wrong Backend route.
    const correcting = reducer(load("rejected"), { type: "begin_correction" });
    expect(correcting.correcting).toBe(true);
    expect(canSubmit(correcting)).toBe(true);

    // A first-time draft is NOT a correction, and so submits.
    expect(load("draft").correcting).toBe(false);
  });

  it("a correction cannot begin from any state other than rejected", () => {
    for (const kind of ["draft", "pending_review", "approved"] as const) {
      const state = load(kind);
      expect(reducer(state, { type: "begin_correction" })).toBe(state);
    }
  });

  it("a pending report offers no way to submit or resubmit", () => {
    const pending = load("pending_review");
    expect(pending.editing).toBe(false);
    expect(canSubmit(pending)).toBe(false);
  });

  it("an approved report is terminal for the learner", () => {
    const approved = load("approved");
    expect(approved.editing).toBe(false);
    expect(canSubmit(approved)).toBe(false);
    expect(reducer(approved, { type: "begin_correction" }).editing).toBe(false);
  });
});
