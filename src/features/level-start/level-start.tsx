"use client";

/**
 * The level start control (L2START-PLAYER-1).
 *
 * WHY IT EXISTS
 * A learner who reached an `available` level had no way to enter it. The
 * Backend owns the `available -> in_progress` transition and now exposes it;
 * this is the one control that asks for it. Before this, the lesson page showed
 * an available level with no action on it at all, and the assessment below
 * refused to start because the level never had.
 *
 * WHY IT IS AN EXPLICIT ACTION AND NOT AN EFFECT OF OPENING THE PAGE
 * Starting a level is a durable, audited transition on the learner's record.
 * Opening a page is not consent to that, and a GET that silently mutates
 * progress would mean a link preview or a back-button could start a level. So
 * the learner presses something, and sees that they did.
 *
 * WHAT IT NEVER DOES
 * It never writes progress itself, never completes a level, never grants XP,
 * never names a learner, and never sends a target status. There is no field in
 * the request at all — the Backend takes the actor from the session.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startLevel } from "@/lib/level-start/level-start-client";
import type { NormalizedError } from "@/lib/api/errors";
import "@/features/level-start/level-start.css";

type Phase = "idle" | "starting" | "started" | "error";

/**
 * What the learner is told when a start does not succeed.
 *
 * `LEVEL_START_LOCKED` and `LEVEL_START_ALREADY_COMPLETED` are not failures of
 * the platform — they mean this page is describing a level the learner has since
 * moved past or has not reached. The honest response is to say so and reload,
 * not to offer the button again.
 */
const CODE_NOTE: Record<string, string> = {
  LEVEL_START_LOCKED: "Этот уровень ещё закрыт. Сначала нужно пройти предыдущие.",
  LEVEL_START_ALREADY_COMPLETED: "Этот уровень уже пройден.",
  LEVEL_START_NOT_CURRENT: "Сейчас открыт другой уровень. Обновите страницу.",
  LEVEL_START_LEVEL_NOT_FOUND: "Такого уровня нет в текущей программе.",
  LEVEL_START_NO_ACTIVE_ENROLLMENT: "Уровни станут доступны после зачисления на программу.",
  LEVEL_START_ENROLLMENT_COMPLETED: "Программа уже завершена.",
  LEVEL_START_CHECKPOINT_UNVERIFIED: "Контрольную точку нельзя начать — её проверяет сервис.",
  LEVEL_START_NOT_AVAILABLE: "Уровень сейчас нельзя начать.",
  LEVEL_STATE_CORRUPT: "Состояние программы требует проверки. Обратитесь в поддержку.",
};

/** Fallback when the Backend gave no code of its own (network, proxy, 5xx). */
const CATEGORY_NOTE: Record<string, string> = {
  UNAUTHENTICATED: "Нужно войти в аккаунт, чтобы начать уровень.",
  FORBIDDEN: "Этот уровень сейчас недоступен.",
  VALIDATION_ERROR: "Уровень не удалось открыть.",
  CONFLICT: "Состояние уровня изменилось. Обновите страницу.",
  RATE_LIMITED: "Слишком много попыток. Подождите немного.",
  NETWORK_ERROR: "Не удалось связаться с сервером. Попробуйте ещё раз.",
  BACKEND_UNAVAILABLE: "Сервер сейчас недоступен. Попробуйте ещё раз позже.",
  MALFORMED_RESPONSE: "Сервер ответил неожиданно. Попробуйте ещё раз.",
  CONFIGURATION_ERROR: "Сервис недоступен.",
};

function noteFor(error: NormalizedError): string {
  // The Backend's own code is preferred: it distinguishes "still locked" from
  // "already finished" from "your page is stale", which a status code alone
  // cannot. It is a closed vocabulary and carries nothing identifying.
  const byCode = error.code === null ? undefined : CODE_NOTE[error.code];
  return byCode ?? CATEGORY_NOTE[error.category] ?? "Не удалось начать уровень. Попробуйте ещё раз.";
}

/**
 * The words around the one control, by what the level IS (2026-10-02).
 *
 * The control and what it does are the same for every level. What a learner is
 * about to begin is not: «станут доступны материал и проверка» was written for
 * a text lesson with a test, and told a learner on a lesson WITHOUT a test, on a
 * report and on a practical level to expect a check that is not there. The page
 * knows the level's completion method and passes the sentence that is true.
 */
export type LevelStartCopy = {
  title: string;
  explain: string;
  action: string;
};

const DEFAULT_COPY: LevelStartCopy = {
  title: "Начать уровень",
  explain: "Уровень откроется, и станут доступны материал и проверка. Прогресс сохраняется на сервере.",
  action: "Начать",
};

export function LevelStart({ stableCode, copy = DEFAULT_COPY }: { stableCode: string; copy?: LevelStartCopy }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string | null>(null);
  // Second half of the double-submit guard: a synchronous ref closes the window
  // between two clicks that React state alone would leave open.
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (phase === "error") statusRef.current?.focus();
  }, [phase]);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("starting");
    setNote(null);

    const result = await startLevel(stableCode);
    inFlight.current = false;

    if (!result.ok) {
      setNote(noteFor(result.error));
      setPhase("error");
      return;
    }
    setPhase("started");
    // Starting changes the level's state, what the page may show and whether the
    // assessment below can run, so the whole view is re-read from the server
    // rather than patched locally.
    router.refresh();
  }, [stableCode, router]);

  return (
    <section className="lvl-start" aria-labelledby="lvl-start-title" data-phase={phase}>
      <h2 id="lvl-start-title" className="lvl-start__title">
        {copy.title}
      </h2>
      <p className="lvl-start__explain">{copy.explain}</p>

      <button
        type="button"
        className="lvl-start__action"
        onClick={start}
        disabled={phase === "starting" || phase === "started"}
        aria-busy={phase === "starting"}
      >
        {phase === "starting" ? "Открываем…" : copy.action}
      </button>

      {/* A polite live region: this is the answer to the action the learner just
          took. `tabIndex={-1}` makes it a programmatic focus target without
          adding it to the tab order. */}
      <p
        className="lvl-start__status"
        role="status"
        tabIndex={-1}
        ref={statusRef}
        data-tone={phase === "error" ? "error" : undefined}
      >
        {phase === "started" ? "Уровень открыт." : (note ?? "")}
      </p>
    </section>
  );
}
