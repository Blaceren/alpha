import { describe, expect, it } from "vitest";
import {
  emptyLessonProgress,
  isLevelCompletedInSession,
  isLevelUnlockedInSession,
  withCompletedLevel,
} from "@/features/lesson/model/lesson-session-progress";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import {
  createEmptyDraftV3,
  emptyReportWorkspaceV3,
  withApproved,
  withDraftV3,
  withEntryFieldV3,
  withSubmittedV3,
  withSummaryV3,
  type ReportDraftV3,
  type ReportWorkspaceStateV3,
} from "@/features/report-level/model/report-workspace-v3";
import {
  approvedReportLevelNumbers,
  sessionWithApprovedReports,
} from "@/features/report-level/model/report-progression";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;

function approvedDraft(): ReportDraftV3 {
  let draft = createEmptyDraftV3(definition);
  for (const entry of draft.entries) {
    draft = withEntryFieldV3(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  draft = withSummaryV3(draft, "итог");
  draft = withSubmittedV3(draft, "2026-07-17T10:00:00.000Z");
  return withApproved(draft, "2026-07-18T12:00:00.000Z");
}

const workspaceWith = (draft: ReportDraftV3): ReportWorkspaceStateV3 =>
  withDraftV3(emptyReportWorkspaceV3(), draft);

describe("approvedReportLevelNumbers", () => {
  it("lists the level of an approved report", () => {
    expect(approvedReportLevelNumbers(workspaceWith(approvedDraft()))).toEqual([3]);
  });

  it("ignores non-approved statuses", () => {
    const draft = withSubmittedV3(
      (() => {
        let d = createEmptyDraftV3(definition);
        for (const e of d.entries) d = withEntryFieldV3(d, e.ordinal, "noticed", "x");
        return withSummaryV3(d, "s");
      })(),
      "2026-07-17T10:00:00.000Z",
    );
    expect(approvedReportLevelNumbers(workspaceWith(draft))).toEqual([]);
  });

  it("is empty for an empty workspace", () => {
    expect(approvedReportLevelNumbers(emptyReportWorkspaceV3())).toEqual([]);
  });
});

describe("sessionWithApprovedReports", () => {
  it("adds the report level as a completion AND unlocks its successor", () => {
    const augmented = sessionWithApprovedReports(emptyLessonProgress(), workspaceWith(approvedDraft()));
    expect(isLevelCompletedInSession(augmented, 3)).toBe(true);
    // Uses the canonical helper, which opens L4 — no bespoke unlock rule.
    expect(isLevelUnlockedInSession(augmented, 4)).toBe(true);
  });

  it("never writes lesson-progress — it only projects a session object", () => {
    // The function is pure: same input, same output, no I/O possible.
    const base = emptyLessonProgress();
    const out = sessionWithApprovedReports(base, workspaceWith(approvedDraft()));
    expect(out).not.toBe(base);
    expect(base.completed).toEqual([]); // input untouched
  });

  it("is a NO-OP with no approved reports", () => {
    const base = emptyLessonProgress();
    expect(sessionWithApprovedReports(base, emptyReportWorkspaceV3())).toBe(base);
  });

  it("is idempotent — folding the same approval twice equals folding it once", () => {
    const ws = workspaceWith(approvedDraft());
    const once = sessionWithApprovedReports(emptyLessonProgress(), ws);
    const twice = sessionWithApprovedReports(once, ws);
    expect(twice.completed).toEqual(once.completed);
    expect(twice.unlocked).toEqual(once.unlocked);
  });

  it("never downgrades an existing completion", () => {
    // A session already past L3 keeps everything it had.
    const seeded = withCompletedLevel(withCompletedLevel(emptyLessonProgress(), 3), 4);
    const augmented = sessionWithApprovedReports(seeded, workspaceWith(approvedDraft()));
    expect(isLevelCompletedInSession(augmented, 3)).toBe(true);
    expect(isLevelCompletedInSession(augmented, 4)).toBe(true);
  });
});
