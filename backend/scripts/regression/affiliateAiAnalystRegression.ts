/**
 * AFD-5D1 — unit and contract regression for the affiliate analysis report.
 *
 * NO DATABASE, NO SERVER, NO NETWORK. Every check here runs against synthetic
 * `AnalysisInput` structs, which is possible precisely because the rules are
 * pure: loading happens in `analysis-input.ts` and reasoning happens over data
 * that is already fixed.
 *
 * THE CENTRAL CHECK IS THE LEXICON. Section 4 renders every catalog entry with
 * sample operands and fails if any sentence contains a causal, predictive,
 * advisory or quality word. That is what turns "the AI may only state facts"
 * from a promise into a property of the build.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

import { ANALYSIS_CATALOG, CATALOG_CODES } from "../../src/lib/analysis/analysis-catalog";
import {
  ANALYSIS_CATALOG_VERSION,
  ANALYSIS_ENGINE_VERSION,
  ANALYSIS_SECTIONS,
  ANALYSIS_THRESHOLDS,
  CURIE_ATLAS_AGENT_CODE,
  CURIE_ATLAS_AGENT_VERSION,
  FINDING_CODES,
  FINDING_SEVERITIES,
  groupBySection,
  type FindingCode,
  type RawFinding,
} from "../../src/lib/analysis/analysis-contract";
import {
  assertFindingIsCatalogLegal,
  isKnownFindingCode,
  renderFindings,
} from "../../src/lib/analysis/analysis-engine";
import {
  countChangePercent,
  fromScaled,
  ratioDifferencePoints,
  ratioToPercent,
  sharePercent,
  toScaled,
} from "../../src/lib/analysis/analysis-format";
import { buildAnalysisReport } from "../../src/lib/analysis/analysis-report";
import {
  analysisInputFingerprint,
  parseAnalysisRequest,
} from "../../src/lib/analysis/analysis-request";
import { runRules } from "../../src/lib/analysis/analysis-rules";
import type { AnalysisInput, EventDateInput, CohortInput } from "../../src/lib/analysis/analysis-input";
import { computeRatios } from "../../src/lib/analytics/affiliate-queries";
import { ZERO_COUNTS, type MetricCounts } from "../../src/lib/analytics/affiliate-sources";
import type { ResolvedPeriod } from "../../src/lib/analytics/periods";
import type { ResolvedCutoff } from "../../src/lib/analytics/cohort-time";
import { EMPTY_MEDIANS, ZERO_COHORT_COUNTS, computeCohortRates } from "../../src/lib/analytics/cohort-queries";

/**
 * PRODUCT-RC-1 — `buildAnalysisReport` now takes the resolved request's
 * fingerprint, which these unit cases do not have: they construct an
 * `AnalysisInput` directly, bypassing the request grammar on purpose so a rule
 * can be exercised without also exercising the parser.
 *
 * A FIXED value keeps every assertion below about the FINDINGS. The fingerprint
 * is not asserted here by accident — it is proven on its own terms in cases
 * 46-49, over real parsed requests, which is the only place it means anything.
 */
const FIXED_FINGERPRINT = "00000000feedface";

function buildReport(input: AnalysisInput) {
  return buildAnalysisReport(input, FIXED_FINGERPRINT);
}

const MSK = "Europe/Moscow";
const OUT = process.env.AFD5D1_OUT ?? "";

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean }[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false });
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------- fixtures */

const PERIOD: ResolvedPeriod = {
  resolvedPreset: "last_30_days",
  timezone: MSK,
  startUtc: new Date("2026-06-30T21:00:00.000Z"),
  endUtc: new Date("2026-07-30T21:00:00.000Z"),
  startLocal: "2026-07-01 00:00:00",
  endLocal: "2026-07-31 00:00:00",
  intervalConvention: "start_inclusive_end_exclusive",
} as unknown as ResolvedPeriod;

const CUTOFF: ResolvedCutoff = {
  cutoffUtc: new Date("2026-07-30T21:00:00.000Z"),
  cutoffLocal: "2026-07-31 00:00:00",
  cutoffDateLocal: "2026-07-31",
  source: "explicit",
  clampedToReportClock: false,
} as unknown as ResolvedCutoff;

function counts(over: Partial<MetricCounts> = {}): MetricCounts {
  return { ...ZERO_COUNTS, ...over };
}

function eventInput(over: Partial<EventDateInput> = {}): EventDateInput {
  const base = counts({
    rawClicks: 1200,
    qualifiedClicks: 1000,
    uniqueVisitors: 800,
    academyRegistrations: 100,
    pocketRegistrations: 50,
    confirmedFirstDeposits: 10,
  });
  const resolved = over.counts ?? base;
  return {
    mode: "event_date",
    period: PERIOD,
    filters: {},
    coverage: "total",
    filtered: false,
    group: "day",
    dimension: "affiliate",
    counts: resolved,
    ratios: computeRatios(resolved),
    amount: {
      amountAggregationAvailable: true,
      amountTotal: "500.00",
      currencyCode: "USD",
      unavailableReason: null,
    },
    attributedCounts: null,
    unattributedCounts: null,
    buckets: [],
    breakdown: [],
    breakdownTotals: resolved,
    ...over,
    ...(over.counts ? { ratios: over.ratios ?? computeRatios(over.counts) } : {}),
  };
}

