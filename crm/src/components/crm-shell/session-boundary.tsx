"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CRM_ROLE_LABEL } from "@/domain/identity/roles";
import { sessionFromDto, type EmployeeSession } from "@/domain/identity/session";
import { fetchSession, type SessionOutcome } from "@/application/session-client";
import { rememberReturnPath } from "@/domain/identity/return-path";
import { AuthenticatedSessionProvider } from "./session-context";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { Button } from "@/components/ui/button";

/** Where an unauthenticated employee is sent. A fixed literal, never built from input. */
export const LOGIN_REDIRECT = "/login?reason=session_required";

type BoundaryState =
  | { kind: "loading" }
  | { kind: "retrying" }
  | { kind: "authenticated"; session: EmployeeSession }
  | { kind: "unauthenticated" }
  | { kind: "forbidden"; requestId?: string }
  | { kind: "upstream_unavailable" }
  | { kind: "malformed" };

function outcomeToState(outcome: SessionOutcome): BoundaryState {
  switch (outcome.status) {
    case "authenticated":
      return { kind: "authenticated", session: sessionFromDto(outcome.dto) };
    case "unauthenticated":
      return { kind: "unauthenticated" };
    case "forbidden":
      return { kind: "forbidden", requestId: outcome.requestId };
    case "upstream_unavailable":
      return { kind: "upstream_unavailable" };
    case "malformed_response":
      return { kind: "malformed" };
  }
}

/** A calm, chrome-free panel. Used for every non-authenticated terminal state. */
function BoundaryPanel({
  title,
  description,
  children,
  role = "status",
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div
        role={role}
        aria-live="polite"
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-6"
      >
        <h1 className="text-base font-semibold text-text-primary">{title}</h1>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
        {children}
      </div>
    </div>
  );
}

export interface SessionBoundaryProps {
  /** Rendered only once a validated session exists. */
  children: React.ReactNode;
  /** Injection seam for component tests; production uses the real client. */
  fetchSessionImpl?: typeof fetchSession;
}

/**
 * The production session boundary (api mode only).
 *
 * Nothing below it renders until `GET /api/crm/v1/session` has returned a
 * payload that passed strict validation. Every other outcome is terminal and
 * fails closed — there is no mock fallback and no partially-trusted state.
 */
export function SessionBoundary({ children, fetchSessionImpl = fetchSession }: SessionBoundaryProps) {
  const router = useRouter();
  const [state, setState] = React.useState<BoundaryState>({ kind: "loading" });

  // Guards a retry against being started twice (double click, or a click while
  // the first attempt is still in flight).
  const inFlight = React.useRef(false);

  const load = React.useCallback(
    async (mode: "initial" | "retry") => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ kind: mode === "initial" ? "loading" : "retrying" });

      const controller = new AbortController();
      try {
        const outcome = await fetchSessionImpl({ signal: controller.signal });
        setState(outcomeToState(outcome));
      } finally {
        inFlight.current = false;
      }
    },
    [fetchSessionImpl],
  );

  React.useEffect(() => {
    void load("initial");
  }, [load]);

  // Redirect rather than render for an unauthenticated employee. The target is
  // a fixed literal, so there is no redirect parameter an attacker could steer.
  //
  // Where the employee was heading is remembered in sessionStorage instead of in
  // the URL — same reason: a return path in a link is a return path an attacker
  // can choose. See domain/identity/return-path.ts.
  React.useEffect(() => {
    if (state.kind !== "unauthenticated") return;
    rememberReturnPath(window.location.pathname + window.location.search);
    router.replace(LOGIN_REDIRECT);
  }, [state.kind, router]);

  const retry = React.useCallback(() => void load("retry"), [load]);

  switch (state.kind) {
    case "loading":
    case "retrying":
      return (
        <BoundaryPanel
          title="Проверяем сессию сотрудника"
          description={
            state.kind === "retrying"
              ? "Повторная проверка сессии…"
              : "Подождите, идёт проверка доступа."
          }
        />
      );

    case "unauthenticated":
      // The redirect is already scheduled; render a quiet placeholder rather
      // than any CRM chrome while it happens.
      return (
        <BoundaryPanel
          title="Требуется вход"
          description="Перенаправляем на страницу входа…"
        />
      );

    case "forbidden":
      return (
        <BoundaryPanel
          role="alert"
          title="Нет доступа к CRM"
          description="У вашей учётной записи нет доступа к этому рабочему пространству. Обратитесь к администратору CRM."
        >
          {state.requestId ? (
            <p className="mt-3 text-2xs text-text-muted">
              Код обращения: <span className="font-mono">{state.requestId}</span>
            </p>
          ) : null}
          {/*
            A session that is valid but not a CRM employee is a dead end, so the
            one available action is to leave. CRM login itself never produces this
            state — the login route drops the cookie for a non-staff account — but
            a session obtained elsewhere on the same host can still land here.
          */}
          <SignOutButton className="mt-4 w-full" />
        </BoundaryPanel>
      );

    case "upstream_unavailable":
      return (
        <BoundaryPanel
          role="alert"
          title="Сервис недоступен"
          description="Не удалось проверить сессию сотрудника. Попробуйте ещё раз."
        >
          <Button className="mt-4 w-full" onClick={retry}>
            Повторить
          </Button>
        </BoundaryPanel>
      );

    case "malformed":
      return (
        <BoundaryPanel
          role="alert"
          title="Некорректный ответ сервиса"
          description="Ответ сервиса сессии не прошёл проверку. Доступ закрыт. Попробуйте ещё раз."
        >
          <Button className="mt-4 w-full" onClick={retry}>
            Повторить
          </Button>
        </BoundaryPanel>
      );

    case "authenticated":
      return (
        <AuthenticatedSessionProvider session={state.session}>
          {children}
        </AuthenticatedSessionProvider>
      );
  }
}

/**
 * The truthful api-mode landing state.
 *
 * `ApiCrmDataProvider` does not exist yet, so there is no honest CRM data to
 * show. Rendering the existing mock workspace here would be a lie — a confirmed
 * production session silently unlocking synthetic users, balances and notes.
 * Instead we confirm the session and say plainly what is not connected yet.
 *
 * Deliberately absent: employeeId, effectivePermissions, expiresAt,
 * permissionVersion and any CRM counts.
 */
export function ApiSessionConfirmed({ session }: { session: EmployeeSession }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
          ATA
        </span>
        <h1 className="mt-4 text-base font-semibold text-text-primary">
          Сессия сотрудника подтверждена
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Подключение данных CRM будет добавлено следующим этапом.
        </p>
        <dl className="mt-4 border-t border-border pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-text-muted">Сотрудник</dt>
            <dd className="font-medium text-text-primary">{session.displayName}</dd>
          </div>
          <div className="mt-2 flex justify-between gap-4">
            <dt className="text-text-muted">Роль</dt>
            <dd className="text-text-secondary">{CRM_ROLE_LABEL[session.role]}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
