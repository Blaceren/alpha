/**
 * Coverage for the one derivation Home, Path and the level page all share.
 *
 * The point of these tests is not that the function returns strings — it is that
 * the product distinctions the phase depends on are structural and cannot be
 * lost in a refactor:
 *
 *   - waiting is not blocked (a learner who has submitted has not failed);
 *   - a mentor message is not a mentor approval;
 *   - a report under review reads differently from a mentor review, though the
 *     progression engine calls both `pending_review`;
 *   - an unknown state fails closed to blocked, never to actionable;
 *   - no branch can produce a financial amount.
 */
import { describe, expect, it } from "vitest";
import { deriveNextAction, explainLevelState } from "@/lib/curriculum/next-action";
import type {
  AcademyCurriculumView,
  AcademyLevelSummary,
  AcademyModuleSummary,
} from "@/lib/curriculum/academy-view";
import type { AcademyCompletionMethod } from "@/lib/curriculum/completion-method";
import type { AcademyLevelState, AcademyLockReason } from "@/lib/curriculum/progress-state";

function level(over: Partial<AcademyLevelSummary> & { order: number }): AcademyLevelSummary {
  const method: AcademyCompletionMethod = over.completionMethod ?? "assessment";
  return {
    ...over,
    levelCode: over.levelCode ?? `v2.l${String(over.order).padStart(3, "0")}`,
    order: over.order,
    title: over.title ?? `Уровень ${over.order}`,
    shortDescription: null,
    learningObjective: "цель",
    typeInfo: {
      type: "lesson",
      label: "Урок",
      isCheckpoint: method === "checkpoint",
      isExternal: method === "external-event",
      supported: true,
    },
    state: over.state ?? "available",
    lockReason: over.lockReason ?? null,
    stateLabel: over.stateLabel ?? "Доступен",
    completionSource: "learner",
    completionSourceLabel: "Проверка знаний",
    requirements: { previousLevel: null, requiredXp: 0, checkpointLevel: null },
    routeAccessible: over.routeAccessible ?? true,
    actions: ["view"],
    href: `/lessons/${over.levelCode ?? `v2.l${String(over.order).padStart(3, "0")}`}`,
    xpReward: 100,
    progressVersion: null,
    checkpoint: over.checkpoint ?? null,
    completionMethod: method,
  } as AcademyLevelSummary;
}

function view(levels: AcademyLevelSummary[], currentCode?: string | null): AcademyCurriculumView {
  const mod: AcademyModuleSummary = {
    moduleCode: "m01",
    order: 1,
    title: "Модуль 1",
    description: null,
    learningObjective: "цель модуля",
    status: "published",
    levels,
    progress: { total: levels.length, completed: levels.filter((l) => l.state === "completed").length },
  };
  return {
    state: "enrolled",
    toolAccess: null, // no Backend verdict in this fixture; null locks every tool
    curriculum: { curriculumCode: "ata-v2", curriculumVersion: 4, title: "Программа", status: "published", publishedAt: null },
    modules: [mod],
    progress: {
      currentLevelCode: currentCode === undefined ? levels[0]?.levelCode ?? null : currentCode,
      currentModuleCode: "m01",
      nextAvailableLevelCode: null,
      completedLevels: mod.progress.completed,
      totalLevels: 100,
      xp: { available: false },
      updatedAt: null,
    },
  };
}

const NO_AMOUNT = /\d[\d\s.,]*\s*(\$|USD|₽|руб)|\$\s*\d/i;

