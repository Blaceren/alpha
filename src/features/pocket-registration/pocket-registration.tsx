"use client";

/**
 * The Pocket registration action of the registration level (POCKETCTA-1).
 *
 * WHY IT EXISTS
 * One level of a program is `external_event:pocket_postback`: the learner
 * completes it by registering with Pocket, and an authenticated postback is the
 * only witness ATA trusts. The Backend has owned that chain for several phases,
 * but the learner had no way to reach the affiliate link through the public
 * Academy — the level page stated a requirement and offered no action, which
 * made the level a dead end. This is that action, and nothing more.
 *
 * WHAT IT NEVER DOES
 * It never completes the level, never writes progress, never grants XP, never
 * binds a Pocket identity, and never infers success from the fact that the
 * external page opened. Opening a registration page is not registering. The
 * postback remains the only thing that can complete the level, so the
 * requirement stays visible until the server says otherwise.
 *
 * THE CHECK IS THE BACKEND'S OWN RECORD (2026-10-02)
 * The registration level was the first of the 100-level program and is the
 * third of the 30-level one, so a learner may register with Pocket while still
 * on a lesson in front of it. The postback then binds the identity and
 * completes nothing — the level was not theirs yet. Re-reading the page could
 * never settle that: the fact is there and nobody acts on it. So «Проверить
 * регистрацию» now asks the Backend to look at its own authenticated record and
 * complete the level if the registration is already a fact, and the same
 * question is asked once when the learner arrives. The request has no body and
 * asserts nothing; a learner who has not registered gets «пока не
 * подтверждена» and nothing is written.
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  checkPocketRegistration,
  requestReferralLink,
} from "@/lib/pocket-registration/referral-link-client";
import type { NormalizedError } from "@/lib/api/errors";
import "@/features/pocket-registration/pocket-registration.css";

type Phase = "idle" | "loading" | "opened" | "error";

const CATEGORY_NOTE: Record<string, string> = {
  UNAUTHENTICATED: "Нужно войти в аккаунт, чтобы получить ссылку.",
  FORBIDDEN: "Ссылка сейчас недоступна.",
  VALIDATION_ERROR: "Ссылку не удалось получить.",
  RATE_LIMITED: "Слишком много попыток. Подождите немного.",
  NETWORK_ERROR: "Не удалось связаться с сервером. Попробуйте ещё раз.",
  BACKEND_UNAVAILABLE: "Сервер сейчас недоступен. Попробуйте ещё раз позже.",
  MALFORMED_RESPONSE: "Сервер ответил неожиданно. Попробуйте ещё раз.",
  CONFIGURATION_ERROR: "Регистрация в Pocket сейчас недоступна.",
};

const PENDING_NOTE = "Регистрация пока не подтверждена. Проверьте ещё раз чуть позже.";
const CONFIRMED_NOTE = "Регистрация подтверждена. Обновляем уровень…";
const CHECK_FAILED_NOTE = "Не удалось проверить регистрацию. Попробуйте ещё раз.";

/** The same categories, said about a check rather than about a link. */
function noteForCheck(error: NormalizedError): string {
  switch (error.category) {
    case "UNAUTHENTICATED":
      return "Нужно войти в аккаунт, чтобы проверить регистрацию.";
    case "RATE_LIMITED":
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
    case "MALFORMED_RESPONSE":
      return CATEGORY_NOTE[error.category] as string;
    default:
      return CHECK_FAILED_NOTE;
  }
}

function noteFor(error: NormalizedError): string {
  return CATEGORY_NOTE[error.category] ?? "Не удалось получить ссылку. Попробуйте ещё раз.";
}


