"use client";

import * as React from "react";
import type { Result } from "@/data/contracts/result";
import type { Paginated } from "@/data/contracts/result";
import type { UserSummary } from "@/domain/users/user";
import { getCrmDataProvider } from "@/application/provider";
import { contextFromSession } from "@/application/context";
import { useSession } from "./session-context";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Badge } from "@/components/ui/badge";
import { FUNDING_LABEL, LIFECYCLE_LABEL } from "@/config/labels";

/**
 * DEV-ONLY diagnostic: live proof that the shell reaches data ONLY through the
 * CrmDataProvider boundary (never fixtures directly), and that loading/empty/
 * error states work. Not shown in production builds. Uses human labels, not raw
 * enum codes (Phase 1B1 §16). The real Today/Users screens arrive later.
 */
export function ProviderSmoke() {
  const { session } = useSession();
  const [state, setState] = React.useState<Result<Paginated<UserSummary>> | null>(null);

  const load = React.useCallback(() => {
    setState(null);
    const provider = getCrmDataProvider();
    provider.searchUsers(contextFromSession(session), {}).then(setState);
  }, [session]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (!state || state.status === "loading") return <SkeletonRows rows={3} />;

  if (state.status === "error") {
    return <ErrorState error={state.error} onRetry={load} />;
  }

  const items = state.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="Нет данных"
        description="Провайдер вернул пустой результат. На следующих этапах здесь появятся пользователи."
      />
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="warning">DEV diagnostic</Badge>
        <p className="text-xs text-text-secondary">
          Данные получены через <code className="text-text-primary">CrmDataProvider</code>:{" "}
          {items.length} synthetic-пользователей (UI не читает fixtures напрямую).
        </p>
      </div>
      <ul className="divide-y divide-border">
        {items.map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <span className="truncate">
              <span className="font-medium text-text-primary">{u.displayName}</span>{" "}
              <span className="text-text-muted">{u.maskedEmail}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Badge tone="neutral">{LIFECYCLE_LABEL[u.lifecycleStage]}</Badge>
              <Badge tone="info">{FUNDING_LABEL[u.fundingStatus]}</Badge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
