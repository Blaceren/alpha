import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ToolWindowFrame } from "@/features/tool-windows/components/tool-window-frame";
import { ToolLocked } from "@/features/tool-windows/components/tool-locked";
import { ToolSoon } from "@/features/tool-windows/components/tool-soon";
import { TradeCardWorkspace } from "@/features/tool-windows/trade-card/trade-card-workspace";
import { TradeCardPreview } from "@/features/tool-windows/trade-card/trade-card-preview";
import {
  RETIRED_TOOL_CODES,
  toolWindowByCode,
  toolWindowBySlug,
  toolWindowHref,
  type ToolWindowDefinition,
} from "@/features/tool-windows/model/catalog";
import {
  fixtureToolAccess,
  learnerCurrentLevel,
  levelTitleOf,
  resolveToolWindow,
  toolAccessOf,
} from "@/features/tool-windows/model/access";
import { getPathProgress, resolvePathScenario } from "@/features/path/model/path-state";
import { getLevel } from "@/data/curriculum/fixture";
import { getAcademyConfig } from "@/config/academy-config";
import { getCurriculumView } from "@/lib/curriculum/provider";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const tool = toolWindowBySlug((await params).slug);
  return {
    title: tool ? `${tool.title} — Alfa Trade Academy` : "Инструмент — Alfa Trade Academy",
    robots: { index: false, follow: false },
  };
}

/**
 * One tool, in a tab of its own: /tools/<slug> (TOOLS-V2).
 *
 * THE ADDRESS. `slug` is the tool's short name (`trade-card`). Published lesson
 * content still links by canonical code (`/tools/tool.trade_card`); a current
 * code is sent to its slug, a code the previous catalogue used and this one
 * retired lands on the tools page, and anything else is the ordinary 404.
 *
 * THE STATE. Resolved from the Backend's verdict, never from the address:
 *   open   → the working tool;
 *   locked → where the learner is, the level that opens it, and an example;
 *   soon   → earned, but this build has no window for it yet.
 */
export default async function ToolWindowPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const tool = toolWindowBySlug(slug);
  if (!tool) {
    const named = toolWindowByCode(slug);
    if (named) redirect(toolWindowHref(named.slug));
    if (RETIRED_TOOL_CODES.includes(slug)) redirect("/tools");
    notFound();
  }

  if (getAcademyConfig().mode === "api") {
    const result = await getCurriculumView();
    const view = resolveToolWindow(tool.slug, toolAccessOf(result));
    const currentLevel = result.ok ? learnerCurrentLevel(result.view) : null;
    const levelTitle = result.ok ? levelTitleOf(result.view, tool.unlockLevel) : null;
    return renderTool(tool, view?.state ?? "locked", view?.unlockLevel ?? tool.unlockLevel, currentLevel, levelTitle);
  }

  const sp = await searchParams;
  const rawScenario = sp.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);
  const view = resolveToolWindow(tool.slug, fixtureToolAccess(scenario));
  return renderTool(
    tool,
    view?.state ?? "locked",
    view?.unlockLevel ?? tool.unlockLevel,
    getPathProgress(scenario).currentLevel,
    getLevel(tool.unlockLevel).title,
  );
}

function renderTool(
  tool: ToolWindowDefinition,
  state: "open" | "locked" | "soon",
  unlockLevel: number,
  currentLevel: number | null,
  releasingLevelTitle: string | null,
) {
  return (
    <ToolWindowFrame tool={tool} unlockLevel={unlockLevel}>
      {state === "open" ? (
        workspaceFor(tool)
      ) : state === "soon" ? (
        <ToolSoon tool={tool} />
      ) : (
        <ToolLocked
          tool={tool}
          unlockLevel={unlockLevel}
          currentLevel={currentLevel}
          releasingLevelTitle={releasingLevelTitle}
          preview={previewFor(tool)}
        />
      )}
    </ToolWindowFrame>
  );
}

/** The working window of a built tool. A tool marked built without one here falls back to the not-built page. */
function workspaceFor(tool: ToolWindowDefinition) {
  switch (tool.slug) {
    case "trade-card":
      return <TradeCardWorkspace />;
    default:
      return <ToolSoon tool={tool} />;
  }
}

function previewFor(tool: ToolWindowDefinition) {
  return tool.slug === "trade-card" ? <TradeCardPreview /> : null;
}
