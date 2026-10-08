"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { confirmEmailChange, verifyEmail, type LinkConfirmFailure } from "@/lib/account/account-client";
import { takeLinkToken } from "@/lib/account/link-token";

/**
 * ACCOUNT RECOVERY — confirm an address with the link from a message.
 *
 * One component, two links: the confirmation of the account's address
 * (`verify-email`) and the confirmation of a NEW address (`email-change`).
 *
 * NOTHING HAPPENS UNTIL THE PERSON PRESSES THE BUTTON. Opening the page spends
 * nothing: mail scanners and link previews open links on their own, and an
 * address must not be confirmed by a robot that never read the message. The
 * token is read from the fragment, removed from the address bar, kept in a ref
 * and posted in a body only when the button is pressed.
 *
 * NO SESSION IS NEEDED. The message may be opened on another device than the
 * one the learner is signed in on; the token is the proof.
 *
 * A LINK PASTED INTO THIS TAB IS READ TOO. A person told «ссылка неполная»
 * copies the whole link from the message into the same address bar. Only the
 * fragment differs from the page already open, so the browser does not load
 * anything — it reports `hashchange`. Found in the browser: without listening
 * for it the page went on saying the link was incomplete, with the complete
 * link, token and all, sitting in the address bar.
 */

type Kind = "verify-email" | "email-change";
type Phase = "reading" | "no-link" | "ready" | "submitting" | "done" | LinkConfirmFailure;

const COPY: Record<Kind, { action: string; busy: string; done: string; doneBody: string; ready: string }> = {
  "verify-email": {
    action: "Подтвердить почту",
    busy: "Подтверждение…",
    done: "Почта подтверждена",
    doneBody: "На этот адрес будут приходить письма о вашем аккаунте — в том числе ссылка для сброса пароля.",
    ready: "Нажмите кнопку, чтобы подтвердить, что этот адрес ваш.",
  },
  "email-change": {
    action: "Подтвердить новый адрес",
    busy: "Подтверждение…",
    done: "Почта аккаунта изменена",
    doneBody: "Теперь вход выполняется по новому адресу. На прежний адрес отправлено уведомление.",
    ready: "Нажмите кнопку, чтобы сделать этот адрес почтой вашего аккаунта.",
  },
};

const FAILURE: Record<LinkConfirmFailure, { title: string; body: string }> = {
  INVALID_TOKEN: {
    title: "Ссылка больше не действует",
    body: "Она уже использована, устарела, отменена или заменена более новой. Запросите письмо ещё раз в профиле.",
  },
  EMAIL_IN_USE: {
    title: "Этот адрес уже занят",
    body: "Другой аккаунт успел занять этот адрес. Почта вашего аккаунта не изменилась.",
  },
  RATE_LIMITED: { title: "Слишком много попыток", body: "Попробуйте позже." },
  FAILED: { title: "Не удалось подтвердить", body: "Проверьте соединение и откройте ссылку из письма ещё раз." },
};

export function LinkConfirmation({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("reading");
  /** Whether the link survived a failure. State, because the token itself is a ref and is not read while rendering. */
  const [retryable, setRetryable] = useState(false);

  useEffect(() => {
    const arrive = (initial: boolean) => {
      const next = takeLinkToken();
      if (next) {
        token.current = next;
        setRetryable(false);
        setPhase("ready");
        return;
      }
      /* Not "no link" when a token is already held: an effect may run twice,
         and the second run finds the fragment already taken. */
      if (initial && !token.current) setPhase("no-link");
    };
    arrive(true);
    const onHashChange = () => arrive(false);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  async function onConfirm() {
    if (phase !== "ready" || !token.current) return;
    setPhase("submitting");
    const result = kind === "verify-email" ? await verifyEmail(token.current) : await confirmEmailChange(token.current);
    if (result.ok) {
      token.current = null;
      setPhase("done");
      return;
    }
    /* A transient failure keeps the token: the person can press again. A dead
       link or a taken address is final for this link. */
    const final = result.failure === "INVALID_TOKEN" || result.failure === "EMAIL_IN_USE";
    if (final) token.current = null;
    setRetryable(!final);
    setPhase(result.failure);
  }

  if (phase === "reading") {
    return <p className="auth-status" role="status" aria-live="polite" />;
  }

  if (phase === "done") {
    return (
      <div className="register-success" role="status" aria-live="polite" data-role="link-done">
        <h2 className="register-success__title">{copy.done}</h2>
        <p className="register-success__body">{copy.doneBody}</p>
        <Link className="register-submit register-submit--link" href="/profile">
          Перейти в профиль
        </Link>
      </div>
    );
  }

  if (phase === "no-link") {
    return (
      <div className="register-success" role="alert" data-role="no-link">
        <h2 className="register-success__title">Ссылка неполная</h2>
        <p className="register-success__body">Откройте ссылку из письма целиком или запросите письмо ещё раз в профиле.</p>
        <Link className="register-submit register-submit--link" href="/profile">
          Перейти в профиль
        </Link>
      </div>
    );
  }

  if (phase !== "ready" && phase !== "submitting") {
    const failure = FAILURE[phase];
    return (
      <div className="register-success" role="alert" data-role="link-failed" data-failure={phase}>
        <h2 className="register-success__title">{failure.title}</h2>
        <p className="register-success__body">{failure.body}</p>
        {retryable ? (
          <button type="button" className="register-submit" onClick={() => setPhase("ready")}>
            Попробовать ещё раз
          </button>
        ) : (
          <Link className="register-submit register-submit--link" href="/profile">
            Перейти в профиль
          </Link>
        )}
      </div>
    );
  }

  const submitting = phase === "submitting";
  return (
    <div className="login-form" data-role="link-ready">
      <p className="auth-note">{copy.ready}</p>
      <button type="button" className="login-submit" onClick={() => void onConfirm()} disabled={submitting} aria-busy={submitting}>
        {submitting ? copy.busy : copy.action}
      </button>
    </div>
  );
}
