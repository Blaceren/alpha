/**
 * TOOLS-V2 — Trading Journal (L10): change one of the learner's own entries.
 *
 *   PATCH /api/tools/journal/:entryId
 *     { "kind": "review", "planFollowed": true|false|null,
 *       "violations": ["revenge", …], "execution": "…", "conclusion": "…" }
 *        the learner's review; any entry
 *     { "kind": "manual", …every field of «Новая запись» }
 *        a hand-recorded entry, replaced whole; refused for an entry made
 *        from a Trade Card (JOURNAL_TRADE_FROM_CARD)
 *
 * No DELETE exists (owner decision): the learner keeps the whole history.
 */
import { assertToolUnlocked } from "@/lib/tools/access";
import {
  assertNoQueryParams,
  enforceToolRateLimit,
  parseJsonObject,
  requireToolLearner,
  toolData,
  toolErrorResponse,
  validateCardId,
} from "@/lib/tools/http";
import { ToolError } from "@/lib/tools/errors";
import { TRADING_JOURNAL_TOOL_CODE, parseJournalChange, toJournalEntryDto } from "@/lib/tools/journal";
import { updateJournalEntry } from "@/lib/tools/journal-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, TRADING_JOURNAL_TOOL_CODE);
    let entryId: string;
    try {
      entryId = validateCardId((await params).entryId);
    } catch {
      throw new ToolError("JOURNAL_ENTRY_NOT_FOUND");
    }
    const change = parseJournalChange(await parseJsonObject(request));
    const row = await updateJournalEntry(gate.userId, entryId, change);
    return toolData({ entry: toJournalEntryDto(row) });
  } catch (error) {
    return toolErrorResponse(error, "PATCH /api/tools/journal/:entryId");
  }
}
