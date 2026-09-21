/**
 * TOOLS-V2 — Entry Checklist (L20).
 *
 *   GET  /api/tools/entry-checks   the fixed list, the learner's newest checks,
 *                                  the minimum payout they last used, the assets
 *   POST /api/tools/entry-checks   «Записать проверку»: one check, its verdict
 *                                  computed here from the answers
 *
 * Gate order: learner session (+ CSRF on POST) → rate limit → tool unlocked
 * (L20 durably completed) → input. A locked tool answers `TOOL_LOCKED` and reads
 * nothing. No query parameter is accepted, and nothing is edited or deleted.
 */
import { assertToolUnlocked } from "@/lib/tools/access";
import {
  ENTRY_CHECKLIST_TOOL_CODE,
  checklistReference,
  parseEntryCheck,
  toEntryCheckDto,
} from "@/lib/tools/entry-checklist";
import { createEntryCheck, readEntryChecks, type EntryCheckState } from "@/lib/tools/entry-checklist-service";
import {
  assertNoQueryParams,
  enforceToolRateLimit,
  parseJsonObject,
  requireToolLearner,
  toolData,
  toolErrorResponse,
} from "@/lib/tools/http";
import { tradeCardReference } from "@/lib/tools/reference";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function stateDto(state: EntryCheckState) {
  return {
    recent: state.recent.map(toEntryCheckDto),
    lastMinPayoutPercent: state.lastMinPayoutPercent,
  };
}

export async function GET(request: Request) {
  const gate = await requireToolLearner(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "read");
    await assertToolUnlocked(gate.userId, ENTRY_CHECKLIST_TOOL_CODE);
    const state = await readEntryChecks(gate.userId);
    return toolData({
      ...stateDto(state),
      checklist: checklistReference(),
      reference: { assets: tradeCardReference().assets },
    });
  } catch (error) {
    return toolErrorResponse(error, "GET /api/tools/entry-checks");
  }
}

export async function POST(request: Request) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, ENTRY_CHECKLIST_TOOL_CODE);
    const body = await parseJsonObject(request);
    const input = parseEntryCheck(body.check);
    const check = await createEntryCheck(gate.userId, input);
    const state = await readEntryChecks(gate.userId);
    return toolData({ check: toEntryCheckDto(check), ...stateDto(state) }, 201);
  } catch (error) {
    return toolErrorResponse(error, "POST /api/tools/entry-checks");
  }
}
