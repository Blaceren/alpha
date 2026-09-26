import * as React from "react";
import Link from "next/link";
import { ShieldAlert, UserX } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { USER_360_LABEL } from "@/config/labels";
import type { CrmError } from "@/data/contracts/result";

/** Back to the register — the safe way out of every terminal state. */
function BackToUsers() {
  return (
    <Button variant="secondary" size="sm" asChild>
      <Link href="/users">{USER_360_LABEL.backToUsers}</Link>
    </Button>
  );
}

/**
 * Skeleton mirroring the real layout (header + two columns) so switching to the
 * loaded screen does not shift anything.
 */
export function User360Skeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Загрузка профиля пользователя">
      <div className="border-b border-border pb-3">
        <Skeleton className="mb-2 h-3 w-24" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-col gap-4 lg:w-2/3">
          {[40, 24, 32, 28].map((h, i) => (
            <Skeleton key={i} className="w-full rounded-lg" style={{ height: `${h * 4}px` }} />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:w-1/3">
          {[28, 24].map((h, i) => (
            <Skeleton key={i} className="w-full rounded-lg" style={{ height: `${h * 4}px` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Unknown user id — a real not-found, never a fabricated profile. */
export function User360NotFound({ userId }: { userId: string }) {
  return (
    <EmptyState
      icon={<UserX className="h-6 w-6" />}
      title="Пользователь не найден"
      // This state is the entire page, so its title is the page heading.
      titleAs="h1"
      description={`Пользователя с идентификатором «${userId}» нет в базе. Возможно, ссылка устарела или в ID опечатка.`}
      action={<BackToUsers />}
    />
  );
}

/**
 * Access denied. Says what is unavailable in general terms only — it must not
 * confirm what sensitive data the record does or does not contain.
 */
export function User360Unauthorized() {
  return (
    <EmptyState
      icon={<ShieldAlert className="h-6 w-6" />}
      title="Доступ ограничен"
      titleAs="h1"
      description="У вашей роли нет прав на просмотр карточки пользователя. Обратитесь к администратору CRM, если доступ нужен для работы."
      action={<BackToUsers />}
    />
  );
}

/** Retry is offered only when the provider marks the error retriable. */
export function User360Error({ error, onRetry }: { error: CrmError | null; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <ErrorState error={error} onRetry={error?.retriable ? onRetry : undefined} />
      <div className="flex justify-center">
        <BackToUsers />
      </div>
    </div>
  );
}
