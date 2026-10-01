"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { confirmPasswordReset, type ResetConfirmFailure } from "@/lib/account/account-client";
import { takeLinkToken } from "@/lib/account/link-token";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/registration-validation";

/**
 * ACCOUNT RECOVERY — set a new password with the link from the message.
 *
 * THE TOKEN COMES FROM THE FRAGMENT AND LEAVES THE ADDRESS BAR. It is read once
 * on arrival, kept in a ref — not in state a devtools panel prints, not in
 * storage — and removed from the URL, so it is not in the browser's history
 * and not in a link copied from the page. It goes to the Backend in a request
 * body.
 *
 * A RESET DOES NOT SIGN ANYONE IN. It closes every session the account had; the
 * person signs in with the new password. A link opened on someone else's
 * machine therefore leaves no session behind.
 *
 * ONE SENTENCE FOR EVERY DEAD LINK. Used, expired, replaced or mistyped — the
 * person needs a new link whichever it was.
 *
 * A LINK PASTED INTO THIS TAB IS READ TOO: only the fragment changes, so the
 * browser reports `hashchange` instead of loading the page again (see
 * `link-confirmation.tsx`). The new link opens a clean form.
 */

type Phase = "reading" | "no-link" | "form" | "submitting" | "done" | "dead-link";

const FAILURE_MESSAGE: Record<Exclude<ResetConfirmFailure, "INVALID_TOKEN">, string> = {
  VALIDATION_ERROR: `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`,
  RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
  FAILED: "Не удалось сохранить пароль. Повторите попытку.",
};

export function ResetPasswordForm() {
  const passwordId = useId();
  const confirmId = useId();
  const hintId = useId();
  const errorId = useId();

  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<Phase>("reading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const arrive = (initial: boolean) => {
      const next = takeLinkToken();
      if (next) {
        token.current = next;
        setPassword("");
        setConfirm("");
        setError(null);
        setPhase("form");
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === "submitting" || !token.current) return;
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(FAILURE_MESSAGE.VALIDATION_ERROR);
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают.");
      return;
    }
    setError(null);
    setPhase("submitting");
    const result = await confirmPasswordReset({ token: token.current, newPassword: password });
    if (result.ok) {
      token.current = null;
      setPassword("");
      setConfirm("");
      setPhase("done");
      return;
    }
    if (result.failure === "INVALID_TOKEN") {
      token.current = null;
      setPassword("");
      setConfirm("");
      setPhase("dead-link");
      return;
    }
    setError(FAILURE_MESSAGE[result.failure]);
    setPhase("form");
  }

  if (phase === "reading") {
    return <p className="auth-status" role="status" aria-live="polite" />;
  }

  if (phase === "done") {
    return (
      <div className="register-success" role="status" aria-live="polite" data-role="reset-done">
        <h2 className="register-success__title">Пароль изменён</h2>
        <p className="register-success__body">Все прежние сеансы завершены. Войдите с новым паролем.</p>
        <Link className="register-submit register-submit--link" href="/login">
          Перейти ко входу
        </Link>
      </div>
    );
  }

  if (phase === "no-link" || phase === "dead-link") {
    return (
      <div className="register-success" role="alert" data-role={phase}>
        <h2 className="register-success__title">
          {phase === "no-link" ? "Ссылка неполная" : "Ссылка больше не действует"}
        </h2>
        <p className="register-success__body">
          {phase === "no-link"
            ? "Откройте ссылку из письма целиком или запросите новую."
            : "Ссылка уже использована, устарела, отменена или заменена более новой. Запросите новую — она придёт на почту аккаунта."}
        </p>
        <Link className="register-submit register-submit--link" href="/forgot-password">
          Запросить новую ссылку
        </Link>
      </div>
    );
  }

  const submitting = phase === "submitting";
  return (
    <form className="login-form" onSubmit={onSubmit} noValidate aria-describedby={error ? errorId : undefined}>
      <div className="login-field">
        <label htmlFor={passwordId}>Новый пароль</label>
        <input
          id={passwordId}
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        />
        <p id={hintId} className="register-field__hint">
          Минимум {PASSWORD_MIN_LENGTH} символов.
        </p>
      </div>

      <div className="login-field">
        <label htmlFor={confirmId}>Повторите пароль</label>
        <input
          id={confirmId}
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={submitting}
          aria-invalid={error ? true : undefined}
        />
      </div>

      {error ? (
        <p id={errorId} className="login-error" role="alert">
          <span>{error}</span>
        </p>
      ) : null}

      <button type="submit" className="login-submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? "Сохранение…" : "Сохранить пароль"}
      </button>
    </form>
  );
}
