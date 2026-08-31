/**
 * RETURN AFTER A PAUSE (§16) — every state a learner can come back to.
 *
 * The contract: for each situation the Backend can genuinely be in, Home gives
 * the MOST SPECIFIC TRUTHFUL next action available, through the one shared
 * derivation. No second resume engine exists, so these tests exercise the same
 * `deriveNextAction` that Home, Path, Level Detail and the completion moment all
 * call.
 *
 * WAITING IS NOT BLOCKED, and this file asserts it state by state: a learner who
 * has done their part and is waiting on somebody else gets `waiting`, never
 * `blocked`, and never an invitation to redo what they already did.
 *
 * REPORT REVISION (§17) is covered here in its progression form — the level is
 * `in_progress` and only the report owner knows why. The report component's own
 * four-state coverage lives in features/report.
 */
import { describe, expect, it } from "vitest";
import { deriveNextAction } from "@/lib/curriculum/next-action";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";

function level(over: Partial<AcademyLevelSummary> = {}): AcademyLevelSummary {
  return {
    levelCode: `v2.l${String(over.order ?? 1).padStart(3, "0")}.x`,
    order: over.order ?? 1,
    title: "Уровень",
    shortDescription: null,
    learningObjective: "Цель",
    typeInfo: { type: "lesson", label: "Урок", isCheckpoint: false, isExternal: false, supported: true },
    state: "available",
    lockReason: null,
    stateLabel: "Доступен",
    completionSource: "assessment_pass",
    completionSourceLabel: "Проверка знаний",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: true,
    actions: ["view"],
    href: `/lessons/v2.l${String(over.order ?? 1).padStart(3, "0")}.x`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: null,
    completionMethod: "assessment",
    ...over,
  };
}

function view(levels: AcademyLevelSummary[]): AcademyCurriculumView {
  const courseModule: AcademyModuleSummary = {
    moduleCode: "module.01",
    order: 1,
    title: "Модуль",
    description: null,
    learningObjective: "Цель",
    status: "active",
    levels,
    progress: { total: levels.length, completed: levels.filter((l) => l.state === "completed").length },
  };
  return {
    state: "enrolled",
    toolAccess: null, // no Backend verdict in this fixture; null locks every tool
    curriculum: { curriculumCode: "ata-v2", curriculumVersion: 4, title: "ATA", status: "published", publishedAt: null },
    modules: [courseModule],
    progress: {
      currentLevelCode: levels[0]!.levelCode,
      currentModuleCode: "module.01",
      nextAvailableLevelCode: null,
      completedLevels: courseModule.progress.completed,
      totalLevels: levels.length,
      xp: { available: true, currentXp: 1700, nextLevelRequiredXp: null, xpRemaining: 0 },
      updatedAt: null,
    },
  };
}

describe("return after a pause — the learner can act", () => {
  it("unfinished lesson: continue, not start over", () => {
    const action = deriveNextAction(view([level({ state: "in_progress", completionMethod: "assessment" })]));
    expect(action.kind).toBe("retry-assessment");
    expect(action.posture).toBe("act");
    expect(action.title).toMatch(/продолжите/i);
  });

  it("unstarted lesson: an invitation to begin", () => {
    const action = deriveNextAction(view([level({ state: "available", completionMethod: "assessment" })]));
    expect(action.kind).toBe("take-assessment");
    expect(action.posture).toBe("act");
  });

  it("started practical: finish it, not start it", () => {
    const action = deriveNextAction(view([level({ state: "in_progress", completionMethod: "manual" })]));
    expect(action.kind).toBe("complete-practical");
    expect(action.title).toMatch(/завершите/i);
  });
});

describe("return after a pause — the report's four canonical states (§16, §17)", () => {
  const reportLevel = (state: AcademyLevelSummary["state"]) =>
    view([level({ order: 3, state, completionMethod: "report", typeInfo: { type: "report", label: "Отчёт", isCheckpoint: false, isExternal: false, supported: true } })]);

  it("no report written yet: prepare and send", () => {
    const action = deriveNextAction(reportLevel("in_progress"), { reportState: "available" });
    expect(action.kind).toBe("submit-report");
    expect(action.title).toMatch(/подготовьте/i);
  });

  it("draft saved: finish it, and say the draft is there", () => {
    const action = deriveNextAction(reportLevel("in_progress"), { reportState: "draft" });
    expect(action.kind).toBe("submit-report");
    expect(action.title).toMatch(/допишите/i);
    expect(action.explanation).toMatch(/черновик/i);
  });

  it("pending review: waiting, and NOT an invitation to write it again", () => {
    const action = deriveNextAction(reportLevel("pending_review"));
    expect(action.kind).toBe("wait-report-review");
    expect(action.posture).toBe("waiting");
    expect(action.title).not.toMatch(/подготовьте|отправьте/i);
  });

  it("REJECTED: revise, not write from scratch — the §16 distinction", () => {
    // The progression engine calls this `in_progress`, identical to a report
    // that was never written. Only the report owner can tell them apart.
    const action = deriveNextAction(reportLevel("in_progress"), { reportState: "rejected" });
    expect(action.kind).toBe("revise-report");
    expect(action.posture).toBe("act");
    expect(action.title).toMatch(/внесите правки/i);
    expect(action.explanation).toMatch(/вернул/i);
    // And it must not claim the level is finished.
    expect(action.explanation).toMatch(/пока не завершён/i);
  });

  it("approved: the level is completed and the answer moves on", () => {
    const action = deriveNextAction(reportLevel("completed"));
    expect(action.kind).not.toBe("submit-report");
    expect(action.kind).not.toBe("revise-report");
  });

  it("falls back to the general sentence when the report state cannot be read", () => {
    // A Backend that is slow, off or unreachable must not change the answer
    // into something wrong — it degrades to the less specific truthful one.
    for (const reportState of [null, undefined]) {
      const action = deriveNextAction(reportLevel("in_progress"), { reportState });
      expect(action.kind).toBe("submit-report");
      expect(action.posture).toBe("act");
    }
  });
});