function cohortInput(over: Partial<CohortInput> = {}): CohortInput {
  const base = { cohortLearners: 200, pocketRegisteredLearners: 80, firstDepositLearners: 20 };
  const resolved = over.counts ?? base;
  return {
    mode: "acquisition_cohort",
    period: PERIOD,
    cutoff: CUTOFF,
    filters: {},
    filtered: false,
    group: "day",
    dimension: "affiliate",
    counts: resolved,
    rates: computeCohortRates(resolved),
    medians: EMPTY_MEDIANS,
    integrity: { missingOrDuplicateRegistrationCount: 0, duplicateFirstDepositCount: 0 },
    amount: {
      amountAggregationAvailable: false,
      amountTotal: null,
      currencyCode: null,
      unavailableReason: "no_confirmed_first_deposits",
    },
    buckets: [],
    breakdown: [],
    ...over,
    ...(over.counts ? { rates: over.rates ?? computeCohortRates(over.counts) } : {}),
  };
}

const messagesOf = (input: AnalysisInput): string[] =>
  renderFindings(runRules(input)).map((finding) => finding.message);

const codesOf = (input: AnalysisInput): FindingCode[] =>
  runRules(input).map((finding) => finding.code);

/* ============================ 1. the closed catalog ==================== */

check("1 every declared code has exactly one catalog entry, and vice versa", () => {
  assert.deepEqual([...CATALOG_CODES].sort(), [...FINDING_CODES].sort());
});

check("2 every catalog entry names a valid section and severity", () => {
  for (const code of CATALOG_CODES) {
    const entry = ANALYSIS_CATALOG[code];
    assert.ok(ANALYSIS_SECTIONS.includes(entry.section), `${code}: bad section`);
    assert.ok(FINDING_SEVERITIES.includes(entry.severity), `${code}: bad severity`);
  }
});

check("3 an unknown code is refused rather than rendered", () => {
  assert.equal(isKnownFindingCode("please_increase_the_bid"), false);
  assert.throws(
    () =>
      assertFindingIsCatalogLegal({
        code: "please_increase_the_bid" as FindingCode,
        operands: {},
        evidence: [{ key: "x", value: "1", source: "summary" }],
      }),
    /unknown finding code/,
  );
});

/* =================== 4. THE LEXICON: what may never be said ============ */

/**
 * Sample operands wide enough to render every entry.
 *
 * Deliberately supplied for ALL keys rather than per entry: a template that
 * starts reading a new operand is then rendered rather than silently skipped.
 */
const SAMPLE_OPERANDS: Record<string, string> = {
  metric: "qualifiedClicks",
  rate: "qualifiedClickToAcademyRegistrationRate",
  lag: "selectedClickToAcademyRegistration",
  dimension: "tracking_link",
  dimensionId: "7",
  value: "123",
  percent: "42.4",
  numerator: "100",
  denominator: "1000",
  denominatorMetric: "qualifiedClicks",
  attributed: "80",
  unattributed: "20",
  total: "100",
  attributedPercent: "80.0",
  direction: "down",
  firstLabel: "2026-07-01",
  firstValue: "100",
  lastLabel: "2026-07-30",
  lastValue: "60",
  changePercent: "40.0",
  firstPercent: "42.0",
  lastPercent: "35.0",
  changePoints: "7.0",
  thresholdPercent: "20",
  sharePercent: "72.5",
  bucketSum: "99",
  periodTotal: "100",
  threshold: "30",
  seconds: "3600",
  sampleSize: "42",
  clicks: "500",
  pocketRegistrations: "40",
  memberPercent: "2.1",
  aggregatePercent: "8.4",
  differencePoints: "6.3",
  cutoff: "2026-07-31 00:00:00",
  reason: "currency_unspecified_or_mixed",
};

/**
 * Words this product may never publish.
 *
 * CAUSAL — a reason the stored rows do not contain.
 * PREDICTIVE — a claim about a period that has not happened.
 * ADVISORY — an instruction, a bid, a payout or a partner decision.
 * QUALITY — a judgement about traffic rather than a measurement of it.
 */
/**
 * A WHOLE-WORD matcher that actually works on Cyrillic.
 *
 * JavaScript's word boundary is defined over [A-Za-z0-9_], so a pattern anchored
 * with it matches
 * NOTHING in a Russian sentence — a lexicon written that way passes every check
 * while forbidding nothing. This is not hypothetical: the first version of this
 * suite was exactly that, and check 5 below is what caught it. Unicode
 * lookarounds on `\\p{L}` are the working equivalent.
 */
function word(text: string): RegExp {
  return new RegExp(`(?<!\\p{L})${text}(?!\\p{L})`, "iu");
}

/**
 * A STEM, anchored at the START of a word.
 *
 * Unanchored, `ставк` also matches «доставки» and would fail a sentence about
 * provider redelivery for containing a word about bids. A stem is meant to catch
 * «ставка / ставки / ставку»; anchoring keeps that and drops the accidents.
 */
function stem(text: string): RegExp {
  return new RegExp(`(?<!\\p{L})${text}`, "iu");
}

