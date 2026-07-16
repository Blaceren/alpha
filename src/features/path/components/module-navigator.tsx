"use client";

import { CURRICULUM, getModuleByIndex } from "@/data/curriculum/fixture";
import {
  moduleAggregateState,
  moduleCompletedCount,
  type PathProgress,
} from "@/features/path/model/path-state";

/**
 * Module navigator — all 20 modules as one compact segmented band.
 * The current module is prominent, completed are quiet, far modules are
 * accessible but subdued (not 20 equally loud items). The selected module's
 * position, title and level range are stated as text under the band.
 */
export function ModuleNavigator({
  selectedIndex,
  progress,
  onSelect,
}: {
  selectedIndex: number;
  progress: PathProgress;
  onSelect: (moduleIndex: number) => void;
}) {
  const selected = getModuleByIndex(selectedIndex);
  const done = moduleCompletedCount(selectedIndex, progress);

  const stateText: Record<string, string> = {
    completed: "пройден",
    current: "текущий",
    upcoming: "следующий",
    locked: "впереди",
  };

  return (
    <nav className="modnav" aria-label="Модули пути">
      <ul className="modnav-band">
        {CURRICULUM.modules.map((mod) => {
          const state = moduleAggregateState(mod.index, progress);
          return (
            <li key={mod.code}>
              <button
                type="button"
                className={`modseg m-${state}`}
                aria-pressed={mod.index === selectedIndex}
                aria-label={`Модуль ${mod.index} «${mod.title}» — уровни ${mod.startLevel}–${mod.endLevel}, ${stateText[state]}`}
                title={`${mod.title} · уровни ${mod.startLevel}–${mod.endLevel}`}
                onClick={() => onSelect(mod.index)}
              >
                <span aria-hidden="true">
                  {mod.index}
                  <i className="tick" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="modnav-meta">
        <p className="modnav-pos">Модуль {selectedIndex} из 20</p>
        <p className="modnav-title">{selected.title}</p>
        <p className="modnav-range">
          Уровни {selected.startLevel}–{selected.endLevel} · пройдено {done} из {selected.levels.length}
        </p>
      </div>
    </nav>
  );
}
