import { getModuleForLevel } from "@/data/curriculum/fixture";
import type { CurriculumLevel } from "@/domain/curriculum";

/**
 * The brief state while a locked-by-sequence level is checked against this
 * browser session (Phase D2B.1).
 *
 * It carries the level's identity (eyebrow + the page's single h1) so the answer
 * that follows does not shift the layout and the document always has a heading.
 * It states nothing about access it does not yet know — no "закрыт", no "открыт".
 */
export function LessonResolving({ level }: { level: CurriculumLevel }) {
  const mod = getModuleForLevel(level.number);

  return (
    <div className="llk">
      <p className="lhd-eyebrow">
        Уровень {level.number} · Модуль {mod.index} «{mod.title}»
      </p>
      <h1 className="lhd-h1">{level.title}</h1>
      <p className="lhd-state" role="status">
        <span className="lhd-sdot locked" aria-hidden="true" />
        Проверяем доступ к уровню…
      </p>
    </div>
  );
}
