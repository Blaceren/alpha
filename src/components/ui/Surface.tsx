import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

type SurfaceLevel = "primary" | "secondary" | "elevated" | "interactive";

const LEVEL: Record<SurfaceLevel, string> = {
  primary: "bg-surface-1",
  secondary: "bg-surface-2",
  elevated: "bg-surface-3 shadow-elev1",
  interactive: "bg-surface-4",
};

export interface SurfaceProps {
  as?: ElementType;
  level?: SurfaceLevel;
  bordered?: boolean;
  className?: string;
  children?: ReactNode;
}

/** A themed surface panel built from semantic tokens. */
export function Surface({
  as,
  level = "primary",
  bordered = true,
  className,
  children,
}: SurfaceProps) {
  const Cmp = as ?? "div";
  return (
    <Cmp
      className={cn(
        "rounded-2xl",
        LEVEL[level],
        bordered && "border border-line",
        className,
      )}
    >
      {children}
    </Cmp>
  );
}
