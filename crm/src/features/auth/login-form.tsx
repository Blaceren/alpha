"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { login, type LoginOutcome } from "@/application/api/auth-client";
import { consumeReturnPath } from "@/domain/identity/return-path";
import type { LoginErrorCode } from "@/data/contracts/api/auth";
import { TurnstileWidget } from "@/features/auth/turnstile-widget";
import {
  TURNSTILE_CRM_LOGIN_ACTION,
  canSubmitChallenge,
  resolveCaptchaContract,
} from "@/lib/auth/turnstile";

/**
 * The real staff login form.
 *
 * Design notes that are decisions, not preferences:
 *
 * - **One error region, announced once.** Every failure renders into a single
 *   `role="alert"` summary above the fields rather than scattering messages, so
 *   a screen reader user hears the outcome once and knows where it is.
 *
 * - **Copy is chosen here, keyed off a stable code.** The backend answers in
 *   Russian prose aimed at learners ("Неверный email или пароль"). Rendering that
 *   would couple CRM copy to another product's wording and leak its tone. The
 *   route handler already reduced it to a code; this maps code → CRM copy.
 *
 * - **Invalid credentials and unknown account read identically**, because the
 *   backend answers both with one 401. Preserving that is what keeps the form
 *   free of account enumeration.
 *
 * - **The password is never retained.** It is cleared on every terminal outcome,
 *   success included, and lives only in React state — never in a ref that
 *   outlives the attempt, never in the URL, never logged.
 *
 * - **A Turnstile challenge must be solved first (AFD-3A3).** The widget is not
 *   the control: the backend verifies the token against Cloudflare and requires
 *   the action stamped on it to be exactly `crm_login`, so a token minted on the
 *   Academy — for its login OR its registration form — is refused here. This
 *   form grants no CRM permission either way; `GET /api/crm/v1/session` remains
 *   the only identity source and the staff check is unchanged.
 *
 * - **The token is renewed after every consumed attempt**, including a wrong
 *   password. The backend verifies the challenge BEFORE comparing the password,
 *   so a rejected credential has already spent the single-use token; reusing it
 *   could only produce `timeout-or-duplicate`.
 */

export type LoginFormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; code: LoginErrorCode; requestId?: string }
  | { kind: "success" };

/** CRM-owned copy for every closed error code. */
const ERROR_COPY: Record<LoginErrorCode, { title: string; detail: string }> = {
  invalid_input: {
    title: "Проверьте email и пароль",
    detail: "Укажите корректный email и пароль не короче 6 символов.",
  },
  invalid_credentials: {
    title: "Неверные данные для входа",
    detail: "Email или пароль не подходят. Проверьте раскладку и попробуйте снова.",
  },
  inactive: {
    title: "Доступ приостановлен",
    detail: "Учётная запись заблокирована. Обратитесь к администратору CRM.",
  },
  email_not_verified: {
    title: "Email не подтверждён",
    detail: "Подтвердите email по ссылке из письма, затем войдите снова.",
  },
  not_staff: {
    title: "Нет доступа к CRM",
    detail:
      "Учётная запись существует, но не является сотрудником CRM. Обратитесь к администратору CRM.",
  },
  rate_limited: {
    title: "Слишком много попыток",
    detail: "Вход временно ограничен. Подождите несколько минут и попробуйте снова.",
  },
  captcha_failed: {
    title: "Проверка безопасности не пройдена",
    detail: "Пройдите проверку ещё раз и повторите вход.",
  },
  captcha_unavailable: {
    title: "Проверка безопасности недоступна",
    detail: "Сервис проверки временно не отвечает. Повторите попытку позже.",
  },
  captcha_configuration_error: {
    title: "Вход временно недоступен",
    detail: "Проверка безопасности не настроена. Обратитесь к администратору CRM.",
  },
  upstream_unavailable: {
    title: "Сервис недоступен",
    detail: "Не удалось связаться с сервисом входа. Попробуйте ещё раз.",
  },
  server_error: {
    title: "Ошибка сервиса входа",
    detail: "Вход временно недоступен. Попробуйте позже.",
  },
};

