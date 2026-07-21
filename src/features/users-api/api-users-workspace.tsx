"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CrmApiUser } from "@/data/contracts/api/users";
import { sessionGrants } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";
import { LOGIN_REDIRECT } from "@/components/crm-shell/session-boundary";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import {
  CRM_USERS_OWNER_FILTERS,
  isOwnerFilter,
  type CrmUsersOwnerFilter,
} from "@/application/api/users-owner-filter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useApiUsersQuery } from "./use-api-users-query";

/**
 * Production Users v1 list.
 *
 * Deliberately NOT the mock `UsersWorkspace`: the backend has no notes,
 * financial, lifecycle or activity data, so this renders only what is truthful.
 * The one relational field it can prove — the current owner's display name — is
 * shown as its own column and drives the owner filter. Rows link to the
 * production detail route only.
 */

const STATUS_LABEL: Record<CrmApiUser["status"], string> = {
  active: "Активен",
  blocked: "Заблокирован",
};

/** «Не назначен» — the frontend label for a `null` owner (pristine OR persisted
 *  unassigned; the list does not distinguish them). It is NOT a backend value. */
export const OWNER_UNASSIGNED_LABEL = "Не назначен";

/** Exact filter labels. `all` omits the URL parameter; `mine`/`unassigned` set it. */
export const OWNER_FILTER_LABEL: Record<CrmUsersOwnerFilter, string> = {
  all: "Все",
  mine: "Мои",
  unassigned: "Без ответственного",
};

/** Deterministic, locale-safe date. Avoids host-locale drift between runs. */
export function formatRegisteredAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

function Panel({
  title,
  description,
  children,
  tone = "status",
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  tone?: "status" | "alert";
}) {
  return (
    <div
      role={tone}
      aria-live="polite"
      className="rounded-lg border border-border bg-surface p-6 text-center"
    >
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">{description}</p>
      {children}
    </div>
  );
}

/**
 * The owner cell — the ONLY owner information the list carries. It renders the
 * live `displayName`, or «Не назначен» for a `null` owner. No employeeId,
 * ownerVersion, StaffRole, email, status, timestamp, edit control or candidate
 * selector: a list row names the owner, it never lets you act on them. A long
 * name wraps and keeps its full text available through `title`.
 */
function OwnerCell({ owner }: { owner: CrmApiUser["owner"] }) {
  if (owner === null) {
    return <span className="text-text-muted">{OWNER_UNASSIGNED_LABEL}</span>;
  }
  return (
    <span className="block max-w-[220px] break-words text-text-secondary" title={owner.displayName}>
      {owner.displayName}
    </span>
  );
}

