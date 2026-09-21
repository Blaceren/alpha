import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { ToolWindowDefinition } from "@/features/tool-windows/model/catalog";
import { ToolPreviewToggle } from "./tool-preview-toggle";

/**
 * A tool the learner has not reached yet.
 *
 * It says where they are, where the tool opens, and what opens it, in the
 * presentation's words. When the tool is built, it can show what it will look
 * like, filled with example values and marked as an example.
 */
export function ToolLocked({
  tool,
  unlockLevel,
  currentLevel,
  releasingLevelTitle,
  preview,
}: {
  tool: ToolWindowDefinition;
  unlockLevel: number;
  /** Null when there is no enrolled progression to say anything about. */
  currentLevel: number | null;
  releasingLevelTitle: string | null;
  preview: ReactNode | null;
}) {
  const reason =
    tool.releasedBy === "lesson"
      ? `Инструмент появится после урока L${unlockLevel}${releasingLevelTitle ? ` «${releasingLevelTitle}»` : ""}.`
      : `Инструмент появится после контрольной точки L${unlockLevel}, когда будут пройдены уроки, на которые он опирается.`;

  return (
    <>
      <section className="tw-locked" aria-labelledby="tool-locked-title">
        <span className="tw-locked__icon" aria-hidden="true">
          <Lock size={20} strokeWidth={1.75} />
        </span>
        <p className="tw-label">{currentLevel !== null ? `Закрыто · сейчас L${currentLevel}` : "Закрыто"}</p>
        <h2 className="tw-locked__title" id="tool-locked-title">
          Откроется на уровне {unlockLevel}
        </h2>
        <p className="tw-locked__body">{reason}</p>
      </section>
      {preview ? <ToolPreviewToggle>{preview}</ToolPreviewToggle> : null}
    </>
  );
}
