import Link from "next/link";
import type { LibraryModuleRow } from "@/features/lessons-library/model/lessons-library-model";

/**
 * The contents of the whole curriculum — Concept B's Index Line, twenty times.
 *
 * One row = `ординал · название · отточие · состояние`. There is no card, no
 * lock icon and no progress ring: a locked module is quiet, not decorated. The
 * selected module is marked by `aria-current` and by a text state, never by
 * colour alone.
 */
export function LibraryModuleIndex({
  modules,
  idPrefix,
}: {
  modules: LibraryModuleRow[];
  /** Distinguishes the desktop column from the mobile sheet instance. */
  idPrefix: string;
}) {
  return (
    <ol className="lib-idx">
      {modules.map((mod) => (
        <li key={mod.code} className={`lib-ir is-${mod.state}${mod.isSelected ? " is-selected" : ""}`}>
          <Link
            href={mod.href}
            id={`${idPrefix}-${mod.code}`}
            aria-current={mod.isSelected ? "true" : undefined}
          >
            <span className="lib-ir-n mono" aria-hidden="true">
              {String(mod.index).padStart(2, "0")}
            </span>
            <span className="lib-ir-t">{mod.title}</span>
            <span className="lib-lead" aria-hidden="true" />
            <span className="lib-ir-s">
              {mod.state === "current" ? (
                <>
                  <b className="mono">{mod.completedCount}</b>/{mod.totalCount}
                </>
              ) : (
                mod.statusLabel
              )}
            </span>
            {/* the state in words, for screen readers and for the selected row */}
            <span className="sr-only">
              {`Модуль ${mod.index} из ${modules.length}. ${mod.statusLabel}. `}
              {`Пройдено ${mod.completedCount} из ${mod.totalCount}.`}
              {mod.isSelected ? " Выбран." : ""}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
