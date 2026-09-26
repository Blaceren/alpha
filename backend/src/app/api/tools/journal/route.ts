/**
 * TOOLS-V2 — Trading Journal (L10).
 *
 *   GET  /api/tools/journal?filter=all|violated|no_conclusion&before=<entryId>
 *        one page of the learner's own entries, counts over the whole journal,
 *        and the lists the forms pick from
 *   POST /api/tools/journal
 *        «Новая запись»: a trade recorded by hand
 *
 * Gate order: learner session (+ CSRF on POST) → rate limit → tool unlocked
 * (L10 durably completed) → input. A locked tool answers TOOL_LOCKED and reads
 * nothing. Only the two named query parameters are accepted.
 */
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
  TRADING_JOURNAL_TOOL_CODE,
  journalReference,
  parseJournalManualEntry,
  parseJournalQuery,
  toJournalEntryDto,
} from "@/lib/tools/journal";
import { createManualJournalEntry, listJournal } from "@/lib/tools/journal-service";
import { tradeCardReference } from "@/lib/tools/reference";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const gate = await requireToolLearner(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    const query = parseJournalQuery(new URL(request.url).searchParams);
    enforceToolRateLimit(gate.userId, "read");
    await assertToolUnlocked(gate.userId, TRADING_JOURNAL_TOOL_CODE);
    const page = await listJournal(gate.userId, query);
    return toolData({
      entries: page.rows.map(toJournalEntryDto),
      nextCursor: page.nextCursor,
      summary: page.summary,
      filter: query.filter,
      reference: { ...tradeCardReference(), ...journalReference() },
    });
  } catch (error) {
    return toolErrorResponse(error, "GET /api/tools/journal");
  }
}

export async function POST(request: Request) {
  const gate = await requireToolLearner(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertNoQueryParams(request);
    enforceToolRateLimit(gate.userId, "write");
    await assertToolUnlocked(gate.userId, TRADING_JOURNAL_TOOL_CODE);
    const body = await parseJsonObject(request);
    const entry = parseJournalManualEntry(body.entry);
    const row = await createManualJournalEntry(gate.userId, entry);
    return toolData({ entry: toJournalEntryDto(row) }, 201);
  } catch (error) {
    return toolErrorResponse(error, "POST /api/tools/journal");
  }
}
