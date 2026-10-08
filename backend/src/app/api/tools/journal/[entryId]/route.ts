/**
 * TOOLS-V2 — Trading Journal (L10): change or delete one of the learner's own
 * entries.
 *
 *   PATCH /api/tools/journal/:entryId
 *     { "kind": "review", "planFollowed": true|false|null,
 *       "violations": ["revenge", …], "execution": "…", "conclusion": "…" }
 *        the learner's review
 *     { "kind": "entry", …every field of «Новая запись» }
 *        the entry replaced whole — a hand-recorded one or one made from a
 *        Trade Card alike (`"manual"` is still read as `"entry"`)
 *
 *   DELETE /api/tools/journal/:entryId
 *        the entry is deleted, with the rules marked on it; the answer carries
 *        the counts of what is left. The Trade Card it came from, if any, stays.
 *
 * Owner, 2026-10-01: full editing and a delete. Until then an entry from a card
 * kept the card's trade and nothing was deleted.
 *
 * The gate is the same for both: learner session + CSRF → rate limit → tool
 * unlocked → the id. An id that is not a learner's own entry is «not found».
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
import { deleteJournalEntry, updateJournalEntry } from "@/lib/tools/journal-service";

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

export async function DELETE(request: Request, { params }: { params: Promise<{ entryId: string }> }) {
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
    const { summary } = await deleteJournalEntry(gate.userId, entryId);
    return toolData({ deleted: { id: entryId }, summary });
  } catch (error) {
    return toolErrorResponse(error, "DELETE /api/tools/journal/:entryId");
  }
}
