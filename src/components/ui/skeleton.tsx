import * as React from "react";
import { cn } from "@/lib/cn";

/** Neutral loading placeholder. Respects reduced-motion (pulse handled in CSS). */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded bg-border/60", className)}
      {...props}
    />
  );
}

/** A few skeleton rows for list/table loading states. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
