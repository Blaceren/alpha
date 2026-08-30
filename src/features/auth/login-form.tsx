"use client";

import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as api from "@/lib/api/client";
import {
  canSubmitChallenge,
  hasCaptchaWidget,
  resolveCaptchaContract,
} from "@/lib/auth/captcha-contract";
import {
  LOGIN_FAILURE_MESSAGE,
  mapLoginFailure,
  shouldClearPassword,
  shouldRenewCaptcha,
  type LoginFailure,
} from "@/lib/auth/login-outcome";
import { sanitizeReturnTo } from "@/lib/auth/return-to";
import { TURNSTILE_LOGIN_ACTION } from "@/lib/auth/turnstile";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";
import Link from "next/link";

/**
 * AFD-3A3 — the Academy login form, now behind a real challenge.
 *
 * WHAT THE WIDGET IS AND IS NOT
 * It produces a token. It proves nothing. The Backend hands that token to
 * Cloudflare's Siteverify endpoint on every attempt, checks that the action
 * stamped on it is `academy_login` — not `academy_register`, not `crm_login` —
 * and refuses the login if that verification does not succeed. A caller who
 * skips this page entirely still needs a token they do not have.
 *
 * WHAT THE TOKEN NEVER TOUCHES
 * React state, then the JSON body of one request. Never the URL, never
 * `localStorage` or `sessionStorage`, never a cookie, never a log. Turnstile
 * tokens are single-use and expire after five minutes, so a persisted one is
 * useless at best and a replay hazard at worst.
 *
 * WHY THE WIDGET RESETS AFTER A WRONG PASSWORD
 * Because the challenge is verified BEFORE the password is compared, a failed
 * login has already spent its token. Leaving the old one in place would make the
 * second attempt fail as a duplicate, and the person would be told twice that
 * their (correct) password was wrong. See `login-outcome.ts`.
 */

type FormError = { failure: LoginFailure; requestId: string | null };

export type LoginFormProps = {
  /**
   * The public Turnstile site key, injected by the server at request time. Null
   * when the deployment has not configured one — which renders an unavailable
   * state and blocks submission rather than posting a request the Backend would
   * refuse with a configuration error anyway.
   */
  turnstileSiteKey: string | null;
};

export function LoginForm({ turnstileSiteKey }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("next"));

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const captchaStatusId = useId();

  const captcha = resolveCaptchaContract(turnstileSiteKey);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  /** In memory only. See the file header. */
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  /** Bumped to force a brand-new challenge after a token-consuming attempt. */
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);

  /**
   * Guards a second in-flight request. React state is not synchronous, so a fast
   * double activation can re-enter the handler before `submitting` has
   * re-rendered — and a duplicate submit would burn the single-use token.
   */
  const inFlight = useRef(false);

  const canSubmit = canSubmitChallenge(captcha, captchaToken);

  const renewCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaResetSignal((value) => value + 1);
  }, []);

  function fail(failure: LoginFailure, requestId: string | null) {
    if (shouldClearPassword(failure)) setPassword("");
    if (shouldRenewCaptcha(failure)) renewCaptcha();
    setError({ failure, requestId });
    setSubmitting(false);
    inFlight.current = false;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || submitting) return;

    // Backstop for a submission that reached here without a solved challenge —
    // an Enter that raced the token, or a disabled attribute defeated in
    // devtools. The Backend would refuse it anyway; refusing locally saves the
    // user a round trip and a login rate-limit slot.
    if (!canSubmitChallenge(captcha, captchaToken)) {
      setError({
        failure: captcha.mode === "provider" ? "CAPTCHA_FAILED" : "CAPTCHA_CONFIGURATION_ERROR",
        requestId: null,
      });
      return;
    }

    inFlight.current = true;
    setError(null);
    setSubmitting(true);

    const result = await api.login({
      email,
      password,
      // The live token, in the JSON body and nowhere else.
      captchaToken: captchaToken ?? undefined,
    });

    if (!result.ok) {
      fail(mapLoginFailure(result.error), result.error.requestId);
      return;
    }

    // Confirm the session was established before navigating.
    const session = await api.fetchSession();
    if (!session.ok || !session.data.user) {
      fail(session.ok ? "UNKNOWN" : mapLoginFailure(session.error), session.ok ? null : session.error.requestId);
      return;
    }

    inFlight.current = false;
    router.replace(returnTo);
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate aria-describedby={error ? errorId : undefined}>
      <div className="login-field">
        <label htmlFor={emailId}>Email</label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      <div className="login-field">
        <label htmlFor={passwordId}>Пароль</label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      {hasCaptchaWidget(captcha) && captcha.mode === "provider" ? (
        <TurnstileWidget
          siteKey={captcha.siteKey}
          action={TURNSTILE_LOGIN_ACTION}
          onToken={setCaptchaToken}
          // Expiry, timeout and provider error all mean the same thing here: the
          // token in hand is dead. Clearing it re-disables submit, so a lapsed
          // challenge cannot be posted.
          onTokenLost={() => setCaptchaToken(null)}
          resetSignal={captchaResetSignal}
          describedById={captchaStatusId}
        />
      ) : (
        <div className="auth-captcha auth-captcha--failed" data-testid="captcha-unavailable" role="alert">
          Вход временно недоступен: проверка безопасности не настроена. Обратитесь к поддержке.
        </div>
      )}

      {error ? (
        <p id={errorId} className="login-error" role="alert">
          <span>{LOGIN_FAILURE_MESSAGE[error.failure]}</span>
          {error.requestId ? (
            <span className="login-error__ref"> (код обращения: {error.requestId})</span>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        className="login-submit"
        disabled={submitting || !canSubmit}
        aria-busy={submitting}
        aria-describedby={!canSubmit && !submitting ? captchaStatusId : undefined}
      >
        {submitting ? "Вход…" : "Войти"}
      </button>

      <p id={captchaStatusId} className="auth-status" role="status" aria-live="polite">
        {captcha.mode === "provider" && !captchaToken && !submitting
          ? "Пройдите проверку безопасности, чтобы продолжить."
          : ""}
      </p>

      {/* The way to registration. `/register` has carried the reciprocal link
          to `/login` since it shipped; this side had none, so a visitor without
          an account reached a dead end and had to guess the URL. Mirrors the
          existing pattern exactly — same shape, same place, same treatment. */}
      <p className="login-alt">
        Нет аккаунта?{" "}
        <Link href="/register" className="login-alt__link">
          Создать аккаунт
        </Link>
      </p>
    </form>
  );
}
