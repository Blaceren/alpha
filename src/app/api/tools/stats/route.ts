/**
 * TOOLS-V2 — Personal Stats (L25).
 *
 *   GET /api/tools/stats?period=7d|30d|all&today=YYYY-MM-DD
 *       the learner's journal over the window: trades, win rate, break-even at
 *       the average payout, the share on plan, the win rate on plan against a
 *       broken plan, the rules broken. Counts and shares only, never money.
 *
 * Gate order: learner session → rate limit → tool unlocked (L25 durably
 * completed) → query. A locked tool answers `TOOL_LOCKED` and reads nothing.
 * Only the two named query parameters are accepted. There is nothing to write.
 */
import { assertToolUnlocked } from "@/lib/tools/access";
import { enforceToolRateLimit, requireToolLearner, toolData, toolErrorResponse } from "@/lib/tools/http";
import { PERSONAL_STATS_TOOL_CODE, parseStatsQuery, toJournalStatsDto } from "@/lib/tools/stats";
import { readJournalStats } from "@/lib/tools/stats-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const gate = await requireToolLearner(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    const query = parseStatsQuery(new URL(request.url).searchParams);
    enforceToolRateLimit(gate.userId, "read");
    await assertToolUnlocked(gate.userId, PERSONAL_STATS_TOOL_CODE);
    const stats = await readJournalStats(gate.userId, query);
    return toolData(toJournalStatsDto(query, stats));
  } catch (error) {
    return toolErrorResponse(error, "GET /api/tools/stats");
  }
}
