import Link from "next/link";
import { Lock } from "lucide-react";
import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";
import type { ReleasingLevel } from "@/features/tool-windows/model/access";

/**
 * A tool the learner has not reached yet: where they are, the level that opens
 * it, and what opens it — and the one next step, which is the path. No example
 * and no preview (owner decision 2026-09-21).
 *
 * WHAT OPENS IT IS THE PROGRAM'S FACT (2026-10-02). The sentence used to be
 * read off the catalogue: the Trade Card after «урок», the other five after
 * «контрольная точка». That was the 100-level program. In the 30-level program
 * the same tools are released by a lesson, a report and a practice, and there
 * are no checkpoint levels at all — so the sentence is written from the level
 * the learner's own program names, and the catalogue is only the fallback for a
 * view that could not say.
 */
export function ToolLocked({
  tool,
  unlockLevel,
  currentLevel,
  releasing,
}: {
  tool: ToolWindowDefinition;
  unlockLevel: number;
  /** Null when there is no enrolled progression to say anything about. */
  currentLevel: number | null;
  /** The releasing level as the learner's program has it, or null when unknown. */
  releasing: ReleasingLevel | null;
}) {
  /* An unknown kind no longer falls back to the catalogue's «контрольная
     точка» (2026-10-04, launch audit): that was the 100-level plan, and the
     learner's program has no checkpoint levels. The catalogue may still say
     «урок» — a lesson releases the Trade Card in every program — and otherwise
     the sentence says «уровень». */
  const kind =
    releasing && releasing.kind !== "unknown"
      ? releasing.kind
      : tool.releasedBy === "lesson"
        ? "lesson"
        : "level";
  const named = releasing?.title ? ` «${releasing.title}»` : "";
  /* «Уровень N» in a sentence, as every heading says it (2026-10-04, launch
     audit): the sentences read «L5», «сейчас L7» beside «Уровень 5». */
  const reason =
    kind === "checkpoint"
      ? `Инструмент появится после контрольной точки на уровне ${unlockLevel}, когда будут пройдены уроки, на которые он опирается.`
      : kind === "lesson"
        ? `Инструмент появится после урока ${unlockLevel}${named}.`
        : `Инструмент появится после уровня ${unlockLevel}${named}.`;

  return (
    <div className="tw-quiet">
      <p className="tw-quiet__mark">
        <Lock aria-hidden="true" size={12} strokeWidth={2} />
        {currentLevel !== null ? `Закрыто · вы на уровне ${currentLevel}` : "Закрыто"}
      </p>
      <h2 className="tw-quiet__title">Откроется после уровня {unlockLevel}</h2>
      <p className="tw-quiet__line">
        {reason}
        {releasing?.inProduction ? " Этот уровень ещё готовится." : ""}
      </p>
      <Link className="tw-button" data-variant="outline" href="/path">
        Продолжить путь
      </Link>
    </div>
  );
}
