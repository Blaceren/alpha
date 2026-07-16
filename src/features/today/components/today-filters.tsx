"use client";

import * as React from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { TodayFilters } from "@/domain/today/today-query";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { TODAY_LABEL } from "@/config/labels";
import { optionLabel, selectedOf, toggledFilters, type FilterDef } from "../model/filter-defs";

export interface TodayFiltersProps {
  defs: FilterDef[];
  filters: TodayFilters;
  setFilters: (patch: Partial<TodayFilters>) => void;
  clearFilter: (key: keyof TodayFilters) => void;
  resetFilters: () => void;
  layout?: "inline" | "stacked";
}

function apply(
  props: Pick<TodayFiltersProps, "filters" | "setFilters" | "clearFilter">,
  key: keyof TodayFilters,
  value: string,
) {
  const next = toggledFilters(props.filters, key, value);
  if ("clear" in next) props.clearFilter(next.clear);
  else props.setFilters(next);
}

function MultiSelect({
  def,
  selected,
  onToggle,
  onClear,
  layout,
}: {
  def: FilterDef;
  selected: string[];
  onToggle: (v: string) => void;
  onClear: () => void;
  layout: "inline" | "stacked";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded border px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // 44px targets in the sheet (touch); compact inline on desktop.
          layout === "stacked" ? "min-h-[44px] justify-between px-3" : "py-1.5",
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
        <ChevronDown aria-hidden className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between gap-3 px-2 py-1 text-2xs uppercase tracking-wide text-text-muted">
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

/**
 * The filter controls. Every option comes from the provider's `filterOptions`,
 * so this renders no value the queue cannot honour — and no forbidden value can
 * appear in the sheet, because a role's options are built from its own queue.
 */
export function TodayFilterControls({ defs, layout = "inline", ...props }: TodayFiltersProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", layout === "stacked" && "flex-col items-stretch")}>
      {defs.map((def) => (
        <MultiSelect
          key={String(def.key)}
          def={def}
          layout={layout}
          selected={selectedOf(props.filters, def.key)}
          onToggle={(v) => apply(props, def.key, v)}
          onClear={() => props.clearFilter(def.key)}
        />
      ))}
    </div>
  );
}

/** Active filters, visible and individually removable. Its own toolbar row. */
export function TodayActiveFilterChips({ defs, ...props }: Omit<TodayFiltersProps, "layout">) {
  const chips = defs.flatMap((def) =>
    selectedOf(props.filters, def.key).map((value) => ({ key: def.key, value })),
  );
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(({ key, value }) => {
        const label = optionLabel(defs, key, value);
        return (
          <Badge key={`${String(key)}:${value}`} tone="accent" className="gap-1 whitespace-nowrap">
            {label}
            <button
              type="button"
              aria-label={`Убрать фильтр ${label}`}
              onClick={() => apply(props, key, value)}
              className="rounded hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}
      <button
        type="button"
        onClick={props.resetFilters}
        className="text-2xs text-text-secondary underline hover:text-text-primary"
      >
        {TODAY_LABEL.resetAll}
      </button>
    </div>
  );
}
