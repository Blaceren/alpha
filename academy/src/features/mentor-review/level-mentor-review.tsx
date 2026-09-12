"use client";

/**
 * The mentor-review control (G3).
 *
 * WHY IT EXISTS
 * 7 canonical practical levels are `mentor_review:mentor_review`. The Backend
 * has always owned both halves of the lifecycle and nothing in the Academy could
 * reach the learner half, so those levels could never leave `in_progress` — the
 * learner could not submit, and no reviewer ever had anything to approve.
 *
 * THE THREE STATES THIS RENDERS, AND ONLY THESE
 *   in_progress    — the learner may submit
 *   pending_review — submitted; a person has to look at it
 *   completed      — a reviewer approved it
 *
 * WHAT THE LEARNER CANNOT DO HERE
 * Approve their own level, name a reviewer, attach an artifact, send a comment
 * or a score, or reopen a level a reviewer already approved. None of those has a
 * control, because none of them has a canonical contract: a mentor-review level
 * carries no report and no rubric, so the submission IS the transition and
 * nothing else. The Backend refuses each of them independently.
 *
 * WHY SUBMITTING IS CONFIRMED
 * `in_progress -> pending_review` is one-way. The learner cannot take it back,
 * and while it is pending their own commands can no longer act on the level. A
 * single stray click should not be able to do that, so the learner confirms.
 *
 * NO REVISION OR REJECTION IS SHOWN — because none exists. The canonical
 * lifecycle has exactly two transitions and approval is the only exit. Rendering
 * a "returned for revision" state would promise a workflow the platform does not
 * have.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestMentorReview } from "@/lib/mentor-review/mentor-review-client";
import type { AcademyLevelState } from "@/lib/curriculum/progress-state";
import type { NormalizedError } from "@/lib/api/errors";
import "@/features/mentor-review/level-mentor-review.css";

type Phase = "idle" | "submitting" | "pending" | "error";

const CODE_NOTE: Record<string, string> = {
  MENTOR_REVIEW_DISABLED: "Отправка на проверку сейчас недоступна.",
  MENTOR_REVIEW_FORBIDDEN: "Этот уровень нельзя отправить из этого аккаунта.",
  MENTOR_REVIEW_NOT_ENROLLED: "Уровни станут доступны после зачисления на программу.",
  MENTOR_REVIEW_LEVEL_NOT_FOUND: "Такого уровня нет в текущей программе.",
  MENTOR_REVIEW_LEVEL_WRONG_OWNER: "Этот уровень проверяется иначе.",
  MENTOR_REVIEW_LEVEL_NOT_CURRENT: "Сейчас открыт другой уровень. Обнови страницу.",
  MENTOR_REVIEW_LEVEL_NOT_STARTED: "Сначала нужно начать уровень.",
  MENTOR_REVIEW_CONFLICT: "Состояние уровня изменилось. Обнови страницу.",
  MENTOR_REVIEW_STATE_CORRUPT: "Состояние программы требует проверки. Обратись в поддержку.",
};

const CATEGORY_NOTE: Record<string, string> = {
  UNAUTHENTICATED: "Нужно войти в аккаунт, чтобы отправить работу на проверку.",
  FORBIDDEN: "Этот уровень сейчас нельзя отправить на проверку.",
  VALIDATION_ERROR: "Не удалось отправить работу на проверку.",
  CONFLICT: "Состояние уровня изменилось. Обнови страницу.",
  RATE_LIMITED: "Слишком много попыток. Подожди немного.",
  NETWORK_ERROR: "Не удалось связаться с сервером. Попробуй ещё раз.",
  BACKEND_UNAVAILABLE: "Сервер сейчас недоступен. Попробуй ещё раз позже.",
  MALFORMED_RESPONSE: "Сервер ответил неожиданно. Попробуй ещё раз.",
  CONFIGURATION_ERROR: "Сервис недоступен.",
};

function noteFor(error: NormalizedError): string {
  const byCode = error.code === null ? undefined : CODE_NOTE[error.code];
  return byCode ?? CATEGORY_NOTE[error.category] ?? "Не удалось отправить работу на проверку.";
}

export function LevelMentorReview({
  stableCode,
  xpReward,
  /**
   * The Backend's state for this level, already mapped by the view model.
   *
   * Taken as the shipped `AcademyLevelState` rather than a bespoke union, so
   * this component cannot disagree with the rest of the page about what state a
   * level is in. `pending_review` and `completed` are the two that change what
   * is rendered; everything else shows the submit surface, and the Backend
   * refuses if the level is not actually the learner's current started one.
   */
  levelState,
}: {
  stableCode: string;
  xpReward: number;
  levelState: AcademyLevelState;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(levelState === "pending_review" ? "pending" : "idle");
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (phase === "error") statusRef.current?.focus();
  }, [phase]);

  const submit = useCallback(async () => {
    if (inFlight.current || !confirmed) return;
    inFlight.current = true;
    setPhase("submitting");
    setNote(null);

    const result = await requestMentorReview(stableCode);
    inFlight.current = false;

    if (!result.ok) {
      setNote(noteFor(result.error));
      setPhase("error");
      return;
    }
    setPhase("pending");
    router.refresh();
  }, [confirmed, stableCode, router]);

  if (levelState === "completed") {
    return (
      <section className="lvl-mentor" aria-labelledby="lvl-mentor-title" data-phase="completed">
        <h2 id="lvl-mentor-title" className="lvl-mentor__title">
          Проверка ментором
        </h2>
        <p className="lvl-mentor__status" role="status">
          Работа принята ментором. Уровень завершён.
        </p>
      </section>
    );
  }

  if (phase === "pending" || levelState === "pending_review") {
    return (
      <section className="lvl-mentor" aria-labelledby="lvl-mentor-title" data-phase="pending">
        <h2 id="lvl-mentor-title" className="lvl-mentor__title">
          Проверка ментором
        </h2>
        <p className="lvl-mentor__pending" role="status">
          Работа отправлена и ждёт ментора. Уровень будет засчитан после того, как ментор её
          примет — отдельных действий от тебя больше не требуется.
        </p>
      </section>
    );
  }

  return (
    <section className="lvl-mentor" aria-labelledby="lvl-mentor-title" data-phase={phase}>
      <h2 id="lvl-mentor-title" className="lvl-mentor__title">
        Проверка ментором
      </h2>
      <p className="lvl-mentor__explain">
        Это практика с проверкой ментором: задание выполняется самостоятельно по материалу выше.
        Когда закончишь — отправь работу на проверку. Уровень засчитывает ментор.
        {xpReward > 0 ? ` За уровень начисляется ${xpReward} XP.` : ""}
      </p>

      <label className="lvl-mentor__confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={phase === "submitting"}
        />
        <span>
          Подтверждаю, что выполнил(а) задание и готов(а) отправить его на проверку. Отменить
          отправку нельзя.
        </span>
      </label>

      <button
        type="button"
        className="lvl-mentor__action"
        onClick={submit}
        disabled={!confirmed || phase === "submitting"}
        aria-busy={phase === "submitting"}
      >
        {phase === "submitting" ? "Отправляем…" : "Отправить на проверку"}
      </button>

      <p
        className="lvl-mentor__status"
        role="status"
        tabIndex={-1}
        ref={statusRef}
        data-tone={phase === "error" ? "error" : undefined}
      >
        {note ?? ""}
      </p>
    </section>
  );
}
