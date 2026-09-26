"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { PageHeader } from "@/components/ui/page-header";
import { AUDIT_LABEL } from "@/config/labels";
import { useAuditQuery } from "./hooks/use-audit-query";
import { AuditLedger } from "./audit-ledger";
import { AuditPagination } from "./audit-pagination";
import { AuditEmpty, AuditError, AuditLoading, AuditRestricted } from "./audit-states";

/**
 * The global Audit Workspace (`/audit`, Phase 1B5-B). A read-only ledger of the
 * browser-local mutation-overlay audit records.
 *
 * What it does NOT do is the point: it does not decide who may see the log, it
 * does not order or paginate the records itself, and it never inspects a raw id or
 * a note body. `getAuditRecords` gates on `canViewAudit`, projects each record to a
 * safe `AuditRecordView`, orders newest-first and paginates; this renders what came
 * back and distinguishes the four surfaces — restricted, error, empty, populated —
 * plus a local skeleton while the client read is in flight.
 *
 * `providerOverride` is for tests only; production uses getCrmDataProvider().
 */
export function AuditWorkspace({ providerOverride }: { providerOverride?: CrmDataProvider }) {
  const q = useAuditQuery(providerOverride);
  const result = q.result;

  const isRestricted = result?.status === "error" && result.error?.code === "unauthorized";
  const isError = result?.status === "error" && !isRestricted;

  const items = result?.data?.items ?? [];
  const total = result?.data?.page.total ?? 0;
  const hasNext = Boolean(result?.data?.page.nextCursor);
  const showPagination = hasNext || q.pageIndex > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={AUDIT_LABEL.title}
        description={isRestricted ? undefined : AUDIT_LABEL.subtitle}
      />

      {/* Calm, honest demo caption. NOT a second DEMO MODE badge — the topbar
          already carries that — and never the phrase "immutable system log"
          without saying it is browser-local. Hidden in the restricted state, which
          shows nothing about the data. */}
      {!isRestricted ? (
        <p className="flex items-center gap-1.5 text-2xs text-text-muted">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {AUDIT_LABEL.demoNote}
        </p>
      ) : null}

      {isRestricted ? (
        <AuditRestricted />
      ) : isError ? (
        <AuditError onRetry={q.retry} />
      ) : !result || (q.loading && !result) ? (
        <AuditLoading />
      ) : items.length === 0 ? (
        <AuditEmpty />
      ) : (
        <section aria-labelledby="audit-ledger-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="audit-ledger-heading" className="text-sm font-semibold text-text-primary">
              {AUDIT_LABEL.ledgerHeading}
            </h2>
            <span className="text-2xs tabular-nums text-text-muted">
              {AUDIT_LABEL.totalLabel}: {total}
            </span>
          </div>

          <AuditLedger items={items} />

          {showPagination ? (
            <AuditPagination
              total={total}
              pageIndex={q.pageIndex}
              hasNext={hasNext}
              onPageIndex={q.setPageIndex}
            />
          ) : null}
        </section>
      )}
    </div>
  );
}
