"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as api from "@/lib/api/client";
import {
  canSubmitRegistration,
  hasCaptchaWidget,
  resolveCaptchaContract,
} from "@/lib/auth/captcha-contract";
import { readReferralCode, type ReferralCodeResult } from "@/lib/auth/referral-code";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";
import { TURNSTILE_REGISTER_ACTION } from "@/lib/auth/turnstile";
import { POST_REGISTRATION_RETURN_TO } from "@/lib/auth/return-to";
import {
  mapRegistrationFailure,
  registrationMessage,
  shouldClearPassword,
  shouldRenewCaptcha,
  type RegistrationFailure,
} from "@/lib/auth/registration-outcome";
import {
  hasFieldErrors,
  normalizeEmail,
  normalizeName,
  validateRegistrationDraft,
  type RegistrationFieldErrors,
} from "@/lib/auth/registration-validation";

/**
 * The Academy request is abandoned after this long so the user gets a truthful
 * "no answer" state instead of an indefinite spinner. The Academy proxy bounds
 * its own upstream wait separately; this is the browser-side bound.
 */
const REQUEST_TIMEOUT_MS = 20_000;

type Outcome =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "failed"; failure: RegistrationFailure; requestId: string | null }
  /**
   * Backend created the account. `session` mirrors `verification.required`
   * inverted: Backend issues the session cookie only when verification is NOT
   * required, so this is the authoritative signal — never an assumption.
   */
  | { kind: "created"; email: string; session: boolean };

function ReferralNotice({ referral }: { referral: ReferralCodeResult }) {
  if (referral.status === "valid") {
    return (
      <p className="register-referral" data-testid="referral-valid">
        Вы регистрируетесь по приглашению. Бонус начислит платформа после создания аккаунта.
      </p>
    );
  }
  if (referral.status === "malformed") {
    return (
      <p className="register-referral register-referral--warn" data-testid="referral-malformed">
        Код приглашения в ссылке не распознан. Аккаунт будет создан без приглашения.
      </p>
    );
  }
  return null;
}

export type RegisterFormProps = {
  /**
   * The PUBLIC Turnstile site key, injected by the server at request time.
   * `null` when the deployment has none — the form then renders an unavailable
   * state and refuses to submit rather than posting a request the Backend will
   * reject with `CAPTCHA_CONFIGURATION_ERROR`.
   */
  turnstileSiteKey: string | null;
};

