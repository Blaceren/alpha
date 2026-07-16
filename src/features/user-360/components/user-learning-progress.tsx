import * as React from "react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  CHECKPOINT_LABEL,
  MENTOR_REVIEW_LABEL,
  REPORT_STATE_LABEL,
  USER_360_LABEL,
} from "@/config/labels";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import type { User360 } from "@/domain/users/user-360";
import { displayNowMs } from "@/features/users/lib/display-clock";
import { Field, SectionCard } from "./section-card";

/**
 * Learning progress from data that exists in the CRM read model only. No invented
 * curriculum details: after level 100 the grid is intentionally undefined (D-10)
 * and we say so rather than showing a fake next checkpoint.
 */
export function UserLearningProgress({ view }: { view: User360 }) {
  const l = view.learning;
  const xpPct =
    l.nextRequiredXp > 0 ? Math.min(100, Math.round((l.xp / l.nextRequiredXp) * 100)) : null;

  return (
    <SectionCard title={USER_360_LABEL.learning} aside={`Программа ${l.curriculumVersion}`}>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <dl className="min-w-0">
          <Field label="Уровень">
            {l.currentLevel}
            <span className="text-text-muted">
              {" "}
              (пройден {l.highestCompletedLevel}
              {l.nextLevel !== null ? `, следующий ${l.nextLevel}` : ""})
            </span>
          </Field>
          <Field label="XP">
            <span className="font-mono tabular-nums">
              {l.xp} / {l.nextRequiredXp}
            </span>
            {xpPct !== null ? <span className="text-text-muted"> · {xpPct}%</span> : null}
          </Field>
          <Field label="Модуль">{l.currentModule}</Field>
          <Field label="Последний урок">
            {l.lastLesson ? (
              <>
                <span className="truncate">{l.lastLesson}</span>
                <span className="text-text-muted"> · {l.lessonProgressPct}%</span>
              </>
            ) : (
              <span className="text-text-muted">нет данных</span>
            )}
          </Field>
        </dl>

        <dl className="min-w-0">
          <Field label="Попытки теста">
            {l.testAttempts}
            {l.latestScore !== null ? (
              <span className="text-text-muted"> · последний балл {l.latestScore}</span>
            ) : null}
          </Field>
          <Field label="Отчёт">{REPORT_STATE_LABEL[l.reportState]}</Field>
          <Field label="Проверка ментора">{MENTOR_REVIEW_LABEL[l.mentorReviewState]}</Field>
          <Field label="Учебная активность">
            {l.lastLearningActivityAt ? (
              <Tooltip content={formatExactTime(l.lastLearningActivityAt)} side="top">
                <span>{formatRelativeTime(l.lastLearningActivityAt, displayNowMs())}</span>
              </Tooltip>
            ) : (
              <span className="text-text-muted">нет активности</span>
            )}
          </Field>
        </dl>
      </div>

      {/* Status and NEXT checkpoint are separate facts: a user can have passed
          the last checkpoint while the next one is still ahead. Merging them on
          one line read as "checkpoint passed · level 10 · $100", which is wrong. */}
      <div className="mt-2 grid grid-cols-1 gap-x-6 border-t border-border pt-2 sm:grid-cols-2">
        <dl className="min-w-0">
          <Field label="Статус контрольной точки">{CHECKPOINT_LABEL[l.checkpointStatus]}</Field>
        </dl>
        <dl className="min-w-0">
          <Field label="Следующая контрольная точка">
            {l.nextCheckpointLevel !== null ? (
              <>
                уровень {l.nextCheckpointLevel}
                {/* Required amount only when the role may see exact financials —
                    grid + checkpoint delta would otherwise reveal the balance. */}
                {l.nextCheckpointRequiredUsd !== null ? (
                  <span className="text-text-muted">
                    {" "}
                    · ${l.nextCheckpointRequiredUsd.toLocaleString("en-US")}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-text-muted">программа в разработке</span>
            )}
          </Field>
        </dl>
      </div>
    </SectionCard>
  );
}
