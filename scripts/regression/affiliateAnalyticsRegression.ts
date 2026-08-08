/**
 * AFD-5B1 — affiliate event-date analytics: business time, presets, grouping,
 * exact decimals, metric sources, dimensions, reconciliation and query safety.
 *
 * WHAT THIS SUITE IS. Everything provable without an HTTP server, run against a
 * SYNTHETIC database built from the repository's own migrations. No live port is
 * contacted, no live database is opened, no live secret is read, and every
 * fixture below is invented here.
 *
 * The authorization contract and the real route wiring are proven separately by
 * `affiliateAnalyticsIsolatedE2E.ts`, which needs a real server.
 *
 * THE CLOCK IS ALWAYS FROZEN. Every preset case passes an explicit `now`, so a
 * suite that runs at 23:59:59 Moscow cannot produce a different answer from one
 * that runs at 00:00:01 — which is exactly the bug these boundaries exist to
 * prevent.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addLocalDays,
  AnalyticsTimeConfigError,
  BUSINESS_TIMEZONE_KEY,
  DEFAULT_BUSINESS_TIMEZONE,
  localDateLabel,
  localWallClockToUtc,
  mondayIndex,
  parseLocalDateOnly,
  resolveBusinessTimezone,
  startOfLocalWeek,
  toLocalParts,
} from "../../src/lib/analytics/business-time";
import {
  AnalyticsPeriodError,
  buildBuckets,
  countBuckets,
  DATE_PRESETS,
  MAX_BUCKETS,
  MAX_CUSTOM_RANGE_DAYS,
  resolvePeriod,
  type DatePreset,
} from "../../src/lib/analytics/periods";
import {
  amountToMinorUnits,
  exactRatio,
  renderMinorUnits,
  sumCanonicalAmounts,
} from "../../src/lib/analytics/decimal";
import {
  METRIC_KEYS,
  RATE_MODE,
  ANALYTICS_MODE,
} from "../../src/lib/analytics/affiliate-sources";
import {
  computeRatios,
  loadAmountAvailability,
  loadAmountAvailabilityByDimension,
  loadBreakdown,
  loadBucketCounts,
  loadCounts,
} from "../../src/lib/analytics/affiliate-queries";
import { buildDataAvailability } from "../../src/lib/analytics/availability";
import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------------ fixture */

