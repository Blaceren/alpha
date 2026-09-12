import * as React from "react";
import { Badge, type BadgeProps } from "./badge";

export interface StatusBadgeProps extends Omit<BadgeProps, "children"> {
  label: string;
  /** Optional leading dot; status is never conveyed by color alone (label always shown). */
  withDot?: boolean;
}

/** A status pill: always carries a text label (no color-only meaning). */
export function StatusBadge({ label, withDot = true, tone, ...props }: StatusBadgeProps) {
  return (
    <Badge tone={tone} {...props}>
      {withDot ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-current opacity-70"
        />
      ) : null}
      {label}
    </Badge>
  );
}