describe("deriveNextAction — action families", () => {
  it("assessment available -> take-assessment, posture act", () => {
    const a = deriveNextAction(view([level({ order: 5, completionMethod: "assessment" })]));
    expect(a.kind).toBe("take-assessment");
    expect(a.posture).toBe("act");
    expect(a.ctaLabel).toBeTruthy();
  });

  it("assessment in progress -> retry-assessment, still act", () => {
    const a = deriveNextAction(view([level({ order: 5, state: "in_progress", completionMethod: "assessment" })]));
    expect(a.kind).toBe("retry-assessment");
    expect(a.posture).toBe("act");
  });

  it("manual practical says the learner confirms it, not ATA", () => {
    const a = deriveNextAction(view([level({ order: 6, completionMethod: "manual" })]));
    expect(a.kind).toBe("start-lesson");
    expect(a.explanation).toContain("самостоятельно");
  });

  it("manual practical in progress -> complete-practical", () => {
    const a = deriveNextAction(view([level({ order: 6, state: "in_progress", completionMethod: "manual" })]));
    expect(a.kind).toBe("complete-practical");
  });

  it("report available -> submit-report", () => {
    const a = deriveNextAction(view([level({ order: 3, completionMethod: "report" })]));
    expect(a.kind).toBe("submit-report");
    expect(a.posture).toBe("act");
  });

  it("mentor level available -> request-mentor-review", () => {
    const a = deriveNextAction(view([level({ order: 14, completionMethod: "mentor-review" })]));
    expect(a.kind).toBe("request-mentor-review");
    expect(a.posture).toBe("act");
  });

  it("external registration available -> start-registration", () => {
    const a = deriveNextAction(view([level({ order: 1, completionMethod: "external-event" })]));
    expect(a.kind).toBe("start-registration");
    expect(a.posture).toBe("act");
  });

  it("external registration started -> wait-registration, posture waiting", () => {
    const a = deriveNextAction(view([level({ order: 1, state: "in_progress", completionMethod: "external-event" })]));
    expect(a.kind).toBe("wait-registration");
    expect(a.posture).toBe("waiting");
  });
});

describe("deriveNextAction — waiting is not blocked", () => {
  it("report under review is waiting, not blocked", () => {
    const a = deriveNextAction(view([level({ order: 3, state: "pending_review", completionMethod: "report" })]));
    expect(a.kind).toBe("wait-report-review");
    expect(a.posture).toBe("waiting");
    expect(a.posture).not.toBe("blocked");
  });

  it("mentor review pending is waiting and says approval has NOT happened", () => {
    const a = deriveNextAction(view([level({ order: 14, state: "pending_review", completionMethod: "mentor-review" })]));
    expect(a.kind).toBe("wait-mentor-review");
    expect(a.posture).toBe("waiting");
    // The distinction the whole mentor product decision rests on.
    expect(a.explanation).toMatch(/только после подтверждения/i);
  });

  it("report-pending and mentor-pending are DIFFERENT kinds though both are pending_review", () => {
    const r = deriveNextAction(view([level({ order: 3, state: "pending_review", completionMethod: "report" })]));
    const m = deriveNextAction(view([level({ order: 14, state: "pending_review", completionMethod: "mentor-review" })]));
    expect(r.kind).not.toBe(m.kind);
    expect(r.title).not.toBe(m.title);
  });
});

describe("deriveNextAction — checkpoints never describe money", () => {
  const cp = (verificationState: string, reason: string) =>
    level({
      order: 15,
      completionMethod: "checkpoint",
      checkpoint: {
        verificationState,
        reason,
        canVerify: false,
        canStart: false,
        canComplete: false,
        retryAfterSeconds: null,
      },
    } as never);

  it("not_met is blocked but explains the requirement, not a balance", () => {
    const a = deriveNextAction(view([cp("not_met", "not_met")]));
    expect(a.kind).toBe("verify-checkpoint");
    expect(a.posture).toBe("blocked");
    expect(a.explanation).not.toMatch(NO_AMOUNT);
  });

  it("provider trouble is waiting, and blames nobody", () => {
    const a = deriveNextAction(view([cp("checking", "provider_timeout")]));
    expect(a.posture).toBe("waiting");
    expect(a.explanation).not.toMatch(NO_AMOUNT);
  });

  it("checkpoint_unverified level state is waiting, not locked", () => {
    const a = deriveNextAction(view([level({ order: 15, state: "checkpoint_unverified", completionMethod: "checkpoint" })]));
    expect(a.kind).toBe("wait-checkpoint");
    expect(a.posture).toBe("waiting");
  });

  it("no checkpoint branch can emit an amount", () => {
    for (const reason of [
      "not_met", "cooldown_active", "identity_unlinked", "identity_mismatch",
      "provider_timeout", "provider_maintenance", "requirement_unconfigured", "stale", "unsupported",
    ]) {
      const a = deriveNextAction(view([cp("not_met", reason)]));
      expect(a.explanation).not.toMatch(NO_AMOUNT);
    }
  });
});