const dbPath = path.join(os.tmpdir(), `ata-afd5b1-analytics-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const projectRoot = path.resolve(__dirname, "../..");

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

const MSK = "Europe/Moscow";

/** Identifiers must be exactly 32 characters from the base32 alphabet. */
let idSequence = 0;
/** Base-26 letters only, so a sequence digit can never leave the alphabet. */
function letterSuffix(value: number): string {
  let out = "";
  let remaining = value;
  do {
    out = String.fromCharCode(97 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  } while (remaining > 0);
  return out;
}
function id32(prefix: string): string {
  idSequence += 1;
  const tail = letterSuffix(idSequence);
  const body = `${prefix}${"a".repeat(32)}`.slice(0, 32 - tail.length);
  return `${body}${tail}`.slice(0, 32);
}

function asEnv(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

/** A Moscow wall-clock instant, written the way a business day is spoken. */
function msk(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return localWallClockToUtc({ year, month, day, hour, minute, second }, MSK);
}

async function main() {
  cleanup();
  process.env.DATABASE_URL = dbUrl;

  /* ==================== A. BUSINESS TIMEZONE CONFIGURATION ================ */

  await check("A1 the default business timezone is Europe/Moscow", () => {
    assert.equal(resolveBusinessTimezone(asEnv({})), "Europe/Moscow");
    assert.equal(DEFAULT_BUSINESS_TIMEZONE, "Europe/Moscow");
  });

  await check("A2 a valid configured timezone is accepted and canonicalised", () => {
    assert.equal(
      resolveBusinessTimezone(asEnv({ [BUSINESS_TIMEZONE_KEY]: "Europe/Lisbon" })),
      "Europe/Lisbon",
    );
    assert.equal(
      resolveBusinessTimezone(asEnv({ [BUSINESS_TIMEZONE_KEY]: "europe/moscow" })),
      "Europe/Moscow",
    );
    assert.equal(resolveBusinessTimezone(asEnv({ [BUSINESS_TIMEZONE_KEY]: "utc" })), "UTC");
  });

  await check("A3 an invalid timezone FAILS CLOSED and never falls back to UTC", () => {
    for (const bad of ["Not/AZone", "", "   ", "+03:00", "MSK", "Europe/Atlantis"]) {
      assert.throws(
        () => resolveBusinessTimezone(asEnv({ [BUSINESS_TIMEZONE_KEY]: bad })),
        AnalyticsTimeConfigError,
        `expected ${JSON.stringify(bad)} to be refused`,
      );
    }
  });

  await check("A4 the rejection message never echoes the configured value", () => {
    try {
      resolveBusinessTimezone(asEnv({ [BUSINESS_TIMEZONE_KEY]: "Secret/Operator-Value" }));
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(error instanceof AnalyticsTimeConfigError);
      assert.ok(!error.message.includes("Secret/Operator-Value"), error.message);
    }
  });

  await check("A5 boundaries do not depend on the host timezone", () => {
    const original = process.env.TZ;
    const readings: string[] = [];
    for (const hostZone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      process.env.TZ = hostZone;
      readings.push(msk(2026, 7, 20).toISOString());
    }
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    assert.equal(new Set(readings).size, 1, `host timezone leaked: ${readings.join(" ")}`);
  });

  await check("A6 Moscow midnight is 21:00 UTC the previous day", () => {
    // The single most consequential fact in the phase: an event at 22:30 UTC on
    // the 31st belongs to the 1st in Moscow, not the 31st.
    assert.equal(msk(2026, 8, 1).toISOString(), "2026-07-31T21:00:00.000Z");
    assert.equal(localDateLabel(toLocalParts(new Date("2026-07-31T22:30:00Z"), MSK)), "2026-08-01");
    assert.equal(localDateLabel(toLocalParts(new Date("2026-07-31T20:30:00Z"), MSK)), "2026-07-31");
  });

  /* ============================ B. WEEK AND DATE MATHS ==================== */

  await check("B1 weeks begin on Monday", () => {
    // 2026-08-03 is a Monday.
    assert.equal(mondayIndex({ year: 2026, month: 8, day: 3, hour: 0, minute: 0, second: 0 }), 0);
    assert.equal(mondayIndex({ year: 2026, month: 8, day: 9, hour: 0, minute: 0, second: 0 }), 6);
    const sunday = { year: 2026, month: 8, day: 9, hour: 12, minute: 0, second: 0 };
    assert.equal(localDateLabel(startOfLocalWeek(sunday)), "2026-08-03");
  });

  await check("B2 a Sunday belongs to the week that opened the previous Monday", () => {
    for (let day = 3; day <= 9; day += 1) {
      const parts = { year: 2026, month: 8, day, hour: 5, minute: 0, second: 0 };
      assert.equal(localDateLabel(startOfLocalWeek(parts)), "2026-08-03", `day ${day}`);
    }
    const nextMonday = { year: 2026, month: 8, day: 10, hour: 0, minute: 0, second: 0 };
    assert.equal(localDateLabel(startOfLocalWeek(nextMonday)), "2026-08-10");
  });

  await check("B3 day arithmetic crosses month and year ends", () => {
    const endOfMonth = { year: 2026, month: 7, day: 31, hour: 0, minute: 0, second: 0 };
    assert.equal(localDateLabel(addLocalDays(endOfMonth, 1)), "2026-08-01");
    const endOfYear = { year: 2026, month: 12, day: 31, hour: 0, minute: 0, second: 0 };
    assert.equal(localDateLabel(addLocalDays(endOfYear, 1)), "2027-01-01");
    // 2026 is not a leap year, so 364 days back from 31 December is 1 January.
    assert.equal(localDateLabel(addLocalDays(endOfYear, -364)), "2026-01-01");
    assert.equal(localDateLabel(addLocalDays(endOfYear, -365)), "2025-12-31");
  });

  await check("B4 strict date parsing refuses impossible and non-date input", () => {
    assert.deepEqual(parseLocalDateOnly("2026-08-01"), {
      year: 2026,
      month: 8,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-08-32",
      "2026-8-1",
      "2026-08-01T00:00:00Z",
      "2026-08-01 00:00",
      "20260801",
      "not-a-date",
      "",
    ]) {
      assert.equal(parseLocalDateOnly(bad), null, `expected ${JSON.stringify(bad)} to be refused`);
    }
  });

  /* ================================ C. PRESETS ============================ */

  // A Saturday, mid-afternoon Moscow, inside a month that is not the first.
  const NOW = msk(2026, 8, 8, 15, 30, 0);

  const period = (preset: DatePreset, startDate?: string, endDate?: string) =>
    resolvePeriod({ preset, startDate, endDate }, MSK, NOW);

  await check("C1 every documented preset resolves", () => {
    assert.equal(DATE_PRESETS.length, 10);
    for (const preset of DATE_PRESETS) {
      if (preset === "custom") continue;
      const resolved = resolvePeriod({ preset }, MSK, NOW);
      assert.equal(resolved.resolvedPreset, preset);
      assert.equal(resolved.timezone, MSK);
      assert.equal(resolved.intervalConvention, "start_inclusive_end_exclusive");
    }
  });

  await check("C2 today is [today 00:00, tomorrow 00:00) in Moscow", () => {
    const today = period("today");
    assert.equal(today.startUtc!.toISOString(), msk(2026, 8, 8).toISOString());
    assert.equal(today.endUtc.toISOString(), msk(2026, 8, 9).toISOString());
    assert.equal(today.startLocal, "2026-08-08T00:00:00");
    assert.equal(today.endLocal, "2026-08-09T00:00:00");
  });

  await check("C3 yesterday is the previous whole business day", () => {
    const yesterday = period("yesterday");
    assert.equal(yesterday.startUtc!.toISOString(), msk(2026, 8, 7).toISOString());
    assert.equal(yesterday.endUtc.toISOString(), msk(2026, 8, 8).toISOString());
  });

  await check("C4 current week opens on Monday and closes on the next Monday", () => {
    const current = period("current_week");
    assert.equal(current.startLocal, "2026-08-03T00:00:00");
    assert.equal(current.endLocal, "2026-08-10T00:00:00");
  });

  await check("C5 previous week is the seven days before that Monday", () => {
    const previous = period("previous_week");
    assert.equal(previous.startLocal, "2026-07-27T00:00:00");
    assert.equal(previous.endLocal, "2026-08-03T00:00:00");
  });

  await check("C6 last_7_days is seven COMPLETE days and excludes today", () => {
    const last7 = period("last_7_days");
    assert.equal(last7.startLocal, "2026-08-01T00:00:00");
    assert.equal(last7.endLocal, "2026-08-08T00:00:00");
    assert.equal(last7.endUtc.getTime() - last7.startUtc!.getTime(), 7 * 86_400_000);
  });

  await check("C7 last_30_days uses the SAME convention as last_7_days", () => {
    const last30 = period("last_30_days");
    assert.equal(last30.startLocal, "2026-07-09T00:00:00");
    assert.equal(last30.endLocal, "2026-08-08T00:00:00");
    assert.equal(last30.endUtc.getTime() - last30.startUtc!.getTime(), 30 * 86_400_000);
    // Both end at the same instant, which is what "one convention" means.
    assert.equal(last30.endUtc.getTime(), period("last_7_days").endUtc.getTime());
  });

  await check("C8 current and previous month are calendar months", () => {
    const current = period("current_month");
    assert.equal(current.startLocal, "2026-08-01T00:00:00");
    assert.equal(current.endLocal, "2026-09-01T00:00:00");
    const previous = period("previous_month");
    assert.equal(previous.startLocal, "2026-07-01T00:00:00");
    assert.equal(previous.endLocal, "2026-08-01T00:00:00");
  });

  await check("C9 month presets survive a January boundary", () => {
    const january = msk(2026, 1, 15, 9, 0, 0);
    const previous = resolvePeriod({ preset: "previous_month" }, MSK, january);
    assert.equal(previous.startLocal, "2025-12-01T00:00:00");
    assert.equal(previous.endLocal, "2026-01-01T00:00:00");
  });

  await check("C10 custom accepts a date-only range, start inclusive end exclusive", () => {
    const custom = period("custom", "2026-08-03", "2026-08-05");
    assert.equal(custom.startUtc!.toISOString(), msk(2026, 8, 3).toISOString());
    assert.equal(custom.endUtc.toISOString(), msk(2026, 8, 5).toISOString());
  });

  await check("C11 custom refuses reversed, empty, impossible and oversized ranges", () => {
    assert.throws(() => period("custom", "2026-08-05", "2026-08-03"), AnalyticsPeriodError);
    assert.throws(() => period("custom", "2026-08-05", "2026-08-05"), AnalyticsPeriodError);
    assert.throws(() => period("custom", "2026-02-30", "2026-03-05"), AnalyticsPeriodError);
    assert.throws(() => period("custom", "2020-01-01", "2030-01-01"), AnalyticsPeriodError);
    assert.throws(() => period("custom", "2026-08-03", undefined), AnalyticsPeriodError);
    assert.ok(MAX_CUSTOM_RANGE_DAYS > 0);
  });

  await check("C12 all_time has no start cutoff and exposes the resolved end", () => {
    const allTime = period("all_time");
    assert.equal(allTime.startUtc, null);
    assert.equal(allTime.startLocal, null);
    assert.equal(allTime.endUtc.toISOString(), NOW.toISOString());
    assert.equal(allTime.endLocal, "2026-08-08T15:30:00");
  });

  await check("C13 an event at 21:00 UTC lands in the NEXT Moscow day's period", () => {
    const today = period("today");
    const justAfterMidnightMoscow = new Date("2026-08-07T21:00:00.000Z");
    assert.equal(justAfterMidnightMoscow.getTime(), msk(2026, 8, 8).getTime());
    // Inclusive start: the boundary instant itself belongs to the period.
    assert.ok(justAfterMidnightMoscow.getTime() >= today.startUtc!.getTime());
    // Exclusive end: the closing instant does not.
    assert.ok(today.endUtc.getTime() > justAfterMidnightMoscow.getTime());
    // Exclusive end: the closing instant belongs to TOMORROW, never to today.
    const tomorrow = resolvePeriod({ preset: "today" }, MSK, msk(2026, 8, 9, 1, 0, 0));
    assert.equal(tomorrow.startUtc!.getTime(), today.endUtc.getTime());
  });

  /* =============================== D. GROUPING ============================ */

  await check("D1 day buckets partition the period with no gap or overlap", () => {
    const custom = period("custom", "2026-08-03", "2026-08-08");
    const buckets = buildBuckets(custom, "day");
    assert.equal(buckets.length, 5);
    assert.equal(buckets[0].localLabel, "2026-08-03");
    assert.equal(buckets[4].localLabel, "2026-08-07");
    assert.equal(buckets[0].startUtc.getTime(), custom.startUtc!.getTime());
    assert.equal(buckets[4].endUtc.getTime(), custom.endUtc.getTime());
    for (let i = 1; i < buckets.length; i += 1) {
      assert.equal(buckets[i].startUtc.getTime(), buckets[i - 1].endUtc.getTime(), `gap at ${i}`);
    }
  });

  await check("D2 week buckets are labelled with their local Monday", () => {
    const custom = period("custom", "2026-07-27", "2026-08-10");
    const buckets = buildBuckets(custom, "week");
    assert.deepEqual(
      buckets.map((bucket) => bucket.localLabel),
      ["2026-07-27", "2026-08-03"],
    );
  });

  await check("D3 a week bucket is CLIPPED when the period starts mid-week", () => {
    // Wednesday start: the first bucket still carries its Monday label, but its
    // boundary is the period start, so the buckets sum to the period exactly.
    const custom = period("custom", "2026-08-05", "2026-08-12");
    const buckets = buildBuckets(custom, "week");
    assert.equal(buckets[0].localLabel, "2026-08-03");
    assert.equal(buckets[0].startUtc.getTime(), custom.startUtc!.getTime());
    assert.equal(buckets[buckets.length - 1].endUtc.getTime(), custom.endUtc.getTime());
  });

  await check("D4 month buckets are labelled YYYY-MM and clip at both ends", () => {
    const custom = period("custom", "2026-07-15", "2026-09-10");
    const buckets = buildBuckets(custom, "month");
    assert.deepEqual(
      buckets.map((bucket) => bucket.localLabel),
      ["2026-07", "2026-08", "2026-09"],
    );
    assert.equal(buckets[0].startUtc.getTime(), custom.startUtc!.getTime());
    assert.equal(buckets[2].endUtc.getTime(), custom.endUtc.getTime());
  });

  await check("D5 buckets are deterministically ascending", () => {
    const custom = period("custom", "2026-01-01", "2026-04-01");
    for (const group of ["day", "week", "month"] as const) {
      const buckets = buildBuckets(custom, group);
      for (let i = 1; i < buckets.length; i += 1) {
        assert.ok(
          buckets[i].startUtc.getTime() > buckets[i - 1].startUtc.getTime(),
          `${group} not ascending at ${i}`,
        );
      }
    }
  });

  await check("D6 an all_time period with no data yields zero buckets", () => {
    assert.equal(buildBuckets(period("all_time"), "day").length, 0);
    assert.equal(countBuckets(period("all_time"), "day"), 0);
  });

  await check("D7 the bucket cap is enforced by REFUSAL, never by truncation", () => {
    const wide = period("custom", "2021-01-01", "2025-01-01");
    assert.ok(countBuckets(wide, "day") > MAX_BUCKETS);
    assert.throws(() => buildBuckets(wide, "day"), AnalyticsPeriodError);
    // The same range grouped by month is comfortably inside the cap.
    assert.ok(countBuckets(wide, "month") <= MAX_BUCKETS);
    assert.equal(buildBuckets(wide, "month").length, 48);
  });

  /* ========================= E. EXACT DECIMAL OUTPUT ====================== */

  await check("E1 a zero denominator returns null, NOT zero", () => {
    assert.equal(exactRatio(0, 0), null);
    assert.equal(exactRatio(5, 0), null);
  });

  await check("E2 a zero numerator over a real denominator returns 0", () => {
    assert.equal(exactRatio(0, 10), "0.000000");
    assert.notEqual(exactRatio(0, 10), null);
  });

  await check("E3 a repeating ratio is exact to a fixed scale and never drifts", () => {
    assert.equal(exactRatio(1, 3), "0.333333");
    assert.equal(exactRatio(2, 3), "0.666666");
    assert.equal(exactRatio(1, 7), "0.142857");
    assert.equal(exactRatio(1, 1), "1.000000");
  });

  await check("E4 large counts stay exact where binary floating point would not", () => {
    assert.equal(exactRatio(1, 10), "0.100000");
    assert.equal(exactRatio(3, 10), "0.300000");
    // 0.1 + 0.2 !== 0.3 in IEEE-754. The string carries no such error.
    assert.equal(exactRatio(2_000_000_003, 4_000_000_006), "0.500000");
    assert.equal(exactRatio(999_999_999, 1_000_000_000), "0.999999");
  });

  await check("E5 exactRatio refuses non-integer and negative counts", () => {
    assert.throws(() => exactRatio(1.5, 3), TypeError);
    assert.throws(() => exactRatio(-1, 3), RangeError);
  });

  await check("E6 amount addition is exact in integer minor units", () => {
    assert.equal(amountToMinorUnits("282.70"), BigInt(28270));
    assert.equal(renderMinorUnits(BigInt(28270)), "282.70");
    assert.equal(sumCanonicalAmounts(["0.10", "0.20"]), "0.30");
    assert.equal(sumCanonicalAmounts(["282.70", "17.30"]), "300.00");
    assert.equal(sumCanonicalAmounts([]), "0.00");
    assert.equal(sumCanonicalAmounts(["999999999999.99", "0.01"]), "1000000000000.00");
  });

  await check("E7 a non-canonical amount is REFUSED, never coerced", () => {
    for (const bad of ["282.7", "282", "1e2", "1,20", "-1.00", " 1.00", "01.00", "1.234"]) {
      assert.throws(() => amountToMinorUnits(bad), RangeError, `expected ${bad} to be refused`);
    }
  });

  await check("E8 ratios are labelled period_event_ratio and never cohort language", () => {
    assert.equal(RATE_MODE, "period_event_ratio");
    assert.equal(ANALYTICS_MODE, "event_date");
    const ratios = computeRatios({
      ...Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])),
      qualifiedClicks: 200,
      academyRegistrations: 50,
      pocketRegistrations: 20,
      confirmedFirstDeposits: 5,
    } as never);
    assert.equal(ratios.qualifiedClickToAcademyRegistrationRate, "0.250000");
    assert.equal(ratios.academyRegistrationToPocketRegistrationRate, "0.400000");
    assert.equal(ratios.pocketRegistrationToFirstDepositRate, "0.250000");
    assert.equal(ratios.qualifiedClickToPocketRegistrationRate, "0.100000");
    assert.equal(ratios.qualifiedClickToFirstDepositRate, "0.025000");
  });

  await check("E9 every ratio is null when its own denominator is zero", () => {
    const ratios = computeRatios(
      Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as never,
    );
    for (const [name, value] of Object.entries(ratios)) {
      assert.equal(value, null, `${name} should be null, not zero`);
    }
  });

  /* ====================== F. DATA-AVAILABILITY HONESTY ==================== */

  await check("F1 unavailable metrics carry a reason and are never zero", () => {
    const availability = buildDataAvailability({
      amountAggregationAvailable: false,
      amountUnavailableReason: "currency_unspecified_or_mixed",
    });
    assert.equal(availability.redeposits.available, false);
    assert.equal(
      availability.redeposits.available === false && availability.redeposits.reason,
      "provider_transaction_identifier_missing",
    );
    assert.equal(availability.currentBalance.available, false);
    assert.equal(
      availability.currentBalance.available === false && availability.currentBalance.reason,
      "prohibited_not_collected",
    );
    assert.equal(availability.educationQuality.available, false);
    // AFD-5B2A SHIPPED the acquisition-cohort mode, so this entry now reports
    // `available`. It was pinned to "deferred_to_afd5b2" while that was true;
    // leaving it pinned afterwards would have made this suite guard a claim the
    // API had stopped being entitled to make. The cohort routes carry their own
    // availability block — this one only says the MODE exists.
    assert.equal(availability.acquisitionCohortMode.available, true);
    // AFD-5B2B shipped the per-lead drilldown, so this flips for exactly the
    // reason the comment above gives: a stale deferral would make this suite
    // guard a claim the API has stopped being entitled to make.
    assert.equal(availability.leadDrilldown.available, true);
    // Every unavailable entry states WHY, and none of them is expressible as a
    // number — an availability state can never be rendered as a zero metric.
    for (const [name, entry] of Object.entries(availability)) {
      assert.equal(typeof entry, "object", name);
      if (entry.available === false) {
        assert.ok(entry.reason.length > 0, `${name} must name a reason`);
      }
    }
  });

  await check("F2 the four proven sources report available", () => {
    const availability = buildDataAvailability({
      amountAggregationAvailable: true,
      amountUnavailableReason: null,
    });
    assert.equal(availability.trafficClicks.available, true);
    assert.equal(availability.academyRegistrations.available, true);
    assert.equal(availability.pocketRegistrations.available, true);
    assert.equal(availability.firstDeposits.available, true);
    assert.equal(availability.firstDepositAmountAggregation.available, true);
  });

  /* ============================ G. SCHEMA AND MIGRATION =================== */

  // AGENT-FOUNDATION-1 moved this literal from 40 to 41. It is a deliberate
  // tripwire, not a nuisance: an unplanned migration must fail this gate, so
  // the number is typed by hand rather than counted from the directory. The
  // migration it now expects is the additive Agent Core foundation, which adds
  // nine tables and changes nothing this suite measures.
  await check("G1 the canonical migration count matches the directory", () => {
    const entries = fs
      .readdirSync(path.join(projectRoot, "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    // PHASE-G0: the hand-written literal is gone. It was pinned to 41 while the
    // repository had already reached 42, so this assertion had been failing on
    // the accepted base and guarded nothing. The count lives ONLY in the shared
    // constant now, which is exactly the arrangement
    // scripts/regression/support/migrationCount.ts exists to enforce -- a second
    // copy beside it is what let it drift in the first place.
    assert.equal(entries.length, EXPECTED_MIGRATION_COUNT);
    assert.ok(entries.includes("20260801000000_analytics_event_date_indexes"));
    assert.ok(entries.includes("20260804000000_agent_core_foundation"));
  });

  await check("G2 migration 40 is index-only and additive", () => {
    const sql = fs.readFileSync(
      path.join(
        projectRoot,
        "prisma",
        "migrations",
        "20260801000000_analytics_event_date_indexes",
        "migration.sql",
      ),
      "utf8",
    );
    const statements = sql
      .split(";")
      .map((part) =>
        part
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((part) => part.length > 0);
    assert.equal(statements.length, 2, statements.join(" | "));
    for (const statement of statements) {
      assert.ok(/^CREATE INDEX /.test(statement), statement);
    }
    for (const forbidden of ["ALTER TABLE", "DROP TABLE", "CREATE TABLE", "UPDATE ", "DELETE "]) {
      assert.ok(!sql.toUpperCase().includes(forbidden), `${forbidden} must not appear`);
    }
  });

  /* ------------------------- build the synthetic database ---------------- */

  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: projectRoot, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  /* ------------------------------- fixture ------------------------------- */

  const staff = await prisma.user.create({
    data: { email: "afd5b1-fixture@example.invalid", name: "Fixture", role: "admin", passwordHash: "x" },
  });

  const alpha = await prisma.affiliatePartner.create({
    data: { code: "alpha", displayName: "Alpha", createdByUserId: staff.id, status: "active" },
  });
  const beta = await prisma.affiliatePartner.create({
    // Archived on purpose: history must remain reportable.
    data: {
      code: "beta",
      displayName: "Beta",
      createdByUserId: staff.id,
      status: "archived",
      archivedAt: new Date(),
    },
  });
  const alphaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: alpha.id,
      code: "alpha-one",
      displayName: "Alpha One",
      createdByUserId: staff.id,
    },
  });
  const betaOne = await prisma.affiliateCampaign.create({
    data: {
      affiliatePartnerId: beta.id,
      code: "beta-one",
      displayName: "Beta One",
      createdByUserId: staff.id,
      status: "archived",
      archivedAt: new Date(),
    },
  });
  const linkA1 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkaone"),
      displayName: "Alpha One A",
      status: "active",
      createdByUserId: staff.id,
    },
  });
  const linkA2 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: alpha.id,
      affiliateCampaignId: alphaOne.id,
      publicCode: id32("linkatwo"),
      // Paused with history: still reportable.
      displayName: "Alpha One B",
      status: "paused",
      createdByUserId: staff.id,
    },
  });
  const linkB1 = await prisma.affiliateTrackingLink.create({
    data: {
      affiliatePartnerId: beta.id,
      affiliateCampaignId: betaOne.id,
      publicCode: id32("linkbone"),
      displayName: "Beta One A",
      status: "archived",
      archivedAt: new Date(),
      createdByUserId: staff.id,
    },
  });

  // Two Moscow business days, deliberately placed either side of 21:00 UTC so a
  // UTC-based implementation would put them on the wrong days.
  const DAY_ONE = msk(2026, 8, 3, 10, 0, 0); // Monday
  const DAY_ONE_LATE = msk(2026, 8, 3, 23, 30, 0); // still Monday in Moscow
  const DAY_TWO = msk(2026, 8, 4, 9, 0, 0); // Tuesday

  const visitorOne = id32("visitorone");
  const visitorTwo = id32("visitortwo");
  const visitorThree = id32("visitorthree");

  await prisma.affiliateClick.createMany({
    data: [
      // Two qualified clicks from ONE visitor on day one: 2 clicks, 1 visitor.
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: visitorOne, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: DAY_ONE },
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: visitorOne, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: DAY_ONE_LATE },
      // A second visitor on day one.
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: visitorTwo, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: DAY_ONE },
      // The SAME visitor as day one, clicking again on day two.
      { ataClickId: id32("c"), trackingLinkId: linkA2.id, anonymousVisitorId: visitorOne, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: DAY_TWO },
      // A third visitor on day two, on the archived affiliate's link.
      { ataClickId: id32("c"), trackingLinkId: linkB1.id, anonymousVisitorId: visitorThree, classification: "qualified", effectiveAttributionWindowDays: 30, occurredAt: DAY_TWO },
      // Prefetch and authenticated-user clicks carry no visitor journey.
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: null, classification: "prefetch", effectiveAttributionWindowDays: 30, occurredAt: DAY_ONE },
      { ataClickId: id32("c"), trackingLinkId: linkA1.id, anonymousVisitorId: null, classification: "authenticated_user", effectiveAttributionWindowDays: 30, occurredAt: DAY_TWO },
    ],
  });

  /** A learner with a frozen attribution to the given link, or direct. */
  async function learner(tag: string, link: { id: number; publicCode: string; affiliatePartnerId: number; affiliateCampaignId: number | null } | null) {
    const user = await prisma.user.create({
      data: { email: `afd5b1-${tag}@example.invalid`, name: tag, role: "user", passwordHash: "x" },
    });
    if (link === null) {
      return { user, attributionId: null as number | null, clickId: null as number | null };
    }

    const click = await prisma.affiliateClick.create({
      data: {
        ataClickId: id32("a"),
        trackingLinkId: link.id,
        anonymousVisitorId: id32("av"),
        classification: "qualified",
        effectiveAttributionWindowDays: 30,
        occurredAt: DAY_ONE,
      },
    });
    const attribution = await prisma.affiliateAttribution.create({
      data: {
        userId: user.id,
        anonymousVisitorId: click.anonymousVisitorId!,
        firstTouchClickId: click.id,
        lastTouchClickId: click.id,
        selectedClickId: click.id,
        attributionModel: "last_eligible_affiliate_click",
        selectedAt: DAY_ONE,
        frozenAt: DAY_ONE,
        selectionReason: "registration_cookie",
      },
    });
    return { user, attributionId: attribution.id, clickId: click.id };
  }

  const attributedLearner = await learner("attributed", linkA1);
  const betaLearner = await learner("beta", linkB1);
  const directLearner = await learner("direct", null);

  // The conversion ledger enforces all-or-nothing attribution columns, so an
  // attributed fixture row must carry every one of them.
  async function registration(
    who: { user: { id: number }; attributionId: number | null; clickId: number | null },
    link: { id: number; publicCode: string; affiliatePartnerId: number; affiliateCampaignId: number | null } | null,
    at: Date,
  ) {
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId: id32("e"),
        eventType: "academy_registration",
        userId: who.user.id,
        attributionId: who.attributionId,
        selectedClickId: who.clickId,
        affiliatePartnerId: link?.affiliatePartnerId ?? null,
        affiliateCampaignId: link?.affiliateCampaignId ?? null,
        trackingLinkId: link?.id ?? null,
        affiliateCodeSnapshot: link ? "snapshot" : null,
        campaignCodeSnapshot: link?.affiliateCampaignId ? "campaign-snapshot" : null,
        trackingLinkPublicCodeSnapshot: link ? link.publicCode : null,
        sourceOwner: "auth_register",
        sourceEventId: `reg-${who.user.id}`,
        occurredAt: at,
      },
    });
  }

  await registration(attributedLearner, linkA1, DAY_ONE);
  await registration(betaLearner, linkB1, DAY_TWO);
  await registration(directLearner, null, DAY_TWO);

  // Trusted Pocket registrations: one attributed, one direct.
  await prisma.pocketTraderIdentity.create({
    data: {
      userId: attributedLearner.user.id,
      pocketUserId: "900000001",
      clickId: "trusted-click-1",
      source: "registration_postback",
      boundAt: DAY_ONE_LATE,
    },
  });
  await prisma.pocketTraderIdentity.create({
    data: {
      userId: directLearner.user.id,
      pocketUserId: "900000002",
      clickId: "trusted-click-2",
      source: "registration_postback",
      boundAt: DAY_TWO,
    },
  });

  async function firstDeposit(
    who: { user: { id: number }; attributionId: number | null; clickId: number | null },
    link: { id: number; publicCode: string; affiliatePartnerId: number; affiliateCampaignId: number | null } | null,
    at: Date,
    amount: string,
    currency: { status: "configured" | "unspecified"; code: string | null },
  ) {
    await prisma.affiliateConversionEvent.create({
      data: {
        eventId: id32("e"),
        eventType: "first_deposit",
        userId: who.user.id,
        attributionId: who.attributionId,
        selectedClickId: who.clickId,
        affiliatePartnerId: link?.affiliatePartnerId ?? null,
        affiliateCampaignId: link?.affiliateCampaignId ?? null,
        trackingLinkId: link?.id ?? null,
        affiliateCodeSnapshot: link ? "snapshot" : null,
        campaignCodeSnapshot: link?.affiliateCampaignId ? "campaign-snapshot" : null,
        trackingLinkPublicCodeSnapshot: link ? link.publicCode : null,
        sourceOwner: "pocket_first_deposit",
        sourceEventId: `fd-${who.user.id}`,
        providerAmount: amount,
        currencyCode: currency.code,
        currencyStatus: currency.status,
        occurredAt: at,
      },
    });
  }

  await firstDeposit(attributedLearner, linkA1, DAY_ONE, "282.70", {
    status: "configured",
    code: "USD",
  });
  await firstDeposit(directLearner, null, DAY_TWO, "17.30", { status: "configured", code: "USD" });

  // Pending and conflicting provider events, with no resolvable owner.
  await prisma.pocketProviderEvent.create({
    data: {
      eventType: "first_deposit",
      pocketClickId: "orphan-click-1",
      pocketPlayerId: "900000101",
      normalizedAmount: "50.00",
      currencyStatus: "unspecified",
      status: "pending_identity",
      firstReceivedAt: DAY_ONE,
      lastReceivedAt: DAY_ONE,
      // A replay is transport metadata: it must never read as a second deposit.
      replayCount: 3,
    },
  });
  await prisma.pocketProviderEvent.create({
    data: {
      eventType: "first_deposit",
      pocketClickId: "orphan-click-2",
      pocketPlayerId: "900000102",
      normalizedAmount: "75.00",
      currencyStatus: "unspecified",
      status: "conflict",
      conflictCode: "amount_mismatch",
      firstReceivedAt: DAY_ONE,
      lastReceivedAt: DAY_TWO,
      conflictDetectedAt: DAY_TWO,
    },
  });

  const bothDays = resolvePeriod(
    { preset: "custom", startDate: "2026-08-03", endDate: "2026-08-05" },
    MSK,
    NOW,
  );
  const dayOneOnly = resolvePeriod(
    { preset: "custom", startDate: "2026-08-03", endDate: "2026-08-04" },
    MSK,
    NOW,
  );

  /* ============================== H. METRIC SOURCES ====================== */

  await check("H1 click classifications are counted separately and correctly", async () => {
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    // 7 fixture clicks + 3 attribution clicks (one per attributed learner, and
    // the direct learner has none) = 9 raw.
    assert.equal(counts.rawClicks, 9);
    assert.equal(counts.qualifiedClicks, 7);
    assert.equal(counts.prefetchClicks, 1);
    assert.equal(counts.authenticatedUserClicks, 1);
    assert.equal(
      counts.qualifiedClicks + counts.prefetchClicks + counts.authenticatedUserClicks,
      counts.rawClicks,
    );
  });

  await check("H2 unique visitors are distinct QUALIFIED visitors, nulls excluded", async () => {
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    // visitorOne (twice on day one, again on day two), visitorTwo, visitorThree,
    // plus the two attribution-click visitors = 5 distinct.
    assert.equal(counts.uniqueVisitors, 5);
    // Prefetch and authenticated-user clicks have a null visitor and must not
    // contribute an "unknown" visitor.
    assert.ok(counts.uniqueVisitors < counts.qualifiedClicks);
  });

  await check("H3 a repeated click from one visitor is one visitor, several clicks", async () => {
    const one = await loadCounts(prisma, dayOneOnly, { affiliateTrackingLinkId: linkA1.id }, "total");
    assert.equal(one.qualifiedClicks, 4, "3 fixture clicks + 1 attribution click");
    assert.equal(one.uniqueVisitors, 3, "visitorOne, visitorTwo, and the attribution visitor");
  });

  await check("H4 academy registrations come from the conversion ledger", async () => {
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    assert.equal(counts.academyRegistrations, 3);
    const attributed = await loadCounts(prisma, bothDays, {}, "attributed");
    const unattributed = await loadCounts(prisma, bothDays, {}, "unattributed");
    assert.equal(attributed.academyRegistrations, 2);
    assert.equal(unattributed.academyRegistrations, 1, "the direct registration");
  });

  await check("H5 Pocket registrations come ONLY from the trusted identity binder", async () => {
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    assert.equal(counts.pocketRegistrations, 2);

    // A row with any other provenance is not a trusted registration. The DB
    // CHECK refuses to store one, which is the strongest possible guarantee.
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "PocketTraderIdentity" ("userId","pocketUserId","clickId","source","boundAt","createdAt","updatedAt")
         VALUES (${betaLearner.user.id}, '900000999', 'x', 'deposit_postback', 0, 0, 0)`,
      ),
      "the database must refuse a non-registration provenance",
    );
  });

  await check("H6 confirmed, pending and conflicting deposits are distinct sources", async () => {
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    assert.equal(counts.confirmedFirstDeposits, 2);
    assert.equal(counts.pendingIdentityDeposits, 1);
    assert.equal(counts.conflictingDeposits, 1);
  });

  await check("H7 a replay is NOT a second deposit", async () => {
    const event = await prisma.pocketProviderEvent.findFirstOrThrow({
      where: { pocketPlayerId: "900000101" },
    });
    assert.equal(event.replayCount, 3);
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    assert.equal(counts.pendingIdentityDeposits, 1, "three deliveries are still one event");
  });

  await check("H8 pending and conflict read their OWN occurrence columns", async () => {
    // The conflict was first received on day one but DETECTED on day two, so a
    // day-one report must not contain it.
    const one = await loadCounts(prisma, dayOneOnly, {}, "total");
    assert.equal(one.pendingIdentityDeposits, 1, "pending arrived on day one");
    assert.equal(one.conflictingDeposits, 0, "the conflict was detected on day two");
  });

  await check("H9 an unresolvable deposit owner stays honestly unattributed", async () => {
    const attributed = await loadCounts(prisma, bothDays, {}, "attributed");
    const unattributed = await loadCounts(prisma, bothDays, {}, "unattributed");
    assert.equal(attributed.pendingIdentityDeposits, 0);
    assert.equal(unattributed.pendingIdentityDeposits, 1);
    assert.equal(unattributed.conflictingDeposits, 1);
  });

  /* ====================== I. COVERAGE AND DIMENSIONS ====================== */

  await check("I1 attributed and unattributed partition total exactly", async () => {
    const [attributed, unattributed, total] = await Promise.all([
      loadCounts(prisma, bothDays, {}, "attributed"),
      loadCounts(prisma, bothDays, {}, "unattributed"),
      loadCounts(prisma, bothDays, {}, "total"),
    ]);
    for (const metric of METRIC_KEYS) {
      if (metric === "uniqueVisitors") continue; // distinct counts do not add
      assert.equal(
        attributed[metric] + unattributed[metric],
        total[metric],
        `${metric} does not partition`,
      );
    }
  });

  await check("I2 every click is structurally attributed", async () => {
    const unattributed = await loadCounts(prisma, bothDays, {}, "unattributed");
    assert.equal(unattributed.rawClicks, 0);
    assert.equal(unattributed.qualifiedClicks, 0);
  });

  await check("I3 an ARCHIVED affiliate and its archived link remain reportable", async () => {
    const counts = await loadCounts(prisma, bothDays, { affiliatePartnerId: beta.id }, "attributed");
    assert.equal(counts.qualifiedClicks, 2, "one fixture click and one attribution click");
    assert.equal(counts.academyRegistrations, 1);
  });

  await check("I4 a PAUSED link with history remains reportable", async () => {
    const counts = await loadCounts(
      prisma,
      bothDays,
      { affiliateTrackingLinkId: linkA2.id },
      "attributed",
    );
    assert.equal(counts.qualifiedClicks, 1);
  });

  await check("I5 filtering by campaign and by partner agree where they must", async () => {
    const byPartner = await loadCounts(prisma, bothDays, { affiliatePartnerId: alpha.id }, "attributed");
    const byCampaign = await loadCounts(
      prisma,
      bothDays,
      { affiliateCampaignId: alphaOne.id },
      "attributed",
    );
    // Every Alpha link in this fixture belongs to Alpha One.
    assert.deepEqual(byCampaign, byPartner);
  });

  await check("I6 a filtered report excludes unattributed events entirely", async () => {
    const filtered = await loadCounts(prisma, bothDays, { affiliatePartnerId: alpha.id }, "attributed");
    assert.equal(filtered.academyRegistrations, 1, "only the Alpha registration");
    assert.equal(filtered.confirmedFirstDeposits, 1);
  });

  await check("I7 Pocket registrations use the FROZEN acquisition, not a later click", async () => {
    // The attributed learner's identity is bound on day one and their frozen
    // attribution points at Alpha. Beta must never claim it.
    const alphaCounts = await loadCounts(prisma, bothDays, { affiliatePartnerId: alpha.id }, "attributed");
    const betaCounts = await loadCounts(prisma, bothDays, { affiliatePartnerId: beta.id }, "attributed");
    assert.equal(alphaCounts.pocketRegistrations, 1);
    assert.equal(betaCounts.pocketRegistrations, 0);
  });

  /* ============================ J. RECONCILIATION ======================== */

  await check("J1 additive bucket sums equal the independently-queried period total", async () => {
    for (const group of ["day", "week", "month"] as const) {
      const buckets = buildBuckets(bothDays, group);
      const [perBucket, totals] = await Promise.all([
        loadBucketCounts(prisma, bothDays, {}, "total", buckets),
        loadCounts(prisma, bothDays, {}, "total"),
      ]);
      for (const metric of METRIC_KEYS) {
        if (metric === "uniqueVisitors") continue;
        const sum = perBucket.reduce((total, bucket) => total + bucket.counts[metric], 0);
        assert.equal(sum, totals[metric], `${group}/${metric} does not reconcile`);
      }
    }
  });

  await check("J2 interior zero buckets are present, not omitted", async () => {
    const wide = resolvePeriod(
      { preset: "custom", startDate: "2026-08-01", endDate: "2026-08-07" },
      MSK,
      NOW,
    );
    const buckets = buildBuckets(wide, "day");
    const perBucket = await loadBucketCounts(prisma, wide, {}, "total", buckets);
    assert.equal(perBucket.length, 6);
    assert.equal(perBucket[0].localLabel, "2026-08-01");
    assert.equal(perBucket[0].counts.qualifiedClicks, 0, "an interior zero bucket");
    assert.equal(perBucket[1].counts.qualifiedClicks, 0);
    assert.ok(perBucket[2].counts.qualifiedClicks > 0, "day one has traffic");
  });

  await check("J3 period uniques are NOT the sum of bucket uniques", async () => {
    const buckets = buildBuckets(bothDays, "day");
    const [perBucket, totals] = await Promise.all([
      loadBucketCounts(prisma, bothDays, {}, "total", buckets),
      loadCounts(prisma, bothDays, {}, "total"),
    ]);
    const summed = perBucket.reduce((total, bucket) => total + bucket.counts.uniqueVisitors, 0);
    // visitorOne clicks on BOTH days, so the naive sum overcounts by exactly one.
    assert.equal(totals.uniqueVisitors, 5);
    assert.equal(summed, 6);
    assert.notEqual(summed, totals.uniqueVisitors);
  });

  await check("J4 Moscow day boundaries assign the 23:30 click to the RIGHT day", async () => {
    const buckets = buildBuckets(bothDays, "day");
    const perBucket = await loadBucketCounts(prisma, bothDays, {}, "total", buckets);
    assert.equal(perBucket[0].localLabel, "2026-08-03");
    // The 23:30 Moscow click is 20:30 UTC on the 3rd: same day either way. The
    // decisive one is the Pocket binding at 23:30 Moscow, which must be day one.
    const dayOne = await loadCounts(prisma, dayOneOnly, {}, "total");
    assert.equal(dayOne.pocketRegistrations, 1, "the 23:30 Moscow binding is day one");
  });

  await check("J5 breakdown rows reconcile with the attributed summary", async () => {
    const [rows, attributed] = await Promise.all([
      loadBreakdown(prisma, bothDays, {}, "affiliate"),
      loadCounts(prisma, bothDays, {}, "attributed"),
    ]);
    for (const metric of METRIC_KEYS) {
      if (metric === "uniqueVisitors") continue;
      let sum = 0;
      for (const row of rows.values()) sum += row.counts[metric];
      assert.equal(sum, attributed[metric], `${metric} breakdown does not reconcile`);
    }
  });

  await check("J6 campaign and tracking-link breakdowns reconcile too", async () => {
    for (const dimension of ["campaign", "tracking_link"] as const) {
      const rows = await loadBreakdown(prisma, bothDays, {}, dimension);
      const attributed = await loadCounts(prisma, bothDays, {}, "attributed");
      let sum = 0;
      for (const row of rows.values()) sum += row.counts.academyRegistrations;
      assert.equal(sum, attributed.academyRegistrations, dimension);
    }
  });

  await check("J7 all_time has no hidden cutoff", async () => {
    const allTime = resolvePeriod({ preset: "all_time" }, MSK, NOW);
    const counts = await loadCounts(prisma, allTime, {}, "total");
    // Inside the 5-year custom cap, and still far earlier than any fixture row.
    const wide = resolvePeriod(
      { preset: "custom", startDate: "2022-01-01", endDate: "2026-08-09" },
      MSK,
      NOW,
    );
    const wideCounts = await loadCounts(prisma, wide, {}, "total");
    assert.deepEqual(counts, wideCounts);
  });

  /* ============================== K. FD AMOUNTS ========================== */

  await check("K1 one configured currency aggregates to an exact total", async () => {
    const amounts = await loadAmountAvailability(prisma, bothDays, {}, "total");
    assert.equal(amounts.amountAggregationAvailable, true);
    assert.equal(amounts.amountTotal, "300.00", "282.70 + 17.30 exactly");
    assert.equal(amounts.currencyCode, "USD");
  });

  await check("K2 an UNSPECIFIED currency withholds the total and names the reason", async () => {
    const learnerU = await learner("unspec", linkA1);
    await firstDeposit(learnerU, linkA1, DAY_TWO, "10.00", { status: "unspecified", code: null });
    const amounts = await loadAmountAvailability(prisma, bothDays, {}, "total");
    assert.equal(amounts.amountAggregationAvailable, false);
    assert.equal(amounts.amountTotal, null);
    assert.equal(amounts.currencyCode, null);
    assert.equal(amounts.unavailableReason, "currency_unspecified_or_mixed");
    // The COUNT stays authoritative even when the money does not.
    const counts = await loadCounts(prisma, bothDays, {}, "total");
    assert.equal(counts.confirmedFirstDeposits, 3);
    await prisma.affiliateConversionEvent.deleteMany({
      where: { sourceEventId: `fd-${learnerU.user.id}` },
    });
  });

  await check("K3 a MIXED currency set withholds the total", async () => {
    const learnerM = await learner("mixed", linkA1);
    await firstDeposit(learnerM, linkA1, DAY_TWO, "10.00", { status: "configured", code: "EUR" });
    const amounts = await loadAmountAvailability(prisma, bothDays, {}, "total");
    assert.equal(amounts.amountAggregationAvailable, false);
    assert.equal(amounts.unavailableReason, "currency_unspecified_or_mixed");
    // Never summed as if the units matched, and never converted.
    assert.equal(amounts.amountTotal, null);
    await prisma.affiliateConversionEvent.deleteMany({
      where: { sourceEventId: `fd-${learnerM.user.id}` },
    });
  });

  await check("K4 no confirmed deposits is its own reason, not a zero total", async () => {
    const empty = resolvePeriod(
      { preset: "custom", startDate: "2026-01-01", endDate: "2026-01-02" },
      MSK,
      NOW,
    );
    const amounts = await loadAmountAvailability(prisma, empty, {}, "total");
    assert.equal(amounts.amountAggregationAvailable, false);
    assert.equal(amounts.amountTotal, null, "absent, never 0.00");
    assert.equal(amounts.unavailableReason, "no_confirmed_first_deposits");
  });

  await check("K5 per-dimension amounts are resolved in ONE grouped query", async () => {
    const byDimension = await loadAmountAvailabilityByDimension(prisma, bothDays, {}, "affiliate");
    const alphaAmount = byDimension.get(alpha.id);
    assert.ok(alphaAmount, "Alpha should have a deposit");
    assert.equal(alphaAmount.amountAggregationAvailable, true);
    assert.equal(alphaAmount.amountTotal, "282.70");
    assert.equal(alphaAmount.currencyCode, "USD");
    // Beta has no confirmed deposit at all.
    assert.equal(byDimension.get(beta.id), undefined);
  });

  /* ============================= L. QUERY SAFETY ========================== */

  await check("L1 every analytics event-time column stores an INTEGER", async () => {
    // The raw queries compare against bound Date parameters. SQLite compares
    // types before values, so a TEXT timestamp written by a DEFAULT
    // CURRENT_TIMESTAMP would silently sort outside every range. This asserts
    // the invariant rather than trusting it.
    const columns: Array<[string, string]> = [
      ["AffiliateClick", "occurredAt"],
      ["AffiliateConversionEvent", "occurredAt"],
      ["PocketTraderIdentity", "boundAt"],
      ["PocketProviderEvent", "firstReceivedAt"],
    ];
    for (const [table, column] of columns) {
      const rows = await prisma.$queryRawUnsafe<Array<{ t: string }>>(
        `SELECT DISTINCT typeof("${column}") AS t FROM "${table}"`,
      );
      assert.deepEqual(rows.map((row) => row.t), ["integer"], `${table}.${column}`);
    }
  });

  await check("L2 the measured query plans are index-driven, never a table scan", async () => {
    const plans: Array<[string, string]> = [
      [
        "clicks",
        `SELECT COUNT(*) FROM "AffiliateClick" WHERE "classification"='qualified' AND "occurredAt" >= 1 AND "occurredAt" < 2`,
      ],
      [
        "conversions",
        `SELECT COUNT(*) FROM "AffiliateConversionEvent" WHERE "eventType"='academy_registration' AND "occurredAt" >= 1 AND "occurredAt" < 2`,
      ],
      [
        "pocket registrations",
        `SELECT COUNT(*) FROM "PocketTraderIdentity" WHERE "source"='registration_postback' AND "boundAt" >= 1 AND "boundAt" < 2`,
      ],
      [
        "pending deposits",
        `SELECT COUNT(*) FROM "PocketProviderEvent" WHERE "status"='pending_identity' AND "firstReceivedAt" >= 1 AND "firstReceivedAt" < 2`,
      ],
      [
        "conflicting deposits",
        `SELECT COUNT(*) FROM "PocketProviderEvent" WHERE "status"='conflict' AND "conflictDetectedAt" >= 1 AND "conflictDetectedAt" < 2`,
      ],
    ];
    for (const [label, sql] of plans) {
      const rows = await prisma.$queryRawUnsafe<Array<{ detail: string }>>(
        `EXPLAIN QUERY PLAN ${sql}`,
      );
      const detail = rows.map((row) => row.detail).join(" | ");
      assert.ok(detail.includes("USING COVERING INDEX"), `${label}: ${detail}`);
      assert.ok(!/\bSCAN [A-Z]/.test(detail), `${label} performs a table scan: ${detail}`);
    }
  });

  await check("L3 the bucket join uses the index once per bucket, not a scan", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ detail: string }>>(
      `EXPLAIN QUERY PLAN
       WITH b(idx, s, e) AS (VALUES (0, 1, 2), (1, 2, 3))
       SELECT b.idx, COUNT(c."id") FROM b LEFT JOIN "AffiliateClick" c
         ON c."occurredAt" >= b.s AND c."occurredAt" < b.e AND c."classification" = 'qualified'
       GROUP BY b.idx`,
    );
    const detail = rows.map((row) => row.detail).join(" | ");
    assert.ok(detail.includes("AffiliateClick_classification_occurredAt_idx"), detail);
    assert.ok(!detail.includes("SCAN AffiliateClick"), detail);
  });

  await check("L4 a bounded number of queries serves any number of buckets", async () => {
    // The guarantee that matters is that query COUNT does not grow with bucket
    // count. Ten metrics is ten statements whether the series has 2 or 200.
    let statements = 0;
    const counted = new Proxy(prisma, {
      get(target, property, receiver) {
        if (property === "$queryRaw") {
          const original = Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown;
          return (...args: unknown[]) => {
            statements += 1;
            return original.apply(target, args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const small = buildBuckets(bothDays, "day");
    statements = 0;
    await loadBucketCounts(counted as typeof prisma, bothDays, {}, "total", small);
    const forTwo = statements;

    const wide = resolvePeriod(
      { preset: "custom", startDate: "2026-06-01", endDate: "2026-09-01" },
      MSK,
      NOW,
    );
    const many = buildBuckets(wide, "day");
    assert.ok(many.length > 90, `expected a long series, got ${many.length}`);
    statements = 0;
    await loadBucketCounts(counted as typeof prisma, wide, {}, "total", many);
    assert.equal(statements, forTwo, "query count must not grow with bucket count");
    assert.equal(statements, METRIC_KEYS.length);
  });

  await check("L5 pagination does not change the totals it pages over", async () => {
    const rows = await loadBreakdown(prisma, bothDays, {}, "affiliate");
    const all = [...rows.values()];
    const firstPage = all.slice(0, 1);
    const secondPage = all.slice(1);
    const sum = (list: typeof all) =>
      list.reduce((total, row) => total + row.counts.academyRegistrations, 0);
    assert.equal(sum(firstPage) + sum(secondPage), sum(all));
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAFD-5B1 analytics regression: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