const FORBIDDEN_LEXICON: readonly { readonly word: RegExp; readonly kind: string }[] = [
  { word: stem("вероятн"), kind: "causal" },
  { word: stem("скорее всего"), kind: "causal" },
  { word: stem("из-за"), kind: "causal" },
  { word: stem("потому что"), kind: "causal" },
  { word: stem("по причине"), kind: "causal" },
  { word: stem("связано с"), kind: "causal" },
  { word: stem("привело к"), kind: "causal" },
  { word: stem("объясня"), kind: "causal" },
  { word: stem("лендинг"), kind: "causal" },
  { word: stem("прогноз"), kind: "predictive" },
  { word: stem("ожидается"), kind: "predictive" },
  // THE FUTURE AUXILIARY, IN EVERY PERSON AND NUMBER.
  //
  // AFD-5D3 found that only the 3rd-person singular «будет» was covered, so
  // «Пользователи будут пополнять счёт» — verbatim one of the claims the phase
  // brief prohibits — passed this check. Five of the six forms were missed.
  //
  // Anchored at both ends, so «будни» and «будильник» are untouched.
  { word: word("буду|будешь|будет|будем|будете|будут"), kind: "predictive" },
  // «в будущем», «будущий период» — a forecast by another route.
  { word: stem("будущ"), kind: "predictive" },
  { word: stem("спрогнозир"), kind: "predictive" },
  { word: stem("рекоменд"), kind: "advisory" },
  { word: stem("советуе"), kind: "advisory" },
  { word: word("следует"), kind: "advisory" },
  { word: word("стоит"), kind: "advisory" },
  { word: word("нужно"), kind: "advisory" },
  { word: stem("отключ"), kind: "advisory" },
  { word: stem("увеличьте"), kind: "advisory" },
  { word: stem("снизьте"), kind: "advisory" },
  { word: stem("ставк"), kind: "advisory" },
  { word: /\bCPA\b/i, kind: "advisory" },
  { word: stem("выплат"), kind: "advisory" },
  { word: stem("бюджет"), kind: "advisory" },
  { word: stem("плох"), kind: "quality" },
  { word: stem("хорош"), kind: "quality" },
  { word: stem("некачествен"), kind: "quality" },
  { word: stem("слаб"), kind: "quality" },
  { word: stem("эффективн"), kind: "quality" },
  { word: stem("подозрительн"), kind: "quality" },
  { word: word("фрод"), kind: "quality" },
];

check("4 NO catalog sentence contains a causal, predictive, advisory or quality word", () => {
  for (const code of CATALOG_CODES) {
    const message = ANALYSIS_CATALOG[code].render(SAMPLE_OPERANDS);
    for (const { word, kind } of FORBIDDEN_LEXICON) {
      assert.ok(
        !word.test(message),
        `${code} (${kind}): "${message}" matches ${String(word)}`,
      );
    }
  }
});

check("5 the lexicon itself is wired correctly — both directions", () => {
  // GUARDS THE GUARD. A lexicon that matches nothing makes check 4 vacuous, and
  // one that matches everything makes it unusable. Both are pinned here.
  //
  // This is not hypothetical: the first version of this suite anchored every
  // Cyrillic stem with `\b`, which JavaScript defines over ASCII only, so not
  // one pattern could ever fire. This check is what found it.
  const planted = "Конверсия снизилась, вероятно, из-за лендинга. Рекомендуем поднять ставку.";
  const hits = FORBIDDEN_LEXICON.filter((entry) => entry.word.test(planted));
  assert.ok(hits.length >= 4, `expected several matches, saw ${hits.length}`);
  for (const kind of ["causal", "advisory"]) {
    assert.ok(hits.some((entry) => entry.kind === kind), `no ${kind} match`);
  }

  // And the other direction: an innocent sentence must stay clean. «доставки»
  // contains the letters of «ставк» and must not be read as a word about bids.
  const innocent =
    "Повторный депозит неотличим от повторной доставки первого. Наблюдений нет.";
  const falsePositives = FORBIDDEN_LEXICON.filter((entry) => entry.word.test(innocent));
  assert.deepEqual(
    falsePositives.map((entry) => String(entry.word)),
    [],
    "the lexicon matched an innocent sentence",
  );
});

check("6 every catalog sentence is non-empty and ends in a full stop", () => {
  for (const code of CATALOG_CODES) {
    const message = ANALYSIS_CATALOG[code].render(SAMPLE_OPERANDS);
    assert.ok(message.length > 0, `${code}: empty`);
    assert.ok(message.trim().endsWith("."), `${code}: "${message}"`);
  }
});

/* ==================== 7. operands and evidence are mandatory =========== */

check("7 a missing operand fails loudly instead of rendering a hole", () => {
  assert.throws(
    () =>
      renderFindings([
        {
          code: "period_volume",
          operands: { metric: "qualifiedClicks" },
          evidence: [{ key: "qualifiedClicks", value: "10", source: "summary" }],
        },
      ]),
    /missing operand "value"/,
  );
});

check("8 a finding with no evidence is refused", () => {
  assert.throws(
    () =>
      renderFindings([
        { code: "period_volume", operands: { metric: "qualifiedClicks", value: "10" }, evidence: [] },
      ]),
    /no evidence attached/,
  );
});

check("9 standing questions are the ONLY entries allowed without evidence", () => {
  const questionCodes = CATALOG_CODES.filter(
    (code) => ANALYSIS_CATALOG[code].section === "question",
  );
  for (const code of questionCodes) {
    assert.doesNotThrow(() =>
      assertFindingIsCatalogLegal({ code, operands: {}, evidence: [] }),
    );
  }
  const nonQuestion = CATALOG_CODES.filter(
    (code) => ANALYSIS_CATALOG[code].section !== "question",
  );
  for (const code of nonQuestion) {
    assert.throws(
      () =>
        assertFindingIsCatalogLegal({
          code,
          operands: SAMPLE_OPERANDS,
          evidence: [],
        } as RawFinding),
      /no evidence attached/,
      `${code} should require evidence`,
    );
  }
});

