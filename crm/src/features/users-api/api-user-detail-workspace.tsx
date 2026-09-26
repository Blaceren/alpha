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
import { useSession } from "@/components/crm-shell/session-context";
import { sessionGrants } from "@/domain/identity/access";
import { useApiUserDetailQuery } from "./use-api-user-detail-query";
import { ApiUserNotesSection } from "./api-user-notes";
import { ApiUserProgressionSection } from "./api-user-progression";
import { ApiUserOwnerSection } from "./api-user-owner";
import { ApiUserOwnerHistorySection } from "./api-user-owner-history";

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

function DetailView({
  detail,
  progression,
  owner,
  ownerHistory,
  notes,
}: {
  detail: CrmApiUserDetail;
  progression?: React.ReactNode;
  owner?: React.ReactNode;
  ownerHistory?: React.ReactNode;
  notes?: React.ReactNode;
}) {
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

      {/*
        PHASE-1 ADMIN. The section that used to live here rendered `detail.level`
        and `detail.xp` under the heading «Прогресс». Those are the LEGACY V1
        columns: in PREPROD they read 1 and 0 for every learner, including ones
        who have completed fourteen V2 levels, so the number an operator read was
        not the learner's Academy progress and never had been. It is replaced by
        the canonical V2 owner, which also carries the legacy pair — clearly
        labelled as V1 and explicitly marked as not being Academy progression.
      */}
      {progression}

      {owner}

      {ownerHistory}

      {notes}

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
  const { session } = useSession();

  // Notes affordances come from the backend's effectivePermissions ONLY. The
  // role name is never consulted: a backend that says `role=crm_admin,
  // effectivePermissions=[]` grants nothing here. The two permissions are
  // checked independently — neither implies the other, and `edit_user_notes`
  // grants neither.
  const canListNotes = sessionGrants(session, "view_user_notes");
  const canCreateNotes = sessionGrants(session, "create_user_notes");

  // Owner affordances also come from effectivePermissions ONLY. The current
  // owner is read for every StaffProfile; only `assign_owner` mounts the editing
  // controls. The role name is never consulted.
  const canAssignOwner = sessionGrants(session, "assign_owner");

  // Owner HISTORY is read-gated by `view_audit` ONLY — never `assign_owner`, so
  // a role that may reassign the owner (retention_manager) still does not see the
  // log. Without it the section is not mounted at all, so no request is made.
  const canViewOwnerHistory = sessionGrants(session, "view_audit");

  // A Notes or Owner 404 means the learner is gone or is not a learner at all,
  // which is an answer about the whole detail, not about one section. An Owner
  // 403 (no StaffProfile) is likewise a whole-detail denial.
  const [notesNotFound, setNotesNotFound] = React.useState(false);
  const [ownerNotFound, setOwnerNotFound] = React.useState(false);
  const [ownerForbidden, setOwnerForbidden] = React.useState(false);
  const learnerNotFound = notesNotFound || ownerNotFound;
  const handleNotesUnauthenticated = React.useCallback(
    () => router.replace(LOGIN_REDIRECT),
    [router],
  );
  const handleNotesNotFound = React.useCallback(() => setNotesNotFound(true), []);
  const handleOwnerNotFound = React.useCallback(() => setOwnerNotFound(true), []);
  const handleOwnerForbidden = React.useCallback(() => setOwnerForbidden(true), []);
  React.useEffect(() => {
    setNotesNotFound(false);
    setOwnerNotFound(false);
    setOwnerForbidden(false);
  }, [userId]);

  // A stable key that changes when the employee session changes, so the Owner
  // section refetches cleanly under the new identity.
  const sessionKey = session ? `${session.employeeId}:${session.permissionVersion}` : undefined;

  // Ready, and ready for THIS learner.
  const detailMatches = q.state.kind === "ready" && q.state.detail.userId === userId;
  const staleDetail = q.state.kind === "ready" && !detailMatches;

  // A 401 means the employee session is no longer valid. Redirect rather than
  // render, and never leave the previous learner's data on screen.
  React.useEffect(() => {
    if (q.state.kind === "unauthenticated") router.replace(LOGIN_REDIRECT);
  }, [q.state.kind, router]);

  return (
    <div className="space-y-4">
      <BackLink />

      {q.state.kind === "loading" || q.state.kind === "retrying" || staleDetail ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем данные пользователя</span>
          <SkeletonRows rows={4} />
        </div>
      ) : null}

      {/*
        `detailMatches` guards a real one-frame hazard: when the route userId
        changes, React renders with the NEW id while the previous learner's
        detail is still in state, before the refetch effect runs. Rendering
        that frame would briefly show one learner's data under another's route
        and would start a Notes request that is immediately superseded.
      */}
      {detailMatches && !learnerNotFound && !ownerForbidden ? (
        <DetailView
          detail={(q.state as { detail: CrmApiUserDetail }).detail}
          progression={
            // Mounted for every StaffProfile: the backend read gate decides
            // whether it answers, and a section that self-hides on a client-side
            // permission guess would be a second, weaker authorization model.
            // The ADJUST control inside mounts only for
            // `curriculum_progress_override`, and the backend re-checks it.
            <ApiUserProgressionSection
              userId={userId}
              legacyLevel={(q.state as { detail: CrmApiUserDetail }).detail.level}
              legacyXp={(q.state as { detail: CrmApiUserDetail }).detail.xp}
            />
          }
          owner={
            // The Owner section is mounted for every StaffProfile — the current
            // owner is universally visible. Editing controls inside decide
            // themselves whether to mount, from `assign_owner`.
            <ApiUserOwnerSection
              userId={userId}
              canAssign={canAssignOwner}
              provider={provider}
              onUnauthenticated={handleNotesUnauthenticated}
              onLearnerNotFound={handleOwnerNotFound}
              onForbidden={handleOwnerForbidden}
              sessionKey={sessionKey}
            />
          }
          ownerHistory={
            // Mounted only for `view_audit`; the section self-hides otherwise and
            // makes no request. A history 404 is a whole-detail answer (the
            // learner is gone), and a 401 redirects — the same handlers the other
            // sections use.
            canViewOwnerHistory ? (
              <ApiUserOwnerHistorySection
                userId={userId}
                canView={canViewOwnerHistory}
                provider={provider}
                onUnauthenticated={handleNotesUnauthenticated}
                onNotFound={handleOwnerNotFound}
                sessionKey={sessionKey}
              />
            ) : null
          }
          notes={
            // Neither permission -> the section is not mounted at all, so no
            // Notes request is ever made.
            canListNotes || canCreateNotes ? (
              <ApiUserNotesSection
                userId={userId}
                canList={canListNotes}
                canCreate={canCreateNotes}
                provider={provider}
                onUnauthenticated={handleNotesUnauthenticated}
                onNotFound={handleNotesNotFound}
              />
            ) : null
          }
        />
      ) : null}

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

      {learnerNotFound && q.state.kind === "ready" ? (
        <Panel
          tone="alert"
          title="Пользователь не найден"
          description="Такого пользователя нет в CRM. Возможно, он был удалён или ссылка устарела."
        />
      ) : null}

      {ownerForbidden && !learnerNotFound && q.state.kind === "ready" ? (
        // An Owner 403 means the session is not a usable CRM employee — the same
        // no-StaffProfile denial the detail read would surface.
        <Panel
          tone="alert"
          title="Нет доступа к данным CRM"
          description="У вашей учётной записи нет доступа к данным этого пользователя. Обратитесь к администратору CRM."
        />
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
