"use client";

/**
 * The learner's own completion control (G3).
 *
 * WHY IT EXISTS
 * 13 of the canonical practical levels are `lesson:manual`. The Backend has
 * always owned them through `level_completion` and nothing in the Academy could
 * reach that owner, so a learner who finished the exercise had no action at all:
 * the level stayed `in_progress` forever and every later level stayed locked.
 *
 * TWO THINGS A LEARNER CAN DECLARE (2026-10-02)
 * The same Backend owner closes two kinds of level, and the control says which:
 *
 *   practice  `lesson:manual` — a practical step done away from the screen.
 *             The platform cannot witness it and does not pretend to, so the
 *             learner ticks a confirmation AND presses a button; both are
 *             required. Opening the page is not consent to completing a level,
 *             and neither is a single stray click on a page being read.
 *
 *   lesson    `lesson:lesson` — a lesson with no test. There is nothing to
 *             vouch for beyond having gone through it, so it is one named
 *             button and no checkbox: a tick that says «я посмотрел» beside a
 *             button that says the same would be a ceremony, not a safeguard.
 *
 * WHAT IT NEVER DOES
 * It never writes progress itself, never decides XP, never names a learner,
 * never names an enrollment and never sends a status or a completion time. The
 * request body is `{ requestId }`. Everything that decides whether this
 * completion happens — the owner check, the current-level check, the started
 * check, the XP award and the unlock — is the Backend's, unchanged.
 *
 * IDEMPOTENCY IS THE COMPONENT'S JOB TOO. The request identity is generated once
 * per mounted attempt and reused for a retry, so a double click or a lost
 * response replays in the Backend instead of asking a second time.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  completeManualLevel,
  newManualCompletionRequestId,
} from "@/lib/manual-completion/manual-completion-client";
import type { NormalizedError } from "@/lib/api/errors";
import "@/features/manual-completion/level-manual-completion.css";

type Phase = "idle" | "completing" | "completed" | "error";

export type ManualCompletionVariant = "practice" | "lesson";

/**
 * What the learner is told when a completion does not succeed.
 *
 * Every one of these is a fact about THIS page being stale or about the level
 * not being theirs to finish — never an apology for a platform fault the learner
 * cannot act on.
 */
const CODE_NOTE: Record<string, string> = {
  MANUAL_COMPLETION_DISABLED: "Завершение уровня сейчас недоступно.",
  MANUAL_COMPLETION_FORBIDDEN: "Этот уровень нельзя завершить из этого аккаунта.",
  MANUAL_COMPLETION_NOT_ENROLLED: "Уровни станут доступны после зачисления на программу.",
  MANUAL_COMPLETION_LEVEL_NOT_FOUND: "Такого уровня нет в текущей программе.",
  MANUAL_COMPLETION_LEVEL_WRONG_OWNER:
    "Этот уровень завершается иначе — не отметкой о выполнении.",
  MANUAL_COMPLETION_LEVEL_NOT_CURRENT: "Сейчас открыт другой уровень. Обновите страницу.",
  MANUAL_COMPLETION_LEVEL_NOT_STARTED: "Сначала нужно начать уровень.",
  MANUAL_COMPLETION_REQUEST_CONFLICT: "Уровень уже завершён. Обновите страницу.",
  MANUAL_COMPLETION_STATE_CORRUPT: "Состояние программы требует проверки. Обратитесь в поддержку.",
};

/** Fallback when the Backend gave no code of its own (network, proxy, 5xx). */
const CATEGORY_NOTE: Record<string, string> = {
  UNAUTHENTICATED: "Нужно войти в аккаунт, чтобы завершить уровень.",
  FORBIDDEN: "Этот уровень сейчас нельзя завершить.",
  VALIDATION_ERROR: "Уровень не удалось завершить.",
  CONFLICT: "Состояние уровня изменилось. Обновите страницу.",
  RATE_LIMITED: "Слишком много попыток. Подождите немного.",
  NETWORK_ERROR: "Не удалось связаться с сервером. Попробуйте ещё раз.",
  BACKEND_UNAVAILABLE: "Сервер сейчас недоступен. Попробуйте ещё раз позже.",
  MALFORMED_RESPONSE: "Сервер ответил неожиданно. Попробуйте ещё раз.",
  CONFIGURATION_ERROR: "Сервис недоступен.",
};