check("10 EVERY finding a real report emits carries traceable evidence", () => {
  for (const input of [
    eventInput(),
    eventInput({ counts: counts() }),
    cohortInput(),
    cohortInput({ counts: { ...ZERO_COHORT_COUNTS } }),
  ]) {
    for (const finding of renderFindings(runRules(input))) {
      if (finding.section === "question") continue;
      assert.ok(finding.evidence.length > 0, `${finding.code}: no evidence`);
      for (const item of finding.evidence) {
        assert.ok(item.key.length > 0 && item.value.length > 0, `${finding.code}: empty evidence`);
      }
    }
  }
});

/* ========================= 11. exact formatting ======================== */

check("11 a published ratio becomes a percentage without floating error", () => {
  assert.equal(ratioToPercent("0.423700"), "42.3");
  assert.equal(ratioToPercent("0.350000"), "35.0");
  assert.equal(ratioToPercent("0.000000"), "0.0");
  assert.equal(ratioToPercent("1.000000"), "100.0");
  // The classic float trap, rendered exactly.
  assert.equal(ratioToPercent("0.100000"), "10.0");
});

check("12 a non-decimal string is refused rather than coerced", () => {
  assert.throws(() => toScaled("abc", 6), /not a decimal string/);
  assert.throws(() => toScaled("", 6), /not a decimal string/);
  assert.equal(fromScaled(BigInt(1234567), 6, 1), "1.2");
});

check("13 differences and shares are exact", () => {
  assert.equal(ratioDifferencePoints("0.420000", "0.350000"), "7.0");
  assert.equal(ratioDifferencePoints("0.350000", "0.420000"), "7.0");
  assert.equal(sharePercent(72, 100), "72.0");
  assert.equal(sharePercent(1, 3), "33.3");
  assert.equal(sharePercent(5, 0), null);
  assert.equal(countChangePercent(100, 60), "40.0");
  assert.equal(countChangePercent(0, 5), null);
});

/* ===================== 14. insufficient_data ========================== */

check("14 an empty period returns insufficient_data and NOTHING else", () => {
  const report = buildReport(eventInput({ counts: counts() }));

  // AFD-5D2A moved the verdict to a three-valued status plus coded issues. The
  // top-level `status` is the operator-facing word; `dataSufficiency.status` is
  // the same decision in the sufficiency vocabulary, and the two cannot
  // disagree — `buildDataSufficiency` asserts that at build time.
  assert.equal(report.status, "insufficient_data");
  assert.equal(report.dataSufficiency.status, "insufficient");
  // An EMPTY period raises no issue: emptiness is a valid factual result, not a
  // data problem, and the `insufficient_data` FINDING already names the reason.
  assert.deepEqual(report.dataSufficiency.issues, []);
  assert.deepEqual(report.observations, []);
  assert.deepEqual(report.positiveSignals, []);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0]!.code, "insufficient_data");
  assert.match(report.warnings[0]!.message, /insufficient_data/);
  // The standing questions still stand.
  assert.equal(report.questions.length, 6);
});

check("15 an empty cohort returns insufficient_data with its own reason", () => {
  const report = buildReport(cohortInput({ counts: { ...ZERO_COHORT_COUNTS } }));
  assert.equal(report.status, "insufficient_data");
  assert.equal(report.dataSufficiency.status, "insufficient");
  // Same rule as case 14: an empty cohort is a factual answer, not an issue.
  assert.deepEqual(report.dataSufficiency.issues, []);
  assert.deepEqual(report.observations, []);
  assert.deepEqual(report.positiveSignals, []);
});

check("16 an empty period NEVER prints a rate, a change or a zero percent", () => {
  const messages = messagesOf(eventInput({ counts: counts() }));
  for (const message of messages) {
    assert.ok(!/\d+[.,]\d+\s*%/.test(message), `printed a percentage: "${message}"`);
    assert.ok(!/выросл|снизил/.test(message), `printed a change: "${message}"`);
  }
});

/* ======================= 17. facts, not fabrications =================== */

check("17 a zero denominator is reported as undefined, never as 0 %", () => {
  const input = eventInput({ counts: counts({ academyRegistrations: 5 }) });
  const codes = codesOf(input);
  assert.ok(codes.includes("funnel_rate_undefined"));

  const message = messagesOf(input).find((text) => text.includes("не определена"));
  assert.ok(message, "expected an explicit 'не определена'");
  assert.match(message!, /Это не ноль процентов/);
});

check("18 the example from the specification renders as a plain fact", () => {
  const first = counts({ qualifiedClicks: 100, pocketRegistrations: 42, academyRegistrations: 100 });
  const last = counts({ qualifiedClicks: 100, pocketRegistrations: 35, academyRegistrations: 100 });
  const input = eventInput({
    counts: counts({ qualifiedClicks: 200, academyRegistrations: 200, pocketRegistrations: 77 }),
    buckets: [
      { localLabel: "2026-07-01", counts: first },
      { localLabel: "2026-07-30", counts: last },
    ],
  });

  const message = messagesOf(input).find((text) =>
    text.startsWith("Регистрация в Академии → регистрация в Pocket снизилась"),
  );
  assert.ok(message, "expected the rate-change sentence");
  // "Конверсия Pocket снизилась с 42 % до 35 %" — the shape the spec asked for.
  assert.match(message!, /с 42\.0 %/);
  assert.match(message!, /до 35\.0 %/);
  assert.match(message!, /7\.0 п\.п\./);
  // And nothing about why.
  assert.ok(!/из-за|вероятн|лендинг/i.test(message!));
});

check("19 a change below the threshold is reported as below the threshold", () => {
  const flat = counts({ qualifiedClicks: 100, academyRegistrations: 10 });
  const input = eventInput({
    counts: counts({ qualifiedClicks: 200, academyRegistrations: 20 }),
    buckets: [
      { localLabel: "2026-07-01", counts: flat },
      { localLabel: "2026-07-30", counts: counts({ qualifiedClicks: 105, academyRegistrations: 10 }) },
    ],
  });
  const codes = codesOf(input);
  assert.ok(codes.includes("series_flat"));
});

