/**
 * TOOLS-V2 — News Calendar (L30).
 *
 *   GET  /api/tools/news-calendar              the plan in force (or null), the
 *                                              published releases within now ± 36 h,
 *                                              and what the plan form offers
 *   GET  /api/tools/news-calendar?from=&to=    the same for a day the browser
 *                                              worked out in the learner's zone
 *   POST /api/tools/news-calendar              «Сохранить план»: a new version, 201;
 *                                              the same plan as the newest adds
 *                                              nothing, 200
 *
 * Gate order: learner session (+ CSRF on POST) → rate limit → tool unlocked
 * (L30 durably completed) → input. A locked tool answers `TOOL_LOCKED` and reads
 * nothing. Only published items are ever read; nothing is ever deleted.
 */
import { toNewsEventDto } from "@/lib/news/news";
import { assertToolUnlocked } from "@/lib/tools/access";
import {
  assertNoQueryParams,
  enforceToolRateLimit,
  parseJsonObject,
  requireToolLearner,
  toolData,
  toolErrorResponse,
} from "@/lib/tools/http";
import {
  NEWS_CALENDAR_TOOL_CODE,
  newsCalendarReference,
  parseCalendarWindow,
  parseNewsPlan,
  toNewsPlanDto,
} from "@/lib/tools/news-calendar";
import { readCalendarEvents, readNewsPlan, saveNewsPlan, type NewsPlanState } from "@/lib/tools/news-calendar-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function planDto(state: NewsPlanState) {
  return state.current ? toNewsPlanDto(state.current.row, state.current.version) : null;
}

export async function GET(request: Request) {
  const gate = await requireToolLearner(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    enforceToolRateLimit(gate.userId, "read");
    await assertToolUnlocked(gate.userId, NEWS_CALENDAR_TOOL_CODE);
    const window = parseCalendarWindow(new URL(request.url).searchParams);
    const [state, events] = await Promise.all([readNewsPlan(gate.userId), readCalendarEvents(window)]);
    return toolData({
      plan: planDto(state),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      events: events.map(toNewsEventDto),
      reference: newsCalendarReference(),
    });
  } catch (error) {
    return toolErrorResponse(error, "GET /api/tools/news-calendar");
  }
}

export async function POST(request: Request) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, NEWS_CALENDAR_TOOL_CODE);
    const body = await parseJsonObject(request);
    const plan = parseNewsPlan(body.plan);
    const { created, state } = await saveNewsPlan(gate.userId, plan);
    return toolData({ plan: planDto(state) }, created ? 201 : 200);
  } catch (error) {
    return toolErrorResponse(error, "POST /api/tools/news-calendar");
  }
}
