import * as React from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { BLOCKER_LABEL } from "@/config/labels";
import type { OperationalBlocker } from "@/domain/lifecycle/state";

/**
 * A single blocker chip with controlled truncation. The full label is always
 * available via the accessible tooltip, so capping the width leaves a stable gap
 * between the blockers column and «Ответственный» without hiding information.
 */
function BlockerChip({ code, className }: { code: OperationalBlocker; className?: string }) {
  const label = BLOCKER_LABEL[code];
  return (
    <Tooltip content={label} side="top">
      <span className={cn("inline-flex min-w-0", className)}>
        <Badge tone="danger" className="min-w-0 max-w-full">
          <span className="truncate">{label}</span>
        </Badge>
      </span>
    </Tooltip>
  );
}

function OverflowChip({ items, count, className }: { items: OperationalBlocker[]; count: number; className?: string }) {
  return (
    <Tooltip content={items.map((b) => BLOCKER_LABEL[b]).join(", ")} side="top">
      <span className={cn("inline-flex", className)}>
        <Badge tone="neutral" className="whitespace-nowrap">
          +{count}
        </Badge>
      </span>
    </Tooltip>
  );
}

/**
 * Blocker chips with responsive overflow.
 * - `table` (default): desktop (xl+) shows up to 2 chips + `+N`; tablet (md..xl)
 *   shows 1 chip + `+N`. Chips are width-capped (truncate) so long labels never
 *   collide with the owner column. Full list via tooltip.
 * - `full`: mobile card — chips wrap (card has vertical room), `+N` only past 3.
 */
export function BlockersCell({
  blockers,
  variant = "table",
}: {
  blockers?: OperationalBlocker[];
  variant?: "table" | "full";
}) {
  const list = blockers ?? [];
  if (list.length === 0) return <span className="text-2xs text-text-muted">—</span>;

  if (variant === "full") {
    const shown = list.slice(0, 3);
    const rest = list.slice(3);
    return (
      <div className="flex flex-wrap items-center gap-1">
        {shown.map((b) => (
          <Badge key={b} tone="danger" className="whitespace-nowrap">
            {BLOCKER_LABEL[b]}
          </Badge>
        ))}
        {rest.length > 0 ? <OverflowChip items={rest} count={rest.length} /> : null}
      </div>
    );
  }

  const first = list[0]!;
  const second = list[1];
  const restTablet = list.slice(1); // tablet hides everything after the 1st
  const restDesktop = list.slice(2); // desktop hides everything after the 2nd

  return (
    <div className="flex max-w-[9rem] flex-wrap items-center gap-1">
      {/* Capped on every breakpoint (tablet tighter) so it never touches owner. */}
      <BlockerChip code={first} className="max-w-[6rem] xl:max-w-[8rem]" />
      {second ? <BlockerChip code={second} className="hidden xl:inline-flex xl:max-w-[8rem]" /> : null}
      {restTablet.length > 0 ? (
        <OverflowChip items={restTablet} count={restTablet.length} className="xl:hidden" />
      ) : null}
      {restDesktop.length > 0 ? (
        <OverflowChip items={restDesktop} count={restDesktop.length} className="hidden xl:inline-flex" />
      ) : null}
    </div>
  );
}
