import * as React from "react";
import { SearchX, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import type { CrmError } from "@/data/contracts/result";

/** Loading skeleton with stable column widths (no layout shift). */
export function UsersTableSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Загрузка пользователей">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-24" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, r) => (
          <div key={r} className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-0">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-5 w-20" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsersNoResults({ onReset }: { onReset: () => void }) {
  return (
    <EmptyState
      icon={<SearchX className="h-6 w-6" />}
      title="По заданным условиям пользователи не найдены"
      description="Измените поиск или фильтры, чтобы увидеть больше пользователей."
      action={
        <Button variant="secondary" size="sm" onClick={onReset}>
          Сбросить фильтры
        </Button>
      }
    />
  );
}

export function UsersEmptyDataset() {
  return (
    <EmptyState
      title="В базе пока нет пользователей"
      description="Как только появятся пользователи, они отобразятся здесь."
    />
  );
}

export function UsersError({ error, onRetry }: { error: CrmError | null; onRetry: () => void }) {
  return <ErrorState error={error} onRetry={onRetry} />;
}

export function UsersUnauthorized() {
  return (
    <EmptyState
      icon={<ShieldAlert className="h-6 w-6" />}
      title="Доступ ограничен"
      description="У вашей роли нет прав на просмотр этого списка."
    />
  );
}
