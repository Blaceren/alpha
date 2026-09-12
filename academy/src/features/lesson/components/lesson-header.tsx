import Link from "next/link";
import { getModuleForLevel } from "@/data/curriculum/fixture";
import type { CurriculumLevel } from "@/domain/curriculum";

/**
 * Lesson header (Phase D2B) — the one h1 on the page.
 *
 * Order: back to Путь · level + module · title · goal · state. The state is a
 * word, not a colour, and the raw state enum is never shown.
 */
export function LessonHeader({
  level,
  goal,
  stateLabel,
}: {
  level: CurriculumLevel;
  goal?: string;
  stateLabel: string;
}) {
  const mod = getModuleForLevel(level.number);

  return (
    <header className="lhd">
      <Link href="/path" className="lhd-back">
        <span aria-hidden="true">←</span> Путь
      </Link>

      <p className="lhd-eyebrow">
        Уровень {level.number} · Модуль {mod.index} «{mod.title}»
      </p>

      <h1 className="lhd-h1">{level.title}</h1>

      {goal && <p className="lhd-goal">{goal}</p>}

      <p className="lhd-state">
        <span className="lhd-sdot" aria-hidden="true" />
        Состояние: <b>{stateLabel}</b>
      </p>
    </header>
  );
}