export function RegisterForm({ turnstileSiteKey }: RegisterFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const referral = readReferralCode(searchParams);
  const captcha = resolveCaptchaContract(turnstileSiteKey);

  const emailId = useId();
  const nameId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const summaryId = useId();
  const statusId = useId();
  const captchaStatusId = useId();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  /**
   * The Turnstile token. Held in memory only — never written to the URL, to
   * `localStorage`, to `sessionStorage`, to a cookie or to any log. It is
   * single-use and expires after five minutes, so persisting it would be a
   * replay hazard that buys nothing.
   */
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  /** Bumped to force a brand-new challenge after a token-consuming failure. */
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<RegistrationFieldErrors>({});
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  /**
   * Guards against a second in-flight request. React state is not synchronous,
   * so a fast double activation (double click, Enter held) can re-enter the
   * handler before `outcome` has re-rendered — this ref closes that window.
   */
  const inFlight = useRef(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);

  const submitting = outcome.kind === "submitting";
  const created = outcome.kind === "created";
  /**
   * Submission requires a provider AND a live token. This is a usability gate,
   * not a security one — the Backend verifies the token with Cloudflare on
   * every request regardless of what this button does.
   */
  const canSubmit = canSubmitRegistration(captcha, captchaToken);

  /** Discard the current token and make the widget issue a fresh challenge. */
  const renewCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaResetSignal((value) => value + 1);
  }, []);

  // Move focus to the error summary so a keyboard/screen-reader user is taken
  // straight to what went wrong instead of hunting for it.
  useEffect(() => {
    if (outcome.kind === "failed") summaryRef.current?.focus();
  }, [outcome]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || created) return;

    const draft = { email, password, confirmPassword, name };
    const errors = validateRegistrationDraft(draft);
    setFieldErrors(errors);
    if (hasFieldErrors(errors)) {
      setOutcome({ kind: "failed", failure: "VALIDATION_ERROR", requestId: null });
      return;
    }

    // Backstop for a submission that reached here without a solved challenge —
    // a keyboard Enter that raced the token, or a disabled attribute defeated
    // in devtools. The Backend would refuse it anyway; refusing locally saves
    // the user a round trip and a rate-limit slot.
    if (!canSubmitRegistration(captcha, captchaToken)) {
      setOutcome({
        kind: "failed",
        failure: captcha.mode === "provider" ? "CAPTCHA_FAILED" : "CAPTCHA_CONFIGURATION_ERROR",
        requestId: null,
      });
      return;
    }

    inFlight.current = true;
    setOutcome({ kind: "submitting" });

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    const normalizedEmail = normalizeEmail(email);
    let result;
    try {
      result = await api.register(
        {
          email: normalizedEmail,
          password,
          name: normalizeName(name),
          // Only a code we vouched for is forwarded; a malformed one is dropped.
          referralCode: referral.status === "valid" ? referral.code : undefined,
          // The live Turnstile token, in the JSON body and nowhere else. The
          // Backend verifies it with Cloudflare before creating anything.
          captchaToken: captchaToken ?? undefined,
        },
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
    }

    if (!result.ok) {
      const failure = timedOut ? "TIMEOUT" : mapRegistrationFailure(result.error);
      if (shouldClearPassword(failure)) {
        setPassword("");
        setConfirmPassword("");
      }
      if (shouldRenewCaptcha(failure)) {
        // The token was consumed or invalidated server-side. Discard it AND
        // reset the widget: a Turnstile token is single-use, so retrying with
        // the same one can only produce `timeout-or-duplicate`.
        renewCaptcha();
      }
      // The email is deliberately kept so a recoverable failure does not make
      // the user retype it.
      setOutcome({ kind: "failed", failure, requestId: result.error.requestId });
      return;
    }

    // Success is read from the authoritative response, never inferred from
    // navigation or from the presence of a cookie (which is httpOnly and
    // invisible to this code anyway).
    setOutcome({
      kind: "created",
      email: normalizedEmail,
      session: !result.data.verification.required,
    });
  }

  if (created && outcome.kind === "created") {
    return (
      <div className="register-success" role="status" aria-live="polite">
        <h2 className="register-success__title">Аккаунт создан</h2>
        <p className="register-success__body">
          Аккаунт для <span className="register-success__email">{outcome.email}</span> готов.
        </p>
        {outcome.session ? (
          <>
            <p className="register-success__body">Вы уже вошли в систему.</p>
            <button
              type="button"
              className="register-submit"
              onClick={() => {
                router.replace(POST_REGISTRATION_RETURN_TO);
                router.refresh();
              }}
            >
              Продолжить
            </button>
          </>
        ) : (
          <>
            <p className="register-success__body">
              Подтвердите email по инструкции оператора, затем войдите.
            </p>
            <Link className="register-submit register-submit--link" href="/login">
              Перейти ко входу
            </Link>
          </>
        )}
      </div>
    );
  }

  const failure = outcome.kind === "failed" ? outcome : null;

  return (
    <form className="register-form" onSubmit={onSubmit} noValidate>
      <ReferralNotice referral={referral} />

      {failure ? (
        <div
          id={summaryId}
          ref={summaryRef}
          tabIndex={-1}
          className="register-error"
          role="alert"
          data-testid="register-error"
        >
          <span>{registrationMessage(failure.failure)}</span>
          {failure.requestId ? (
            <span className="register-error__ref"> (код обращения: {failure.requestId})</span>
          ) : null}
        </div>
      ) : null}

      <div className="register-field">
        <label htmlFor={emailId}>Email</label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
        />
        {fieldErrors.email ? (
          <p id={`${emailId}-error`} className="register-field__error">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="register-field">
        <label htmlFor={nameId}>
          Имя <span className="register-field__optional">— необязательно</span>
        </label>
        <input
          id={nameId}
          name="name"
          type="text"
          autoComplete="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
        />
        <p className="register-field__hint">Если не указать, платформа подберёт имя автоматически.</p>
      </div>

      <div className="register-field">
        <label htmlFor={passwordId}>Пароль</label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={
            fieldErrors.password ? `${passwordId}-error` : `${passwordId}-hint`
          }
        />
        {fieldErrors.password ? (
          <p id={`${passwordId}-error`} className="register-field__error">
            {fieldErrors.password}
          </p>
        ) : (
          <p id={`${passwordId}-hint`} className="register-field__hint">
            Минимум 6 символов, заглавная и строчная буква, цифра.
          </p>
        )}
      </div>

      <div className="register-field">
        <label htmlFor={confirmId}>Повторите пароль</label>
        <input
          id={confirmId}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={submitting}
          aria-invalid={fieldErrors.confirmPassword ? true : undefined}
          aria-describedby={fieldErrors.confirmPassword ? `${confirmId}-error` : undefined}
        />
        {fieldErrors.confirmPassword ? (
          <p id={`${confirmId}-error`} className="register-field__error">
            {fieldErrors.confirmPassword}
          </p>
        ) : null}
      </div>

      {hasCaptchaWidget(captcha) && captcha.mode === "provider" ? (
        <TurnstileWidget
          siteKey={captcha.siteKey}
          action={TURNSTILE_REGISTER_ACTION}
          onToken={setCaptchaToken}
          // Expiry, timeout and provider error all mean the same thing to this
          // form: the token in hand is dead. Clearing it re-disables submit, so
          // the user cannot post a challenge that has already lapsed.
          onTokenLost={() => setCaptchaToken(null)}
          resetSignal={captchaResetSignal}
          describedById={captchaStatusId}
        />
      ) : (
        <div className="auth-captcha auth-captcha--failed" data-testid="captcha-unavailable" role="alert">
          Регистрация временно недоступна: проверка безопасности не настроена. Обратитесь к поддержке.
        </div>
      )}

      <button
        type="submit"
        className="register-submit"
        disabled={submitting || !canSubmit}
        aria-busy={submitting}
        aria-describedby={!canSubmit && !submitting ? captchaStatusId : undefined}
      >
        {submitting ? "Создаём аккаунт…" : "Создать аккаунт"}
      </button>

      <p id={captchaStatusId} className="auth-status" role="status" aria-live="polite">
        {captcha.mode === "provider" && !captchaToken && !submitting
          ? "Пройдите проверку безопасности, чтобы продолжить."
          : ""}
      </p>

      <p id={statusId} className="auth-status" role="status" aria-live="polite">
        {submitting ? "Создаём аккаунт, подождите." : ""}
      </p>

      <p className="register-alt">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="register-alt__link">
          Войти
        </Link>
      </p>
    </form>
  );
}
