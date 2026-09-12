"use client";

import * as React from "react";
import { Columns3, Filter, Search } from "lucide-react";
import type { UserFilters } from "@/data/contracts/CrmDataProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ActiveFilterChips, UsersFilters } from "./users-filters";
import { OPTIONAL_COLUMNS, type OptionalColumnKey } from "./hooks/use-column-visibility";

interface ToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  filters: UserFilters;
  setFilters: (patch: Partial<UserFilters>) => void;
  clearFilter: (key: keyof UserFilters) => void;
  resetFilters: () => void;
  activeFilterCount: number;
  columnVisible: Record<OptionalColumnKey, boolean>;
  onToggleColumn: (key: OptionalColumnKey) => void;
}

function ColumnsMenu({
  visible,
  onToggle,
}: {
  visible: Record<OptionalColumnKey, boolean>;
  onToggle: (key: OptionalColumnKey) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <Columns3 className="h-4 w-4" aria-hidden />
          Колонки
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="px-2 py-1 text-2xs uppercase tracking-wide text-text-muted">
          Дополнительные колонки
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONAL_COLUMNS.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={visible[c.key]}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(c.key)}
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FiltersSheet({
  filters,
  setFilters,
  clearFilter,
  resetFilters,
  activeFilterCount,
}: Pick<ToolbarProps, "filters" | "setFilters" | "clearFilter" | "resetFilters" | "activeFilterCount">) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm">
          <Filter className="h-4 w-4" aria-hidden />
          Фильтры{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" title="Фильтры">
        <div className="flex h-14 items-center border-b border-white/10 px-4 text-sm font-medium text-white">
          Фильтры
        </div>
        <div className="space-y-3 overflow-y-auto bg-background p-4 text-text-primary">
          <UsersFilters filters={filters} setFilters={setFilters} clearFilter={clearFilter} resetFilters={resetFilters} layout="stacked" />
          <ActiveFilterChips filters={filters} setFilters={setFilters} clearFilter={clearFilter} resetFilters={resetFilters} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function UsersToolbar(props: ToolbarProps) {
  const { search, onSearch, activeFilterCount, columnVisible, onToggleColumn } = props;
  const searchId = React.useId();

  // Render the real <input> only after mount. Chromium's form/autofill agent
  // injects an inline `style` onto a server-rendered text input during the
  // hydration window (racing React), producing an intermittent dev warning
  // "Extra attributes from the server: style". Rendering an identical placeholder
  // box on the server/first client render and mounting the input in an effect
  // means the input is client-created, not hydrated — no node to mismatch.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="space-y-2">
      {/* Row 1 — search always on its own line; Колонки (tablet/desktop) and the
          Фильтры sheet (mobile/tablet) sit beside it so neither wraps alone. */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor={searchId} className="sr-only">
            Поиск: имя, email или ID
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          {mounted ? (
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Имя, email или ID"
              className="h-9 w-full rounded border border-border bg-surface pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div className="h-9 w-full rounded border border-border bg-surface" aria-hidden />
          )}
        </div>

        {/* Mobile + tablet: filters live in a Sheet (below xl). */}
        <div className="shrink-0 xl:hidden">
          <FiltersSheet
            filters={props.filters}
            setFilters={props.setFilters}
            clearFilter={props.clearFilter}
            resetFilters={props.resetFilters}
            activeFilterCount={activeFilterCount}
          />
        </div>

        {/* Columns menu is useful only where a table renders (tablet + desktop). */}
        <div className="hidden shrink-0 md:block">
          <ColumnsMenu visible={columnVisible} onToggle={onToggleColumn} />
        </div>
      </div>

      {/* Row 2 — inline filter group, desktop only (xl+). */}
      <div className="hidden xl:block">
        <UsersFilters
          filters={props.filters}
          setFilters={props.setFilters}
          clearFilter={props.clearFilter}
          resetFilters={props.resetFilters}
        />
      </div>

      {/* Row 3 — active filter chips + «Сбросить всё» (own row, all breakpoints). */}
      <ActiveFilterChips
        filters={props.filters}
        setFilters={props.setFilters}
        clearFilter={props.clearFilter}
        resetFilters={props.resetFilters}
      />
    </div>
  );
}
