"use client";

import * as React from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AFFILIATE_DEFAULT_LIMIT,
  fetchAffiliatePartners,
  type AffiliateOutcome,
} from "@/application/api/affiliates-client";
import type { AffiliatePartner, AffiliatePartnerList } from "@/data/contracts/api/affiliates";
import { useAffiliateAccess } from "./use-affiliate-access";
import { AffiliateSectionTabs } from "./affiliate-section-tabs";
import {
  AVAILABILITY_LABEL,
  ENTITY_STATUS_LABEL,
  describeAffiliateFailure,
  failureRequestId,
  formatDateTime,
  pluralDays,
  statusTone,
} from "./affiliate-labels";
import { PartnerFormDialog } from "./partner-form";
import { Field, Select, TextInput } from "./affiliate-form-fields";

/**
 * AFD-5A — the affiliate partner list.
 *
 * WHAT IS DELIBERATELY NOT HERE: clicks, unique visitors, registrations, first
 * deposits, conversion rates, revenue and current balance. The columns are
 * CONFIGURATION and INVENTORY only. A zero in an inventory column truthfully
 * means "no campaigns configured"; a zero in a traffic column would mean
 * "tracking ran and found nothing", which this phase cannot honestly claim.
 */

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; page: AffiliatePartnerList }
  | { kind: "error"; message: string; requestId?: string }
  | { kind: "forbidden"; message: string };

function outcomeToState(outcome: AffiliateOutcome<AffiliatePartnerList>): ViewState {
  if (outcome.status === "success") return { kind: "ready", page: outcome.data };
  if (outcome.status === "forbidden") {
    return { kind: "forbidden", message: describeAffiliateFailure(outcome) };
  }
  return {
    kind: "error",
    message: describeAffiliateFailure(outcome),
    requestId: failureRequestId(outcome),
  };
}

