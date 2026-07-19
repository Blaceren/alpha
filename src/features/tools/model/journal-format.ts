/**
 * Deterministic presentation helpers for the Trading Journal (Phase D4-B).
 *
 * All formatting reads the STORED ISO string's own fields (never the runtime
 * timezone), so a screenshot or a test renders the same text on any machine. The
 * manual result is always presented as a SECONDARY fact, never a balance.
 */

import type { JournalEntry } from "@/features/tools/model/journal-entry";

const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** "16 июля · 09:00". Falls back to the raw string if it is not our ISO shape. */
export function formatOccurredAt(iso: string): string {
  const match = ISO_RE.exec(iso);
  if (!match) return iso;
  const [, , month, day, hh, mm] = match;
  const monthName = MONTHS_RU[Number(month) - 1] ?? month;
  const dayNum = String(Number(day));
  return `${dayNum} ${monthName} · ${hh}:${mm}`;
}

/** "16 июля" — the compact date for a collapsed row. */
export function formatOccurredDate(iso: string): string {
  const match = ISO_RE.exec(iso);
  if (!match) return iso;
  const [, , month, day] = match;
  const monthName = MONTHS_RU[Number(month) - 1] ?? month;
  return `${String(Number(day))} ${monthName}`;
}

/** Sign of the result for a small, restrained accent — never whole-row colour. */
export type ResultTone = "positive" | "negative" | "neutral" | "none";

export function resultTone(value: number | null): ResultTone {
  if (value === null) return "none";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

/** "+18" / "−7" / "0", with a real minus sign. Null → "" (caller shows absence). */
export function formatManualResult(value: number | null): string {
  if (value === null) return "";
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return "0";
}

/** The secondary result line. Absence is a normal, complete state. */
export function manualResultLine(value: number | null): string {
  if (value === null) return "Денежный результат не указан";
  return `Результат сделки, введён вручную: ${formatManualResult(value)}`;
}

/** The node ordinal — the creation order embedded in the id (journal-3 → 3). */
export function entryOrdinal(entry: JournalEntry): number {
  const match = /^journal-(\d+)$/.exec(entry.id);
  return match ? Number(match[1]) : 0;
}

/** Two-digit node label, e.g. "03". */
export function entryNodeLabel(entry: JournalEntry): string {
  return String(entryOrdinal(entry)).padStart(2, "0");
}

/** A one-line lesson preview for a collapsed row (never truncates mid-word ugly). */
export function lessonPreview(lesson: string, max = 90): string {
  const flat = lesson.replace(/\s+/gu, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}
