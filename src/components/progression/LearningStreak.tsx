import type { StreakModel } from "@/domain/progression";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * "Серия обучения" — extended only by meaningful learning actions, never by
 * login/trading/deposit. No red punishment; best result is preserved.
 */
export function LearningStreak({
  streak,
  className,
}: {
  streak: StreakModel;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Icon
        name="flame"
        className={cn("h-4 w-4", streak.active ? "text-warning" : "text-ink-3")}
      />
      <span className="font-ui text-sm text-ink-2">
        Серия обучения{" "}
        <span className="font-semibold text-ink">{streak.current}</span>
        <span className="text-ink-3"> · лучшая {streak.best}</span>
      </span>
    </span>
  );
}