export function AffiliatesWorkspace() {
  const { canManage, readOnly } = useAffiliateAccess();

  const [state, setState] = React.useState<ViewState>({ kind: "loading" });
  const [searchInput, setSearchInput] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [offset, setOffset] = React.useState(0);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchAffiliatePartners({
      limit: AFFILIATE_DEFAULT_LIMIT,
      offset,
      search: appliedSearch || undefined,
      status: status || undefined,
    }).then((outcome) => {
      if (!cancelled) setState(outcomeToState(outcome));
    });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, status, offset, reloadToken]);

  const reload = React.useCallback(() => setReloadToken((n) => n + 1), []);

  const hasFilters = appliedSearch !== "" || status !== "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Аффилейты"
        description="Партнёры, кампании и трекинговые ссылки. Метрики трафика — на вкладке «Аналитика»."
        actions={
          canManage ? (
            <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
              Новый аффилейт
            </Button>
          ) : null
        }
      />

      {/* AFD-5C1. This page remains inventory-only; the tab is the way to the
          traffic numbers, which deliberately do not appear in these columns. */}
      <AffiliateSectionTabs active="management" />

      {readOnly ? (
        <p
          role="status"
          className="rounded-sm border border-border bg-surface px-2 py-1.5 text-xs text-text-secondary"
        >
          Режим только для чтения: у вас есть доступ к просмотру конфигурации аффилейтов, но не к её
          изменению.
        </p>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setAppliedSearch(searchInput.trim());
        }}
      >
        <div className="min-w-[12rem] flex-1">
          <Field id="affiliate-search" label="Поиск по названию или коду">
            {(aria) => (
              <TextInput
                {...aria}
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                maxLength={100}
                placeholder="Например: alpha"
              />
            )}
          </Field>
        </div>
        <div className="min-w-[10rem]">
          <Field id="affiliate-status" label="Статус">
            {(aria) => (
              <Select
                {...aria}
                value={status}
                onChange={(e) => {
                  setOffset(0);
                  setStatus(e.target.value);
                }}
              >
                <option value="">Все</option>
                <option value="active">Активные</option>
                <option value="paused">На паузе</option>
                <option value="archived">В архиве</option>
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Найти
        </Button>
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchInput("");
              setAppliedSearch("");
              setStatus("");
              setOffset(0);
            }}
          >
            Сбросить
          </Button>
        ) : null}
      </form>

      <PartnerListBody
        state={state}
        hasFilters={hasFilters}
        canManage={canManage}
        onRetry={reload}
        onCreate={() => setCreateOpen(true)}
      />

      {state.kind === "ready" ? (
        <Pagination
          total={state.page.total}
          limit={state.page.limit}
          offset={state.page.offset}
          onChange={setOffset}
        />
      ) : null}

      {canManage ? (
        <PartnerFormDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

function PartnerListBody({
  state,
  hasFilters,
  canManage,
  onRetry,
  onCreate,
}: {
  state: ViewState;
  hasFilters: boolean;
  canManage: boolean;
  onRetry: () => void;
  onCreate: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">Загрузка списка аффилейтов</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <EmptyState
        title="Нет доступа"
        description={`${state.message} Раздел «Аффилейты» доступен ролям с правом просмотра аффилейтов.`}
      />
    );
  }

  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-text-primary"
      >
        <p>{state.message}</p>
        {state.requestId ? (
          <p className="mt-1 text-2xs text-text-secondary">
            Код обращения: <code className="font-mono">{state.requestId}</code>
          </p>
        ) : null}
        <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  }

  if (state.page.items.length === 0) {
    return hasFilters ? (
      <EmptyState
        title="Ничего не найдено"
        description="Под текущие фильтры не подходит ни один аффилейт. Измените запрос или сбросьте фильтры."
      />
    ) : (
      <EmptyState
        title="Аффилейтов пока нет"
        description={
          canManage
            ? "Создайте первого партнёра, чтобы затем добавить кампании и трекинговые ссылки."
            : "Партнёры ещё не заведены."
        }
        action={
          canManage ? (
            <Button type="button" size="sm" onClick={onCreate}>
              Новый аффилейт
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <>
      {/* Wide layout: a real table, horizontally scrollable inside its own box
          so the PAGE never scrolls sideways. */}
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <caption className="sr-only">Список аффилейт-партнёров</caption>
          <thead className="border-b border-border bg-surface text-2xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Название</th>
              <th scope="col" className="px-3 py-2 font-medium">Код</th>
              <th scope="col" className="px-3 py-2 font-medium">Статус</th>
              <th scope="col" className="px-3 py-2 font-medium">Доступность</th>
              <th scope="col" className="px-3 py-2 font-medium">Окно</th>
              <th scope="col" className="px-3 py-2 font-medium">Кампании</th>
              <th scope="col" className="px-3 py-2 font-medium">Ссылки</th>
              <th scope="col" className="px-3 py-2 font-medium">Создан</th>
            </tr>
          </thead>
          <tbody>
            {state.page.items.map((partner) => (
              <tr key={partner.id} className="border-b border-border last:border-0 hover:bg-row-hover">
                <td className="px-3 py-2">
                  <Link
                    href={`/affiliates/${partner.id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {partner.displayName}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-text-secondary">{partner.code}</td>
                <td className="px-3 py-2">
                  <StatusBadge
                    tone={statusTone(partner.status)}
                    label={ENTITY_STATUS_LABEL[partner.status]}
                  />
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {AVAILABILITY_LABEL[partner.availability]}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {pluralDays(partner.defaultAttributionWindowDays)}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {partner.inventory.campaigns}
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {partner.inventory.trackingLinks}
                  <span className="text-text-muted">
                    {" "}
                    (активных: {partner.inventory.activeTrackingLinks})
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-text-secondary">
                  {formatDateTime(partner.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow layout: cards, so nothing is clipped or hidden on a phone. */}
      <ul className="space-y-2 md:hidden">
        {state.page.items.map((partner) => (
          <li key={partner.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <Link
                href={`/affiliates/${partner.id}`}
                className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {partner.displayName}
              </Link>
              <StatusBadge
                tone={statusTone(partner.status)}
                label={ENTITY_STATUS_LABEL[partner.status]}
              />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-text-secondary">Код</dt>
              <dd className="font-mono text-text-primary">{partner.code}</dd>
              <dt className="text-text-secondary">Доступность</dt>
              <dd className="text-text-primary">{AVAILABILITY_LABEL[partner.availability]}</dd>
              <dt className="text-text-secondary">Окно</dt>
              <dd className="text-text-primary">
                {pluralDays(partner.defaultAttributionWindowDays)}
              </dd>
              <dt className="text-text-secondary">Кампании</dt>
              <dd className="text-text-primary">{partner.inventory.campaigns}</dd>
              <dt className="text-text-secondary">Ссылки</dt>
              <dd className="text-text-primary">
                {partner.inventory.trackingLinks} (активных:{" "}
                {partner.inventory.activeTrackingLinks})
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pagination({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  const canPrevious = offset > 0;
  const canNext = offset + limit < total;

  if (total <= limit && offset === 0) return null;

  return (
    <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Постраничная навигация">
      <p className="text-xs text-text-secondary" aria-live="polite">
        Показаны {from}–{to} из {total}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canPrevious}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Назад
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canNext}
          onClick={() => onChange(offset + limit)}
        >
          Вперёд
        </Button>
      </div>
    </nav>
  );
}
