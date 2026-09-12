"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";

interface PaginationProps {
  total: number;
  pageIndex: number;
  pageSize: number;
  onPageIndex: (i: number) => void;
  onPageSize: (n: number) => void;
}

export function UsersPagination({ total, pageIndex, pageSize, onPageIndex, onPageSize }: PaginationProps) {
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const hasPrev = pageIndex > 0;
  const hasNext = to < total;
  const sizeId = React.useId();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-text-secondary">
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId} className="text-text-muted">
          На странице
        </label>
        <select
          id={sizeId}
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-8 rounded border border-border bg-surface px-2 text-xs text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </div>

      <div className="flex items-center gap-3">
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
    </div>
  );
}
