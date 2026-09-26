/**
 * The Personal Stats client: its path and the shape it guards. The transport is
 * the tools' shared one (`tools-client-core.ts`).
 */
import { PROXY_BASE, isRecord, toolGet, type ToolResult } from "../tools-client-core";
import type { JournalStats, StatsPeriod } from "./stats-model";

const PERIODS = new Set(["7d", "30d", "all"]);
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const isRate = (value: unknown) => value === null || isCount(value);

function isWinRate(value: unknown): boolean {
  return isRecord(value) && isCount(value.trades) && isCount(value.wins) && isRate(value.winRateBasisPoints);
}

export function isJournalStats(value: unknown): value is JournalStats {
  if (!isRecord(value) || !isRecord(value.split) || !isRecord(value.violations)) return false;
  const window = value.window;
  return (
    typeof value.period === "string" &&
    PERIODS.has(value.period) &&
    (window === null ||
      (isRecord(window) && typeof window.from === "string" && typeof window.to === "string")) &&
    isWinRate(value) &&
    isRate(value.averagePayoutTenths) &&
    isRate(value.breakEvenBasisPoints) &&
    isCount(value.onPlan) &&
    isRate(value.onPlanBasisPoints) &&
    isCount(value.unmarked) &&
    isWinRate(value.split.followed) &&
    isWinRate(value.split.broken) &&
    isCount(value.violations.total) &&
    Array.isArray(value.violations.items) &&
    value.violations.items.every(
      (item) => isRecord(item) && typeof item.code === "string" && typeof item.label === "string" && isCount(item.count),
    ) &&
    typeof value.preliminary === "boolean" &&
    isCount(value.minSample)
  );
}

/** The path of one window: the period, and the learner's today for 7 and 30 days. */
export function statsPath(period: StatsPeriod, today: string | null): string {
  const params = new URLSearchParams({ period });
  if (today) params.set("today", today);
  return `${PROXY_BASE}/tools/stats?${params.toString()}`;
}

export function fetchStats(period: StatsPeriod, today: string | null): Promise<ToolResult<JournalStats>> {
  return toolGet(statsPath(period, today), isJournalStats);
}
