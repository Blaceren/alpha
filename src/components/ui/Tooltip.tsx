"use client";

import type { ReactNode } from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
}

/** Radix-backed tooltip. Supplementary only — never the sole source of meaning. */
export function Tooltip({ content, children }: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className="z-50 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5 font-ui text-xs text-ink shadow-elev2"
          >
            {content}
            <RadixTooltip.Arrow className="fill-[var(--surface-elevated)]" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
