"use client";

import * as React from "react";
import { Inbox, Lock, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AUDIT_LABEL } from "@/config/labels";

/**
 * Local skeleton ledger — a few placeholder rows announced as a loading status,
 * so the screen is never blank before the client read lands and a screen reader
 * hears that something is loading.
 */
export function AuditLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={AUDIT_LABEL.loading}
      className="divide-y divide-border rounded-lg border border-border bg-surface"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-baseline sm:gap-4">
          <Skeleton className="h-3 w-24 shrink-0" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state for a role that MAY view the log but the browser holds no records
 * yet. Says the log is empty and how it fills — never that "there are no actions"
 * in a way that could be confused with the restricted state.
 */
export function AuditEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
      <Inbox className="h-6 w-6 text-text-muted" aria-hidden />
      <h2 className="text-sm font-medium text-text-primary">{AUDIT_LABEL.emptyTitle}</h2>
      <p className="max-w-sm text-xs text-text-secondary">{AUDIT_LABEL.emptyText}</p>
    </div>
  );
}

/**
 * Restricted state for any role WITHOUT `canViewAudit`. A calm, defensive panel —
 * no skeleton, no empty-copy, no partial records. It explicitly says the role may
 * not view the log, so it can never be mistaken for "there are simply no actions".
 */
export function AuditRestricted() {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 py-12 text-center"
    >
      <Lock className="h-6 w-6 text-text-muted" aria-hidden />
      <h2 className="text-sm font-medium text-text-primary">{AUDIT_LABEL.restrictedTitle}</h2>
      <p className="max-w-sm text-xs text-text-secondary">{AUDIT_LABEL.restrictedText}</p>
    </div>
  );
}

/**
 * Error state. A localized message with retry — the raw `CrmError.message` is
 * never rendered, so no diagnostics reach the DOM. Retry re-runs the provider read.
 */
export function AuditError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-6 py-12 text-center"
    >
      <TriangleAlert className="h-6 w-6 text-danger" aria-hidden />
      <h2 className="text-sm font-medium text-text-primary">{AUDIT_LABEL.errorTitle}</h2>
      <p className="max-w-sm text-xs text-text-secondary">
        Источник данных недоступен. Повторите попытку.
      </p>
      <Button variant="secondary" size="sm" className="mt-1" onClick={onRetry}>
        {AUDIT_LABEL.retry}
      </Button>
    </div>
  );
}
