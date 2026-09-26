"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/lib/cn";

export interface AvatarProps {
  initials: string;
  className?: string;
}

/** Initials-only avatar (no external images in Phase 1A). */
export function Avatar({ initials, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "inline-flex h-8 w-8 select-none items-center justify-center overflow-hidden rounded-full bg-accent/15 text-xs font-semibold text-accent",
        className,
      )}
    >
      <AvatarPrimitive.Fallback delayMs={0}>{initials}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
