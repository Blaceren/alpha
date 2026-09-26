/**
 * Which filter controls the Today toolbar renders, and how each maps onto
 * `TodayFilters`.
 *
 * OPTIONS ARE NOT HARDCODED. They are built from `TodayFilterOptions`, which the
 * provider derives from this role's actual queue — so a control never offers a
 * value that would return nothing, and never advertises a basis (or an owner)
 * that this role's queue does not contain.
 */
import type { TodayFilterOptions } from "@/domain/today/today";
import type { TodayFilters } from "@/domain/today/today-query";
import type { SlaState } from "@/domain/users/user-360";
import {
  PRIORITY_LABEL,
  SLA_STATE_LABEL,
  TODAY_FILTER_LABEL,
  ownerLabel,
} from "@/config/labels";
import { QUEUE_TITLE } from "@/config/queues";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDef {
  key: keyof TodayFilters;
  label: string;
  options: FilterOption[];
}

/** SLA states worth filtering on. `on_track` is not work — it is the absence of it. */
const SLA_FILTER_STATES: SlaState[] = ["breached", "warning"];

/** Only the states this queue actually contains — an empty queue offers no SLA control. */
function slaOptionsOf(options: TodayFilterOptions): FilterOption[] {
  return SLA_FILTER_STATES.filter((s) => options.sla.includes(s)).map((s) => ({
    value: s,
    label: SLA_STATE_LABEL[s],
  }));
}

export function buildFilterDefs(options: TodayFilterOptions): FilterDef[] {
  const defs: FilterDef[] = [];

  if (options.priority.length > 1) {
    defs.push({
      key: "priority",
      label: TODAY_FILTER_LABEL.priority,
      options: options.priority.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
    });
  }

  if (options.basis.length > 1) {
    defs.push({
      key: "basis",
      label: TODAY_FILTER_LABEL.basis,
      options: options.basis.map((b) => ({ value: b, label: QUEUE_TITLE[b] })),
    });
  }

  const sla = slaOptionsOf(options);
  if (sla.length > 0) {
    defs.push({ key: "sla", label: TODAY_FILTER_LABEL.sla, options: sla });
  }

  if (options.owners.length > 0) {
    const owners: FilterOption[] = options.owners.map((o) => ({ value: o, label: ownerLabel(o) }));
    // "Unassigned" is offered only when the queue really contains one.
    if (options.hasUnassigned) {
      owners.push({ value: UNASSIGNED, label: TODAY_FILTER_LABEL.unassigned });
    }
    defs.push({ key: "ownerId", label: TODAY_FILTER_LABEL.owner, options: owners });
  }

  return defs;
}

/** Sentinel for the "no owner" choice inside the owner control. */
export const UNASSIGNED = "__unassigned__";

/** Human text for one selected filter value — used by the active chips. */
export function optionLabel(defs: FilterDef[], key: keyof TodayFilters, value: string): string {
  return defs.find((d) => d.key === key)?.options.find((o) => o.value === value)?.label ?? value;
}

/** Currently-selected values of a control, as plain strings. */
export function selectedOf(filters: TodayFilters, key: keyof TodayFilters): string[] {
  const v = filters[key];
  if (v === "unassigned") return [UNASSIGNED];
  return Array.isArray(v) ? (v as string[]) : [];
}

/**
 * Toggle one value of a control and produce the next filter state.
 *
 * `ownerId` is the awkward one: the contract models "no owner" as the literal
 * `"unassigned"` rather than as an id, so the two cannot be combined. Selecting
 * it therefore replaces an id selection instead of merging with it — modelled
 * here rather than in the component, which should not know the contract's shape.
 */
export function toggledFilters(
  filters: TodayFilters,
  key: keyof TodayFilters,
  value: string,
): Partial<TodayFilters> | { clear: keyof TodayFilters } {
  const current = selectedOf(filters, key);
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];

  if (next.length === 0) return { clear: key };

  if (key === "ownerId") {
    if (next.includes(UNASSIGNED)) return { ownerId: "unassigned" };
    return { ownerId: next };
  }
  return { [key]: next } as Partial<TodayFilters>;
}
