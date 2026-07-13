import type { Rank } from "@/domain/progression";
import { cn } from "@/lib/cn";

/**
 * Provisional rank emblem. Trading/analytics character (hexagon + ascending
 * candle motif), NOT a casino medal. Shows the rank label and tier pips, never
 * a monetary sum. Scales down to a community badge. `locked` renders a muted
 * silhouette used for not-yet-earned ranks.
 */
export function RankBadge({
  rank,
  size = "md",
  showLabel = true,
  locked = false,
  className,
}: {
  rank: Rank;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  locked?: boolean;
  className?: string;
}) {
  const px = size === "lg" ? 72 : size === "sm" ? 28 : 46;
  const stroke = locked ? "var(--locked)" : "var(--accent-primary)";
  const fill2 = locked ? "var(--locked)" : "var(--accent-secondary)";

  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <span className="relative inline-flex shrink-0" style={{ width: px, height: px }}>
        <svg width={px} height={px} viewBox="0 0 48 48" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={`rg-${rank.code}-${size}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--surface-elevated)" />
              <stop offset="1" stopColor="var(--surface-secondary)" />
            </linearGradient>
          </defs>
          {/* hexagon shield */}
          <path
            d="M24 2 L42 12 V30 L24 46 L6 30 V12 Z"
            fill={`url(#rg-${rank.code}-${size})`}
            stroke={locked ? "var(--border-default)" : stroke}
            strokeWidth="1.5"
            opacity={locked ? 0.7 : 1}
          />
          {/* ascending candle / analytics motif */}
          {!locked && (
            <>
              <path
                d="M14 30 L20 24 L26 27 L34 17"
                stroke={stroke}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="34" cy="17" r="2.4" fill={fill2} />
            </>
          )}
          {locked && (
            <path
              d="M20 26 h8 v6 h-8 z M22 26 v-3 a2 2 0 0 1 4 0 v3"
              stroke="var(--locked)"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
          )}
        </svg>
        {/* tier pips */}
        {size !== "sm" && (
          <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
            {[1, 2, 3, 4].map((t) => (
              <span
                key={t}
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    !locked && t <= rank.tier ? "var(--accent-primary)" : "var(--locked)",
                  opacity: !locked && t <= rank.tier ? 1 : 0.4,
                }}
              />
            ))}
          </span>
        )}
      </span>

      {showLabel && (
        <span className="flex flex-col leading-tight">
          <span className="font-ui text-[0.7rem] uppercase tracking-wide text-ink-3">
            Ранг
          </span>
          <span
            className={cn(
              "font-display font-semibold",
              size === "lg" ? "text-lg" : "text-sm",
              locked ? "text-ink-3" : "text-ink",
            )}
          >
            {locked ? "Скрытый ранг" : rank.label}
          </span>
        </span>
      )}
    </span>
  );
}
