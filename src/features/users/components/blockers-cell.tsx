import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { BLOCKER_LABEL } from "@/config/labels";
import type { OperationalBlocker } from "@/domain/lifecycle/state";

export function BlockersCell({ blockers }: { blockers?: OperationalBlocker[] }) {
  const list = blockers ?? [];
  if (list.length === 0) return <span className="text-2xs text-text-muted">—</span>;

  const shown = list.slice(0, 2);
  const rest = list.slice(2);

  return (
    <div className="flex max-w-[9.5rem] flex-wrap items-center gap-1">
      {shown.map((b) => (
        <Badge key={b} tone="danger">
          {BLOCKER_LABEL[b]}
        </Badge>
      ))}
      {rest.length > 0 ? (
        <Tooltip content={rest.map((b) => BLOCKER_LABEL[b]).join(", ")} side="top">
          <span className="inline-flex">
            <Badge tone="neutral">+{rest.length}</Badge>
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}