/** Bounded pre-flight matching the server contract, so an obvious typo is local. */
function localValidationCode(email: string, password: string): LoginErrorCode | null {
  const trimmed = email.trim();
  if (trimmed === "" || !trimmed.includes("@") || password.length < 6) return "invalid_input";
  return null;
}

/**
 * Failures after which the widget must issue a brand-new challenge.
 *
 * Everything except the outcomes decided BEFORE the request reached backend
 * CAPTCHA validation, where the token is provably still unspent: a local or
 * server-side input rejection, a rate limit refused ahead of verification, and a
 * transport failure that may never have arrived.
 */
const KEEPS_TOKEN: ReadonlySet<LoginErrorCode> = new Set<LoginErrorCode>([
  "invalid_input",
  "rate_limited",
  "upstream_unavailable",
]);

export interface LoginFormProps {
  /** Set when the boundary bounced the employee here; drives the notice. */
  sessionExpired?: boolean;
  /** Injection seam for tests; production uses the real client. */
  loginImpl?: typeof login;
  /**
   * The PUBLIC Turnstile site key, injected by the server at request time.
   * `null` when the deployment has none — the form then renders an unavailable
   * state and refuses to submit rather than posting a request the backend would
   * reject with a configuration error.
   */
  turnstileSiteKey?: string | null;
}

