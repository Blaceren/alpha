"use client";

/**
 * PHASE-1 ADMIN — the correction dialog.
 *
 * THE SHAPE IS DELIBERATELY NOT `[-] 15 [+]`. The target is chosen from the
 * learner's own pinned curriculum, so what an operator selects is always a level
 * that exists in the version this learner is enrolled on; there is no spinner
 * that can produce a number the curriculum has never heard of, and no minus
 * button, because backward correction does not exist in this phase and offering
 * a disabled control for it would advertise something that is not coming back
 * next week.
 *
 * PREVIEW IS MANDATORY BEFORE CONFIRM. `Подтвердить` is not rendered until the
 * server has answered `canApply: true` for this exact target, and any change to
 * the target clears the plan. That is not merely a nicety: the consequences —
 * which levels, how much XP, which gate blocks — are computed by the server from
 * durable state, and an operator confirming without them would be approving a
 * description they never saw.
 *
 * THE PLAN IS NOT AUTHORITY. `expectedCurrentLevel` and
 * `expectedCurriculumVersionId` travel with the confirm, and the backend
 * re-plans inside its own transaction. If the learner moved while the dialog was
 * open, the answer is a typed conflict and the operator is told to look again —
 * never a silent rebase onto whatever is current now.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  adjustProgression,
  newProgressionRequestId,
  previewProgression,
  PROGRESSION_REASON_CODES,
  PROGRESSION_REASON_LABEL,
  type ProgressionPlan,
  type ProgressionReasonCode,
  type ProgressionSnapshotEnrolled,
} from "@/application/api/progression-client";
import { levelTypeLabel } from "./api-user-progression";

const REASON_TEXT_MIN = 10;
const REASON_TEXT_MAX = 2000;

/** Operator-facing text for every refusal the backend can return. */
const REFUSAL_TEXT: Record<string, string> = {
  PROGRESSION_ADJUST_BACKWARD_UNSUPPORTED:
    "Обратная корректировка не поддерживается: история прохождения неизменяема.",
  PROGRESSION_ADJUST_NO_CHANGE: "Учащийся уже находится на этом уровне.",
  PROGRESSION_ADJUST_GATE_LEVEL_REFUSED:
    "Интервал содержит уровень, состояние которого подтверждается отдельной authority.",
  PROGRESSION_ADJUST_STALE_STATE:
    "Прогресс учащегося изменился, пока открыт диалог. Закройте и посмотрите снова.",
  PROGRESSION_ADJUST_WRONG_CURRICULUM:
    "Учащийся закреплён за другой версией программы.",
  PROGRESSION_ADJUST_NOT_ENROLLED: "У учащегося нет активного зачисления.",
  PROGRESSION_ADJUST_LEARNER_INACTIVE: "Учётная запись учащегося неактивна.",
  PROGRESSION_ADJUST_REQUEST_CONFLICT:
    "Идентификатор запроса конфликтует с уже записанным начислением.",
  PROGRESSION_ADJUST_STATE_CORRUPT:
    "Состояние курса не согласовано — корректировка отклонена, ничего не записано.",
  PROGRESSION_ADJUST_FORBIDDEN: "Недостаточно прав для этой операции.",
};

function refusalText(code: string | null | undefined): string {
  if (!code) return "Корректировка невозможна.";
  return REFUSAL_TEXT[code] ?? "Корректировка невозможна.";
}

type Phase =
  | { kind: "editing" }
  | { kind: "previewing" }
  | { kind: "previewed"; plan: ProgressionPlan }
  | { kind: "applying"; plan: ProgressionPlan }
  | { kind: "applied"; toLevel: number; levels: number[]; xp: number }
  | { kind: "failed"; message: string };

