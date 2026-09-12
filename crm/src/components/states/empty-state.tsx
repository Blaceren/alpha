import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: string;
  /** Explain WHY it is empty and what to do next (UX_BLUEPRINT §11). */
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /**
   * Render the title as the page heading. Use when this state IS the whole page
   * (e.g. a not-found route), which would otherwise have no h1 at all.
   * Defaults to a plain paragraph for in-page empty states.
   */
  titleAs?: "p" | "h1";
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  titleAs = "p",
}: EmptyStateProps) {
  const Title = titleAs;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <div className="text-text-muted" aria-hidden>
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <Title className="text-sm font-medium text-text-primary">{title}</Title>
      {description ? (
        <p className="max-w-sm text-xs text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
