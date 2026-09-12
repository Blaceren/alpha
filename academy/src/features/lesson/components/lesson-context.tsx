"use client";

import { getModuleForLevel, getNextCheckpoint } from "@/data/curriculum/fixture";
import { formatDuration } from "@/features/lesson/model/lesson";
import type { LessonExperience } from "@/features/lesson/model/lesson-state-machine";
import { sectionAt } from "@/features/lesson/components/lesson-video-stage";
import { LessonOutline } from "@/features/lesson/components/lesson-outline";

/**
 * Contextual rail (Phase D2B) — the metadata that surrounds one learning step.
 *
 * Narrow and secondary by construction: structure of the material, duration,
 * what the level requires and which boundary stands ahead. It is NOT a dashboard
 * or an in-page sidebar — no KPI tiles, no charts, no controls that duplicate
 * the stage, and no user balance (only the checkpoint's target, per DD-046).
 *
 * On mobile it sits between the video and the assessment in source order, which
 * is exactly where the learning flow wants it — so no DOM duplication.
 */
export function LessonContext({ experience }: { experience: LessonExperience }) {
  const { lesson, session, testUnlocked, assessmentComplete } = experience;
  const checkpoint = getNextCheckpoint(lesson.level.number);
  const mod = getModuleForLevel(lesson.level.number);
  const active = sectionAt(lesson.sections, session.media.currentPosition);

  const satisfied: Record<string, boolean> = {
    watch: testUnlocked,
    assessment: assessmentComplete,
    "mentor-review": false,
    artifact: false,
  };

  return (
    <aside className="lctx" aria-label="Контекст урока">
      <div className="lctx-sec">
        <p className="lctx-k">Структура урока</p>
        <LessonOutline sections={lesson.sections} activeSectionId={active?.id ?? null} />
        <p className="lctx-dur">
          Длительность <b>{formatDuration(lesson.media.durationSeconds)}</b>
        </p>
      </div>

      <div className="lctx-sec">
        <p className="lctx-k">Что требуется</p>
        <ul className="lctx-reqs">
          {lesson.requirements.map((r) => (
            <li key={r.id} className={satisfied[r.kind] ? "ok" : ""}>
              <span className="lctx-rg" aria-hidden="true">
                {satisfied[r.kind] ? "✓" : "○"}
              </span>
              <span className="lctx-rl">{r.label}</span>
              <span className="lctx-rs">{satisfied[r.kind] ? "выполнено" : "ещё нет"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="lctx-sec">
        <p className="lctx-k">Впереди</p>
        <p className="lctx-cp">
          Контрольная точка · Уровень {checkpoint.level}
          <span className="lctx-cpv">закрывает модуль {mod.index} «{mod.title}»</span>
        </p>
        <p className="lctx-cpnote">
          Условие контрольной точки показывается на Пути — здесь только учебный шаг.
        </p>
      </div>
    </aside>
  );
}