export function ProgressionAdjustDialog({
  userId,
  snapshot,
  onClose,
  onApplied,
}: {
  userId: string;
  snapshot: ProgressionSnapshotEnrolled;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [target, setTarget] = React.useState("");
  const [reasonCode, setReasonCode] = React.useState<ProgressionReasonCode>("preprod_qa");
  const [reasonText, setReasonText] = React.useState("");
  const [referenceId, setReferenceId] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>({ kind: "editing" });

  // One identity per ATTEMPT, reused across retries of that attempt so a
  // double-click replays instead of correcting twice.
  const requestIdRef = React.useRef(newProgressionRequestId());

  // Only levels strictly ahead of the learner can be a forward target.
  const targets = React.useMemo(
    () => snapshot.levels.filter((level) => level.levelNumber > snapshot.currentLevel),
    [snapshot],
  );

  const resetPlan = React.useCallback(() => {
    setPhase({ kind: "editing" });
    requestIdRef.current = newProgressionRequestId();
  }, []);

  const reasonValid =
    reasonText.trim().length >= REASON_TEXT_MIN &&
    reasonText.trim().length <= REASON_TEXT_MAX;

  async function runPreview() {
    if (!target) return;
    setPhase({ kind: "previewing" });
    const outcome = await previewProgression(userId, target);
    if (outcome.status === "success") {
      setPhase({ kind: "previewed", plan: outcome.data });
      return;
    }
    if (outcome.status === "refused") {
      setPhase({ kind: "failed", message: refusalText(outcome.code) });
      return;
    }
    setPhase({
      kind: "failed",
      message:
        outcome.status === "forbidden"
          ? "Недостаточно прав для этой операции."
          : outcome.status === "csrf_unavailable"
            ? "Сессия недоступна — обновите страницу."
            : "Не удалось получить предпросмотр.",
    });
  }

  async function runApply(plan: ProgressionPlan) {
    setPhase({ kind: "applying", plan });
    const outcome = await adjustProgression(userId, {
      targetStableCode: plan.targetStableCode,
      expectedCurrentLevel: plan.fromCurrentLevel,
      expectedCurriculumVersionId: plan.curriculumVersionId,
      reasonCode,
      reasonText: reasonText.trim(),
      referenceId: referenceId.trim() || null,
      requestId: requestIdRef.current,
    });
    if (outcome.status === "success") {
      setPhase({
        kind: "applied",
        toLevel: outcome.data.toCurrentLevel,
        levels: outcome.data.levelsCompleted,
        xp: outcome.data.xpAwarded,
      });
      return;
    }
    if (outcome.status === "refused") {
      setPhase({ kind: "failed", message: refusalText(outcome.code) });
      return;
    }
    setPhase({
      kind: "failed",
      message:
        outcome.status === "forbidden"
          ? "Недостаточно прав для этой операции."
          : outcome.status === "rate_limited"
            ? "Слишком много запросов. Повторите позже."
            : outcome.status === "csrf_unavailable"
              ? "Сессия недоступна — обновите страницу."
              : outcome.status === "invalid_input"
                ? "Проверьте причину и целевой уровень."
                : "Корректировка не выполнена.",
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Корректировка прогресса Академии"
      className="mt-4 rounded-lg border border-border bg-surface-raised p-4"
    >
      <h3 className="text-sm font-semibold text-text-primary">
        Корректировка прогресса Академии
      </h3>
      <p className="mt-1 text-xs text-text-secondary">
        Текущее состояние: пройдено {snapshot.highestCompletedLevel}, текущий уровень L
        {snapshot.currentLevel}. Корректировка выполняется только вперёд.
      </p>

      {phase.kind === "applied" ? (
        <div role="status" aria-live="polite" className="mt-4 space-y-2 text-sm">
          <p className="text-text-primary">
            Готово. Учащийся переведён на L{phase.toLevel}.
          </p>
          <p className="text-xs text-text-secondary">
            Административно завершено уровней: {phase.levels.length} (
            {phase.levels.map((n) => `L${n}`).join(", ")}). Начислено XP: {phase.xp}{" "}
            (источник admin_correction).
          </p>
          <div className="flex justify-end">
            <Button type="button" onClick={onApplied}>
              Закрыть и обновить
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3 text-sm">
            <label className="block">
              <span className="text-xs text-text-muted">Целевой уровень</span>
              <select
                className="mt-1 w-full rounded border border-border bg-surface p-2 text-sm"
                value={target}
                onChange={(event) => {
                  setTarget(event.target.value);
                  resetPlan();
                }}
              >
                <option value="">— выберите уровень —</option>
                {targets.map((level) => (
                  <option key={level.stableCode} value={level.stableCode}>
                    L{level.levelNumber} · {level.title} · {levelTypeLabel(level.type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-text-muted">Категория причины</span>
              <select
                className="mt-1 w-full rounded border border-border bg-surface p-2 text-sm"
                value={reasonCode}
                onChange={(event) =>
                  setReasonCode(event.target.value as ProgressionReasonCode)
                }
              >
                {PROGRESSION_REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {PROGRESSION_REASON_LABEL[code]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-text-muted">
                Причина (обязательно, не менее {REASON_TEXT_MIN} символов)
              </span>
              <textarea
                className="mt-1 w-full rounded border border-border bg-surface p-2 text-sm"
                rows={3}
                maxLength={REASON_TEXT_MAX}
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-xs text-text-muted">Ссылка на кейс (необязательно)</span>
              <input
                className="mt-1 w-full rounded border border-border bg-surface p-2 text-sm"
                value={referenceId}
                maxLength={128}
                onChange={(event) => setReferenceId(event.target.value)}
              />
            </label>
          </div>

          {phase.kind === "previewed" ? (
            <PlanView plan={phase.plan} />
          ) : null}

          {phase.kind === "failed" ? (
            <p
              role="alert"
              className="mt-3 rounded border border-danger-border bg-danger-surface p-2 text-xs text-danger-text"
            >
              {phase.message}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!target || phase.kind === "previewing" || phase.kind === "applying"}
              onClick={runPreview}
            >
              {phase.kind === "previewing" ? "Проверяем…" : "Проверить последствия"}
            </Button>
            {phase.kind === "previewed" && phase.plan.canApply ? (
              <Button
                type="button"
                disabled={!reasonValid}
                onClick={() => runApply(phase.plan)}
              >
                Подтвердить корректировку
              </Button>
            ) : null}
            {phase.kind === "applying" ? (
              <Button type="button" disabled>
                Применяем…
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function PlanView({ plan }: { plan: ProgressionPlan }) {
  return (
    <div className="mt-4 rounded border border-border bg-surface p-3 text-xs">
      <h4 className="mb-2 font-semibold text-text-primary">Последствия</h4>

      {plan.blocker ? (
        <p role="alert" className="mb-2 text-danger-text">
          Невозможно выполнить эту корректировку автоматически. L
          {plan.blocker.levelNumber} — {levelTypeLabel(plan.blocker.type)}. Его
          состояние подтверждается отдельной authority и не может быть выставлено
          административно.
        </p>
      ) : null}

      <dl className="space-y-1">
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Переход</dt>
          <dd className="tabular-nums text-text-primary">
            L{plan.fromCurrentLevel} → L{plan.targetCurrentLevel}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Будет завершено уровней</dt>
          <dd className="tabular-nums text-text-primary">{plan.levels.length}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">XP (admin_correction)</dt>
          <dd className="tabular-nums text-text-primary">+{plan.xpTotal}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Инструменты</dt>
          <dd className="text-text-primary">
            {plan.toolsUnlocked.length === 0 ? "без изменений" : plan.toolsUnlocked.join(", ")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-muted">Community</dt>
          <dd className="text-text-primary">
            {plan.communitySpacesOpened.length === 0
              ? "без изменений"
              : plan.communitySpacesOpened.join(", ")}
          </dd>
        </div>
      </dl>

      {plan.levels.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-text-secondary">
          {plan.levels.map((level) => (
            <li key={level.stableCode}>
              L{level.levelNumber} · {level.title} · {levelTypeLabel(level.type)}
              {level.xpReward > 0 ? ` · +${level.xpReward} XP` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {plan.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-text-muted">
          {plan.warnings.map((warning) => (
            <li key={warning}>• {warning}</li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-text-muted">
        Сохраняется без изменений: отчёты, проверки менторов, контрольные точки и
        история прохождения.
      </p>
    </div>
  );
}
