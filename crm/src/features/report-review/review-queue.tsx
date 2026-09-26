"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useReviewQueue, type QueueState } from "./use-review-queue";
import type { QueueItem } from "@/data/contracts/api/report-review";
import { fetchReviewQueue } from "@/application/api/report-review-client";

/**
 * The pending-review queue.
 *
 * Filtering and sorting are deliberately narrow. The Backend queue accepts only
 * `locale`, `limit` and `cursor`, and orders by `submittedAt ASC, id ASC` — there
 * is no server-side filter or sort parameter. So the CRM offers exactly one
 * client-side filter (a substring match over data already on screen), clearly
 * labelled as narrowing the loaded page, and no sort control at all. Inventing a
 * sort UI that silently reorders one page while the server paginates by submission
 * time would misrepresent the data.
 *
 * Waiting time is derived from `submittedAt` for operator triage. It is a
 * presentation of a Backend timestamp, not a client-authored status.
 *
 * ## Two presentations, split at `md`
 *
 * A seven-column operational table does not belong at 390 px, and visual review
 * proved it the hard way. Three attempts at forcing one layout to serve both:
 *
 *   1. `min-w-[46rem]` + `overflow-x-auto` — the DOCUMENT scrolled sideways by
 *      283 px (`window.scrollTo(9999,0)` moved it), because inside the shell's
 *      column flex container the forced width propagated past the wrapper.
 *   2. Dropping the min-width — still overflowed: a seven-column `table-layout:
 *      auto` has a min-content width well above 358 px.
 *   3. `table-fixed` + `break-words` — the overflow metric finally passed, but the
 *      result was unreadable: headers and values broke mid-word ("УЧЕ НИК",
 *      "26. 07. 202 6") and the row action was still clipped.
 *
 * So the table is now **desktop-only** (`hidden md:block`) and narrow widths get a
 * card list (`md:hidden`) carrying the same Backend fields with room to breathe.
 * This is the pattern the shipped `/users` workspace already uses for the same
 * reason. Both presentations render from one `visible` array, so they cannot drift.
 */

export const QUEUE_STATES = [
  "QUEUE_LOADING",
  "QUEUE_READY",
  "QUEUE_EMPTY",
  "FILTERED_EMPTY",
  "QUEUE_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "FLAG_DISABLED",
] as const;

/** Whole days/hours since submission. Coarse on purpose — this is triage, not SLA. */
export function waitingLabel(submittedAt: string, now: Date = new Date()): string {
  const then = new Date(submittedAt);
  if (Number.isNaN(then.getTime())) return "—";
  const minutes = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  return `${Math.floor(hours / 24)} дн`;
}

const CLAIM_LABEL: Record<QueueItem["claim"]["state"], string> = {
  unclaimed: "Свободен",
  owned_by_you: "У вас",
  claimed: "У другого наставника",
  expired: "Заявка истекла",
};

function Panel({
  title,
  description,
  role = "status",
  children,
}: {
  title: string;
  description: string;
  role?: "status" | "alert";
  children?: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className="rounded-lg border border-border bg-surface p-6"
    >
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-prose text-sm text-text-secondary">{description}</p>
      {children}
    </div>
  );
}

export interface ReviewQueueProps {
  onOpen: (submissionRef: string) => void;
  /** Injection seam for tests. */
  fetchQueueImpl?: typeof fetchReviewQueue;
}

