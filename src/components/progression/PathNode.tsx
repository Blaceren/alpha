import type { PathNodeModel } from "@/domain/progression";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

const ACTIVITY_ICON: Record<string, string> = {
  lesson: "play",
  test: "check",
  report: "star",
  practical: "compass",
  checkpoint: "target",
};

/**
 * A single node on the horizontal path. Reward label is visually primary; the
 * numeric index is secondary (DD-051). States: completed / active / locked /
 * checkpoint (others map to these visuals in D1A).
 */
export function PathNode({
  node,
  size = "md",
  showLabel = true,
}: {
  node: PathNodeModel;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}) {
  const dim = size === "lg" ? 60 : size === "sm" ? 40 : 50;
  const isActive = node.state === "active";
  const isCompleted = node.state === "completed";
  const isCheckpoint = node.state === "checkpoint";
  const isLocked = node.state === "locked" || node.state === "hidden";

  const ring = isActive
    ? "border-active shadow-[0_0_0_4px_color-mix(in_srgb,var(--active)_22%,transparent),0_18px_44px_-16px_var(--path-glow)]"
    : isCompleted
      ? "border-completed"
      : isCheckpoint
        ? "border-warning"
        : "border-line";

  const iconColor = isActive
    ? "text-active"
    : isCompleted
      ? "text-completed"
      : isCheckpoint
        ? "text-warning"
        : "text-locked";

  const iconName = isCompleted
    ? "check"
    : isLocked
      ? "lock"
      : ACTIVITY_ICON[node.activity] ?? "node";

  return (
    <div className="flex w-[104px] shrink-0 flex-col items-center gap-2 text-center">
      <div
        className={cn(
          "relative flex items-center justify-center rounded-2xl border-2 bg-surface-2",
          isCheckpoint && "rotate-45 rounded-xl",
          ring,
        )}
        style={{ width: dim, height: dim }}
        aria-hidden="true"
      >
        <span className={cn(isCheckpoint && "-rotate-45")}>
          <Icon name={iconName} className={cn("h-5 w-5", iconColor)} />
        </span>
      </div>

      {showLabel && (
        <div className="flex flex-col items-center gap-0.5">
          {node.reward ? (
            <span className="line-clamp-2 font-ui text-xs font-semibold text-ink">
              {node.reward}
            </span>
          ) : (
            <span className="line-clamp-2 font-ui text-xs text-ink-2">{node.label}</span>
          )}
          <span className="font-mono text-[0.65rem] text-ink-3 tabular-nums">
            Уровень {node.index}
          </span>
        </div>
      )}
    </div>
  );
}
