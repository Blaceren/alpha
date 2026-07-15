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
import { UsersFilters } from "./users-filters";
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

export function UsersToolbar(props: ToolbarProps) {
  const { search, onSearch, activeFilterCount, columnVisible, onToggleColumn } = props;
  const searchId = React.useId();

  // Render the real <input> only after mount. Chromium's form/autofill agent
  // injects an inline `style` onto a server-rendered text input during the
  // hydration window (racing React), producing an intermittent dev warning
  // "Extra attributes from the server: style". The server never emits `style`
  // and our code never sets it — the browser mutates the SSR'd node before
  // hydration. Rendering an identical placeholder box on the server/first
  // client render (so both match) and mounting the input in an effect means the
  // input is client-created, not hydrated, so there is no server node for React
  // to reconcile and no attribute to mismatch. Visuals are unchanged.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
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
          // Identical box during SSR / first client render (no layout shift).
          <div className="h-9 w-full rounded border border-border bg-surface" aria-hidden />
        )}
      </div>

      {/* Desktop / tablet: inline filters */}
      <div className="hidden md:flex md:flex-wrap md:items-center md:gap-2">
        <UsersFilters
          filters={props.filters}
          setFilters={props.setFilters}
          clearFilter={props.clearFilter}
          resetFilters={props.resetFilters}
        />
      </div>

      {/* Mobile: filters in a Sheet */}
      <div className="md:hidden">
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
            <div className="overflow-y-auto bg-background p-4 text-text-primary">
              <UsersFilters
                filters={props.filters}
                setFilters={props.setFilters}
                clearFilter={props.clearFilter}
                resetFilters={props.resetFilters}
                layout="stacked"
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <ColumnsMenu visible={columnVisible} onToggle={onToggleColumn} />
    </div>
  );
}
