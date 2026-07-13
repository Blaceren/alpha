import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "locked";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-4 text-ink-2 border-line",
  accent: "bg-[color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-accent border-[color-mix(in_srgb,var(--accent-primary)_30%,transparent)]",
  success: "bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-success border-[color-mix(in_srgb,var(--success)_30%,transparent)]",
  warning: "bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-warning border-[color-mix(in_srgb,var(--warning)_30%,transparent)]",
  danger: "bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-danger border-[color-mix(in_srgb,var(--danger)_30%,transparent)]",
  locked: "bg-surface-2 text-ink-3 border-line-subtle",
};

export interface BadgeProps {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}

/** Small status pill. Never color-only — always carries text/icon content. */
export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "font-ui text-xs font-medium leading-none",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
