import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { UnreadPresence } from "@/components/shell/unread-presence";
import { ToolPage } from "@/features/tool-windows/components/tool-page";
import { ToolLocked } from "@/features/tool-windows/components/tool-locked";
import { ToolSoon } from "@/features/tool-windows/components/tool-soon";
import { TradeCardWorkspace } from "@/features/tool-windows/trade-card/trade-card-workspace";
import { JournalWorkspace } from "@/features/tool-windows/journal/journal-workspace";
import { RiskWorkspace } from "@/features/tool-windows/risk/risk-workspace";
import { ChecklistWorkspace } from "@/features/tool-windows/checklist/checklist-workspace";
import { StatsWorkspace } from "@/features/tool-windows/stats/stats-workspace";
import { NewsWorkspace } from "@/features/tool-windows/news/news-workspace";
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
import type { AcademyToolAccess } from "@/lib/curriculum/academy-view";
import { getPathProgress, resolvePathScenario } from "@/features/path/model/path-state";
import { getLevel } from "@/data/curriculum/fixture";
import { getAcademyConfig } from "@/config/academy-config";
import { getServerViewer, shellViewerName } from "@/server/auth/server-session";
import { getCurriculumView } from "@/lib/curriculum/provider";
import { readTradeCardStateOnServer } from "@/server/tools/trade-card-read";
import { readJournalOnServer } from "@/server/tools/journal-read";
import { readRiskStateOnServer } from "@/server/tools/risk-read";
import { readChecklistOnServer } from "@/server/tools/checklist-read";
import { readStatsOnServer } from "@/server/tools/stats-read";
import { readNewsCalendarOnServer } from "@/server/tools/news-read";
import type { TradeCardState } from "@/features/tool-windows/trade-card/trade-card-client";
import type { JournalPage } from "@/features/tool-windows/journal/journal-model";
import type { RiskState } from "@/features/tool-windows/risk/risk-model";
import type { ChecklistState } from "@/features/tool-windows/checklist/checklist-model";
import type { JournalStats } from "@/features/tool-windows/stats/stats-model";
import type { NewsCalendarState } from "@/features/tool-windows/news/news-model";
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
 *
 * THE FIRST READ. A built tool's data is read here, alongside the verdict, so
 * the tool arrives already drawn. A locked tool's read is refused by the
 * Backend and comes back null, and a failed one leaves the tool to read again
 * from the browser.
 *
 * `?card=<id>` on the journal is «Разобрать в журнале» from a saved Trade Card:
 * the journal opens that card's entry for review. The id only selects among
 * the learner's own entries the Backend already sent; it reaches no request.
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

  const sp = await searchParams;
  const reviewCardId = tool.slug === "journal" ? cardIdOf(sp.card) : null;

  if (getAcademyConfig().mode === "api") {
    const [viewer, result, tradeCard, journal, risk, checklist, stats, news] = await Promise.all([
      getServerViewer(),
      getCurriculumView(),
      tool.slug === "trade-card" ? readTradeCardStateOnServer() : Promise.resolve(null),
      tool.slug === "journal" ? readJournalOnServer() : Promise.resolve(null),
      tool.slug === "risk-calculator" ? readRiskStateOnServer() : Promise.resolve(null),
      tool.slug === "entry-checklist" ? readChecklistOnServer() : Promise.resolve(null),
      tool.slug === "stats" ? readStatsOnServer() : Promise.resolve(null),
      tool.slug === "news" ? readNewsCalendarOnServer() : Promise.resolve(null),
    ]);
    const access = toolAccessOf(result);
    const view = resolveToolWindow(tool.slug, access);
    return (
      <AppShell userName={viewer?.name ?? "Ученик"} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
        <ToolContent
          tool={tool}
          state={view?.state ?? "locked"}
          unlockLevel={view?.unlockLevel ?? tool.unlockLevel}
          currentLevel={result.ok ? learnerCurrentLevel(result.view) : null}
          releasingLevelTitle={result.ok ? levelTitleOf(result.view, tool.unlockLevel) : null}
          data={{
            tradeCard,
            journal,
            risk,
            checklist,
            stats,
            news: news?.state ?? null,
            newsDay: news?.day ?? null,
            journalOpen: isOpen("journal", access),
            reviewCardId,
          }}
        />
      </AppShell>
    );
  }

  const rawScenario = sp.scenario;
  const scenario = resolvePathScenario(Array.isArray(rawScenario) ? rawScenario[0] : rawScenario);
  const access = fixtureToolAccess(scenario);
  const view = resolveToolWindow(tool.slug, access);
  return (
    <AppShell userName={await shellViewerName()} activeId="tools" frozenSurface notificationPresence={<UnreadPresence />}>
      <ToolContent
        tool={tool}
        state={view?.state ?? "locked"}
        unlockLevel={view?.unlockLevel ?? tool.unlockLevel}
        currentLevel={getPathProgress(scenario).currentLevel}
        releasingLevelTitle={getLevel(tool.unlockLevel).title}
        data={{
          tradeCard: null,
          journal: null,
          risk: null,
          checklist: null,
          stats: null,
          news: null,
          newsDay: null,
          journalOpen: isOpen("journal", access),
          reviewCardId,
        }}
      />
    </AppShell>
  );
}

/** What the built tools read with the page. Null reads again from the browser. */
type ToolData = {
  readonly tradeCard: TradeCardState | null;
  readonly journal: JournalPage | null;
  readonly risk: RiskState | null;
  readonly checklist: ChecklistState | null;
  readonly stats: JournalStats | null;
  readonly news: NewsCalendarState | null;
  /** The learner's today in their saved plan's zone, worked out with the first read. */
  readonly newsDay: string | null;
  /** Whether the Trading Journal is open: a saved card then goes into it. */
  readonly journalOpen: boolean;
  /** The Trade Card whose journal entry opens for review, from `?card=`. */
  readonly reviewCardId: string | null;
};

/** A cuid-shaped id, or null: anything else in the address is ignored. */
function cardIdOf(raw: string | string[] | undefined): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(raw) ? raw : null;
}

function isOpen(slug: ToolWindowDefinition["slug"], access: AcademyToolAccess | null): boolean {
  return resolveToolWindow(slug, access)?.state === "open";
}

function ToolContent({
  tool,
  state,
  unlockLevel,
  currentLevel,
  releasingLevelTitle,
  data,
}: {
  tool: ToolWindowDefinition;
  state: ToolWindowState;
  unlockLevel: number;
  currentLevel: number | null;
  releasingLevelTitle: string | null;
  data: ToolData;
}) {
  return (
    <ToolPage tool={tool} unlockLevel={unlockLevel}>
      {state === "open" ? (
        workspaceFor(tool, data)
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
function workspaceFor(tool: ToolWindowDefinition, data: ToolData) {
  switch (tool.slug) {
    case "trade-card":
      return <TradeCardWorkspace initialState={data.tradeCard} journalOpen={data.journalOpen} />;
    case "journal":
      return <JournalWorkspace initialPage={data.journal} reviewCardId={data.reviewCardId} />;
    case "risk-calculator":
      return <RiskWorkspace initialState={data.risk} />;
    case "entry-checklist":
      return <ChecklistWorkspace initialState={data.checklist} />;
    case "stats":
      return <StatsWorkspace initialStats={data.stats} />;
    case "news":
      return <NewsWorkspace initialState={data.news} initialDay={data.newsDay} />;
    default:
      return <ToolSoon tool={tool} />;
  }
}
