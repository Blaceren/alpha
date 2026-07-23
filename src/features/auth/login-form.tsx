"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import * as api from "@/lib/api/client";
import type { ErrorCategory } from "@/lib/api/errors";
import { sanitizeReturnTo } from "@/lib/auth/return-to";

/**
 * Generic, account-enumeration-safe messages. An unknown user and a wrong
 * password map to the SAME message, and no raw Backend string is ever shown.
 */
function messageFor(category: ErrorCategory): string {
  switch (category) {
    case "INVALID_CREDENTIALS":
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return "Неверный email или пароль.";
    case "VALIDATION_ERROR":
      return "Проверьте введённые данные.";
    case "RATE_LIMITED":
      return "Слишком много попыток. Попробуйте позже.";
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Сервис временно недоступен. Повторите попытку.";
    case "CONFIGURATION_ERROR":
      return "Вход временно недоступен.";
    default:
      return "Не удалось войти. Повторите попытку.";
  }
}

type FormError = { message: string; requestId: string | null; retryable: boolean };

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("next"));

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    const result = await api.login({ email, password });
    if (!result.ok) {
      setError({
        message: messageFor(result.error.category),
        requestId: result.error.requestId,
        retryable: result.error.retryable,
      });
      setSubmitting(false);
      return;
    }

    // Confirm the session was established before navigating.
    const session = await api.fetchSession();
    if (!session.ok || !session.data.user) {
      setError({
        message: messageFor(session.ok ? "UNKNOWN_ERROR" : session.error.category),
        requestId: session.ok ? null : session.error.requestId,
        retryable: true,
      });
      setSubmitting(false);
      return;
    }

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

      {error ? (
        <p id={errorId} className="login-error" role="alert">
          <span>{error.message}</span>
          {error.requestId ? (
            <span className="login-error__ref"> (код обращения: {error.requestId})</span>
          ) : null}
        </p>
      ) : null}

      <button type="submit" className="login-submit" disabled={submitting} aria-busy={submitting}>
        {submitting ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}
