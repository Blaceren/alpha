import Link from "next/link";
import { Lock } from "lucide-react";
import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";

/**
 * A tool the learner has not reached yet: where they are, the level that opens
 * it, and what opens it — and the one next step, which is the path. No example
 * and no preview (owner decision 2026-09-21).
 */
export function ToolLocked({
  tool,
  unlockLevel,
  currentLevel,
  releasingLevelTitle,
}: {
  tool: ToolWindowDefinition;
  unlockLevel: number;
  /** Null when there is no enrolled progression to say anything about. */
  currentLevel: number | null;
  releasingLevelTitle: string | null;
}) {
  const reason =
    tool.releasedBy === "lesson"
      ? `Инструмент появится после урока L${unlockLevel}${releasingLevelTitle ? ` «${releasingLevelTitle}»` : ""}.`
      : `Инструмент появится после контрольной точки L${unlockLevel}, когда будут пройдены уроки, на которые он опирается.`;

  return (
    <div className="tw-quiet">
      <p className="tw-quiet__mark">
        <Lock aria-hidden="true" size={12} strokeWidth={2} />
        {currentLevel !== null ? `Закрыто · сейчас L${currentLevel}` : "Закрыто"}
      </p>
      <h2 className="tw-quiet__title">Откроется на уровне {unlockLevel}</h2>
      <p className="tw-quiet__line">{reason}</p>
      <Link className="tw-button" data-variant="outline" href="/path">
        Продолжить путь
      </Link>
    </div>
  );
}