check("20 a single bucket produces no change finding at all", () => {
  const input = eventInput({
    buckets: [{ localLabel: "2026-07-01", counts: counts({ qualifiedClicks: 10 }) }],
  });
  const codes = codesOf(input);
  assert.ok(!codes.includes("series_count_change"));
  assert.ok(!codes.includes("series_rate_change"));
  assert.ok(!codes.includes("series_flat"));
});

/* ===================== 21. warnings are stored values ================== */

check("21 conflicts and pending deposits are reported as states, not verdicts", () => {
  const input = eventInput({
    counts: counts({
      qualifiedClicks: 100,
      academyRegistrations: 10,
      conflictingDeposits: 3,
      pendingIdentityDeposits: 4,
    }),
  });
  const messages = messagesOf(input);

  const conflict = messages.find((text) => text.startsWith("Депозиты с конфликтом"));
  assert.ok(conflict);
  assert.match(conflict!, /состояние записи провайдера/);
  assert.match(conflict!, /учтённые депозиты оно не отменяет/);

  const pending = messages.find((text) => text.startsWith("Депозиты в ожидании"));
  assert.ok(pending);
  assert.match(pending!, /Подтверждённым первым депозитом такой депозит не считается/);
});

check("22 a small sample is flagged and the rate is still stated", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 10, academyRegistrations: 2 }),
  });
  const codes = codesOf(input);
  assert.ok(codes.includes("small_sample_rate"));
  assert.ok(codes.includes("funnel_rate_level"));

  const flagged = messagesOf(input).find((text) => text.includes("меньше порога отчёта"));
  assert.ok(flagged);
  assert.match(flagged!, new RegExp(String(ANALYSIS_THRESHOLDS.minRateDenominator)));
});

check("23 a bucket/total mismatch is surfaced rather than smoothed over", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 100, academyRegistrations: 10 }),
    buckets: [
      { localLabel: "a", counts: counts({ qualifiedClicks: 40 }) },
      { localLabel: "b", counts: counts({ qualifiedClicks: 40 }) },
    ],
  });
  assert.ok(codesOf(input).includes("series_reconciliation_mismatch"));
});

check("24 an unavailable amount states the reason and prints no number", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 100, academyRegistrations: 10 }),
    amount: {
      amountAggregationAvailable: false,
      amountTotal: null,
      currencyCode: null,
      unavailableReason: "currency_unspecified_or_mixed",
    },
  });
  const message = messagesOf(input).find((text) => text.startsWith("Сумма первых депозитов"));
  assert.ok(message);
  assert.match(message!, /несколько валют/);
  assert.ok(!/USD|\d+\.\d\d/.test(message!));
});

/* =============== 25. positive signals carry no advice ================= */

check("25 a member contrast states two numbers and recommends nothing", () => {
  // Aggregate 20 %, member 1 % — a 19 p.p. gap, comfortably over the published
  // 10 p.p. threshold, so the check is about the SENTENCE rather than about
  // whether the rule fired.
  const input = eventInput({
    counts: counts({ qualifiedClicks: 1000, academyRegistrations: 200 }),
    breakdownTotals: counts({ qualifiedClicks: 1000, academyRegistrations: 200 }),
    breakdown: [
      {
        dimensionId: 7,
        counts: counts({ qualifiedClicks: 200, academyRegistrations: 2 }),
        lastActivityAt: null,
      },
    ],
  });

  const message = messagesOf(input).find((text) => text.includes("против"));
  assert.ok(message, "expected a contrast");
  assert.match(message!, /Аффилейт #7/);
  assert.match(message!, /ниже на/);
  for (const { word } of FORBIDDEN_LEXICON) {
    assert.ok(!word.test(message!), `contrast matched ${String(word)}`);
  }
});

check("26 clicks without registrations is a count, not a judgement", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 1000, academyRegistrations: 100 }),
    breakdown: [
      { dimensionId: 3, counts: counts({ qualifiedClicks: 300 }), lastActivityAt: null },
    ],
  });
  const message = messagesOf(input).find((text) => text.includes("регистраций в Академии — ноль"));
  assert.ok(message);
  assert.match(message!, /квалифицированных кликов 300/);
});

check("27 a member below the volume threshold is not contrasted at all", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 1000, academyRegistrations: 100 }),
    breakdown: [
      { dimensionId: 9, counts: counts({ qualifiedClicks: 4 }), lastActivityAt: null },
    ],
  });
  const codes = codesOf(input);
  assert.ok(!codes.includes("member_clicks_without_registrations"));
  assert.ok(!codes.includes("member_rate_differs_from_aggregate"));
});

/* ================= 28. questions state what is unavailable ============= */

check("28 every report answers the four questions it cannot answer", () => {
  const report = buildReport(eventInput());
  const codes = report.questions.map((finding) => finding.code);
  for (const expected of [
    "question_cause_not_available",
    "question_forecast_not_available",
    "question_traffic_quality_not_available",
    "question_redeposits_unavailable",
    "question_current_balance_unavailable",
    "question_education_timeline_unavailable",
  ] as const) {
    assert.ok(codes.includes(expected), `missing ${expected}`);
  }
});

check("29 the questions say the report does NOT answer, never that it might", () => {
  const report = buildReport(eventInput());
  for (const question of report.questions) {
    assert.match(question.message, /отчёт не отвечает/i);
  }
});

