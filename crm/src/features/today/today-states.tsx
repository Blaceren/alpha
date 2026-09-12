import * as React from "react";
import { CheckCircle2, SearchX, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { TODAY_LABEL } from "@/config/labels";
import type { CrmError } from "@/data/contracts/result";

/**
 * Loading skeleton mirroring the real layout — header, summary strip, section
 * heading, rows — at the real heights, so nothing jumps when data lands.
 */
export function TodaySkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Загрузка очереди">
      <div className="space-y-2.5 border-b border-border pb-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-28" />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-28" />
      </div>

      {Array.from({ length: 2 }).map((_, s) => (
        <div key={s} className="space-y-2">
          <Skeleton className="h-5 w-56" />
          <div className="overflow-hidden rounded-lg border border-border">
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="flex items-start gap-3 border-b border-border px-3 py-3 last:border-0">
                <Skeleton className="h-5 w-20" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-72" />
                </div>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-8 w-8" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Nothing needs attention — and that is a RESULT, not a failure.
 *
 * Distinct from "filters matched nothing": this one means the dataset was read,
 * every user was assessed, and none had grounds. No celebration illustration and
 * no marketing voice; an operator is being told their queue is clear, which is
 * information, not a reward (§19).
 */
export function TodayNoWork() {
  return (
    <EmptyState
      icon={<CheckCircle2 className="h-6 w-6" />}
      title="На сегодня нет пользователей, требующих внимания"
      description="Ни у одного пользователя нет активного основания: блокеров, нарушенных сроков и остановленного прогресса не обнаружено."
    />
  );
}

/**
 * There are no users at all — not "no work", and emphatically not "no access".
 *
 * Mirrors UsersEmptyDataset: an empty dataset is a fact about the data, and
 * telling an admin their role lacks access to an empty database would be false.
 */
export function TodayEmptyDataset() {
  return (
    <EmptyState
      title="В базе пока нет пользователей"
      description="Как только появятся пользователи, требующие внимания, они отобразятся здесь."
    />
  );
}

/** Filters excluded everything — the queue itself is not empty. */
export function TodayNoResults({ onReset }: { onReset: () => void }) {
  return (
    <EmptyState
      icon={<SearchX className="h-6 w-6" />}
      title="По выбранным фильтрам ничего не найдено"
      description="В очереди есть пользователи, но ни один не подходит под текущие условия."
      action={
        <Button variant="secondary" size="sm" onClick={onReset}>
          {TODAY_LABEL.resetFilters}
        </Button>
      }
    />
  );
}

/**
 * This role has no queue to show.
 *
 * Says nothing about whether hidden users exist — "у вас нет доступа к 22
 * пользователям" would leak the very count the projection withholds (§19).
 */
export function TodayNoAccess() {
  return (
    <EmptyState
      icon={<ShieldAlert className="h-6 w-6" />}
      title="Очередь недоступна для вашей роли"
      description="Обратитесь к администратору CRM, если работа с очередью входит в ваши задачи."
    />
  );
}

export function TodayError({ error, onRetry }: { error: CrmError | null; onRetry: () => void }) {
  // Retry is offered only when the provider says the read is retriable.
  return <ErrorState title="Не удалось загрузить очередь" error={error} onRetry={onRetry} />;
}
