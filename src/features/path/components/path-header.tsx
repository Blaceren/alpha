"use client";

import { formatThresholdUsd } from "@/domain/curriculum";
import { getLevel, getModuleForLevel, getNextCheckpoint } from "@/data/curriculum/fixture";
import type { PathProgress } from "@/features/path/model/path-state";

/**
 * Path header: the page's single h1, the "where am I now" context line, the
 * nearest checkpoint (target only — never the user's balance) and the
 * return-to-current action when the user has navigated away.
 */
export function PathHeader({
  progress,
  showReturn,
  onReturn,
}: {
  progress: PathProgress;
  showReturn: boolean;
  onReturn: () => void;
}) {
  const current = getLevel(progress.currentLevel);
  const mod = getModuleForLevel(progress.currentLevel);
  const cp = getNextCheckpoint(progress.currentLevel);
  const currentIsGate = current.kind === "checkpoint";

  return (
    <header className="path-head">
      <div>
        <h1 className="path-h1">Путь</h1>
        <p className="path-now">
          {progress.allCompleted ? (
            <>
              Все 100 уровней пройдены · <b>{progress.rankLabel}</b>
            </>
          ) : (
            <>
              Сейчас: <b>Уровень {current.number}</b> ·{" "}
              {currentIsGate ? "Контрольная точка" : current.title} — модуль {mod.index} из 20{" "}
              «{mod.title}»
            </>
          )}
        </p>
        {/* Hidden when the current level IS the gate — the "now" line already says it. */}
        {!progress.allCompleted && !currentIsGate && (
          <p className="path-cp-ahead">
            Ближайшая контрольная точка · Уровень {cp.level} ·{" "}
            <b>баланс Pocket от {formatThresholdUsd(cp.thresholdUsd)}</b>
          </p>
        )}
      </div>
      <button type="button" className="rtc" hidden={!showReturn} onClick={onReturn}>
        <span className="dotmark" aria-hidden="true" />
        К текущему уровню
      </button>
    </header>
  );
}
