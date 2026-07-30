"use client";

/**
 * The Level 1 Pocket registration action (POCKETCTA-1).
 *
 * WHY IT EXISTS
 * Level 1 is `external_event:pocket_postback`: the learner completes it by
 * registering with Pocket, and an authenticated postback is the only witness ATA
 * trusts. The Backend has owned that chain for several phases, but the learner
 * had no way to reach the affiliate link through the public Academy — the level
 * page stated a requirement and offered no action, which made Level 1 a dead
 * end. This is that action, and nothing more.
 *
 * WHAT IT NEVER DOES
 * It never completes the level, never writes progress, never grants XP, never
 * binds a Pocket identity, and never infers success from the fact that the
 * external page opened. Opening a registration page is not registering. The
 * postback remains the only thing that can complete Level 1, so the requirement
 * stays visible until the server says otherwise.
 *
 * WHY RE-CHECKING IS A BUTTON AND NOT A POLL
 * A learner comes back from Pocket wanting to know whether it worked. Continuous
 * polling would put an unbounded load on the Backend for an event that arrives
 * once, at a time nobody here can predict. So the learner asks, and the answer
 * comes from the authoritative server render. One revalidation also fires when
 * they return to this tab, which is the moment the answer is most likely to have
 * changed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestReferralLink } from "@/lib/pocket-registration/referral-link-client";
import type { NormalizedError } from "@/lib/api/errors";
import "@/features/pocket-registration/pocket-registration.css";

type Phase = "idle" | "loading" | "opened" | "error";

const CATEGORY_NOTE: Record<string, string> = {
  UNAUTHENTICATED: "Нужно войти в аккаунт, чтобы получить ссылку.",
  FORBIDDEN: "Ссылка сейчас недоступна.",
  VALIDATION_ERROR: "Ссылку не удалось получить.",
  RATE_LIMITED: "Слишком много попыток. Подожди немного.",
  NETWORK_ERROR: "Не удалось связаться с сервером. Попробуй ещё раз.",
  BACKEND_UNAVAILABLE: "Сервер сейчас недоступен. Попробуй ещё раз позже.",
  MALFORMED_RESPONSE: "Сервер ответил неожиданно. Попробуй ещё раз.",
  CONFIGURATION_ERROR: "Регистрация в Pocket сейчас недоступна.",
};

function noteFor(error: NormalizedError): string {
  return CATEGORY_NOTE[error.category] ?? "Не удалось получить ссылку. Попробуй ещё раз.";
}

export function PocketRegistration() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Synchronous guards: a ref closes the window between two fast clicks that
  // React state alone would leave open.
  const inFlight = useRef(false);
  const checkInFlight = useRef(false);
  // Focus revalidation is armed only once the learner has actually left for
  // Pocket. Before that there is nothing new to find.
  const armed = useRef(false);
  const lastRevalidate = useRef(0);
  const statusRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (phase === "error") statusRef.current?.focus();
  }, [phase]);

  const revalidate = useCallback(() => {
    // The authoritative answer is the server render of this level, so the view is
    // re-read rather than patched locally. Nothing is written.
    router.refresh();
  }, [router]);

  useEffect(() => {
    // `focus` and `visibilitychange` both fire for one return to the tab, so a
    // short window collapses them into a single revalidation per return event.
    const onReturn = () => {
      if (!armed.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastRevalidate.current < 1000) return;
      lastRevalidate.current = now;
      revalidate();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [revalidate]);

  const openRegistration = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("loading");
    setNote(null);

    const result = await requestReferralLink();
    inFlight.current = false;

    if (!result.ok) {
      setNote(noteFor(result.error));
      setPhase("error");
      return;
    }

    // `noopener,noreferrer` severs the opened page from this one: without
    // `noopener` the affiliate page gets a live `window.opener` handle back into
    // the learner's Academy session.
    window.open(result.url, "_blank", "noopener,noreferrer");
    armed.current = true;
    setPhase("opened");
  }, []);

  const recheck = useCallback(() => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setChecking(true);
    lastRevalidate.current = Date.now();
    revalidate();
    // The refresh is a server round trip with no completion callback here, so the
    // control is released after a bounded moment rather than left disabled.
    window.setTimeout(() => {
      checkInFlight.current = false;
      setChecking(false);
      setNote("Регистрация пока не подтверждена. Проверь ещё раз чуть позже.");
    }, 1200);
  }, [revalidate]);

  return (
    <section className="pocket-reg" aria-labelledby="pocket-reg-title" data-phase={phase}>
      <h2 id="pocket-reg-title" className="pocket-reg__title">
        Регистрация в Pocket
      </h2>
      <p className="pocket-reg__explain">
        Чтобы пройти этот уровень, зарегистрируйся в Pocket по ссылке ниже. Уровень
        закроется автоматически, когда Pocket подтвердит регистрацию — вручную это
        отметить нельзя.
      </p>

      <div className="pocket-reg__actions">
        <button
          type="button"
          className="pocket-reg__action"
          onClick={openRegistration}
          disabled={phase === "loading"}
          aria-busy={phase === "loading"}
        >
          {phase === "loading" ? "Готовим ссылку…" : "Зарегистрироваться в Pocket"}
        </button>

        <button
          type="button"
          className="pocket-reg__recheck"
          onClick={recheck}
          disabled={checking}
          aria-busy={checking}
        >
          {checking ? "Проверяем…" : "Проверить регистрацию"}
        </button>
      </div>

      <p
        className="pocket-reg__status"
        role="status"
        tabIndex={-1}
        ref={statusRef}
        data-tone={phase === "error" ? "error" : undefined}
      >
        {phase === "opened" && note === null
          ? "Страница Pocket открыта в новой вкладке. Вернись сюда после регистрации и нажми «Проверить регистрацию»."
          : (note ?? "")}
      </p>
    </section>
  );
}
