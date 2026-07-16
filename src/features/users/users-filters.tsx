"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { UserFilters } from "@/data/contracts/CrmDataProvider";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ALL_FILTERS, optionLabel, type FilterDef } from "./filter-options";

interface FiltersProps {
  filters: UserFilters;
  setFilters: (patch: Partial<UserFilters>) => void;
  clearFilter: (key: keyof UserFilters) => void;
  resetFilters: () => void;
  /** Layout: inline row (desktop) or stacked (mobile sheet). */
  layout?: "inline" | "stacked";
}

function selectedOf(filters: UserFilters, key: keyof UserFilters): string[] {
  const v = filters[key];
  return Array.isArray(v) ? (v as string[]) : [];
}

function MultiSelect({
  def,
  selected,
  onToggle,
  onClear,
}: {
  def: FilterDef;
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected.length > 0
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-surface text-text-secondary hover:bg-row-hover",
        )}
      >
        {def.label}
        {selected.length > 0 ? (
          <span className="rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-foreground">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown className="h-3 w-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between px-2 py-1 text-2xs uppercase tracking-wide text-text-muted">
          {def.label}
          {selected.length > 0 ? (
            <button type="button" onClick={onClear} className="text-accent hover:underline">
              Очистить
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {def.options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(o.value)}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function toggleValue(
  filters: UserFilters,
  setFilters: (patch: Partial<UserFilters>) => void,
  clearFilter: (key: keyof UserFilters) => void,
  key: keyof UserFilters,
  value: string,
) {
  const cur = selectedOf(filters, key);
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
  if (next.length === 0) clearFilter(key);
  else setFilters({ [key]: next } as unknown as Partial<UserFilters>);
}

/** Filter controls (the dropdown group only). Active chips live in their own row. */
export function UsersFilters({ filters, setFilters, clearFilter, layout = "inline" }: FiltersProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", layout === "stacked" && "flex-col items-stretch")}>
      {ALL_FILTERS.map((def) => (
        <MultiSelect
          key={def.key as string}
          def={def}
          selected={selectedOf(filters, def.key)}
          onToggle={(v) => toggleValue(filters, setFilters, clearFilter, def.key, v)}
          onClear={() => clearFilter(def.key)}
        />
      ))}
    </div>
  );
}

/** Active filter chips + "Сбросить всё" — rendered as its own toolbar row. */
export function ActiveFilterChips({
  filters,
  setFilters,
  clearFilter,
  resetFilters,
}: Omit<FiltersProps, "layout">) {
  const activeChips = ALL_FILTERS.flatMap((def) =>
    selectedOf(filters, def.key).map((value) => ({ key: def.key, value })),
  );
  if (activeChips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeChips.map(({ key, value }) => (
        <span key={`${String(key)}:${value}`} className="inline-flex items-center">
          <Badge tone="accent" className="gap-1 whitespace-nowrap">
            {optionLabel(key, value)}
            <button
              type="button"
              aria-label={`Убрать фильтр ${optionLabel(key, value)}`}
              onClick={() => toggleValue(filters, setFilters, clearFilter, key, value)}
              className="rounded hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </Badge>
        </span>
      ))}
      <button
        type="button"
        onClick={resetFilters}
        className="text-2xs text-text-secondary underline hover:text-text-primary"
      >
        Сбросить всё
      </button>
    </div>
  );
}
