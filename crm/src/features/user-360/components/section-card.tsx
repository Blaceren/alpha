import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * One operational block of the User 360. A calm bordered section — deliberately
 * not a KPI card: no big numbers, no decorative chrome. Each block is a real
 * <section> labelled by its own heading, so the page reads as a landmark list.
 */
export function SectionCard({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  /** Small right-aligned meta (counts, freshness) — never a mutating control. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  // useId is stable across server/client render — no hydration mismatch.
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-lg border border-border bg-surface", className)}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {title}
        </h2>
        {aside ? <div className="shrink-0 text-2xs text-text-muted">{aside}</div> : null}
      </div>
      <div className="px-3 py-3">{children}</div>
    </section>
  );
}

/** Label → value row used across the User 360 blocks. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", className)}>
      <dt className="shrink-0 text-2xs text-text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-xs text-text-primary">{children}</dd>
    </div>
  );
}