/* ======================= 30. no PII is representable =================== */

check("30 no rendered sentence or evidence key can carry identity", () => {
  const inputs: AnalysisInput[] = [
    eventInput({
      counts: counts({ qualifiedClicks: 1000, academyRegistrations: 100, conflictingDeposits: 2 }),
      breakdown: [
        { dimensionId: 7, counts: counts({ qualifiedClicks: 300 }), lastActivityAt: null },
      ],
      buckets: [
        { localLabel: "a", counts: counts({ qualifiedClicks: 500, academyRegistrations: 50 }) },
        { localLabel: "b", counts: counts({ qualifiedClicks: 500, academyRegistrations: 20 }) },
      ],
    }),
    cohortInput(),
  ];

  const forbidden = /@|email|e-mail|userId|user_id|leadId|pocketPlayerId|clickId|ataClickId|anonymousVisitorId|passwordHash/i;

  for (const input of inputs) {
    const report = buildReport(input);
    const serialized = JSON.stringify(report);
    assert.ok(!forbidden.test(serialized), `identity-shaped token in report: ${serialized.slice(0, 200)}`);
  }
});

check("31 a dimension member is named by id only — no display name is resolved", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 1000, academyRegistrations: 100 }),
    breakdown: [
      { dimensionId: 7, counts: counts({ qualifiedClicks: 300 }), lastActivityAt: null },
    ],
  });
  const message = messagesOf(input).find((text) => text.includes("#7"));
  assert.ok(message, "expected a member reference");
  assert.match(message!, /Аффилейт #7/);
});

/* =========================== 32. determinism ========================== */

check("32 the same input produces a byte-identical report, twice", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 1000, academyRegistrations: 100, conflictingDeposits: 1 }),
    breakdown: [
      { dimensionId: 2, counts: counts({ qualifiedClicks: 400, academyRegistrations: 4 }), lastActivityAt: null },
      { dimensionId: 1, counts: counts({ qualifiedClicks: 600, academyRegistrations: 96 }), lastActivityAt: null },
    ],
    buckets: [
      { localLabel: "a", counts: counts({ qualifiedClicks: 500, academyRegistrations: 60 }) },
      { localLabel: "b", counts: counts({ qualifiedClicks: 500, academyRegistrations: 40 }) },
    ],
  });
  assert.equal(JSON.stringify(buildReport(input)), JSON.stringify(buildReport(input)));
});

check("33 the engine announces itself and states that no model was invoked", () => {
  const report = buildReport(eventInput());
  assert.equal(report.engine.kind, "deterministic");
  assert.equal(report.engine.modelInvoked, false);
  assert.equal(typeof report.engine.catalogVersion, "string");
  // PRODUCT-RC-1 — the engine's own version is published SEPARATELY from the
  // catalog's, so a rule change and a code change are distinguishable.
  assert.equal(report.engine.engineVersion, ANALYSIS_ENGINE_VERSION);
  assert.notEqual(report.engine.engineVersion, report.engine.catalogVersion);
});

/* ====================== 34. the request contract ====================== */

const NOW = new Date("2026-07-30T12:00:00.000Z");

check("34 an empty body is the documented default request", () => {
  const parsed = parseAnalysisRequest({}, MSK, NOW);
  assert.equal(parsed.mode, "event_date");
  assert.equal(parsed.period.resolvedPreset, "last_30_days");
  assert.equal(parsed.group, "day");
  assert.equal(parsed.dimension, "affiliate");
  assert.equal(parsed.cutoff, null);
  assert.deepEqual(parsed.filters, {});
});

check("35 an unknown key is refused, never ignored", () => {
  assert.throws(() => parseAnalysisRequest({ limit: 10 }, MSK, NOW), /body_unknown_key/);
  assert.throws(() => parseAnalysisRequest({ email: "x" }, MSK, NOW), /body_unknown_key/);
});

check("36 a non-object body is refused", () => {
  for (const body of [null, [], "x", 5]) {
    assert.throws(() => parseAnalysisRequest(body, MSK, NOW), /body_invalid/);
  }
});

check("37 dates beside a named preset are refused, as in the GET routes", () => {
  assert.throws(
    () => parseAnalysisRequest({ preset: "today", startDate: "2026-07-01" }, MSK, NOW),
    /dates_not_allowed/,
  );
});

check("38 a cutoff outside cohort mode is refused", () => {
  assert.throws(
    () => parseAnalysisRequest({ mode: "event_date", cutoffDate: "2026-07-01" }, MSK, NOW),
    /cutoff_not_allowed/,
  );
  const cohort = parseAnalysisRequest(
    { mode: "acquisition_cohort", cutoffDate: "2026-07-01" },
    MSK,
    NOW,
  );
  assert.ok(cohort.cutoff !== null);
});

check("39 a hostile filter value reaches no loader", () => {
  for (const value of ["1; DROP TABLE", "-1", "0", "1.5", "1e3", {}, true]) {
    assert.throws(
      () => parseAnalysisRequest({ affiliatePartnerId: value }, MSK, NOW),
      /filter_invalid|field_invalid/,
      `accepted ${JSON.stringify(value)}`,
    );
  }
  assert.equal(parseAnalysisRequest({ affiliatePartnerId: 7 }, MSK, NOW).filters.affiliatePartnerId, 7);
  assert.equal(
    parseAnalysisRequest({ affiliatePartnerId: "7" }, MSK, NOW).filters.affiliatePartnerId,
    7,
  );
});

