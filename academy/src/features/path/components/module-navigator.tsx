"use client";

import { CURRICULUM, getModuleByIndex } from "@/data/curriculum/fixture";
import {
  moduleAggregateState,
  moduleCompletedCount,
  type PathProgress,
} from "@/features/path/model/path-state";

/**
 * Module navigator (Phase D2A, hierarchy refined in D2A-R1).
 *
 * All 20 modules stay reachable, but they are no longer a row of identical
 * numbers: a scale marker states the position in the whole path, the band is
 * grouped into four chapters of five with weak boundaries, and the two roles are
 * carried by DIFFERENT GEOMETRY (not colour) — the current module gets a filled
 * node mark under its number, the viewed module gets a bracketed frame. Distant
 * future modules are narrower and quieter; the touch strip stays ≥44px tall.
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
  const currentIndex =
    CURRICULUM.modules.findIndex(
      (m) => moduleAggregateState(m.index, progress) === "current",
    ) + 1;

  const stateText: Record<string, string> = {
    completed: "пройден",
    current: "текущий",
    upcoming: "следующий",
    locked: "впереди",
  };

  // Four chapters of five modules — a weak structural rhythm for 20 items.
  const chapters = [0, 1, 2, 3].map((c) => CURRICULUM.modules.slice(c * 5, c * 5 + 5));

  return (
    <nav className="modnav" aria-label="Модули пути">
      <div className="modnav-top">
        <p className="modnav-scale">
          {/* Screen readers get the full phrase; the eye gets the scale mark. */}
          <span className="sr-only">Модуль {selectedIndex} из 20</span>
          <span className="mns-now" aria-hidden="true">{selectedIndex}</span>
          <span className="mns-of" aria-hidden="true">/ 20</span>
        </p>
        <div className="modnav-meta">
          <p className="modnav-title">
            <span className="mm-k">Смотришь</span> {selected.title}
          </p>
          <p className="modnav-range">
            Уровни {selected.startLevel}–{selected.endLevel} · пройдено {done} из{" "}
            {selected.levels.length}
          </p>
        </div>
      </div>

      <div className="modnav-band">
        {chapters.map((chapter, ci) => (
          <ul className="modnav-chapter" key={ci}>
            {chapter.map((mod) => {
              const state = moduleAggregateState(mod.index, progress);
              const isCurrent = mod.index === currentIndex;
              const isViewed = mod.index === selectedIndex;
              // Distant future modules compress; near context stays legible.
              const distant = state === "locked" && mod.index > currentIndex + 1;
              return (
                <li key={mod.code}>
                  <button
                    type="button"
                    className={`modseg m-${state}`}
                    data-current={isCurrent || undefined}
                    data-viewed={isViewed || undefined}
                    data-distant={distant || undefined}
                    aria-pressed={isViewed}
                    aria-label={`Модуль ${mod.index} «${mod.title}» — уровни ${mod.startLevel}–${mod.endLevel}, ${stateText[state]}${isCurrent ? ", здесь ты сейчас" : ""}`}
                    title={`${mod.title} · уровни ${mod.startLevel}–${mod.endLevel}`}
                    onClick={() => onSelect(mod.index)}
                  >
                    <span className="seg-in" aria-hidden="true">
                      <i className="num">{mod.index}</i>
                      <i className="tick" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </nav>
  );
}
