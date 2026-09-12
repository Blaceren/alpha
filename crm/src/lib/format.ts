/**
 * Display formatting helpers. Relative time is computed against a supplied
 * `nowMs` so callers can pass FixedMockClock.nowMs() for deterministic output
 * (stable screenshots + tests).
 */
import type { ISODateString } from "@/domain/shared/primitives";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Russian relative time, e.g. "2 ч назад", "3 дн назад", "только что". */
export function formatRelativeTime(iso: ISODateString | null, nowMs: number): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = nowMs - then;
  if (diff < MIN) return "только что";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} мин назад`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ч назад`;
  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days} дн назад`;
  const months = Math.floor(days / 30);
  return `${months} мес назад`;
}

/** Exact local timestamp for tooltips. */
export function formatExactTime(iso: ISODateString | null): string {
  if (!iso) return "нет данных";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "нет данных" : d.toLocaleString("ru-RU");
}
