"use client";

import * as React from "react";
import Link from "next/link";
import { CRM_ROLE_LABEL } from "@/domain/identity/roles";
import type { EmployeeSession } from "@/domain/identity/session";
import { SignOutButton } from "@/features/auth/sign-out-button";

/**
 * Bounded api-mode shell.
 *
 * Deliberately NOT the mock `MockShell`: that one renders the full sidebar with
 * Today, Audit, Financial, Tasks, Cases and Settings, none of which have a
 * backend. Showing them would imply those sections work. This shell exposes
 * exactly the one connected capability — Пользователи — and nothing else.
 *
 * It never renders RoleSwitch (there is no local role to switch), mock counts,
 * fake notifications, the employeeId, the permission list or anything about the
 * backend origin or environment.
 */
export const API_USERS_PATH = "/users";

export function ApiShell({
  session,
  children,
}: {
  session: EmployeeSession;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {/*
        Every child here is a flex item with the default `min-width: auto`, so the
        header's width floor is the SUM of its children's min-content widths. Once
        that floor exceeds the viewport the header — a block in the full-height
        column — widens the document itself, which is a document-level horizontal
        scroll at 320px and at 200% zoom.

        The floor is therefore made explicit instead of accidental: the badge, the
        section navigation and the sign-out action never shrink (they are the
        things an employee must still be able to reach), the wordmark is dropped
        on narrow viewports because the badge beside it already carries the brand,
        and the identity text is the one element allowed to give — it truncates.
      */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-2xs font-bold text-accent-foreground">
          ATA
        </span>
        {/*
          `md` rather than `sm`: at 200% zoom the viewport is still ~640px wide
          (a breakpoint is a CSS pixel query and does not move when the root font
          size doubles), while every box inside it is twice as large. Hiding the
          wordmark only below `sm` therefore still left the identity text with a
          few pixels at 200% zoom and rendered it as a bare ellipsis.
        */}
        <span className="hidden text-sm font-semibold text-text-primary md:inline">ATA CRM</span>

        <nav aria-label="Разделы CRM" className="ml-4 shrink-0">
          <ul>
            <li>
              <Link
                href={API_USERS_PATH}
                aria-current="page"
                className="rounded px-2 py-1 text-sm font-medium text-text-primary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Пользователи
              </Link>
            </li>
          </ul>
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-3">
          {/*
            `min-w-0` + `truncate`: without both, the name's min-content width is a
            hard floor no amount of available space can reduce. `title` keeps the
            full name reachable when it is visually clipped.
          */}
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium text-text-primary" title={session.displayName}>
              {session.displayName}
            </p>
            <p className="truncate text-2xs text-text-muted">{CRM_ROLE_LABEL[session.role]}</p>
          </div>
          <SignOutButton className="shrink-0" />
        </div>
      </header>

      <main id="crm-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 focus:outline-none">
        {/*
          `min-w-0` lets this container shrink below its content width. Without it,
          `main`'s default `min-width: auto` as a column flex item allows wide
          content (a data table) to widen the document instead of scrolling inside
          its own container.
        */}
        <div className="mx-auto min-w-0 max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

/**
 * The truthful state for every api-mode route that is not `/users`.
 *
 * `ApiSessionConfirmed` in session-boundary.tsx covers the pre-Users case; this
 * variant adds a way back to the one section that does work, without implying
 * the requested section exists.
 */
export function ApiRouteDeferred({ session }: { session: EmployeeSession }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
          ATA
        </span>
        <h1 className="mt-4 text-base font-semibold text-text-primary">
          Раздел ещё не подключён
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Сессия сотрудника подтверждена. Из данных CRM сейчас доступен только список
          пользователей — остальные разделы будут подключены следующими этапами.
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
        <Link
          href={API_USERS_PATH}
          className="mt-4 inline-flex h-9 items-center rounded bg-accent px-3.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Перейти к пользователям
        </Link>
      </div>
    </div>
  );
}
