"use client";

import * as React from "react";
import { ArrowDownWideNarrow, Filter, Search } from "lucide-react";
import type { TodayFilterOptions, TodaySortField } from "@/domain/today/today";
import type { TodayFilters } from "@/domain/today/today-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TODAY_LABEL, TODAY_SORT_LABEL } from "@/config/labels";
import { buildFilterDefs } from "../model/filter-defs";
import { TodayActiveFilterChips, TodayFilterControls } from "./today-filters";

interface ToolbarProps {
  options: TodayFilterOptions;
  filters: TodayFilters;
  setFilters: (patch: Partial<TodayFilters>) => void;
  clearFilter: (key: keyof TodayFilters) => void;
  resetFilters: () => void;
  activeFilterCount: number;
  sort: TodaySortField;
  setSort: (s: TodaySortField) => void;
  search: string;
  onSearch: (v: string) => void;
  resultCount: number;
}

const SORT_FIELDS: TodaySortField[] = ["urgency", "last_activity", "owner"];

/**
 * Sort control. The trigger always shows the ACTIVE mode, because a queue
 * ordered by anything other than urgency must say so — otherwise the top row
 * silently stops meaning "most urgent" (§13).
 */
function SortMenu({ sort, setSort }: { sort: TodaySortField; setSort: (s: TodaySortField) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`${TODAY_LABEL.sort}: ${TODAY_SORT_LABEL[sort]}`}>
          <ArrowDownWideNarrow aria-hidden className="h-4 w-4" />
          <span className="hidden sm:inline">{TODAY_SORT_LABEL[sort]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="px-2 py-1 text-2xs uppercase tracking-wide text-text-muted">
          {TODAY_LABEL.sort}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as TodaySortField)}>
          {SORT_FIELDS.map((f) => (
            <DropdownMenuRadioItem key={f} value={f}>
              {TODAY_SORT_LABEL[f]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile/tablet: filters live in a Sheet (Radix gives focus trap + Esc). */
function FilterSheet(props: ToolbarProps & { defs: ReturnType<typeof buildFilterDefs> }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm">
          <Filter aria-hidden className="h-4 w-4" />
          {TODAY_LABEL.filters}
          {props.activeFilterCount > 0 ? ` (${props.activeFilterCount})` : ""}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" title={TODAY_LABEL.filters}>
        <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4 text-sm font-medium text-white">
          {TODAY_LABEL.filters}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-background p-4 text-text-primary">
          <TodayFilterControls {...props} layout="stacked" />
          <TodayActiveFilterChips {...props} />
          {/* The count updates live, so the effect of a choice is visible
              without closing the sheet. */}
          <p className="text-2xs text-text-secondary">
            Найдено: <span className="tabular-nums">{props.resultCount}</span>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function TodayToolbar(props: ToolbarProps) {
  const searchId = React.useId();
  const defs = React.useMemo(() => buildFilterDefs(props.options), [props.options]);

  // The real <input> mounts client-side only: Chromium's autofill agent injects
  // an inline style onto a server-rendered text input during hydration, which
  // surfaces as "Extra attributes from the server: style". Same fix as Users.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {TODAY_LABEL.search}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          />
          {mounted ? (
            <input
              id={searchId}
              type="search"
              value={props.search}
              onChange={(e) => props.onSearch(e.target.value)}
              placeholder={TODAY_LABEL.searchPlaceholder}
              className="h-9 w-full rounded border border-border bg-surface pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div aria-hidden className="h-9 w-full rounded border border-border bg-surface" />
          )}
        </div>

        {/* Filters collapse into a sheet below xl; sort stays reachable always. */}
        <div className="shrink-0 xl:hidden">
          <FilterSheet {...props} defs={defs} />
        </div>
        <div className="shrink-0">
          <SortMenu sort={props.sort} setSort={props.setSort} />
        </div>
      </div>

      {/* Inline filter row — desktop only. */}
      <div className="hidden xl:block">
        <TodayFilterControls {...props} defs={defs} />
      </div>

      <TodayActiveFilterChips {...props} defs={defs} />
    </div>
  );
}
