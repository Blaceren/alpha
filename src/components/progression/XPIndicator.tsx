import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/** XP indicator. XP never derives from trades/deposits/losses (DD-031). */
export function XPIndicator({
  label,
  className,
  emphasis = false,
}: {
  label: string;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono",
        emphasis ? "text-ink" : "text-ink-2",
        className,
      )}
    >
      <Icon name="sparkles" className="h-4 w-4 text-accent-2" />
      <span className="tabular-nums">{label}</span>
    </span>
  );
}
