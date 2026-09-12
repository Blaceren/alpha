"use client";

import * as React from "react";
import type { AuditRecordView } from "@/data/contracts/CrmDataProvider";
import { Tooltip } from "@/components/ui/tooltip";
import { auditRowText, AUDIT_LABEL } from "@/config/labels";
import { formatExactTime, formatRelativeTime } from "@/lib/format";
import { displayNowMs } from "@/features/users/lib/display-clock";

/**
 * One dense chronological ledger — NOT a heavy card per event. Every row states
 * one already-projected action. Nothing here inspects a raw id, a note body or a
 * reason code: the row renders only what `AuditRecordView` carries, and its React
 * `key` is the audit id, which is never printed as text.
 *
 * Layout: on desktop the time sits in a fixed left column and the action reads to
 * its right; on mobile/reflow it collapses to one column, the action first and the
 * time on a secondary line, so nothing needs a horizontal scroll.
 */
export function AuditLedger({ items }: { items: AuditRecordView[] }) {
  return (
    <ol
      aria-label={AUDIT_LABEL.ledgerHeading}
      className="divide-y divide-border rounded-lg border border-border bg-surface"
    >
      {items.map((view) => (
        <AuditRow key={view.id} view={view} />
      ))}
    </ol>
  );
}

function AuditRow({ view }: { view: AuditRecordView }) {
  const { primary, detail } = auditRowText(view);

  return (
    <li className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <Tooltip content={formatExactTime(view.at)} side="top">
        <time
          dateTime={view.at}
          className="order-2 shrink-0 text-2xs tabular-nums text-text-muted sm:order-1 sm:w-28"
        >
          {formatRelativeTime(view.at, displayNowMs())}
        </time>
      </Tooltip>

      <div className="order-1 min-w-0 sm:order-2">
        <p className="break-words text-sm text-text-primary">{primary}</p>
        {detail ? (
          <p className="mt-0.5 break-words text-xs text-text-secondary">
            <span className="text-text-muted">{AUDIT_LABEL.ownerTransitionLabel}: </span>
            {detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}
