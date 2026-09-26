/**
 * THE COMPLETION MOMENT — canonical, motivational, and never authoritative.
 *
 * The rules under test, in the order they matter:
 *   §14  completion is shown ONLY when canonical state says `completed`;
 *   §13  XP is the curriculum's published reward, and never gates anything;
 *   §15  the acknowledgement stays controlled — no celebration language, no
 *        financial metaphor, no fake currency.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LevelCompletion } from "@/features/academy-experience/level-completion";
import type { AcademyLevelSummary, AcademyProgressSummary } from "@/lib/curriculum/academy-view";
import type { AcademyNextAction } from "@/lib/curriculum/next-action";

function level(over: Partial<AcademyLevelSummary> = {}): AcademyLevelSummary {
  return {
    levelCode: "v2.l014.lichnyy-risk-plan",
    order: 14,
    title: "Личный Risk Plan",
    shortDescription: null,
    learningObjective: "Составить личный план риска",
    typeInfo: { type: "mentor-review", label: "Практика", isCheckpoint: false, isExternal: false, supported: true },
    state: "completed",
    lockReason: null,
    stateLabel: "Завершён",
    completionSource: "mentor_review",
    completionSourceLabel: "Проверка наставником",
    requirements: { previousLevel: 13, requiredXp: 0, checkpointLevel: null },
    routeAccessible: true,
    actions: ["view"],
    href: "/lessons/v2.l014.lichnyy-risk-plan",
    xpReward: 250,
    progressVersion: null,
    checkpoint: null,
    completionMethod: "mentor-review",
    ...over,
  };
}

const PROGRESS: AcademyProgressSummary = {
  currentLevelCode: "v2.l015.kontrolnaya-tochka-200",
  currentModuleCode: "module.03",
  nextAvailableLevelCode: "v2.l015.kontrolnaya-tochka-200",
  completedLevels: 14,
  totalLevels: 100,
  xp: { available: true, currentXp: 1700, nextLevelRequiredXp: null, xpRemaining: 0 },
  updatedAt: null,
};

function nextAction(over: Partial<AcademyNextAction> = {}): AcademyNextAction {
  return {
    kind: "verify-checkpoint",
    posture: "act",
    title: "Пройдите контрольную точку",
    explanation: "Это требование программы.",
    ctaLabel: "Открыть контрольную точку",
    href: "/lessons/v2.l015.kontrolnaya-tochka-200",
    level: level({ levelCode: "v2.l015.kontrolnaya-tochka-200", order: 15 }),
    module: null,
    ...over,
  };
}

describe("LevelCompletion — canonical state is the only trigger", () => {
  it("renders nothing unless the canonical state is completed", () => {
    // §14: not a successful submission, not a clicked CTA, not a local "done".
    for (const state of ["pending_review", "in_progress", "available", "locked", "checkpoint_unverified"] as const) {
      const { container } = render(
        <LevelCompletion
          level={level({ state })}
          progress={PROGRESS}
          nextAction={nextAction()}
          moduleTitle="Риск и капитал"
        />,
      );
      expect(container).toBeEmptyDOMElement();
    }
  });

  it("states the completion, the position and the module from canonical reads", () => {
    render(
      <LevelCompletion level={level()} progress={PROGRESS} nextAction={nextAction()} moduleTitle="Риск и капитал" />,
    );
    expect(screen.getByText("Уровень 14 завершён")).toBeInTheDocument();
    expect(screen.getByText("14 из 100 уровней")).toBeInTheDocument();
    expect(screen.getByText("Риск и капитал")).toBeInTheDocument();
  });
});

describe("LevelCompletion — XP", () => {
  it("shows the curriculum's published reward for this level", () => {
    render(<LevelCompletion level={level()} progress={PROGRESS} nextAction={nextAction()} moduleTitle={null} />);
    expect(screen.getByText("+250 XP")).toBeInTheDocument();
  });

  it("shows the canonical reward for every canonical completion method", () => {
    // The published model: assessment 100, manual 150, mentor 250, report 500.
    const cases: Array<[AcademyLevelSummary["completionMethod"], number]> = [
      ["assessment", 100],
      ["manual", 150],
      ["mentor-review", 250],
      ["report", 500],
    ];
    for (const [completionMethod, xpReward] of cases) {
      const { unmount } = render(
        <LevelCompletion
          level={level({ completionMethod, xpReward })}
          progress={PROGRESS}
          nextAction={nextAction()}
          moduleTitle={null}
        />,
      );
      expect(screen.getByText(`+${xpReward} XP`)).toBeInTheDocument();
      unmount();
    }
  });

  it("shows no XP line at all on a level whose canonical reward is zero", () => {
    // The 20 financial checkpoints and the Pocket registration. "+0 XP" would
    // read as a failure rather than as a level that was never scored.
    for (const completionMethod of ["checkpoint", "external-event"] as const) {
      const { container, unmount } = render(
        <LevelCompletion
          level={level({ completionMethod, xpReward: 0 })}
          progress={PROGRESS}
          nextAction={nextAction()}
          moduleTitle={null}
        />,
      );
      expect(container.textContent).not.toContain("XP");
      expect(container.textContent).not.toContain("Начислено");
      unmount();
    }
  });

  it("never presents XP as a balance, a currency or a total to reach", () => {
    const { container } = render(
      <LevelCompletion level={level()} progress={PROGRESS} nextAction={nextAction()} moduleTitle={null} />,
    );
    const text = container.textContent ?? "";
    for (const forbidden of ["баланс", "$", "₽", "депозит", "вывод", "счёт", "накоплено", "до следующего"]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("LevelCompletion — §15 restraint", () => {
  it("uses no celebration or winnings language", () => {
    const { container } = render(
      <LevelCompletion level={level()} progress={PROGRESS} nextAction={nextAction()} moduleTitle="Риск и капитал" />,
    );
    const text = (container.textContent ?? "").toLowerCase();
    for (const forbidden of ["поздравля", "ура", "победа", "выигр", "приз", "награда", "джекпот", "бонус"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("carries no animation, canvas or media hook", () => {
    const { container } = render(
      <LevelCompletion level={level()} progress={PROGRESS} nextAction={nextAction()} moduleTitle={null} />,
    );
    expect(container.querySelectorAll("canvas, svg, video, audio, img")).toHaveLength(0);
  });

  it("offers exactly one forward control and no action of its own", () => {
    const { container } = render(
      <LevelCompletion level={level()} progress={PROGRESS} nextAction={nextAction()} moduleTitle={null} />,
    );
    // A link forward is navigation; a button here would be a second completion
    // owner on a level that is already finished.
    expect(container.querySelectorAll("button, input, form")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("LevelCompletion — the next step is the shared derivation", () => {
  it("repeats the derived action verbatim", () => {
    render(
      <LevelCompletion
        level={level()}
        progress={PROGRESS}
        nextAction={nextAction({ title: "Пройдите проверку знаний", explanation: "Изучите урок." })}
        moduleTitle={null}
      />,
    );
    expect(screen.getByText("Пройдите проверку знаний")).toBeInTheDocument();
    expect(screen.getByText("Изучите урок.")).toBeInTheDocument();
  });

  it("says nothing about what is next when the derived action is this same level", () => {
    // Re-inviting a learner to the level they just finished is the failure mode
    // this guard exists for.
    const { container } = render(
      <LevelCompletion
        level={level()}
        progress={PROGRESS}
        nextAction={nextAction({ title: "Открыть уровень", level: level() })}
        moduleTitle={null}
      />,
    );
    expect(container.textContent).not.toContain("Открыть уровень");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("still renders when the derived action has no control to offer", () => {
    render(
      <LevelCompletion
        level={level()}
        progress={PROGRESS}
        nextAction={nextAction({ title: "Уровень завершён", ctaLabel: null, href: null, level: null })}
        moduleTitle={null}
      />,
    );
    expect(screen.getByText("Уровень 14 завершён")).toBeInTheDocument();
  });
});

describe("LevelCompletion — the control follows the derived posture", () => {
  it("lights the control only when the learner can genuinely act", () => {
    const { container } = render(
      <LevelCompletion
        level={level()}
        progress={PROGRESS}
        nextAction={nextAction({ posture: "act" })}
        moduleTitle={null}
      />,
    );
    const cta = container.querySelector(".ax-done__cta");
    expect(cta?.getAttribute("data-posture")).toBe("act");
    expect(cta?.className).not.toContain("ax-done__cta--quiet");
  });

  it("keeps the control quiet when the next action is waiting or blocked", () => {
    // Finishing level 14 does not make level 15 actionable. Home renders this
    // same action with a quiet control; lighting it here would make one screen
    // promise what the next withholds.
    for (const posture of ["waiting", "blocked", "done"] as const) {
      const { container, unmount } = render(
        <LevelCompletion
          level={level()}
          progress={PROGRESS}
          nextAction={nextAction({ posture })}
          moduleTitle={null}
        />,
      );
      const cta = container.querySelector(".ax-done__cta");
      expect(cta?.getAttribute("data-posture")).toBe(posture);
      expect(cta?.className).toContain("ax-done__cta--quiet");
      unmount();
    }
  });
});
