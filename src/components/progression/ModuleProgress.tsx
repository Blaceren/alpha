import type { ModuleProgressModel } from "@/domain/progression";
import { cn } from "@/lib/cn";

/** Progress within the current curriculum module (e.g. 2/5 of "Чтение графика"). */
export function ModuleProgress({
  module,
  className,
  compact = false,
}: {
  module: ModuleProgressModel;
  className?: string;
  compact?: boolean;
}) {
  const pct = Math.round((module.completedLevels / module.totalLevels) * 100);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-ui text-sm text-ink-2">
          <span className="text-ink-3">Модуль {module.ordinal}</span>{" "}
          <span className="truncate font-medium text-ink">«{module.name}»</span>
        </span>
        {!compact && (
          <span className="shrink-0 font-mono text-xs text-ink-3 tabular-nums">
            {module.completedLevels}/{module.totalLevels}
          </span>
        )}
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Прогресс модуля «${module.name}»`}
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--accent-primary),var(--accent-secondary))]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
