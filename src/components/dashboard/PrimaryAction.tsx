import type { PrimaryActionModel } from "@/domain/progression";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

const KIND_ICON: Record<PrimaryActionModel["kind"], string> = {
  "continue-lesson": "play",
  "start-test": "check",
  "fix-report": "star",
  checkpoint: "target",
};

/**
 * The single primary action ("один очевидный следующий шаг"). Exactly one per
 * screen. `emphasis` controls how dominant the block is per art direction.
 */
export function PrimaryAction({
  action,
  emphasis = "high",
  className,
}: {
  action: PrimaryActionModel;
  emphasis?: "high" | "medium";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-line p-5 sm:flex-row sm:items-center sm:justify-between",
        emphasis === "high"
          ? "bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--accent-primary)_16%,transparent),transparent_60%),var(--surface-elevated)] shadow-glow"
          : "bg-surface-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-[color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-accent">
          <Icon name={KIND_ICON[action.kind]} className="h-5 w-5" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-ui text-xs uppercase tracking-wide text-ink-3">
            Следующий шаг
          </span>
          <span className="font-display text-lg font-semibold leading-tight text-ink">
            {action.label}
          </span>
          <span className="font-ui text-sm text-ink-2">{action.context}</span>
        </span>
      </div>
      <Button size="lg" className="w-full shrink-0 sm:w-auto">
        {action.label}
        <Icon name="arrowRight" className="h-4 w-4" strokeWidth={2.25} />
      </Button>
    </div>
  );
}
