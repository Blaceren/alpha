import type { CheckpointTargetModel } from "@/domain/progression";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

/**
 * Next checkpoint target. Shows ONLY the required target and the rank it
 * unlocks. NEVER the user's balance, deposits, or "remaining $X"; no Pocket CTA
 * (DD-020…DD-024). Checkpoint is not the primary action in this synthetic state.
 */
export function CheckpointPreview({
  checkpoint,
  className,
  tone = "default",
}: {
  checkpoint: CheckpointTargetModel;
  className?: string;
  tone?: "default" | "quiet";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line p-4",
        tone === "quiet" ? "bg-surface-1" : "bg-surface-2",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon name="target" className="h-4 w-4 text-warning" />
        <span className="font-ui text-sm font-semibold text-ink">
          Контрольная точка · Уровень {checkpoint.levelIndex}
        </span>
        <Badge tone="neutral" className="ml-auto">
          Впереди
        </Badge>
      </div>
      <p className="font-ui text-sm leading-relaxed text-ink-2">
        Для открытия следующего модуля требуется баланс Pocket от{" "}
        <span className="font-semibold text-ink">${checkpoint.targetUsd}</span>.
      </p>
      <p className="mt-1.5 font-ui text-xs text-ink-3">
        Учитывается только реальный баланс. Demo не засчитывается.
      </p>
      <div className="mt-3 flex items-center gap-2 border-t border-line-subtle pt-3">
        <Icon name="shield" className="h-4 w-4 text-accent" />
        <span className="font-ui text-xs text-ink-2">
          Откроется ранг{" "}
          <span className="font-medium text-ink">{checkpoint.rankLabel}</span>
        </span>
      </div>
    </div>
  );
}
