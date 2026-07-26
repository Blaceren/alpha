"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { login, type LoginOutcome } from "@/application/api/auth-client";
import { consumeReturnPath } from "@/domain/identity/return-path";
import type { LoginErrorCode } from "@/data/contracts/api/auth";

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

export interface LoginFormProps {
  /** Set when the boundary bounced the employee here; drives the notice. */
  sessionExpired?: boolean;
  /** Injection seam for tests; production uses the real client. */
  loginImpl?: typeof login;
}

export function LoginForm({ sessionExpired = false, loginImpl = login }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [state, setState] = React.useState<LoginFormState>({ kind: "idle" });

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

      inFlight.current = true;
      setState({ kind: "submitting" });

      let outcome: LoginOutcome;
      try {
        outcome = await loginImpl(email.trim(), password);
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

      setState({
        kind: "error",
        code: outcome.code,
        ...(outcome.requestId ? { requestId: outcome.requestId } : {}),
      });
    },
    [email, password, loginImpl, router],
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

      {/* type="submit" keeps Enter working from either field with no key handler. */}
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>
        {submitting ? "Выполняется вход…" : "Войти"}
      </Button>

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
