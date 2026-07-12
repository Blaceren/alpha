import * as React from "react";
import { cn } from "@/lib/cn";

/** Provisional wordmark (no confirmed brand book). Compact when collapsed. */
export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-xs font-bold text-accent-foreground">
        ATA
      </span>
      {!collapsed ? (
        <span className="truncate text-sm font-semibold text-white">
          Alfa Trade Academy <span className="text-sidebar-foreground/60">CRM</span>
        </span>
      ) : null}
    </div>
  );
}