export function LoginForm({
  sessionExpired = false,
  loginImpl = login,
  turnstileSiteKey = null,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [state, setState] = React.useState<LoginFormState>({ kind: "idle" });
  /** In memory only — never storage, never the URL, never a log. */
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  /** Bumped to force a brand-new challenge after a token-consuming attempt. */
  const [captchaResetSignal, setCaptchaResetSignal] = React.useState(0);
  const captchaStatusId = React.useId();

  const captcha = resolveCaptchaContract(turnstileSiteKey);
  const canSubmit = canSubmitChallenge(captcha, captchaToken);

  const renewCaptcha = React.useCallback(() => {
    setCaptchaToken(null);
    setCaptchaResetSignal((value) => value + 1);
  }, []);

  const errorRef = React.useRef<HTMLDivElement | null>(null);
  // Guards a second submit while the first is still in flight — the button is
  // also disabled, but a disabled button is a UI affordance, not a guarantee.
  const inFlight = React.useRef(false);

  // Move focus to the error summary so a keyboard user is taken to the problem
  // instead of having to hunt for what changed.
  React.useEffect(() => {
    if (state.kind === "error") errorRef.current?.focus();
  }, [state]);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (inFlight.current) return;

      const localCode = localValidationCode(email, password);
      if (localCode) {
        setState({ kind: "error", code: localCode });
        return;
      }

      // Backstop for a submission that reached here without a solved challenge —
      // an Enter that raced the token, or a disabled attribute defeated in
      // devtools. The backend would refuse it anyway; refusing locally saves a
      // round trip and a login rate-limit slot.
      if (!canSubmitChallenge(captcha, captchaToken)) {
        setState({
          kind: "error",
          code: captcha.mode === "provider" ? "captcha_failed" : "captcha_configuration_error",
        });
        return;
      }

      inFlight.current = true;
      setState({ kind: "submitting" });

      let outcome: LoginOutcome;
      try {
        outcome = await loginImpl(email.trim(), password, { captchaToken: captchaToken ?? undefined });
      } finally {
        inFlight.current = false;
      }

      // Cleared on every path, success or failure.
      setPassword("");

      if (outcome.status === "success") {
        setState({ kind: "success" });
        // `replace`, not `push`: the login page must not sit in history behind an
        // authenticated workspace where Back would return to it.
        router.replace(consumeReturnPath());
        return;
      }

      // The token was almost certainly consumed server-side; a fresh challenge
      // is what makes the retry able to succeed.
      if (!KEEPS_TOKEN.has(outcome.code)) renewCaptcha();

      setState({
        kind: "error",
        code: outcome.code,
        ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
      });
    },
    [email, password, loginImpl, router, captcha, captchaToken, renewCaptcha],
  );

  const submitting = state.kind === "submitting";
  const copy = state.kind === "error" ? ERROR_COPY[state.code] : null;

  return (
    <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
      {/*
        The live region is always present rather than conditionally mounted:
        assistive tech announces changes to an existing region reliably, but a
        region that appears at the same moment as its text is often missed.
      */}
      <div aria-live="assertive" aria-atomic="true">
        {copy ? (
          <div
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="rounded border border-danger/40 bg-danger/10 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-sm font-semibold text-text-primary">{copy.title}</p>
            <p className="mt-1 text-sm text-text-secondary">{copy.detail}</p>
            {state.kind === "error" && state.requestId ? (
              <p className="mt-2 text-2xs text-text-muted">
                Код обращения: <span className="font-mono">{state.requestId}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {sessionExpired && state.kind === "idle" ? (
        <div role="status" className="rounded border border-border bg-elevated p-3">
          <p className="text-sm text-text-secondary">
            Сессия завершена. Войдите снова, чтобы продолжить работу.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor="crm-login-email" className="block text-sm font-medium text-text-primary">
          Рабочий email
        </label>
        <input
          id="crm-login-email"
          name="email"
          type="email"
          // Real autocomplete tokens: a password manager that cannot recognise
          // the fields is a password manager staff will work around.
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          disabled={submitting}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-describedby="crm-login-email-hint"
          className="mt-1 block h-9 w-full rounded border border-border bg-background px-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
        <p id="crm-login-email-hint" className="mt-1 text-2xs text-text-muted">
          Используйте рабочую учётную запись сотрудника.
        </p>
      </div>

      <div>
        <label htmlFor="crm-login-password" className="block text-sm font-medium text-text-primary">
          Пароль
        </label>
        <input
          id="crm-login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={submitting}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 block h-9 w-full rounded border border-border bg-background px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      {captcha.mode === "provider" ? (
        <TurnstileWidget
          siteKey={captcha.siteKey}
          action={TURNSTILE_CRM_LOGIN_ACTION}
          onToken={setCaptchaToken}
          // Expiry, timeout and provider error all mean the same thing: the
          // token in hand is dead. Clearing it re-disables submit, so a lapsed
          // challenge cannot be posted.
          onTokenLost={() => setCaptchaToken(null)}
          resetSignal={captchaResetSignal}
          describedById={captchaStatusId}
        />
      ) : (
        <div
          role="alert"
          data-testid="captcha-unavailable"
          className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-text-primary"
        >
          Вход временно недоступен: проверка безопасности не настроена. Обратитесь к администратору
          CRM.
        </div>
      )}

      {/* type="submit" keeps Enter working from either field with no key handler. */}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={submitting || !canSubmit}
        aria-describedby={!canSubmit && !submitting ? captchaStatusId : undefined}
      >
        {submitting ? "Выполняется вход…" : "Войти"}
      </Button>

      {/*
        A LIVE region, not a plain paragraph. This is the only explanation an
        employee gets for a submit button that will not activate, and a screen
        reader that is not told the region is live simply never announces it —
        leaving a disabled button with no stated reason.
      */}
      <p
        id={captchaStatusId}
        role="status"
        aria-live="polite"
        className="text-2xs text-text-muted"
      >
        {captcha.mode === "provider" && !captchaToken && !submitting
          ? "Пройдите проверку безопасности, чтобы продолжить."
          : ""}
      </p>

      <div aria-live="polite" className="min-h-4">
        {submitting ? (
          <p className="text-2xs text-text-muted">Проверяем учётные данные…</p>
        ) : null}
        {state.kind === "success" ? (
          <p className="text-2xs text-text-muted">Вход выполнен. Открываем рабочее пространство…</p>
        ) : null}
      </div>
    </form>
  );
}