export function PocketRegistration() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  /** The registration address, once the Backend has issued it — kept as a real link. */
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
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
  // The arrival check runs once per mount, also under React's double-invoked
  // development effects.
  const arrivalChecked = useRef(false);

  useEffect(() => {
    if (phase === "error") statusRef.current?.focus();
  }, [phase]);

  const revalidate = useCallback(() => {
    // The authoritative answer is the server render of this level, so the view is
    // re-read rather than patched locally. Nothing is written.
    router.refresh();
  }, [router]);

  useEffect(() => {
    // ON ARRIVAL: has Pocket already confirmed this learner? If the level
    // completes, the page is re-read and this component is replaced by the
    // confirmation. Any other answer — not registered yet, a failed request —
    // changes nothing on screen: the learner asked nothing, so nothing is said.
    if (arrivalChecked.current) return;
    arrivalChecked.current = true;
    let cancelled = false;
    void checkPocketRegistration().then((result) => {
      if (!cancelled && result.ok && result.levelCompleted) revalidate();
    });
    return () => {
      cancelled = true;
    };
  }, [revalidate]);

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
    //
    // THE TAB MAY NOT OPEN (2026-10-04, launch audit). It opens after two
    // awaited requests, outside the click, and a popup blocker — Safari on a
    // phone above all — may stop it; with `noopener` this page cannot even tell.
    // So the address is also kept and shown as a real link, which is a click of
    // the learner's own and always opens.
    window.open(result.url, "_blank", "noopener,noreferrer");
    setOpenedUrl(result.url);
    armed.current = true;
    setPhase("opened");
  }, []);

  const recheck = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setChecking(true);
    setNote(null);
    lastRevalidate.current = Date.now();

    const result = await checkPocketRegistration();

    // The authoritative answer is still the server render of this level: it is
    // re-read whatever the check said, because the postback may have completed
    // the level on its own between the two.
    revalidate();
    checkInFlight.current = false;
    setChecking(false);
    if (!result.ok) {
      setNote(noteForCheck(result.error));
      return;
    }
    // A completed level replaces this component on the re-read; until then the
    // line says what the Backend said.
    setNote(result.confirmed ? CONFIRMED_NOTE : PENDING_NOTE);
  }, [revalidate]);

  return (
    <section className="pocket-reg" aria-labelledby="pocket-reg-title" data-phase={phase}>
      <h2 id="pocket-reg-title" className="pocket-reg__title">
        Регистрация в Pocket
      </h2>
      <p className="pocket-reg__explain">
        Чтобы пройти этот уровень, зарегистрируйтесь в Pocket по ссылке ниже. Уровень
        завершится автоматически, когда Pocket подтвердит регистрацию — вручную это
        отметить нельзя.
      </p>
      {/* THE INSTRUCTION THE HOME PROMISES (2026-10-04, launch audit). The Home's
          card for this level says «там есть ссылка и инструкция»; there was a
          link and one sentence. Three steps of what actually happens, and where
          to go when it does not — nothing about the broker beyond what this
          product does. */}
      <ol className="pocket-reg__steps">
        <li>Нажмите «Зарегистрироваться в Pocket» — сайт откроется в новой вкладке.</li>
        <li>Создайте аккаунт там, по этой ссылке.</li>
        <li>
          Вернитесь сюда: Pocket сообщит о регистрации сам, и уровень завершится. Если этого
          ещё не произошло, нажмите «Проверить регистрацию».
        </li>
      </ol>

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
          ? "Сайт Pocket открывается в новой вкладке. Вернитесь сюда после регистрации и нажмите «Проверить регистрацию»."
          : (note ?? "")}
      </p>
      {openedUrl ? (
        <p className="pocket-reg__fallback">
          Вкладка не открылась?{" "}
          <a href={openedUrl} target="_blank" rel="noopener noreferrer">
            Открыть сайт Pocket
          </a>
        </p>
      ) : null}
      <p className="pocket-reg__help">
        Аккаунт в Pocket уже был или подтверждение не приходит?{" "}
        <Link href="/profile/support">Напишите в поддержку</Link> — разберёмся.
      </p>
    </section>
  );
}
