"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { AUDIT_PAGE_SIZE } from "./hooks/use-audit-query";

interface AuditPaginationProps {
  total: number;
  pageIndex: number;
  hasNext: boolean;
  onPageIndex: (i: number) => void;
}

/**
 * Prev/next pagination for the ledger. Rendered only when there is more than one
 * page (a next page exists, or we are past the first) — the first version has no
 * page-size control and no filters toolbar (contract §6). Keyboard-reachable
 * through the two icon buttons; the range is announced politely.
 */
export function AuditPagination({ total, pageIndex, hasNext, onPageIndex }: AuditPaginationProps) {
  const from = total === 0 ? 0 : pageIndex * AUDIT_PAGE_SIZE + 1;
  const to = Math.min(total, (pageIndex + 1) * AUDIT_PAGE_SIZE);
  const hasPrev = pageIndex > 0;

  return (
    <div className="flex items-center justify-end gap-3 text-xs text-text-secondary">
      <span className="tabular-nums" aria-live="polite">
        {from}–{to} из {total}
      </span>
      <div className="flex items-center gap-1">
        <IconButton label="Предыдущая страница" disabled={!hasPrev} onClick={() => onPageIndex(pageIndex - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label="Следующая страница" disabled={!hasNext} onClick={() => onPageIndex(pageIndex + 1)}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
