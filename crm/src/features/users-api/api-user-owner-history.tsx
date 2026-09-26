"use client";

import * as React from "react";
import type {
  CrmApiOwnerHistoryActor,
  CrmApiOwnerHistoryItem,
  CrmApiOwnerTransition,
} from "@/data/contracts/api/user-owner-history";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useApiUserOwnerHistory } from "./use-api-user-owner-history";

/**
 * Production Owner History (OH-1) — the immutable log of owner transitions.
 *
 * Read-only and permission-gated: the whole section is mounted only for a
 * session that holds `view_audit`, handed down as `canView`. There is no edit,
 * delete or manual-create control anywhere here — the backend has no such
 * endpoint, and history rows are written only as a side effect of assigning an
 * owner. The transition type is a closed enum derived server-side, so this
 * component maps it to a label rather than inventing one from ids.
 */

/** Deterministic UTC timestamp, matching the Notes section. The history
 * contract carries no staff timezone, so a local one would show two employees
 * different times for the same event; UTC is labelled explicitly. */
export function formatHistoryTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${date.getUTCFullYear()}, ${hh}:${mi} UTC`;
}

/** Human-readable transition labels. The meaning never relies on colour alone —
 * the label text carries it. */
const TRANSITION_LABEL: Record<CrmApiOwnerTransition, string> = {
  assigned: "Назначен",
  reassigned: "Изменён",
  unassigned: "Снят",
};

const TRANSITION_TONE: Record<CrmApiOwnerTransition, string> = {
  assigned: "text-success",
  reassigned: "text-text-primary",
  unassigned: "text-text-secondary",
};

function ownerLabel(owner: CrmApiOwnerHistoryActor | null): string {
  return owner ? owner.displayName : "Не назначен";
}

function HistoryRow({ item }: { item: CrmApiOwnerHistoryItem }) {
  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={`text-xs font-medium ${TRANSITION_TONE[item.transition]}`}>
          {TRANSITION_LABEL[item.transition]}
        </span>
        <time dateTime={item.createdAt} className="text-2xs tabular-nums text-text-muted">
          {formatHistoryTimestamp(item.createdAt)}
        </time>
      </div>
      {/* previous → next, both plain text and break-words so a long name never
          forces horizontal overflow at narrow breakpoints. */}
      <p className="mt-1 break-words text-xs text-text-primary">
        <span className="text-text-secondary">{ownerLabel(item.previousOwner)}</span>
        <span aria-hidden="true" className="px-1 text-text-muted">
          →
        </span>
        <span className="font-medium">{ownerLabel(item.nextOwner)}</span>
      </p>
      <p className="mt-1 text-2xs text-text-muted break-words">
        Сотрудник: <span className="text-text-secondary">{item.actor.displayName}</span>
      </p>
    </li>
  );
}

export function ApiUserOwnerHistorySection({
  userId,
  canView,
  provider,
  onUnauthenticated,
  onNotFound,
  sessionKey,
}: {
  userId: string;
  canView: boolean;
  provider?: CrmUsersReadCapability;
  onUnauthenticated: () => void;
  onNotFound: () => void;
  sessionKey?: string;
}) {
  const history = useApiUserOwnerHistory(
    userId,
    canView,
    provider,
    { onUnauthenticated, onNotFound },
    sessionKey,
  );

  // Permission-hidden: render nothing at all, so no request is ever made and no
  // empty teaser implies a feature the role may not use.
  if (!canView) return null;

  const { listState } = history;

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
        История ответственного
      </h2>

      {listState.kind === "loading" ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">Загружаем историю ответственного</span>
          <SkeletonRows rows={2} />
        </div>
      ) : null}

      {listState.kind === "ready" && history.items.length === 0 ? (
        // Honest empty state: history starts at the feature's launch, never a
        // fabricated backfill. Do not claim this is a complete history.
        <p className="text-xs text-text-secondary">
          Записей пока нет. История фиксирует изменения ответственного, сделанные после
          включения этой функции. Более ранние передачи ответственного недоступны.
        </p>
      ) : null}

      {history.items.length > 0 ? (
        <ol className="space-y-2">
          {history.items.map((item) => (
            <HistoryRow key={item.historyId} item={item} />
          ))}
        </ol>
      ) : null}

      {listState.kind === "ready" && history.hasMore ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={history.loadMore} disabled={history.loadingMore}>
            {history.loadingMore ? "Загружаем…" : "Показать ещё"}
          </Button>
        </div>
      ) : null}

      {history.loadMoreFailed ? (
        <p role="alert" className="mt-2 text-2xs text-danger">
          Не удалось загрузить следующую страницу истории. Попробуйте ещё раз.
        </p>
      ) : null}

      {listState.kind === "invalid_input" ? (
        <p role="alert" className="text-xs text-danger">
          Некорректный запрос истории
        </p>
      ) : null}

      {listState.kind === "forbidden" ? (
        <p className="text-xs text-text-secondary">Нет доступа к истории ответственного</p>
      ) : null}

      {listState.kind === "upstream_unavailable" || listState.kind === "malformed" ? (
        <div role="alert">
          <p className="text-xs text-danger">
            {listState.kind === "malformed"
              ? "Ответ сервиса не прошёл проверку. История не показана."
              : "Не удалось загрузить историю ответственного."}
          </p>
          <Button variant="secondary" className="mt-2" onClick={history.retryList}>
            Повторить
          </Button>
        </div>
      ) : null}
    </section>
  );
}