function noteFor(error: NormalizedError): string {
  const byCode = error.code === null ? undefined : CODE_NOTE[error.code];
  return byCode ?? CATEGORY_NOTE[error.category] ?? "Не удалось завершить уровень. Попробуйте ещё раз.";
}

const COPY: Record<
  ManualCompletionVariant,
  { title: string; explain: string; confirm: string | null; action: string; doneTitle: string }
> = {
  practice: {
    title: "Практическое задание",
    explain:
      "Это практика: задание выполняется самостоятельно по материалу выше. Когда закончите — отметьте выполнение, и уровень будет засчитан.",
    confirm: "Подтверждаю, что выполнил(а) задание этого уровня.",
    action: "Отметить выполнение",
    doneTitle: "Практическое задание",
  },
  lesson: {
    title: "Урок без теста",
    explain:
      "В этом уроке нет теста. Когда изучите материал выше — отметьте урок пройденным, и уровень будет засчитан.",
    confirm: null,
    action: "Отметить урок пройденным",
    doneTitle: "Урок пройден",
  },
};

export function LevelManualCompletion({
  stableCode,
  /** The canonical reward, for the confirmation copy only. Never an input. */
  xpReward,
  alreadyCompleted,
  variant = "practice",
}: {
  stableCode: string;
  xpReward: number;
  alreadyCompleted: boolean;
  variant?: ManualCompletionVariant;
}) {
  const router = useRouter();
  const copy = COPY[variant];
  const needsConfirmation = copy.confirm !== null;
  const [phase, setPhase] = useState<Phase>(alreadyCompleted ? "completed" : "idle");
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Second half of the double-submit guard: a synchronous ref closes the window
  // between two clicks that React state alone would leave open.
  const inFlight = useRef(false);
  // One identity per mounted attempt, REUSED on retry so a retry replays.
  const requestId = useRef<string>(newManualCompletionRequestId());
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (phase === "error") statusRef.current?.focus();
  }, [phase]);

  const ready = !needsConfirmation || confirmed;

  const complete = useCallback(async () => {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setPhase("completing");
    setNote(null);

    const result = await completeManualLevel(stableCode, requestId.current);
    inFlight.current = false;

    if (!result.ok) {
      setNote(noteFor(result.error));
      setPhase("error");
      return;
    }
    setPhase("completed");
    // Completing changes the level's state, the learner's XP and which level is
    // current, so the whole view is re-read from the server rather than patched
    // locally. The Backend remains the only source of what happened.
    router.refresh();
  }, [ready, stableCode, router]);

  if (alreadyCompleted) {
    return (
      <section className="lvl-manual" aria-labelledby="lvl-manual-title" data-phase="completed" data-variant={variant}>
        <h2 id="lvl-manual-title" className="lvl-manual__title">
          {copy.doneTitle}
        </h2>
        <p className="lvl-manual__status" role="status">
          Уровень завершён.
        </p>
      </section>
    );
  }

  return (
    <section className="lvl-manual" aria-labelledby="lvl-manual-title" data-phase={phase} data-variant={variant}>
      <h2 id="lvl-manual-title" className="lvl-manual__title">
        {copy.title}
      </h2>
      <p className="lvl-manual__explain">
        {copy.explain}
        {xpReward > 0 ? ` За уровень начисляется ${xpReward} XP.` : ""}
      </p>

      {copy.confirm !== null ? (
        <label className="lvl-manual__confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={phase === "completing" || phase === "completed"}
          />
          <span>{copy.confirm}</span>
        </label>
      ) : null}

      <button
        type="button"
        className="lvl-manual__action"
        onClick={complete}
        disabled={!ready || phase === "completing" || phase === "completed"}
        aria-busy={phase === "completing"}
      >
        {phase === "completing" ? "Засчитываем…" : copy.action}
      </button>

      {/* A polite live region: this is the answer to the action the learner just
          took. `tabIndex={-1}` makes it a programmatic focus target without
          adding it to the tab order. */}
      <p
        className="lvl-manual__status"
        role="status"
        tabIndex={-1}
        ref={statusRef}
        data-tone={phase === "error" ? "error" : undefined}
      >
        {phase === "completed" ? "Уровень завершён." : (note ?? "")}
      </p>
      {/* A message that sends the learner to support carries the way there
          (2026-10-04, launch audit: support lives under Профиль, and nothing
          said so). */}
      {phase === "error" && note && /поддержк/i.test(note) ? (
        <p className="lvl-support-link">
          <Link href="/profile/support">Написать в поддержку</Link>
        </p>
      ) : null}
    </section>
  );
}
