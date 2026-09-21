import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { ToolPage } from "@/features/tool-windows/components/tool-page";
import { ToolLocked } from "@/features/tool-windows/components/tool-locked";
import { ToolSoon } from "@/features/tool-windows/components/tool-soon";
import { TradeCardWorkspace } from "@/features/tool-windows/trade-card/trade-card-workspace";
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
  type ToolWindowState,
} from "@/features/tool-windows/model/access";
import { getPathProgress, resolvePathScenario } from "@/features/path/model/path-state";
import { getLevel } from "@/data/curriculum/fixture";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer, shellViewerName } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { readTradeCardStateOnServer } from "@/server/tools/trade-card-read";
import type { TradeCardState } from "@/features/tool-windows/trade-card/trade-card-client";
import "@/features/tool-windows/tool-windows.css";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const tool = toolWindowBySlug((await params).slug);
  return { title: tool ? `${tool.title} — Alfa Trade Academy` : "Инструмент — Alfa Trade Academy" };
}

/**
 * One tool: /tools/<slug> (TOOLS-V2), inside the Academy shell.
 *
 * THE SAME TAB (owner decision 2026-09-21). The tools page links here like any
 * other page, and «Все инструменты» at the top of the tool leads back.
 *
 * THE ADDRESS. `slug` is the tool's short name (`trade-card`). Published lesson
 * content still links by canonical code (`/tools/tool.trade_card`); a current
 * code is sent to its slug, a code the previous catalogue used and this one
 * retired lands on the tools page, and anything else is the ordinary 404.
 *
 * THE STATE. Resolved from the Backend's verdict, never from the address:
 *   open   → the working tool;
 *   locked → where the learner is, the level that opens it, and why;
 *   soon   → earned, but this build has no tool page for it yet.
 */
export default async function ToolRoute({
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
    /* The card is read alongside the verdict, so the tool arrives already drawn.
       A locked tool's read is refused by the Backend and simply comes back null. */
    const [viewer, result, tradeCard] = await Promise.all([
      getServerViewer(),
      getCurriculumView(),
      tool.slug === "trade-card" ? readTradeCardStateOnServer() : Promise.resolve(null),
    ]);
    const view = resolveToolWindow(tool.slug, toolAccessOf(result));
    return (
      <AppShell userName={viewer?.name ?? "Ученик"} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
        <ToolContent
          tool={tool}
          state={view?.state ?? "locked"}
          unlockLevel={view?.unlockLevel ?? tool.unlockLevel}
          currentLevel={result.ok ? learnerCurrentLevel(result.view) : null}
          releasingLevelTitle={result.ok ? levelTitleOf(result.view, tool.unlockLevel) : null}
          tradeCard={tradeCard}
        />
      </AppShell>
    );
  }

  const sp = await searchParams;
  const rawScenario = sp.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);
  const view = resolveToolWindow(tool.slug, fixtureToolAccess(scenario));
  return (
    <AppShell userName={await shellViewerName()} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
      <ToolContent
        tool={tool}
        state={view?.state ?? "locked"}
        unlockLevel={view?.unlockLevel ?? tool.unlockLevel}
        currentLevel={getPathProgress(scenario).currentLevel}
        releasingLevelTitle={getLevel(tool.unlockLevel).title}
        tradeCard={null}
      />
    </AppShell>
  );
}

function ToolContent({
  tool,
  state,
  unlockLevel,
  currentLevel,
  releasingLevelTitle,
  tradeCard,
}: {
  tool: ToolWindowDefinition;
  state: ToolWindowState;
  unlockLevel: number;
  currentLevel: number | null;
  releasingLevelTitle: string | null;
  /** The server's first read of the Trade Card, or null to read from the browser. */
  tradeCard: TradeCardState | null;
}) {
  return (
    <ToolPage tool={tool} unlockLevel={unlockLevel}>
      {state === "open" ? (
        workspaceFor(tool, tradeCard)
      ) : state === "soon" ? (
        <ToolSoon tool={tool} />
      ) : (
        <ToolLocked
          tool={tool}
          unlockLevel={unlockLevel}
          currentLevel={currentLevel}
          releasingLevelTitle={releasingLevelTitle}
        />
      )}
    </ToolPage>
  );
}

/** The working tool of a built tool. One marked built without one here falls back to the not-built state. */
function workspaceFor(tool: ToolWindowDefinition, tradeCard: TradeCardState | null) {
  switch (tool.slug) {
    case "trade-card":
      return <TradeCardWorkspace initialState={tradeCard} />;
    default:
      return <ToolSoon tool={tool} />;
  }
}
