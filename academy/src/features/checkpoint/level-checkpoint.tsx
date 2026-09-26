"use client";

/**
 * Backend-driven financial checkpoint (L4HG-1 honest gate, L4VC-1 verification).
 *
 * The Backend decides whether the condition can be verified at all, and what
 * the answer is. This screen renders that decision and offers — at most — one
 * control to ask the question.
 *
 * WHAT IT SHOWS
 *   - the canonical target from the curriculum («Баланс Pocket от $50»);
 *   - what passing it opens (rank / community channel — L4 opens no tool);
 *   - the honest current state, including "we cannot look right now";
 *   - one verification control, only when the Backend says the learner may ask.
 *
 * WHAT IT NEVER SHOWS OR OFFERS (DD-020…DD-024, STATE_MATRIX §2)
 *   the learner's balance · «осталось $X» · a progress bar toward money ·
 *   a Pocket link or CTA · deposit-encouraging copy · a balance input ·
 *   an upload · a mentor-review request · a spinner that never resolves ·
 *   a verify button while verification is unavailable.
 *
 * THE COMPONENT HOLDS NO AMOUNT. Neither its props nor its state has a field an
 * amount could occupy, so no render path can display one even by mistake.
 *
 * COPY NOTE — a deliberate, documented deviation, unchanged from L4HG-1. The
 * canonical «Data unavailable» line promises a retry that is happening. While
 * no provider is configured no check is running and none is scheduled, so the
 * state is described truthfully instead. The canonical line returns when a real
 * provider answers.
 */
import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";
import type { AcademyCheckpointState } from "@/lib/curriculum/academy-view";
import { buildCheckpointInfo } from "@/features/lessons-library/model/lessons-library-model";
import { CheckpointGate } from "@/components/progression/checkpoint-gate";
import {
  canSubmit,
  initialState,
  reducer,
  type CheckpointPhase,
} from "@/features/checkpoint/checkpoint-machine";
import { newCheckpointRequestId, verifyCheckpoint } from "@/lib/checkpoint/checkpoint-client";
import "@/features/checkpoint/level-checkpoint.css";

/**
 * The status line per screen. Every one is about the CHECK, never about the
 * learner's money — including `not_met`, which says the condition is not met
 * without saying by how much.
 */
const STATUS: Record<CheckpointPhase, string> = {
  disabled: "Проверка условия сейчас недоступна.",
  provider_unavailable: "Проверка условия сейчас недоступна.",
  identity_unlinked: "Счёт для проверки не привязан.",
  identity_mismatch: "Привязанный счёт не совпадает с аккаунтом Академии.",
  unsupported_currency: "Валюта счёта не поддерживается для этой проверки.",
  ready: "Условие можно проверить.",
  checking: "Проверяем условие…",
  cooldown: "Повторная проверка будет доступна чуть позже.",
  not_met: "Условие пока не выполнено.",
  completed: "Условие выполнено. Контрольная точка пройдена.",
  error: "Не удалось выполнить проверку.",
};

/** The explanation under the status line. Operational, never financial. */
const EXPLAIN: Record<CheckpointPhase, string> = {
  disabled: "Автоматическая проверка контрольной точки пока не подключена.",
  provider_unavailable:
    "Сервис проверки сейчас не отвечает. Это не связано с твоим результатом — попробуй позже.",
  identity_unlinked:
    "Чтобы проверить условие, счёт должен быть привязан к аккаунту Академии.",
  identity_mismatch:
    "Проверка возможна только по счёту, привязанному к этому аккаунту.",
  unsupported_currency:
    "Условие задано в долларах США, и валюту этого счёта сравнить с ним нельзя.",
  ready: "Учитывается только подтверждённый реальный счёт. Demo не учитывается.",
  checking: "Это занимает несколько секунд.",
  cooldown: "Между проверками нужен небольшой перерыв.",
  not_met: "Проверка прошла, но условие ещё не выполнено. Можно проверить снова позже.",
  completed: "Следующий модуль пути открыт.",
  error: "Проверка не была выполнена. Попробуй ещё раз.",
};

/** Screens on which the gate stays shut for an operational reason. */
const BLOCKED_PHASES = new Set<CheckpointPhase>([
  "disabled",
  "provider_unavailable",
  "identity_unlinked",
  "identity_mismatch",
  "unsupported_currency",
]);

