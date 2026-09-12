import * as React from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required accessible label for icon-only controls. */
  label: string;
}

/** Square icon-only button. `label` becomes aria-label + tooltip title. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, label, children, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded text-text-secondary transition-colors hover:bg-row-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
IconButton.displayName = "IconButton";
