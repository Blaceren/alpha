"use client";

import { CURRICULUM } from "@/data/curriculum/fixture";
import {
  levelVisualState,
  moduleAggregateState,
  stateLabel,
  type PathProgress,
} from "@/features/path/model/path-state";

/**
 * Semantic progression structure — the real, testable text alternative to the
 * visual Route Field. Visually hidden but fully present in the accessibility
 * tree: an ordered list of all 20 modules, with the selected module's levels
 * as a nested ordered list. The current level carries aria-current="step".
 */
export function PathAccessibleOutline({
  selectedModuleIndex,
  progress,
}: {
  selectedModuleIndex: number;
  progress: PathProgress;
}) {
  const moduleStateText: Record<string, string> = {
    completed: "пройден",
    current: "текущий",
    upcoming: "следующий",
    locked: "впереди",
  };

  return (
    <nav className="sr-only" aria-label="Структура пути — текстовая версия">
      <p>
        {progress.allCompleted
          ? "Все 100 уровней пройдены."
          : `Текущий уровень: ${progress.currentLevel}.`}{" "}
        Всего 20 модулей и 100 уровней.
      </p>
      <ol>
        {CURRICULUM.modules.map((mod) => (
          <li key={mod.code}>
            Модуль {mod.index} «{mod.title}» — уровни {mod.startLevel}–{mod.endLevel},{" "}
            {moduleStateText[moduleAggregateState(mod.index, progress)]}.
            {mod.index === selectedModuleIndex && (
              <ol>
                {mod.levels.map((level) => {
                  const state = levelVisualState(level, progress);
                  const isCurrent = state === "current" || state === "checkpoint-current";
                  return (
                    <li key={level.code} aria-current={isCurrent ? "step" : undefined}>
                      Уровень {level.number}: {level.title} — {stateLabel(state)}.
                      {level.checkpoint && (
                        <>
                          {" "}
                          Условие: баланс Pocket от ${level.checkpoint.thresholdUsd}. Откроется:{" "}
                          {level.checkpoint.rank.label}
                          {level.checkpoint.toolUnlock
                            ? `, ${level.checkpoint.toolUnlock.name}`
                            : ""}
                          {level.checkpoint.communityUnlock
                            ? `, канал «${level.checkpoint.communityUnlock.name}»`
                            : ""}
                          .
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
