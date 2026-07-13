import type { ToolModel } from "@/domain/progression";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

/** A tool tile: English name + RU description + unlock/state. Manual-only tools. */
export function ToolUnlockPreview({
  tool,
  className,
}: {
  tool: ToolModel;
  className?: string;
}) {
  const locked = tool.state === "locked";
  const reward = tool.state === "nearest-reward";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-line p-3",
        reward ? "bg-surface-3" : "bg-surface-1",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
          reward
            ? "border-accent text-accent"
            : locked
              ? "border-line-subtle text-locked"
              : "border-line text-ink-2",
        )}
      >
        <Icon name={locked ? "lock" : reward ? "sparkles" : "tools"} className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-ui text-sm font-medium text-ink">{tool.name}</span>
        <span className="truncate font-ui text-xs text-ink-3">{tool.description}</span>
      </span>
      <span className="ml-auto shrink-0">
        {reward ? (
          <Badge tone="accent">Ближайшая награда</Badge>
        ) : locked ? (
          <Badge tone="locked">Уровень {tool.unlockLevel}</Badge>
        ) : (
          <Badge tone="success">Открыт</Badge>
        )}
      </span>
    </div>
  );
}