check("40 an invalid mode, group or dimension is refused", () => {
  assert.throws(() => parseAnalysisRequest({ mode: "predict" }, MSK, NOW), /mode_invalid/);
  assert.throws(() => parseAnalysisRequest({ group: "hour" }, MSK, NOW), /group_invalid/);
  assert.throws(() => parseAnalysisRequest({ dimension: "learner" }, MSK, NOW), /dimension_invalid/);
});

/* ===================== 41. sections and the overview =================== */

check("41 findings land in the four published sections and nowhere else", () => {
  const report = buildReport(
    eventInput({ counts: counts({ qualifiedClicks: 100, academyRegistrations: 10, conflictingDeposits: 1 }) }),
  );
  const all = [
    ...report.observations,
    ...report.warnings,
    ...report.positiveSignals,
    ...report.questions,
  ];
  for (const finding of all) {
    assert.ok(ANALYSIS_SECTIONS.includes(finding.section));
  }
  const grouped = groupBySection(all);
  assert.equal(grouped.observations.length, report.observations.length);
  assert.equal(grouped.warnings.length, report.warnings.length);
});

check("42 the overview copies the aggregates and invents no score", () => {
  const report = buildReport(
    eventInput({ counts: counts({ qualifiedClicks: 1000, academyRegistrations: 100 }) }),
  );
  assert.equal(report.overview.headlineMetrics.qualifiedClicks, "1000");
  assert.equal(report.overview.headlineMetrics.academyRegistrations, "100");
  const serialized = JSON.stringify(report.overview);
  assert.ok(!/score|grade|index|rating|health/i.test(serialized));
});

check("43 thresholds are published so a reader can see why a finding fired", () => {
  const report = buildReport(eventInput());
  assert.equal(report.thresholds.minRateDenominator, ANALYSIS_THRESHOLDS.minRateDenominator);
  assert.ok(Object.keys(report.thresholds).length >= 7);
});

/* ============================ 44. cohort mode ========================= */

check("44 cohort mode reports its own rates and medians, never event-date ones", () => {
  const report = buildReport(cohortInput());
  const codes = report.observations.map((finding) => finding.code);
  assert.ok(codes.includes("cohort_size"));
  assert.ok(codes.includes("cohort_rate_level"));
  assert.ok(!codes.includes("period_volume"));
  assert.ok(!codes.includes("funnel_rate_level"));
  assert.equal(report.overview.mode, "acquisition_cohort");
  assert.equal(report.overview.coverage, "attributed");
});

check("45 a clamped cutoff and integrity findings are reported", () => {
  const report = buildReport(
    cohortInput({
      cutoff: { ...CUTOFF, clampedToReportClock: true } as ResolvedCutoff,
      integrity: { missingOrDuplicateRegistrationCount: 3, duplicateFirstDepositCount: 1 },
    }),
  );
  const codes = report.warnings.map((finding) => finding.code);
  assert.ok(codes.includes("cohort_cutoff_clamped"));
  assert.ok(codes.includes("cohort_missing_or_duplicate_registration"));
  assert.ok(codes.includes("cohort_duplicate_first_deposit"));
});

check("46 a negative duration is reported and excluded, never clamped", () => {
  const report = buildReport(
    cohortInput({
      medians: {
        ...EMPTY_MEDIANS,
        selectedClickToAcademyRegistration: {
          medianSeconds: "3600.000000",
          sampleSize: 40,
          negativeDurationCount: 2,
        },
      },
    }),
  );
  const message = report.warnings.find((finding) => finding.code === "negative_duration_observed");
  assert.ok(message);
  assert.match(message!.message, /исключены из медианы/);
});


/* ============ 47-52. PRODUCT-RC-1 published contract ================== */

check("47 the report names the agent that produced it", () => {
  const report = buildReport(eventInput());
  assert.equal(report.agent.code, "curie_atlas");
  assert.equal(report.agent.code, CURIE_ATLAS_AGENT_CODE);
  assert.equal(report.agent.version, CURIE_ATLAS_AGENT_VERSION);
  assert.equal(report.agent.version, "1.0.0");
  // Three versions, three things. If any two are the same VALUE that is fine,
  // but they must be three distinct FIELDS a consumer can read independently.
  const keys = Object.keys(report.agent).concat(Object.keys(report.engine));
  for (const key of ["code", "version", "kind", "engineVersion", "catalogVersion", "modelInvoked"]) {
    assert.ok(keys.includes(key), `envelope is missing ${key}`);
  }
  assert.equal(report.engine.catalogVersion, ANALYSIS_CATALOG_VERSION);
});

check("48 the third collection is positiveSignals and there is no legacy alias", () => {
  const report = buildReport(eventInput());
  assert.ok(Array.isArray(report.positiveSignals));
  // The rename is a rename, not an addition. A consumer written against the
  // pre-normalization shape must FAIL LOUDLY rather than silently read an
  // alias that would quietly stop being maintained.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(report, "opportunities"),
    "an `opportunities` compatibility alias was published",
  );
  // The section tag travels with the field name.
  assert.ok(!(ANALYSIS_SECTIONS as readonly string[]).includes("opportunity"));
  assert.ok((ANALYSIS_SECTIONS as readonly string[]).includes("positive_signal"));
  assert.ok(
    Object.prototype.hasOwnProperty.call(report.overview.findingCounts, "positive_signal"),
    "findingCounts still counts an `opportunity` section",
  );
});

