"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/states/empty-state";
import { fetchNewsList, type NewsFilter, type NewsOutcome } from "@/application/api/news-client";
import type { NewsList } from "@/data/contracts/api/news";
import { Field, Select } from "@/features/affiliates/affiliate-form-fields";
import {
  IMPORTANCE_WORDS,
  NEWS_NEW_PATH,
  NEWS_STATUS_LABEL,
  browserTimeZone,
  importanceDots,
  newsItemPath,
  releaseWords,
  zoneLabel,
} from "./news-model";

/**
 * TOOLS-V2 NEWS — the copywriter's list.
 *
 * Every economic release written so far, drafts included, newest release
 * first. A published item is a public page and a row in the learners' News
 * Calendar; a draft is neither. Times are shown in the viewer's own zone and
 * the zone is named, because a release typed in Warsaw is read everywhere.
 */

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; list: NewsList }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

function describeFailure(outcome: Exclude<NewsOutcome<unknown>, { status: "success" }>): string {
  switch (outcome.status) {
    case "unauthenticated":
      return "Сессия закончилась. Войдите снова.";
    case "rate_limited":
      return "Слишком много запросов подряд. Подождите минуту.";
    case "upstream_unavailable":
      return "Нет связи с сервером. Попробуйте ещё раз.";
    default:
      return "Список не загрузился. Попробуйте ещё раз.";
  }
}

export function NewsWorkspace() {
  const [filter, setFilter] = React.useState<NewsFilter>("all");
  const [page, setPage] = React.useState(1);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [state, setState] = React.useState<ViewState>({ kind: "loading" });
  const zone = React.useMemo(() => browserTimeZone(), []);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void fetchNewsList({ status: filter, page }).then((outcome) => {
      if (cancelled) return;
      if (outcome.status === "success") setState({ kind: "ready", list: outcome.data });
      else if (outcome.status === "forbidden") setState({ kind: "forbidden" });
      else setState({ kind: "error", message: describeFailure(outcome) });
    });
    return () => {
      cancelled = true;
    };
  }, [filter, page, reloadToken]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Новости"
        description="Экономические новости для News Calendar учеников. Опубликованная новость — отдельная публичная страница и строка в календаре; черновик не виден никому, кроме редакции."
        actions={
          state.kind === "forbidden" ? null : (
            <Button asChild size="sm">
              <Link href={NEWS_NEW_PATH}>Новая новость</Link>
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[12rem]">
          <Field id="news-filter" label="Показать">
            {(aria) => (
              <Select
                {...aria}
                value={filter}
                onChange={(event) => {
                  setPage(1);
                  setFilter(event.target.value as NewsFilter);
                }}
              >
                <option value="all">Все</option>
                <option value="draft">Черновики</option>
                <option value="published">Опубликованные</option>
              </Select>
            )}
          </Field>
        </div>
        <p className="text-2xs text-text-secondary">Время выхода — по вашему поясу: {zoneLabel(zone)}</p>
      </div>

      <NewsListBody state={state} zone={zone} onRetry={() => setReloadToken((n) => n + 1)} filtered={filter !== "all"} />

      {state.kind === "ready" && state.list.pageCount > 1 ? (
        <nav aria-label="Страницы списка" className="flex items-center justify-between gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Назад
          </Button>
          <p className="text-xs text-text-secondary">
            Страница {state.list.page} из {state.list.pageCount}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= state.list.pageCount}
            onClick={() => setPage(page + 1)}
          >
            Дальше
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

function NewsListBody({
  state,
  zone,
  filtered,
  onRetry,
}: {
  state: ViewState;
  zone: string;
  filtered: boolean;
  onRetry: () => void;
}) {
  if (state.kind === "loading") {
    return (
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">Загрузка новостей</span>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (state.kind === "forbidden") {
    return (
      <EmptyState
        title="Нет доступа"
        description="Раздел «Новости» доступен копирайтерам и администраторам CRM."
      />
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-3 text-sm text-text-primary">
        <p>{state.message}</p>
        <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
          Повторить
        </Button>
      </div>
    );
  }
  if (state.list.items.length === 0) {
    return filtered ? (
      <EmptyState title="Ничего не найдено" description="В этом статусе новостей нет." />
    ) : (
      <EmptyState
        title="Новостей пока нет"
        description="Добавьте первую: страну, время выхода, важность и лид. Опубликуйте — и она появится в календаре учеников и на сайте."
        action={
          <Button asChild size="sm">
            <Link href={NEWS_NEW_PATH}>Новая новость</Link>
          </Button>
        }
      />
    );
  }

  const { items } = state.list;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">Новости, сначала поздние по времени выхода</caption>
          <thead className="border-b border-border bg-surface text-2xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Выход</th>
              <th scope="col" className="px-3 py-2 font-medium">Страна</th>
              <th scope="col" className="px-3 py-2 font-medium">Новость</th>
              <th scope="col" className="px-3 py-2 font-medium">Важность</th>
              <th scope="col" className="px-3 py-2 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border last:border-0 hover:bg-row-hover">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-text-secondary">{releaseWords(item.releaseAt, zone)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-text-secondary">
                  {item.countryLabel} · <span className="font-mono text-xs">{item.currency}</span>
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={newsItemPath(item.id)}
                    className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.title}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span aria-hidden className="tracking-widest text-text-primary">
                    {importanceDots(item.importance)}
                  </span>
                  <span className="sr-only">{IMPORTANCE_WORDS[item.importance]}</span>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge
                    tone={item.status === "published" ? "success" : "neutral"}
                    label={NEWS_STATUS_LABEL[item.status]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden" aria-label="Новости">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2 text-2xs text-text-secondary">
              <span className="tabular-nums">{releaseWords(item.releaseAt, zone)}</span>
              <StatusBadge tone={item.status === "published" ? "success" : "neutral"} label={NEWS_STATUS_LABEL[item.status]} />
            </div>
            <Link
              href={newsItemPath(item.id)}
              className="mt-1 block font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.title}
            </Link>
            <p className="mt-1 text-xs text-text-secondary">
              {item.countryLabel} · {item.currency} ·{" "}
              <span aria-hidden className="tracking-widest">
                {importanceDots(item.importance)}
              </span>
              <span className="sr-only">{IMPORTANCE_WORDS[item.importance]}</span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
