/**
 * The Trading Journal client: its paths and the shapes it guards. The transport
 * is the tools' shared one (`tools-client-core.ts`).
 */
import { makeError } from "@/lib/api/errors";
import { PROXY_BASE, isNullableString, isRecord, toolDelete, toolGet, toolSend, type ToolResult } from "../tools-client-core";
import type { JournalEntry, JournalFilter, JournalPage, JournalSummary, ManualInput, ReviewInput } from "./journal-model";

/** The review alone, or the entry replaced whole — whichever source it came from. */
export type JournalChange = ({ kind: "review" } & ReviewInput) | ({ kind: "entry" } & ManualInput);

const FILTERS: readonly JournalFilter[] = ["all", "violated", "no_conclusion"];

export function isJournalEntry(value: unknown): value is JournalEntry {
  if (!isRecord(value) || !isRecord(value.asset) || !isRecord(value.expiry)) return false;
  return (
    typeof value.id === "string" &&
    (value.source === "trade_card" || value.source === "manual") &&
    isNullableString(value.tradeCardId) &&
    typeof value.tradeDate === "string" &&
    typeof value.entryTime === "string" &&
    typeof value.asset.code === "string" &&
    typeof value.asset.label === "string" &&
    (value.direction === "up" || value.direction === "down") &&
    typeof value.amount === "string" &&
    typeof value.payoutPercent === "number" &&
    typeof value.expiry.code === "string" &&
    typeof value.expiry.label === "string" &&
    typeof value.expiry.seconds === "number" &&
    (value.result === "profit" || value.result === "loss") &&
    typeof value.resultAmount === "string" &&
    isNullableString(value.plan) &&
    isNullableString(value.execution) &&
    isNullableString(value.conclusion) &&
    (value.planFollowed === null || typeof value.planFollowed === "boolean") &&
    Array.isArray(value.violations) &&
    value.violations.every((code) => typeof code === "string") &&
    // Absent from a Backend older than the journal's full editing: read as «not edited».
    (value.editedAfterCard === undefined || typeof value.editedAfterCard === "boolean") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isJournalSummary(value: unknown): value is JournalSummary {
  return (
    isRecord(value) &&
    isCount(value.total) &&
    isCount(value.onPlan) &&
    isCount(value.violated) &&
    isCount(value.unmarked) &&
    isCount(value.withoutConclusion)
  );
}

export function isJournalPage(value: unknown): value is JournalPage {
  if (!isRecord(value) || !isRecord(value.reference)) return false;
  const { reference } = value;
  return (
    Array.isArray(value.entries) &&
    value.entries.every(isJournalEntry) &&
    isNullableString(value.nextCursor) &&
    FILTERS.includes(value.filter as JournalFilter) &&
    isJournalSummary(value.summary) &&
    Array.isArray(reference.assets) &&
    reference.assets.length > 0 &&
    reference.assets.every(
      (asset) =>
        isRecord(asset) &&
        typeof asset.code === "string" &&
        typeof asset.label === "string" &&
        typeof asset.group === "string",
    ) &&
    Array.isArray(reference.expiries) &&
    reference.expiries.length > 0 &&
    reference.expiries.every(
      (expiry) =>
        isRecord(expiry) &&
        typeof expiry.code === "string" &&
        typeof expiry.label === "string" &&
        typeof expiry.seconds === "number",
    ) &&
    Array.isArray(reference.violations) &&
    reference.violations.every(
      (rule) => isRecord(rule) && typeof rule.code === "string" && typeof rule.label === "string",
    )
  );
}

function isEntryEnvelope(value: unknown): value is { entry: JournalEntry } {
  return isRecord(value) && isJournalEntry(value.entry);
}

function isDeletedEnvelope(value: unknown): value is { deleted: { id: string }; summary: JournalSummary } {
  return isRecord(value) && isRecord(value.deleted) && typeof value.deleted.id === "string" && isJournalSummary(value.summary);
}

/** The path of one page: only the filter and, after the first page, the cursor. */
export function journalPagePath(filter: JournalFilter, before: string | null): string {
  const params = new URLSearchParams({ filter });
  if (before) params.set("before", before);
  return `${PROXY_BASE}/tools/journal?${params.toString()}`;
}

export function fetchJournalPage(
  filter: JournalFilter,
  before: string | null = null,
): Promise<ToolResult<JournalPage>> {
  return toolGet(journalPagePath(filter, before), isJournalPage);
}

/** «Новая запись». */
export async function createJournalEntry(entry: ManualInput): Promise<ToolResult<JournalEntry>> {
  const result = await toolSend("POST", `${PROXY_BASE}/tools/journal`, { entry }, isEntryEnvelope);
  return result.ok ? { ok: true, data: result.data.entry } : result;
}

/** «Сохранить разбор», or an entry replaced whole. */
export async function changeJournalEntry(entryId: string, change: JournalChange): Promise<ToolResult<JournalEntry>> {
  const result = await toolSend(
    "PATCH",
    `${PROXY_BASE}/tools/journal/${encodeURIComponent(entryId)}`,
    change,
    isEntryEnvelope,
  );
  return result.ok ? { ok: true, data: result.data.entry } : result;
}

/**
 * «Удалить запись». The answer is the journal's counts after the delete, read
 * by the Backend in the same step — and it must name the entry that was asked
 * for, or it is not an answer to this request.
 */
export async function deleteJournalEntry(entryId: string): Promise<ToolResult<JournalSummary>> {
  const result = await toolDelete(`${PROXY_BASE}/tools/journal/${encodeURIComponent(entryId)}`, isDeletedEnvelope);
  if (!result.ok) return result;
  if (result.data.deleted.id !== entryId) {
    return { ok: false, error: makeError("MALFORMED_RESPONSE"), detail: null };
  }
  return { ok: true, data: result.data.summary };
}