function UsersTable({ items }: { items: CrmApiUser[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-2xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="px-3 py-2 font-medium">Имя</th>
            <th scope="col" className="px-3 py-2 font-medium">Email</th>
            <th scope="col" className="px-3 py-2 font-medium">Статус</th>
            <th scope="col" className="px-3 py-2 font-medium">Уровень</th>
            <th scope="col" className="px-3 py-2 font-medium">Email подтверждён</th>
            <th scope="col" className="px-3 py-2 font-medium">Ответственный</th>
            <th scope="col" className="px-3 py-2 font-medium">Регистрация</th>
          </tr>
        </thead>
        <tbody>
          {items.map((user) => (
            // userId is the React key only — it is never rendered.
            <tr key={user.userId} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium">
                {/*
                  A real link, not a click-only row: it is keyboard reachable,
                  carries an accessible name identifying the learner, and uses
                  the backend's opaque string id verbatim — never a number.
                */}
                <Link
                  href={`/users/${encodeURIComponent(user.userId)}`}
                  className="text-text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {user.displayName}
                </Link>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                {user.email.value}
                {user.email.visibility === "masked" ? (
                  <span className="sr-only"> (скрытый адрес)</span>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <Badge tone={user.status === "active" ? "success" : "danger"}>
                  {STATUS_LABEL[user.status]}
                </Badge>
              </td>
              <td className="px-3 py-2 tabular-nums text-text-secondary">{user.level}</td>
              <td className="px-3 py-2 text-text-secondary">
                {user.emailConfirmed ? "Подтверждён" : "Не подтверждён"}
              </td>
              <td className="px-3 py-2">
                <OwnerCell owner={user.owner} />
              </td>
              <td className="px-3 py-2 tabular-nums text-text-secondary">
                {formatRegisteredAt(user.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The owner filter — a labelled native select. One accessible control for every
 * viewport (44px min target), always exactly one selected value. It is shown to
 * EVERY authenticated employee: there is no `assign_owner` gate, no StaffRole
 * branch and no owner-candidates request behind it. There is no `assigned` and
 * no specific-owner option — the list only distinguishes all / mine / no owner.
 */
function OwnerFilterControl({
  value,
  onChange,
}: {
  value: CrmUsersOwnerFilter;
  onChange: (next: CrmUsersOwnerFilter) => void;
}) {
  return (
    <div className="min-w-[180px]">
      <label htmlFor="api-users-owner" className="block text-2xs text-text-muted">
        Ответственный
      </label>
      <select
        id="api-users-owner"
        value={value}
        aria-describedby="api-users-owner-mine-hint"
        onChange={(event) => {
          const next = event.target.value;
          if (isOwnerFilter(next)) onChange(next);
        }}
        className="mt-1 min-h-[44px] w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {CRM_USERS_OWNER_FILTERS.map((filter) => (
          <option
            key={filter}
            value={filter}
            title={filter === "mine" ? "Закреплённые за мной" : undefined}
          >
            {OWNER_FILTER_LABEL[filter]}
          </option>
        ))}
      </select>
      <span id="api-users-owner-mine-hint" className="sr-only">
        «Мои» — закреплённые за мной.
      </span>
    </div>
  );
}

export function ApiUsersWorkspace({ provider }: { provider?: CrmUsersReadCapability }) {
  const router = useRouter();
  const { session } = useSession();

  // Authority is the backend's effectivePermissions — never the role.
  const canSearchEmail = sessionGrants(session, "view_identity_full_email");

  const q = useApiUsersQuery({ canSearchEmail, provider, sessionEmployeeId: session.employeeId });

  // A 401 means the employee session is no longer valid. Redirect rather than
  // render, and never show the rows that were on screen a moment ago.
  React.useEffect(() => {
    if (q.state.kind === "unauthenticated") router.replace(LOGIN_REDIRECT);
  }, [q.state.kind, router]);

  const searchLabel = canSearchEmail ? "Имя или email" : "Имя";

  // Empty-state copy. A non-empty search takes precedence over the owner-filter
  // copy; otherwise mine/unassigned get their own guidance and `all` keeps the
  // existing neutral message. Raw query values and employee ids never appear.
  const emptyDescription = q.appliedSearch
    ? "По этому запросу пользователей нет. Измените запрос или сбросьте поиск."
    : q.ownerFilter === "mine"
      ? "За вами пока не закреплены пользователи."
      : q.ownerFilter === "unassigned"
        ? "Все пользователи закреплены за ответственными."
        : "Пользователи не найдены.";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold text-text-primary">Пользователи</h1>
        <p className="mt-1 text-xs text-text-muted">
          Данные загружаются из backend CRM. Часть разделов ещё не подключена.
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          q.submitSearch();
        }}
      >
        <div className="min-w-[220px] flex-1">
          <label htmlFor="api-users-search" className="block text-2xs text-text-muted">
            {searchLabel}
          </label>
          <input
            id="api-users-search"
            type="text"
            value={q.searchInput}
            onChange={(event) => q.setSearchInput(event.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-describedby={q.localSearchError ? "api-users-search-error" : undefined}
          />
        </div>
        {/* The owner filter is always visible — it stays put across loading and
            every error state, and always reflects the selected value. */}
        <OwnerFilterControl value={q.ownerFilter} onChange={q.setOwnerFilter} />
        <Button type="submit">Найти</Button>
        {q.appliedSearch || q.searchInput ? (
          <Button type="button" variant="secondary" onClick={q.clearSearch}>
            Сбросить
          </Button>
        ) : null}
      </form>

      {q.localSearchError ? (
        <p id="api-users-search-error" role="alert" className="text-xs text-danger">
          {q.localSearchError}
        </p>
      ) : null}

      {q.state.kind === "loading" || q.state.kind === "retrying" ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем список пользователей</span>
          <SkeletonRows rows={5} />
        </div>
      ) : null}

      {q.state.kind === "ready" && q.state.items.length > 0 ? (
        <>
          <UsersTable items={q.state.items} />
          <div className="flex items-center justify-between gap-3">
            {/* No total exists, so there is no "страница X из Y" — only a position. */}
            <p className="text-2xs text-text-muted">Страница {q.pageNumber}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={q.previousPage}
                disabled={!q.canGoPrevious}
              >
                Предыдущая
              </Button>
              <Button type="button" onClick={q.nextPage} disabled={!q.canGoNext}>
                Следующая
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {q.state.kind === "ready" && q.state.items.length === 0 ? (
        <Panel title="Ничего не найдено" description={emptyDescription} />
      ) : null}

      {q.state.kind === "invalid_input" ? (
        <Panel
          tone="alert"
          title="Некорректный запрос"
          description="Сервис не принял параметры поиска. Измените запрос и попробуйте снова."
        >
          {q.state.requestId ? (
            <p className="mt-3 text-2xs text-text-muted">
              Код обращения: <span className="font-mono">{q.state.requestId}</span>
            </p>
          ) : null}
        </Panel>
      ) : null}

      {q.state.kind === "unauthenticated" ? (
        <Panel title="Требуется вход" description="Перенаправляем на страницу входа…" />
      ) : null}

      {q.state.kind === "forbidden" ? (
        <Panel
          tone="alert"
          title="Нет доступа к данным CRM"
          description="У вашей учётной записи нет доступа к списку пользователей. Обратитесь к администратору CRM."
        >
          {q.state.requestId ? (
            <p className="mt-3 text-2xs text-text-muted">
              Код обращения: <span className="font-mono">{q.state.requestId}</span>
            </p>
          ) : null}
        </Panel>
      ) : null}

      {q.state.kind === "upstream_unavailable" ? (
        <Panel
          tone="alert"
          title="Сервис недоступен"
          description="Не удалось загрузить список пользователей. Попробуйте ещё раз."
        >
          <Button className="mt-4" onClick={q.retry}>
            Повторить
          </Button>
        </Panel>
      ) : null}

      {q.state.kind === "malformed" ? (
        <Panel
          tone="alert"
          title="Некорректный ответ сервиса"
          description="Ответ сервиса не прошёл проверку. Данные не показаны. Попробуйте ещё раз."
        >
          <Button className="mt-4" onClick={q.retry}>
            Повторить
          </Button>
        </Panel>
      ) : null}
    </div>
  );
}
