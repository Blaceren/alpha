import type { AlexMessageModel } from "@/domain/progression";
import { cn } from "@/lib/cn";

/**
 * Alex Curie contextual message. Media is a PROVISIONAL abstract placeholder
 * (no real/random human face); it swaps for a real photo/video asset later.
 * `prominence="feature"` makes Alex more visible (used by the editorial direction).
 */
export function AlexMessage({
  message,
  prominence = "compact",
  className,
}: {
  message: AlexMessageModel;
  prominence?: "compact" | "feature";
  className?: string;
}) {
  const feature = prominence === "feature";
  return (
    <figure
      className={cn(
        "flex gap-4 rounded-2xl border border-line bg-surface-1 p-4",
        feature && "sm:p-5",
        className,
      )}
    >
      <AlexMedia size={feature ? 72 : 48} />
      <div className="flex min-w-0 flex-col justify-center gap-1">
        <figcaption className="font-ui text-xs uppercase tracking-wide text-ink-3">
          Alex Curie · наставник курса
        </figcaption>
        <blockquote
          className={cn(
            "font-ui text-ink-2",
            feature ? "text-[1.0625rem] leading-relaxed text-ink" : "text-sm leading-relaxed",
          )}
        >
          {message.text}
        </blockquote>
      </div>
    </figure>
  );
}

/** Abstract media placeholder — a stylized silhouette, deliberately not a face. */
function AlexMedia({ size }: { size: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-xl border border-line-subtle"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="absolute inset-0 bg-[radial-gradient(90%_90%_at_50%_10%,color-mix(in_srgb,var(--accent-primary)_22%,transparent),transparent_70%),var(--surface-elevated)]" />
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        className="relative"
        fill="none"
      >
        <circle cx="24" cy="18" r="8" fill="color-mix(in srgb, var(--text-secondary) 55%, transparent)" />
        <path
          d="M10 44 C10 33 17 29 24 29 C31 29 38 33 38 44 Z"
          fill="color-mix(in srgb, var(--text-secondary) 45%, transparent)"
        />
      </svg>
    </span>
  );
}