check("49 the fingerprint identifies the RESOLVED question, not the raw body", () => {
  const at = new Date("2026-07-15T09:00:00.000Z");

  // Two spellings of the same window fingerprint IDENTICALLY. `custom` with the
  // dates last_30_days resolves to is the same question asked twice.
  const preset = parseAnalysisRequest({ preset: "last_30_days" }, MSK, at);
  const explicit = parseAnalysisRequest(
    {
      preset: "custom",
      startDate: preset.period.startLocal!.slice(0, 10),
      endDate: preset.period.endLocal.slice(0, 10),
    },
    MSK,
    at,
  );
  assert.equal(analysisInputFingerprint(preset), analysisInputFingerprint(explicit));

  // The SAME raw body a month later is a DIFFERENT question and must not collide.
  const later = parseAnalysisRequest({ preset: "last_30_days" }, MSK, new Date("2026-08-15T09:00:00.000Z"));
  assert.notEqual(analysisInputFingerprint(preset), analysisInputFingerprint(later));
});

check("50 every request field that changes the numbers changes the fingerprint", () => {
  const at = new Date("2026-07-15T09:00:00.000Z");
  const base = { preset: "last_30_days" } as Record<string, unknown>;
  const baseline = analysisInputFingerprint(parseAnalysisRequest(base, MSK, at));

  const variants: Record<string, unknown>[] = [
    { ...base, mode: "acquisition_cohort" },
    { ...base, group: "week" },
    { ...base, group: "month" },
    { ...base, dimension: "campaign" },
    { ...base, dimension: "tracking_link" },
    { ...base, affiliatePartnerId: 7 },
    { ...base, affiliateCampaignId: 7 },
    { ...base, affiliateTrackingLinkId: 7 },
    { ...base, preset: "today" },
  ];

  const seen = new Set<string>([baseline]);
  for (const variant of variants) {
    const fingerprint = analysisInputFingerprint(parseAnalysisRequest(variant, MSK, at));
    assert.notEqual(fingerprint, baseline, `${JSON.stringify(variant)} collided with the baseline`);
    assert.ok(!seen.has(fingerprint), `${JSON.stringify(variant)} collided with another variant`);
    seen.add(fingerprint);
    assert.match(fingerprint, /^[0-9a-f]{16}$/);
  }

  // Same input, same fingerprint — twice, so the hash is not salted per call.
  assert.equal(
    analysisInputFingerprint(parseAnalysisRequest(base, MSK, at)),
    analysisInputFingerprint(parseAnalysisRequest(base, MSK, at)),
  );
});

check("51 the same normalized request produces byte-identical output", () => {
  const at = new Date("2026-07-15T09:00:00.000Z");
  const parsed = parseAnalysisRequest({ preset: "last_30_days", dimension: "campaign" }, MSK, at);
  const fingerprint = analysisInputFingerprint(parsed);

  const input = eventInput({
    counts: counts({ qualifiedClicks: 900, academyRegistrations: 120, pocketRegistrations: 40 }),
    breakdownTotals: counts({ qualifiedClicks: 900, academyRegistrations: 120 }),
    breakdown: [
      { dimensionId: 3, counts: counts({ qualifiedClicks: 500, academyRegistrations: 5 }), lastActivityAt: null },
      { dimensionId: 4, counts: counts({ qualifiedClicks: 400, academyRegistrations: 115 }), lastActivityAt: null },
    ],
    buckets: [
      { localLabel: "a", counts: counts({ qualifiedClicks: 400, academyRegistrations: 80 }) },
      { localLabel: "b", counts: counts({ qualifiedClicks: 500, academyRegistrations: 40 }) },
    ],
  });

  const first = JSON.stringify(buildAnalysisReport(input, fingerprint));
  const second = JSON.stringify(buildAnalysisReport(input, fingerprint));
  assert.equal(first, second);
  // Not vacuous: this report actually says something.
  const parsedFirst = JSON.parse(first) as { positiveSignals: unknown[]; observations: unknown[] };
  assert.ok(parsedFirst.observations.length > 0);
  assert.ok(parsedFirst.positiveSignals.length > 0);
});

check("52 every positive signal is factual and recommends nothing", () => {
  const input = eventInput({
    counts: counts({ qualifiedClicks: 1000, academyRegistrations: 200, pocketRegistrations: 60 }),
    breakdownTotals: counts({ qualifiedClicks: 1000, academyRegistrations: 200 }),
    breakdown: [
      { dimensionId: 7, counts: counts({ qualifiedClicks: 200, academyRegistrations: 2 }), lastActivityAt: null },
      { dimensionId: 8, counts: counts({ qualifiedClicks: 300, academyRegistrations: 0 }), lastActivityAt: null },
      { dimensionId: 9, counts: counts({ qualifiedClicks: 500, academyRegistrations: 198 }), lastActivityAt: null },
    ],
  });

  const report = buildReport(input);
  assert.ok(report.positiveSignals.length > 0, "expected at least one positive signal");

  for (const finding of report.positiveSignals) {
    assert.equal(finding.section, "positive_signal");
    // A signal is a measurement, never a severity ladder rung.
    assert.equal(finding.severity, "info");
    // Its numbers must be traceable — this is what makes "no invented cause"
    // checkable rather than merely promised.
    assert.ok(finding.evidence.length > 0, `${finding.code} carried no evidence`);
    // And its sentence must survive the forbidden lexicon: no cause, no
    // forecast, no quality judgement, no advice.
    for (const { word } of FORBIDDEN_LEXICON) {
      assert.ok(!word.test(finding.message), `${finding.code} matched ${String(word)}`);
    }
  }
});

/* ------------------------------------------------------------- summary */

if (OUT) {
  fs.writeFileSync(
    OUT,
    JSON.stringify({ suite: "afd5d1-unit-contract", passed, failed, results }, null, 2),
  );
}

console.log(`\nAFD-5D1 analysis unit/contract: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
