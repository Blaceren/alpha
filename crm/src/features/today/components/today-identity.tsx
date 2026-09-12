import * as React from "react";
import { EyeOff } from "lucide-react";
import type { TodayQueueItem } from "@/domain/today/today";

/**
 * The subject of the row, rendered from the identity PROJECTION only.
 *
 * Each mode is a real product state, not a fallback chain: an analyst gets a
 * pseudonym because that is what pseudonymous access means, and a
 * content_manager gets no subject at all. The user id is always shown — it is
 * the platform identifier, not identity, and it is how an operator without a
 * name still refers to the row.
 */
export function TodayIdentity({ item }: { item: TodayQueueItem }) {
  const { mode, displayName, email, pseudonymId } = item.identity;

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      {displayName ? (
        <span className="truncate text-sm font-medium text-text-primary">{displayName}</span>
      ) : pseudonymId ? (
        <span className="truncate font-mono text-sm font-medium text-text-primary">{pseudonymId}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-sm font-medium text-text-secondary">
          <EyeOff aria-hidden className="h-3.5 w-3.5" />
          Без идентификации
        </span>
      )}

      {email ? <span className="truncate font-mono text-2xs text-text-muted">{email}</span> : null}

      {/* Shown when it is not already the visible subject. */}
      {mode !== "pseudonymous" ? (
        <span className="truncate font-mono text-2xs text-text-muted">{item.userId}</span>
      ) : null}
    </div>
  );
}
