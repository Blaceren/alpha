"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CrmApiUserDetail } from "@/data/contracts/api/user-detail";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import { LOGIN_REDIRECT } from "@/components/crm-shell/session-boundary";
import { API_USERS_PATH } from "@/components/crm-shell/api-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useApiUserDetailQuery } from "./use-api-user-detail-query";

/**
 * Production learner detail FOUNDATION.
 *
 * Deliberately NOT the mock `User360Workspace`: the backend has no owner,
 * notes, financial, activity, lifecycle, timeline or recommendation data, so
 * this renders only the eight fields the contract actually carries. Sections
 * for unavailable data are omitted entirely rather than shown empty — an
 * "Owner: нет данных" row would imply the feature exists and is merely blank.
 *
 * It is read-only. There are no edit, block/unblock, reset or delete controls,
 * because no mutation endpoint exists.
 */

const STATUS_LABEL: Record<CrmApiUserDetail["status"], string> = {
  active: "Активен",
  blocked: "Заблокирован",
};

/** Deterministic, locale-safe date. Avoids host-locale drift between runs. */
export function formatDetailDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}`;
}

function BackLink() {
  return (
    <Link
      href={API_USERS_PATH}
      className="inline-flex items-center text-xs text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      ← К списку пользователей
    </Link>
  );
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-right text-text-primary">{children}</dd>
    </div>
  );
}

function DetailView({ detail }: { detail: CrmApiUserDetail }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold text-text-primary">{detail.displayName}</h1>
        <Badge tone={detail.status === "active" ? "success" : "danger"}>
          {STATUS_LABEL[detail.status]}
        </Badge>
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
          Идентификация
        </h2>
        <dl className="text-sm">
          <Row label="Email">
            <span className="font-mono text-xs">{detail.email.value}</span>
            <span className="ml-2 text-2xs text-text-muted">
              {detail.email.visibility === "full" ? "Полный email" : "Скрытый email"}
            </span>
          </Row>
          <Row label="Подтверждение email">
            {detail.emailConfirmed ? "Подтверждён" : "Не подтверждён"}
          </Row>
          <Row label="Регистрация">
            <span className="tabular-nums">{formatDetailDate(detail.createdAt)}</span>
          </Row>
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
          Прогресс
        </h2>
        <dl className="text-sm">
          <Row label="Уровень">
            <span className="tabular-nums">{detail.level}</span>
          </Row>
          <Row label="XP">
            <span className="tabular-nums">{detail.xp}</span>
          </Row>
        </dl>
      </section>

      <p className="text-2xs text-text-muted">
        Доступны только базовые данные учётной записи. Остальные разделы будут подключены
        следующими этапами.
      </p>
    </div>
  );
}

export function ApiUserDetailWorkspace({
  userId,
  provider,
}: {
  userId: string;
  provider?: CrmUsersReadCapability;
}) {
  const router = useRouter();
  const q = useApiUserDetailQuery(userId, provider);

  // A 401 means the employee session is no longer valid. Redirect rather than
  // render, and never leave the previous learner's data on screen.
  React.useEffect(() => {
    if (q.state.kind === "unauthenticated") router.replace(LOGIN_REDIRECT);
  }, [q.state.kind, router]);

  return (
    <div className="space-y-4">
      <BackLink />

      {q.state.kind === "loading" || q.state.kind === "retrying" ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем данные пользователя</span>
          <SkeletonRows rows={4} />
        </div>
      ) : null}

      {q.state.kind === "ready" ? <DetailView detail={q.state.detail} /> : null}

      {q.state.kind === "invalid_id" || q.state.kind === "invalid_input" ? (
        <Panel
          tone="alert"
          title="Некорректный идентификатор пользователя"
          description="Ссылка содержит неверный идентификатор. Вернитесь к списку и откройте пользователя заново."
        />
      ) : null}

      {q.state.kind === "unauthenticated" ? (
        <Panel title="Требуется вход" description="Перенаправляем на страницу входа…" />
      ) : null}

      {q.state.kind === "forbidden" ? (
        <Panel
          tone="alert"
          title="Нет доступа к данным CRM"
          description="У вашей учётной записи нет доступа к данным этого пользователя. Обратитесь к администратору CRM."
        >
          {q.state.requestId ? (
            <p className="mt-3 text-2xs text-text-muted">
              Код обращения: <span className="font-mono">{q.state.requestId}</span>
            </p>
          ) : null}
        </Panel>
      ) : null}

      {q.state.kind === "not_found" ? (
        // The backend deliberately cannot distinguish "no such learner" from
        // "this id is a staff or system account", so neither can this copy.
        <Panel
          tone="alert"
          title="Пользователь не найден"
          description="Такого пользователя нет в CRM. Возможно, он был удалён или ссылка устарела."
        />
      ) : null}

      {q.state.kind === "upstream_unavailable" ? (
        <Panel
          tone="alert"
          title="Сервис недоступен"
          description="Не удалось загрузить данные пользователя. Попробуйте ещё раз."
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
