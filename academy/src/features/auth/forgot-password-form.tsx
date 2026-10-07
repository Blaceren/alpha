"use client";

import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestPasswordReset, type ResetRequestFailure } from "@/lib/account/account-client";
import { canSubmitChallenge, hasCaptchaWidget, resolveCaptchaContract } from "@/lib/auth/captcha-contract";
import { normalizeEmail } from "@/lib/auth/registration-validation";
import { TURNSTILE_PASSWORD_RESET_ACTION } from "@/lib/auth/turnstile";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";

/**
 * ACCOUNT RECOVERY — ask for a reset link.
 *
 * THE ANSWER IS THE SAME FOR EVERY ADDRESS. The Backend answers one way whether
 * the address has an account or not, and so does this page: «если адрес
 * зарегистрирован, мы отправили письмо». It never says "no such account" — that
 * sentence is how a sign-in page becomes a way to check who is a member.
 *
 * THE CHALLENGE IS THIS FORM'S OWN. It is minted for the recovery surface; the
 * Backend refuses a login or registration token here, and refuses this one
 * there. Like every Turnstile token it lives in memory and in one request body.
 */

const FAILURE_MESSAGE: Record<ResetRequestFailure, string> = {
  CAPTCHA_FAILED: "Проверка не пройдена. Пройдите её ещё раз.",
  CAPTCHA_UNAVAILABLE: "Сервис проверки временно недоступен. Повторите попытку позже.",
  CAPTCHA_CONFIGURATION_ERROR: "Восстановление временно недоступно. Попробуйте позже.",
  UNAVAILABLE: "Восстановление пароля по почте сейчас недоступно.",
  RATE_LIMITED: "Слишком много запросов. Попробуйте позже.",
  VALIDATION_ERROR: "Проверьте адрес почты.",
  FAILED: "Не удалось отправить запрос. Повторите попытку.",
};

/** Failures decided before the Backend verified the challenge: the token is unspent.
    Only those keep it (2026-10-07 audit): a failure after the challenge may have
    spent the token, and keeping it made the next press fail as a replay. */
const KEEPS_TOKEN: ReadonlySet<ResetRequestFailure> = new Set(["RATE_LIMITED", "VALIDATION_ERROR"]);

export function ForgotPasswordForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const emailId = useId();
  const errorId = useId();
  const captchaStatusId = useId();
  const captcha = resolveCaptchaContract(turnstileSiteKey);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<{ failure: ResetRequestFailure; requestId: string | null } | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const inFlight = useRef(false);

  const canSubmit = canSubmitChallenge(captcha, captchaToken);

  const renewCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaResetSignal((value) => value + 1);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || submitting) return;
    const address = normalizeEmail(email);
    if (!address || !address.includes("@")) {
      setFailure({ failure: "VALIDATION_ERROR", requestId: null });
      return;
    }
    if (!canSubmitChallenge(captcha, captchaToken)) {
      setFailure({ failure: captcha.mode === "provider" ? "CAPTCHA_FAILED" : "CAPTCHA_CONFIGURATION_ERROR", requestId: null });
      return;
    }
    inFlight.current = true;
    setFailure(null);
    setSubmitting(true);
    const result = await requestPasswordReset({ email: address, captchaToken: captchaToken ?? undefined });
    inFlight.current = false;
    setSubmitting(false);
    if (result.ok) {
      setSentTo(address);
      return;
    }
    if (!KEEPS_TOKEN.has(result.failure)) renewCaptcha();
    setFailure({ failure: result.failure, requestId: result.requestId });
  }

  if (sentTo) {
    return (
      <div className="register-success" role="status" aria-live="polite" data-role="reset-requested">
        <h2 className="register-success__title">Проверьте почту</h2>
        <p className="register-success__body">
          Если адрес <span className="register-success__email">{sentTo}</span> зарегистрирован в Академии, мы отправили
          на него ссылку для нового пароля.
        </p>
        <p className="register-success__body">Ссылка действует 60 минут и срабатывает один раз. Письмо может оказаться в папке «Спам».</p>
        <Link className="register-submit register-submit--link" href="/login">
          Вернуться ко входу
        </Link>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={onSubmit} noValidate aria-describedby={failure ? errorId : undefined}>
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
          onChange={(event) => setEmail(event.target.value)}
          disabled={submitting}
          aria-invalid={failure?.failure === "VALIDATION_ERROR" ? true : undefined}
          aria-describedby={failure ? errorId : undefined}
        />
      </div>

      {hasCaptchaWidget(captcha) && captcha.mode === "provider" ? (
        <TurnstileWidget
          siteKey={captcha.siteKey}
          action={TURNSTILE_PASSWORD_RESET_ACTION}
          onToken={setCaptchaToken}
          onTokenLost={() => setCaptchaToken(null)}
          resetSignal={captchaResetSignal}
          describedById={captchaStatusId}
        />
      ) : (
        <div id={captchaStatusId} className="auth-captcha auth-captcha--failed" data-testid="captcha-unavailable" role="alert">
          Восстановление временно недоступно: проверка безопасности не настроена.
        </div>
      )}

      {failure ? (
        <p id={errorId} className="login-error" role="alert">
          <span>{FAILURE_MESSAGE[failure.failure]}</span>
          {failure.requestId ? <span className="login-error__ref"> (код обращения: {failure.requestId})</span> : null}
        </p>
      ) : null}

      <button
        type="submit"
        className="login-submit"
        disabled={submitting || !canSubmit}
        aria-busy={submitting}
        aria-describedby={!canSubmit && !submitting ? captchaStatusId : undefined}
      >
        {submitting ? "Отправка…" : "Отправить ссылку"}
      </button>

      {/* Why the button is not available yet is said by the check's own line,
          above it: the button is described by that line (`captchaStatusId`).
          There used to be a second line here — «Пройдите проверку
          безопасности…» — which asked the visitor to do something while the
          check was running by itself. */}
      <p className="auth-status" role="status" aria-live="polite">
        {submitting ? "Отправляем запрос, подождите." : ""}
      </p>

      <p className="login-alt">
        Вспомнили пароль?{" "}
        <Link href="/login" className="login-alt__link">
          Войти
        </Link>
      </p>
    </form>
  );
}