describe("return after a pause — waiting on somebody else", () => {
  it("mentor pending: waiting, and says a message is not a decision", () => {
    const action = deriveNextAction(
      view([level({ order: 14, state: "pending_review", completionMethod: "mentor-review" })]),
    );
    expect(action.kind).toBe("wait-mentor-review");
    expect(action.posture).toBe("waiting");
    expect(action.explanation).toMatch(/только после подтверждения/i);
  });

  it("checkpoint waiting: waiting, never blocked, and never an amount", () => {
    const action = deriveNextAction(
      view([
        level({
          order: 15,
          state: "available",
          completionMethod: "checkpoint",
          typeInfo: { type: "checkpoint", label: "Контрольная точка", isCheckpoint: true, isExternal: false, supported: true },
          checkpoint: {
            verificationState: "verification_unavailable",
            reason: "provider_disabled",
            canVerify: false,
            canStart: false,
            canComplete: false,
            retryAfterSeconds: null,
          },
        }),
      ]),
    );
    expect(action.kind).toBe("wait-checkpoint");
    expect(action.posture).toBe("waiting");
    expect(action.explanation).not.toMatch(/\$|₽|баланс|депозит/i);
  });

  it("checkpoint requirement not met: blocked, and still never an amount", () => {
    const action = deriveNextAction(
      view([
        level({
          order: 15,
          state: "available",
          completionMethod: "checkpoint",
          typeInfo: { type: "checkpoint", label: "Контрольная точка", isCheckpoint: true, isExternal: false, supported: true },
          checkpoint: {
            verificationState: "not_met",
            reason: "not_met",
            canVerify: true,
            canStart: false,
            canComplete: false,
            retryAfterSeconds: null,
          },
        }),
      ]),
    );
    expect(action.posture).toBe("blocked");
    expect(action.explanation).not.toMatch(/\$|₽|баланс|депозит|осталось/i);
  });

  it("external registration pending: waiting on the partner, not on the learner", () => {
    const action = deriveNextAction(
      view([
        level({
          order: 1,
          state: "in_progress",
          completionMethod: "external-event",
          typeInfo: { type: "external", label: "Регистрация", isCheckpoint: false, isExternal: true, supported: true },
        }),
      ]),
    );
    expect(action.kind).toBe("wait-registration");
    expect(action.posture).toBe("waiting");
  });

  it("external registration not started: the learner acts", () => {
    const action = deriveNextAction(
      view([
        level({
          order: 1,
          state: "available",
          completionMethod: "external-event",
          typeInfo: { type: "external", label: "Регистрация", isCheckpoint: false, isExternal: true, supported: true },
        }),
      ]),
    );
    expect(action.kind).toBe("start-registration");
    expect(action.posture).toBe("act");
  });
});

describe("return after a pause — no dead ends", () => {
  it("every canonical situation yields a title and an explanation", () => {
    const situations: AcademyCurriculumView[] = [
      view([level({ state: "available" })]),
      view([level({ state: "in_progress" })]),
      view([level({ state: "pending_review", completionMethod: "report" })]),
      view([level({ state: "pending_review", completionMethod: "mentor-review" })]),
      view([level({ state: "locked", lockReason: "sequence", routeAccessible: false })]),
      view([level({ state: "checkpoint_unverified", completionMethod: "checkpoint" })]),
      view([level({ state: "completed" })]),
    ];
    for (const situation of situations) {
      const action = deriveNextAction(situation);
      expect(action.title.length).toBeGreaterThan(0);
      expect(action.explanation.length).toBeGreaterThan(0);
      // A control is either fully present or fully absent — never a label with
      // nowhere to go, which is the shape a dead end takes.
      expect(action.ctaLabel === null).toBe(action.href === null);
    }
  });

  it("a completed programme says so rather than repeating the last level", () => {
    const action = deriveNextAction(view([level({ order: 1, state: "completed" }), level({ order: 2, state: "completed" })]));
    expect(["course-complete", "continue-next-level"]).toContain(action.kind);
    expect(action.posture).not.toBe("act");
  });
});