describe("deriveNextAction — locks explain themselves", () => {
  // `unknown` is excluded on purpose: it IS the generic fallback, and asserting
  // that it differs from itself would only force a fake-specific sentence for a
  // reason the Backend could not name. It is covered separately below.
  const reasons: AcademyLockReason[] = ["sequence", "not_current", "xp", "checkpoint", "external", "inactive", "visibility"];

  it.each(reasons)("locked/%s produces a specific, non-empty reason", (reason) => {
    const a = deriveNextAction(view([level({ order: 20, state: "locked", lockReason: reason, routeAccessible: false })]));
    expect(a.kind).toBe("blocked");
    expect(a.posture).toBe("blocked");
    expect(a.explanation.length).toBeGreaterThan(10);
    expect(a.explanation).not.toBe("Уровень пока закрыт.");
  });

  it("each named reason produces a DISTINCT sentence — no two locks read alike", () => {
    const sentences = reasons.map(
      (r) => deriveNextAction(view([level({ order: 20, state: "locked", lockReason: r, routeAccessible: false })])).explanation,
    );
    expect(new Set(sentences).size).toBe(reasons.length);
  });

  it("locked/unknown falls back honestly rather than inventing a cause", () => {
    const a = deriveNextAction(view([level({ order: 20, state: "locked", lockReason: "unknown", routeAccessible: false })]));
    expect(a.posture).toBe("blocked");
    expect(a.explanation).toBe("Уровень пока закрыт.");
  });

  it("an unknown lock reason still refuses, it does not fall through to actionable", () => {
    const a = deriveNextAction(view([level({ order: 20, state: "locked", lockReason: null, routeAccessible: false })]));
    expect(a.posture).toBe("blocked");
    expect(a.ctaLabel).toBeNull();
  });
});

describe("deriveNextAction — fail-closed and edges", () => {
  it("an unrecognised level state is blocked, never actionable", () => {
    const a = deriveNextAction(view([level({ order: 9, state: "banana" as unknown as AcademyLevelState })]));
    expect(a.posture).toBe("blocked");
  });

  it("an unsupported completion method offers no control", () => {
    const a = deriveNextAction(view([level({ order: 9, completionMethod: "unsupported" as AcademyCompletionMethod })]));
    expect(a.kind).toBe("blocked");
    expect(a.href).toBeNull();
    expect(a.ctaLabel).toBeNull();
  });

  it("every level completed -> course-complete, posture done", () => {
    const a = deriveNextAction(view([level({ order: 1, state: "completed" })], null));
    expect(a.kind).toBe("course-complete");
    expect(a.posture).toBe("done");
  });

  it("completed current level rolls forward to the next open level", () => {
    const a = deriveNextAction(
      view(
        [level({ order: 1, state: "completed" }), level({ order: 2, state: "available", completionMethod: "assessment" })],
        "v2.l001",
      ),
    );
    expect(a.kind).toBe("take-assessment");
    expect(a.level?.order).toBe(2);
  });

  it("not enrolled and no programme are answered, not blank", () => {
    const cand = deriveNextAction({ state: "candidate", curriculum: { curriculumCode: "c", curriculumVersion: 1, title: "T", status: "published", publishedAt: null }, modules: [], progress: null });
    expect(cand.kind).toBe("not-enrolled");
    const un = deriveNextAction({ state: "unavailable", reason: "x" });
    expect(un.kind).toBe("not-enrolled");
    expect(un.explanation.length).toBeGreaterThan(10);
  });

  it("the current level wins over the next available level", () => {
    const v = view([level({ order: 5, state: "in_progress" }), level({ order: 6, state: "available" })], "v2.l005");
    expect(deriveNextAction(v).level?.order).toBe(5);
  });
});

describe("explainLevelState — shared with Path", () => {
  it("gives a distinct sentence per state family", () => {
    const seen = new Set(
      (["completed", "in_progress", "available", "pending_review", "locked"] as AcademyLevelState[]).map((s) =>
        explainLevelState(level({ order: 1, state: s })),
      ),
    );
    expect(seen.size).toBe(5);
  });

  it("mentor pending says approval has not happened", () => {
    const t = explainLevelState(level({ order: 14, state: "pending_review", completionMethod: "mentor-review" }));
    expect(t).toMatch(/не подтвердил/i);
  });

  it("never emits an amount for a checkpoint level", () => {
    const t = explainLevelState(
      level({ order: 15, state: "checkpoint_unverified", completionMethod: "checkpoint",
        checkpoint: { verificationState: "not_met", reason: "not_met", canVerify: false, canStart: false, canComplete: false, retryAfterSeconds: null } } as never),
    );
    expect(t).not.toMatch(NO_AMOUNT);
  });
});
