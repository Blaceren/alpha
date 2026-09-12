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
  LEVEL_START_NOT_CURRENT: "Сейчас открыт другой уровень. Обнови страницу.",
  LEVEL_START_LEVEL_NOT_FOUND: "Такого уровня нет в текущей программе.",
  LEVEL_START_NO_ACTIVE_ENROLLMENT: "Уровни станут доступны после зачисления на программу.",
  LEVEL_START_ENROLLMENT_COMPLETED: "Программа уже завершена.",
  LEVEL_START_CHECKPOINT_UNVERIFIED: "Контрольную точку нельзя начать — её проверяет сервис.",
  LEVEL_START_NOT_AVAILABLE: "Уровень сейчас нельзя начать.",
  LEVEL_STATE_CORRUPT: "Состояние программы требует проверки. Обратись в поддержку.",
};

/** Fallback when the Backend gave no code of its own (network, proxy, 5xx). */
const CATEGORY_NOTE: Record<string, string> = {
  UNAUTHENTICATED: "Нужно войти в аккаунт, чтобы начать уровень.",
  FORBIDDEN: "Этот уровень сейчас недоступен.",
  VALIDATION_ERROR: "Уровень не удалось открыть.",
  CONFLICT: "Состояние уровня изменилось. Обнови страницу.",
  RATE_LIMITED: "Слишком много попыток. Подожди немного.",
  NETWORK_ERROR: "Не удалось связаться с сервером. Попробуй ещё раз.",
  BACKEND_UNAVAILABLE: "Сервер сейчас недоступен. Попробуй ещё раз позже.",
  MALFORMED_RESPONSE: "Сервер ответил неожиданно. Попробуй ещё раз.",
  CONFIGURATION_ERROR: "Сервис недоступен.",
};

function noteFor(error: NormalizedError): string {
  // The Backend's own code is preferred: it distinguishes "still locked" from
  // "already finished" from "your page is stale", which a status code alone
  // cannot. It is a closed vocabulary and carries nothing identifying.
  const byCode = error.code === null ? undefined : CODE_NOTE[error.code];
  return byCode ?? CATEGORY_NOTE[error.category] ?? "Не удалось начать уровень. Попробуй ещё раз.";
}

export function LevelStart({ stableCode }: { stableCode: string }) {
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
        Начать уровень
      </h2>
      <p className="lvl-start__explain">
        Уровень откроется, и станут доступны материал и проверка. Прогресс сохраняется на сервере.
      </p>

      <button
        type="button"
        className="lvl-start__action"
        onClick={start}
        disabled={phase === "starting" || phase === "started"}
        aria-busy={phase === "starting"}
      >
        {phase === "starting" ? "Открываем…" : "Начать"}
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
