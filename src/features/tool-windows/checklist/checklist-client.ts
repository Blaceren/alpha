/**
 * The Entry Checklist client: its path and the shapes it guards. The transport
 * is the tools' shared one (`tools-client-core.ts`).
 */
import { PROXY_BASE, isRecord, toolGet, toolSend, type ToolResult } from "../tools-client-core";
import type { ChecklistState, EntryCheck, EntryCheckInput } from "./checklist-model";

const CHECKS_PATH = `${PROXY_BASE}/tools/entry-checks`;
const VERDICTS = new Set(["enter", "skip_stop", "skip_condition"]);

const isMinimum = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100);

export function isEntryCheck(value: unknown): value is EntryCheck {
  if (!isRecord(value) || !isRecord(value.asset) || !isRecord(value.answers)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.asset.code === "string" &&
    typeof value.asset.label === "string" &&
    isMinimum(value.minPayoutPercent) &&
    Object.values(value.answers).every((answer) => typeof answer === "boolean") &&
    typeof value.verdict === "string" &&
    VERDICTS.has(value.verdict) &&
    (value.missingItem === null || typeof value.missingItem === "string") &&
    (value.verdict === "enter") === (value.missingItem === null) &&
    // The named item's own words and the list version (2026-10-07): the Backend of that day sends them,
    // an older one does not — a check is read either way.
    (value.missingItemLabel === undefined || value.missingItemLabel === null || typeof value.missingItemLabel === "string") &&
    (value.listVersion === undefined || typeof value.listVersion === "number") &&
    typeof value.createdAt === "string"
  );
}

function isRecent(value: unknown): value is EntryCheck[] {
  return Array.isArray(value) && value.every(isEntryCheck);
}

export function isChecklistState(value: unknown): value is ChecklistState {
  if (!isRecord(value) || !isRecord(value.checklist) || !isRecord(value.reference)) return false;
  const { checklist, reference } = value;
  return (
    isRecent(value.recent) &&
    isMinimum(value.lastMinPayoutPercent) &&
    Array.isArray(checklist.groups) &&
    checklist.groups.every((group) => isRecord(group) && typeof group.code === "string" && typeof group.label === "string") &&
    Array.isArray(checklist.items) &&
    checklist.items.length > 0 &&
    checklist.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.code === "string" &&
        typeof item.group === "string" &&
        typeof item.stop === "boolean" &&
        typeof item.label === "string",
    ) &&
    Array.isArray(reference.assets) &&
    reference.assets.length > 0 &&
    reference.assets.every(
      (asset) => isRecord(asset) && typeof asset.code === "string" && typeof asset.label === "string" && typeof asset.group === "string",
    )
  );
}

/** What a save answers: the kept check and the list as it now stands. */
export type SavedCheck = { check: EntryCheck; recent: EntryCheck[]; lastMinPayoutPercent: number | null };

function isSavedCheck(value: unknown): value is SavedCheck {
  return isRecord(value) && isEntryCheck(value.check) && isRecent(value.recent) && isMinimum(value.lastMinPayoutPercent);
}

export function fetchChecklistState(): Promise<ToolResult<ChecklistState>> {
  return toolGet(CHECKS_PATH, isChecklistState);
}

/** «Записать проверку». */
export function saveEntryCheck(check: EntryCheckInput): Promise<ToolResult<SavedCheck>> {
  return toolSend("POST", CHECKS_PATH, { check }, isSavedCheck);
}
