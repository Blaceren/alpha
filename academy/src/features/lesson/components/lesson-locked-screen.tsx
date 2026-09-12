import Link from "next/link";
import { getLevel, getModuleForLevel } from "@/data/curriculum/fixture";
import type { CurriculumLevel } from "@/domain/curriculum";
import { levelCodeFor } from "@/features/lesson/model/lesson";
import { lockedLessonReason } from "@/features/lesson/model/lesson-state-machine";
import type { PathProgress } from "@/features/path/model/path-state";

/**
 * A lesson the user has not reached yet (Phase D2B).
 *
 * The route resolves — it is never a 404 and never a fake unlock. It explains
 * the SEQUENCE and nothing else: no financial condition is shown, because being
 * next in line has nothing to do with money. It reveals no lesson body, no
 * question and no explanation; only what the level will ask for.
 *
 * Both ways out are real links: the current lesson, and Путь.
 */
export function LessonLockedScreen({
  level,
  progress,
  note,
}: {
  level: CurriculumLevel;
  progress: PathProgress;
  note?: string;
}) {
  const mod = getModuleForLevel(level.number);
  const current = getLevel(progress.currentLevel);

  return (
    // Not a spine flow — a closed door has no stages to thread, so it gets a
    // plain constrained column instead of a stray spine node (D2B visual QA).
    <div className="llk">
      <Link href="/path" className="lhd-back">
        <span aria-hidden="true">←</span> Путь
      </Link>
      <p className="lhd-eyebrow">
        Уровень {level.number} · Модуль {mod.index} «{mod.title}»
      </p>
      <h1 className="lhd-h1">{level.title}</h1>
      <p className="lhd-state">
        <span className="lhd-sdot locked" aria-hidden="true" />
        Состояние: <b>закрыт</b>
      </p>

      <div className="llk-sec">
        <p className="llk-k">Почему закрыт</p>
        <ul>
          <li>{lockedLessonReason(level.number, progress)}</li>
          <li>Уровни открываются строго по порядку — перепрыгнуть нельзя.</li>
        </ul>
      </div>

      <div className="llk-sec">
        <p className="llk-k">Что попросит уровень</p>
        <ul>
          {level.kind === "video-test" && <li>Видеоурок и проверку понимания</li>}
          {level.kind === "practical" && <li>Практическое задание</li>}
          {level.kind === "report" && <li>Структурированный отчёт</li>}
          {level.kind === "task" && <li>Задание</li>}
          {level.artifact && (
            <li>
              Артефакт: <b>{level.artifact}</b>
            </li>
          )}
          {level.mentorReview && <li>Обязательную проверку ментора</li>}
        </ul>
        <p className="llk-note">Содержание уровня откроется вместе с доступом.</p>
        {note && <p className="llk-note">{note}</p>}
      </div>

      <div className="lnav-row">
        <Link href="/path" className="lnav-back">
          <span aria-hidden="true">←</span> Вернуться в Путь
        </Link>
        <Link href={`/lessons/${levelCodeFor(current.number)}`} className="lnav-next">
          Перейти к текущему уроку — уровень {current.number}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