export function LevelCheckpoint({
  levelNumber,
  stableCode,
  checkpoint,
}: {
  levelNumber: number;
  /** The Backend stable code — the verification route's only path input. */
  stableCode: string;
  checkpoint: AcademyCheckpointState;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, checkpoint, initialState);
  // Second half of the double-submit guard: a synchronous ref closes the window
  // between two clicks that React state alone would leave open.
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  // Canonical target and rewards, from the same curriculum fixture the library
  // reads. Null when the level carries no checkpoint — rendered as absence
  // rather than as a placeholder amount.
  const info = buildCheckpointInfo(levelNumber);

  const counting = state.retryAfterSeconds !== null;

  // Countdown. Drives only the displayed wait and the moment the control
  // reopens; it never re-asks on the learner's behalf.
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1_000);
    return () => clearInterval(timer);
  }, [counting]);

  // Move focus to the answer once a verification settles, so a keyboard or
  // screen-reader user is taken to the result rather than left on a button.
  useEffect(() => {
    if (state.phase === "completed" || state.phase === "not_met" || state.phase === "error") {
      statusRef.current?.focus();
    }
  }, [state.phase]);

  // A server-confirmed pass changes the whole curriculum, so re-read it from
  // the server rather than patching anything locally.
  useEffect(() => {
    if (state.completed) router.refresh();
  }, [state.completed, router]);

  const submit = useCallback(async () => {
    if (inFlight.current) return;
    if (!canSubmit(state, checkpoint)) return;
    inFlight.current = true;
    // One stable identity per attempt. A retry of THIS attempt reuses it, so
    // the Backend replays instead of spending another hourly attempt.
    const requestId = state.requestId ?? newCheckpointRequestId();
    dispatch({ type: "verify_pending", requestId });
    const result = await verifyCheckpoint(stableCode, requestId);
    inFlight.current = false;
    if (result.ok) dispatch({ type: "verify_ok", result: result.data });
    else dispatch({ type: "verify_err", error: result.error });
  }, [state, checkpoint, stableCode]);

  const submittable = canSubmit(state, checkpoint);
  const waiting = state.retryAfterSeconds !== null && state.retryAfterSeconds > 0;

  return (
    <section
      className="cp-gate"
      aria-labelledby="cp-gate-title"
      data-verification={state.phase}
    >
      <h2 id="cp-gate-title" className="cp-gate__title">
        Контрольная точка
      </h2>

      <div className="cp-gate__body">
        <div className="cp-gate__near">
          {info ? (
            <>
              <p className="cp-gate__condition">
                Условие: <b>{info.requirement}</b>
              </p>
              <p className="cp-gate__note">
                Учитывается только подтверждённый реальный баланс. Demo не учитывается.
              </p>
            </>
          ) : (
            <p className="cp-gate__note">Условие этой контрольной точки не задано в программе.</p>
          )}

          {/* The honest state. A polite live region because it is the answer to
              the action the learner came here to take. `tabIndex={-1}` makes it
              a programmatic focus target without adding it to the tab order. */}
          <p className="cp-gate__status" role="status" tabIndex={-1} ref={statusRef}>
            {STATUS[state.phase]}
          </p>
          <p className="cp-gate__explain">
            {EXPLAIN[state.phase]}
            {BLOCKED_PHASES.has(state.phase)
              ? " Пока проверка недоступна, следующий модуль не открывается."
              : ""}
          </p>

          {/* NOT a live region. It updates every second, and announcing that
              on each tick would flood a screen reader; the status line above
              already announces the state change this detail belongs to. */}
          {waiting ? (
            <p className="cp-gate__wait">
              {`Повторная проверка через ${state.retryAfterSeconds} с.`}
            </p>
          ) : null}

          {/* Exactly one control, and only when the Backend permits it. While
              verification is unavailable there is no button at all — not even a
              disabled one, which would imply the platform could look if pressed. */}
          {checkpoint.canVerify && state.phase !== "completed" ? (
            <button
              type="button"
              className="cp-gate__verify"
              onClick={submit}
              disabled={!submittable}
              aria-busy={state.phase === "checking"}
            >
              {state.phase === "checking" ? "Проверяем…" : "Проверить условие"}
            </button>
          ) : null}

          <p className="cp-gate__saved">
            Прогресс сохранён: пройденные уровни и материалы остаются доступными.
          </p>
        </div>

        <CheckpointGate />

        {info && info.rewards.length > 0 ? (
          <div className="cp-gate__far">
            <p className="cp-gate__far-label">За границей · что откроется</p>
            <ul className="cp-gate__rewards">
              {info.rewards.map((reward) => (
                <li key={reward}>{reward}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
