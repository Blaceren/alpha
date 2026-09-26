import { describe, expect, it } from "vitest";
import { getPathProgress } from "@/features/path/model/path-state";
import { emptyLessonProgress } from "@/features/lesson/model/lesson-session-progress";
import { resolveRouteAvailability } from "@/features/lesson/model/lesson-availability";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import {
  createEmptyDraft,
  withEntryField,
  withSubmitted,
  withSummary,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";
import {
  withApproved,
  withSubmittedV3,
  type ReportDraftV3,
} from "@/features/report-level/model/report-workspace-v3";
import {
  deriveReportExperience,
  deriveReportLifecycle,
  pluralRu,
  reportStatusLabel,
} from "@/features/report-level/model/report-experience";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;
const session = emptyLessonProgress();

/** The marker under which the report is the user's current step (DD-271). */
const reportMarker = getPathProgress("report");
/** The canonical marker: Артём on level 18 — level 3 is long behind him. */
const canonicalMarker = getPathProgress("active");

function readyDraft(): ReportDraft {
  let draft = createEmptyDraft(definition);
  for (const entry of draft.entries) {
    draft = withEntryField(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummary(draft, "итог");
}

/** Lift a legacy v1 draft to the v3 shape — exactly what migration does. */
const lift = (draft: ReportDraft): ReportDraftV3 => ({
  ...draft,
  review: null,
  meaningfulRevision: draft.revision,
  approvedAt: null,
});

const derive = (draft: ReportDraft, marker = reportMarker) =>
  deriveReportExperience({ definition, draft: lift(draft), marker, session });

/** A fully approved v3 draft, built through the real transitions. */
function approvedDraftV3(): ReportDraftV3 {
  const pending = withSubmittedV3(lift(readyDraft()), "2026-07-17T10:00:00.000Z");
  return withApproved(pending, "2026-07-18T12:00:00.000Z");
}
const deriveV3 = (draft: ReportDraftV3, marker = reportMarker) =>
  deriveReportExperience({ definition, draft, marker, session });

describe("report scenario marker", () => {
  it("puts the user on level 3 — the only marker the report story is true under", () => {
    expect(reportMarker.currentLevel).toBe(3);
    expect(reportMarker.scenario).toBe("report");
  });

  it("leaves the canonical marker untouched", () => {
    expect(canonicalMarker.currentLevel).toBe(18);
    expect(canonicalMarker.rankLabel).toBe("Наблюдатель III");
    expect(canonicalMarker.xpLabel).toBe("2 480 XP");
    expect(canonicalMarker.streak).toBe(6);
  });

  it("invents no XP rule — instrumentation is copied from the early scenario", () => {
    const early = getPathProgress("early");
    expect(reportMarker.xpLabel).toBe(early.xpLabel);
    expect(reportMarker.rankLabel).toBe(early.rankLabel);
  });
});

describe("report lifecycle", () => {
  it("is draft while incomplete", () => {
    expect(deriveReportLifecycle(lift(createEmptyDraft(definition)))).toBe("draft");
  });

  it("is ready — computed, never stored — once the rule is satisfied", () => {
    const draft = readyDraft();
    expect(draft.status).toBe("draft");
    expect(deriveReportLifecycle(lift(draft))).toBe("ready");
  });

  it("is pending-review after a local submit", () => {
    expect(deriveReportLifecycle(lift(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z")))).toBe(
      "pending-review",
    );
  });

  it("labels the three states in Russian", () => {
    expect(reportStatusLabel("draft")).toBe("Черновик");
    expect(reportStatusLabel("ready")).toBe("Готов к отправке");
    expect(reportStatusLabel("pending-review")).toBe("На проверке");
  });
});

describe("report experience — readiness copy", () => {
  it("counts entries in words, never in percent or score", () => {
    let draft = createEmptyDraft(definition);
    draft = withEntryField(draft, 1, "noticed", "a");
    draft = withEntryField(draft, 2, "noticed", "b");
    draft = withEntryField(draft, 3, "noticed", "c");

    const experience = derive(draft);
    expect(experience.readinessLabel).toBe("Заполнено 3 из 5 записей");
    expect(experience.remainingLabel).toBe("Осталось заполнить 2 записи и итоговое наблюдение");
    expect(experience.readinessLabel).not.toMatch(/%/);
    expect(experience.readinessLabel).not.toMatch(/балл|score|оценка/i);
  });

  it("names only what is actually missing", () => {
    let draft = createEmptyDraft(definition);
    for (const entry of draft.entries) {
      draft = withEntryField(draft, entry.ordinal, "noticed", "n");
    }
    expect(derive(draft).remainingLabel).toBe("Осталось заполнить итоговое наблюдение");

    const oneLeft = withSummary(
      withEntryField(draft, 5, "noticed", ""),
      "итог",
    );
    expect(derive(oneLeft).remainingLabel).toBe("Осталось заполнить 1 запись");
  });

  it("switches to the ready sentence with nothing left", () => {
    const experience = derive(readyDraft());
    expect(experience.remainingLabel).toBeNull();
    expect(experience.readyLabel).toBe("Можно отправить на проверку");
    expect(experience.canSubmit).toBe(true);
  });

  it("declines Russian counts correctly", () => {
    expect(pluralRu(1, "запись", "записи", "записей")).toBe("запись");
    expect(pluralRu(2, "запись", "записи", "записей")).toBe("записи");
    expect(pluralRu(5, "запись", "записи", "записей")).toBe("записей");
    expect(pluralRu(11, "запись", "записи", "записей")).toBe("записей");
    expect(pluralRu(21, "запись", "записи", "записей")).toBe("запись");
  });
});

describe("report experience — progression", () => {
  it("keeps level 4 locked while the report is the current step", () => {
    // The report never completes level 3, so level 4 is only ever "next in line",
    // which the resolver reports as locked.
    expect(resolveRouteAvailability(4, reportMarker, session)).toBe("locked");

    const experience = derive(createEmptyDraft(definition));
    expect(experience.nextLevelNumber).toBe(4);
    expect(experience.nextLevelLocked).toBe(true);
    expect(experience.blockedNote).toBe(
      'Уровень 4 «Контрольная точка $50» откроется после одобрения отчёта.',
    );
  });

  it("still keeps level 4 locked after a local submit — pending is not completion", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    const experience = derive(submitted);
    expect(experience.lifecycle).toBe("pending-review");
    expect(experience.nextLevelLocked).toBe(true);
    expect(resolveRouteAvailability(4, reportMarker, session)).toBe("locked");
  });

  it("makes NO claim about level 4 when it is genuinely already open", () => {
    // The canonical profile: Артём is on 18, so level 4 is a passed checkpoint.
    // The sentence is DERIVED, so it is absent rather than false.
    expect(resolveRouteAvailability(4, canonicalMarker, session)).toBe("completed");

    const experience = derive(createEmptyDraft(definition), canonicalMarker);
    expect(experience.nextLevelLocked).toBe(false);
    expect(experience.blockedNote).toBeNull();
  });

  it("never downgrades canonical progression, even holding a pending report", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    // A pending report written under the report scenario must not retroactively
    // close levels 4–18 for the canonical user.
    for (const level of [4, 5, 10, 17]) {
      expect(resolveRouteAvailability(level, canonicalMarker, session)).toBe("completed");
    }
    expect(derive(submitted, canonicalMarker).blockedNote).toBeNull();
  });
});

describe("report experience — mode", () => {
  it("is editing when level 3 is the current step", () => {
    const experience = derive(createEmptyDraft(definition));
    expect(experience.mode).toBe("editing");
    expect(experience.editable).toBe(true);
  });

  it("is pending once submitted, and pending is never editable", () => {
    const experience = derive(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    expect(experience.mode).toBe("pending");
    expect(experience.editable).toBe(false);
    expect(experience.canSubmit).toBe(false);
  });

  it("is archive for the canonical user, who is already past level 3", () => {
    const experience = derive(createEmptyDraft(definition), canonicalMarker);
    expect(experience.mode).toBe("archive");
    expect(experience.editable).toBe(false);
    expect(experience.canSubmit).toBe(false);
  });

  it("cannot submit from archive mode even with a ready draft", () => {
    expect(derive(readyDraft(), canonicalMarker).canSubmit).toBe(false);
  });

  it("lets the canonical sequence win over a browser-local pending marker", () => {
    // A pending report written under the report scenario must not make level 3
    // look unfinished for a user the sequence has already carried past it.
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    const experience = derive(submitted, canonicalMarker);
    expect(experience.mode).toBe("archive");
    expect(experience.editable).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * D3-D — approved: base-completed vs approval-induced distinction
 * ------------------------------------------------------------------ */

describe("approved lifecycle", () => {
  it("derives the approved lifecycle and «Одобрено» label", () => {
    expect(deriveReportLifecycle(approvedDraftV3())).toBe("approved");
    expect(reportStatusLabel("approved")).toBe("Одобрено");
  });
});

describe("approval-induced completion (report marker)", () => {
  const exp = deriveV3(approvedDraftV3());

  it("enters approved mode, not archive — the verdict advanced the level", () => {
    expect(exp.mode).toBe("approved");
    expect(exp.approvalInduced).toBe(true);
    expect(exp.editable).toBe(false);
  });

  it("shows the approved headline with the level number", () => {
    expect(exp.approvedHeadline).toBe("Отчёт принят. Уровень 3 завершён.");
  });

  it("exposes the next step as the L4 checkpoint with the $50 target", () => {
    expect(exp.nextStepCheckpoint).toEqual({
      levelNumber: 4,
      requirement: "Баланс Pocket от $50",
    });
  });

  it("drops the blocked note — the next level is now open (DD-297)", () => {
    expect(exp.blockedNote).toBeNull();
    expect(exp.nextLevelLocked).toBe(false);
  });
});

describe("canonical completion (L18) is NOT approval-induced", () => {
  const exp = deriveV3(approvedDraftV3(), canonicalMarker);

  it("stays a neutral archive — the sequence owns the level, not the verdict", () => {
    expect(exp.mode).toBe("archive");
    expect(exp.approvalInduced).toBe(false);
    // «Одобрено» is never surfaced under the canonical profile.
    expect(exp.approvedHeadline).toBeNull();
  });

  it("is decided by base vs effective, not by final availability alone", () => {
    // Both the canonical case and the approval-induced case END at completed;
    // only the base distinguishes them.
    const induced = deriveV3(approvedDraftV3());
    expect(induced.mode).toBe("approved");
    expect(exp.mode).toBe("archive");
  });
});

describe("blockedNote disappears only after a valid approval", () => {
  it("is present while pending, absent once approved", () => {
    const pending = derive(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    expect(pending.blockedNote).not.toBeNull();

    const approved = deriveV3(approvedDraftV3());
    expect(approved.blockedNote).toBeNull();
  });
});
