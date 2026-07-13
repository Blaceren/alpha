import { cn } from "@/lib/cn";

/**
 * TEMPORARY brand mark. This is a provisional placeholder to be replaced by the
 * real Alfa Trade Academy logo asset. It deliberately does NOT show the word
 * "placeholder" to the user — it renders the real product name.
 */
export function LogoPlaceholder({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect
          x="1"
          y="1"
          width="26"
          height="26"
          rx="8"
          fill="var(--surface-elevated)"
          stroke="var(--border-default)"
        />
        <path
          d="M6 19 L11 12 L15 15 L22 7"
          stroke="var(--accent-primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22" cy="7" r="2.2" fill="var(--accent-secondary)" />
      </svg>
      {!compact && (
        <span className="font-display text-[0.95rem] font-semibold leading-tight text-ink">
          Alfa Trade
          <br className="hidden xl:block" />
          <span className="xl:hidden"> </span>Academy
        </span>
      )}
    </span>
  );
}
