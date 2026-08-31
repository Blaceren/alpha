import { projectTool } from "@/features/tools/model/tools-projection";
import type { PathProgress } from "@/features/path/model/path-state";
import {
  RISK_CALCULATOR_CODE,
  TRADING_JOURNAL_CODE,
} from "@/features/tools/model/tool-catalog";
import { TradingJournalWorkspace } from "@/features/tools/components/trading-journal-workspace";
import { RiskCalculatorWorkspace } from "@/features/tools/components/risk-calculator-workspace";
import {
  ToolLockedPage,
  ToolNotEnterablePage,
  ToolNotFoundPage,
  ToolWorkFrame,
} from "@/features/tools-fidelity/tools-fidelity";
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";

/**
 * ONE TOOL — dispatched on the RESOLVED view, never on the raw code.
 *
 * The order of these branches is the whole safety property: an unknown code
 * cannot borrow a real tool's frame, a locked tool cannot render a working
 * surface, and an unlocked-but-unbuilt tool cannot claim to be operational. The
 * frozen design has a page for each of those, and they differ STRUCTURALLY —
 * not by colour, and not by one page with a different sentence in it.
 *
 * NO PROGRESSION MEANS NO UNLOCKS. A learner with no enrolled progression sees
 * the locked page for a real tool code, because that is what is true: the tool
 * exists and their progression has not reached it.
 */
export function ToolFidelitySurface({
  toolCode,
  progress,
  access,
}: {
  toolCode: string;
  progress: PathProgress | null;
  /** The Backend's verdict. Null locks every tool, by design. */
  access: AcademyToolAccess | null;
}) {
  const tool = progress ? projectTool(toolCode, progress, access) : null;

  if (!tool) {
    /* Unknown code, or no progression to resolve against. Either way the page
       must not invent a capability — and a code that is not in the catalogue
       must never borrow the frame of one that is. */
    const known = progress === null ? projectToolWithoutProgress(toolCode) : null;
    return known ? <ToolLockedPage tool={known} /> : <ToolNotFoundPage />;
  }

  if (!tool.unlocked) return <ToolLockedPage tool={tool} />;
  if (!tool.available) return <ToolNotEnterablePage tool={tool} />;

  if (tool.code === TRADING_JOURNAL_CODE) {
    return (
      <ToolWorkFrame tool={tool}>
        <TradingJournalWorkspace />
      </ToolWorkFrame>
    );
  }
  if (tool.code === RISK_CALCULATOR_CODE) {
    return (
      <ToolWorkFrame tool={tool}>
        <RiskCalculatorWorkspace />
      </ToolWorkFrame>
    );
  }

  /* In the catalogue and marked available, but no surface is wired here. The
     honest page is the not-enterable one, never a crash and never an empty
     frame that looks like a broken tool. */
  return <ToolNotEnterablePage tool={tool} />;
}

/**
 * A tool's identity WITHOUT any progression to resolve against.
 *
 * Used only on the no-progression path, so a real tool code still renders as
 * locked-with-its-own-name rather than as "no such tool". It asks the projector
 * with an empty marker, so the catalogue stays the single source of tool
 * identity and this file declares no tool of its own.
 */
function projectToolWithoutProgress(toolCode: string) {
  /* No progression means no verdict either, and a null verdict is exactly the
     locked answer this path wants: a real tool code renders as itself, locked. */
  return projectTool(toolCode, {
    scenario: "active",
    currentLevel: 1,
    allCompleted: false,
    rankLabel: "",
    xpLabel: "",
    streak: 0,
  } as PathProgress, null);
}