export function ReviewQueue({ onOpen, fetchQueueImpl }: ReviewQueueProps) {
  const { state, refresh } = useReviewQueue(fetchQueueImpl ? { fetchQueueImpl } : {});
  const [filter, setFilter] = React.useState("");

  const items = state.kind === "ready" ? state.page.items : [];
  const needle = filter.trim().toLocaleLowerCase();
  const visible = needle === ""
    ? items
    : items.filter(
        (item) =>
          item.owner.displayName.toLocaleLowerCase().includes(needle) ||
          item.level.title.toLocaleLowerCase().includes(needle) ||
          item.level.stableCode.toLocaleLowerCase().includes(needle),
      );

  return (
    <section aria-labelledby="review-queue-heading" className="min-w-0 space-y-4">
      <header>
        <h1 id="review-queue-heading" className="text-lg font-semibold text-text-primary">
          Отчёты на проверке
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {state.kind === "ready"
            ? `Ожидают проверки: ${items.length}. Сортировка — по времени отправки, от самых давних.`
            : "Очередь отчётов, отправленных учениками на проверку наставнику."}
        </p>
      </header>

      {state.kind === "loading" ? (
        <div role="status" aria-live="polite" className="space-y-2">
          <p className="text-sm text-text-secondary">Загружаем очередь…</p>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded bg-elevated" />
          ))}
        </div>
      ) : null}

      {state.kind === "unauthorized" ? (
        <Panel
          role="alert"
          title="Требуется вход"
          description="Сессия сотрудника не подтверждена. Войдите снова, чтобы открыть очередь проверки."
        />
      ) : null}

      {state.kind === "forbidden" ? (
        <Panel
          role="alert"
          title="Нет доступа к проверке отчётов"
          description="Ваша учётная запись сотрудника не имеет прав наставника-проверяющего. Проверка отчётов доступна ролям «наставник» и «администратор». Обратитесь к администратору CRM."
        />
      ) : null}

      {state.kind === "flag_disabled" ? (
        <Panel
          role="alert"
          title="Проверка отчётов отключена"
          description="Функция отчётов сейчас выключена на сервере. Очередь недоступна, пока её не включат."
        />
      ) : null}

      {state.kind === "error" ? (
        <Panel
          role="alert"
          title="Не удалось загрузить очередь"
          description="Сервис проверки отчётов не ответил. Данные не показаны, чтобы не ввести в заблуждение."
        >
          {state.retryable ? (
            <Button className="mt-4" onClick={refresh}>
              Повторить
            </Button>
          ) : null}
        </Panel>
      ) : null}

      {state.kind === "empty" ? (
        <Panel
          title="Очередь пуста"
          description="Сейчас нет отчётов, ожидающих проверки. Новые появятся здесь автоматически после отправки учеником."
        >
          <Button variant="secondary" className="mt-4" onClick={refresh}>
            Обновить
          </Button>
        </Panel>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label htmlFor="queue-filter" className="block text-sm font-medium text-text-primary">
                Фильтр по ученику или уровню
              </label>
              <input
                id="queue-filter"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-describedby="queue-filter-hint"
                className="mt-1 block h-9 w-full rounded border border-border bg-background px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p id="queue-filter-hint" className="mt-1 text-2xs text-text-muted">
                Фильтр применяется к загруженной странице. Сервер отдаёт очередь постранично по времени отправки.
              </p>
            </div>
            <Button variant="secondary" onClick={refresh}>
              Обновить
            </Button>
          </div>

          {visible.length === 0 ? (
            <Panel
              title="Ничего не найдено"
              description="На загруженной странице нет отчётов, подходящих под фильтр. Очистите фильтр, чтобы увидеть все ожидающие отчёты."
            >
              <Button variant="secondary" className="mt-4" onClick={() => setFilter("")}>
                Очистить фильтр
              </Button>
            </Panel>
          ) : (
            <>
            {/* Narrow widths: one card per report, same fields, no clipping. */}
            <ul className="space-y-2 md:hidden">
              {visible.map((item) => (
                <li
                  key={item.submissionRef}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <p className="font-medium text-text-primary">{item.owner.displayName}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{item.level.title}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-2xs">
                    <dt className="text-text-muted">Уровень</dt>
                    <dd className="text-text-secondary">{item.level.levelNumber}</dd>
                    <dt className="text-text-muted">Ревизия</dt>
                    <dd className="text-text-secondary">№{item.revision.revisionNumber}</dd>
                    <dt className="text-text-muted">Отправлен</dt>
                    <dd className="text-text-secondary">
                      {new Date(item.submittedAt).toLocaleString("ru-RU")}
                    </dd>
                    <dt className="text-text-muted">Ожидает</dt>
                    <dd className="text-text-secondary">{waitingLabel(item.submittedAt)}</dd>
                    <dt className="text-text-muted">Заявка</dt>
                    <dd className="text-text-secondary">{CLAIM_LABEL[item.claim.state]}</dd>
                  </dl>
                  <Button size="sm" className="mt-3 w-full" onClick={() => onOpen(item.submissionRef)}>
                    Открыть
                  </Button>
                </li>
              ))}
            </ul>

            {/* Desktop: the full table. */}
            <div className="hidden min-w-0 max-w-full overflow-x-auto rounded-lg border border-border md:block">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">
                  Отчёты, ожидающие проверки наставником, от самых давних к новым
                </caption>
                <thead>
                  <tr className="border-b border-border bg-elevated text-left text-2xs uppercase tracking-wide text-text-muted">
                    <th scope="col" className="px-3 py-2 font-medium">Ученик</th>
                    <th scope="col" className="px-3 py-2 font-medium">Уровень</th>
                    <th scope="col" className="px-3 py-2 font-medium">Ревизия</th>
                    <th scope="col" className="px-3 py-2 font-medium">Отправлен</th>
                    <th scope="col" className="px-3 py-2 font-medium">Ожидает</th>
                    <th scope="col" className="px-3 py-2 font-medium">Заявка</th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Действие</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.submissionRef} className="border-b border-border last:border-0 hover:bg-row-hover">
                      <td className="px-3 py-2 font-medium text-text-primary">{item.owner.displayName}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        <span className="block">{item.level.title}</span>
                        <span className="block text-2xs text-text-muted">
                          Уровень {item.level.levelNumber}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">№{item.revision.revisionNumber}</td>
                      <td className="px-3 py-2 text-text-secondary">
                        {new Date(item.submittedAt).toLocaleString("ru-RU")}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{waitingLabel(item.submittedAt)}</td>
                      <td className="px-3 py-2">
                        {/* Text, not colour alone — the claim state must be readable without hue. */}
                        <span className="text-text-secondary">{CLAIM_LABEL[item.claim.state]}</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" onClick={() => onOpen(item.submissionRef)}>
                          Открыть
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}

          {state.page.nextCursor ? (
            <p className="text-2xs text-text-muted">
              Показана первая страница очереди. Постраничная навигация будет добавлена вместе с ростом объёма.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
