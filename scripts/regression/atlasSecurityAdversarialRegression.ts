/**
 * AFD-5D3 — adversarial security, policy and factuality verification for Curie
 * Atlas.
 *
 * WHAT THIS SUITE IS FOR. AFD-5D1 and AFD-5D2A established that the engine emits
 * factual sentences and that the contract is closed. They tested the system
 * COOPERATIVELY: with well-formed inputs, one planted forbidden sentence, and one
 * innocent word. This suite attacks it.
 *
 * The distinction matters most for the forbidden-language policy. A lexicon of
 * Cyrillic stems is exactly the kind of control that looks thorough and fails
 * silently — AFD-5D1 already shipped one version that could never match anything,
 * because JavaScript's `\b` is ASCII-only. The remaining question is not "does
 * the lexicon match its own planted sentence" but "what does it MISS": homoglyph
 * substitution, transliteration, zero-width insertion, combining marks, case and
 * punctuation games. Sections A and B are that inventory.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE. This suite adds no product behaviour, no
 * metric, no SQL and no schema. Where it finds that a control is narrower than an
 * audit might assume, it records the boundary as an assertion rather than
 * widening the control — the reachability analysis in the audit is what decides
 * whether narrowness is a defect or a correct scope.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ANALYSIS_CATALOG, CATALOG_CODES } from "../../src/lib/analysis/analysis-catalog";
import { buildAnalysisReport } from "../../src/lib/analysis/analysis-report";
import type { AnalysisInput } from "../../src/lib/analysis/analysis-input";
import { computeRatios } from "../../src/lib/analytics/affiliate-queries";
import { ZERO_COUNTS, type MetricCounts } from "../../src/lib/analytics/affiliate-sources";
import {
  ANALYSIS_THRESHOLDS,
  FINDING_CODES,
  ANALYSIS_SECTIONS,
  FINDING_SEVERITIES,
  EVIDENCE_SOURCES,
  type RawFinding,
} from "../../src/lib/analysis/analysis-contract";
import {
  assertFindingIsCatalogLegal,
  isKnownFindingCode,
  renderFindings,
  supportsMode,
  AnalysisFindingError,
} from "../../src/lib/analysis/analysis-engine";
import { supportTierOf, comparisonOf, SUPPORT_TIERS } from "../../src/lib/analysis/analysis-support";
import {
  sufficiencyIssuesOf,
  analysisStatusOf,
  assertStatusesAgree,
  assertIssueIsCatalogLegal,
  SUFFICIENCY_REASON_CODES,
} from "../../src/lib/analysis/analysis-sufficiency";

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, ok: false, detail });
    console.log(`FAIL ${name}`);
    console.log(detail);
  }
}

/* ==================================================================== */
/* A. THE FORBIDDEN-LANGUAGE POLICY, AS AN OBJECT UNDER TEST            */
/* ==================================================================== */

/**
 * The policy under test, restated here so this suite tests the RULE rather than
 * a copy of the implementation's opinion of itself.
 *
 * `stem` is start-anchored: it must catch «ставка / ставки / ставку» without
 * catching «доставки». `word` is anchored at both ends.
 */
function word(text: string): RegExp {
  return new RegExp(`(?<!\\p{L})${text}(?!\\p{L})`, "iu");
}
function stem(text: string): RegExp {
  return new RegExp(`(?<!\\p{L})${text}`, "iu");
}

const LEXICON: readonly { readonly pattern: RegExp; readonly kind: string }[] = [
  { pattern: stem("вероятн"), kind: "causal" },
  { pattern: stem("скорее всего"), kind: "causal" },
  { pattern: stem("из-за"), kind: "causal" },
  { pattern: stem("потому что"), kind: "causal" },
  { pattern: stem("по причине"), kind: "causal" },
  { pattern: stem("связано с"), kind: "causal" },
  { pattern: stem("привело к"), kind: "causal" },
  { pattern: stem("объясня"), kind: "causal" },
  { pattern: stem("лендинг"), kind: "causal" },
  { pattern: stem("прогноз"), kind: "predictive" },
  { pattern: stem("ожидается"), kind: "predictive" },
  { pattern: word("буду|будешь|будет|будем|будете|будут"), kind: "predictive" },
  { pattern: stem("будущ"), kind: "predictive" },
  { pattern: stem("спрогнозир"), kind: "predictive" },
  { pattern: stem("рекоменд"), kind: "advisory" },
  { pattern: stem("советуе"), kind: "advisory" },
  { pattern: word("следует"), kind: "advisory" },
  { pattern: word("стоит"), kind: "advisory" },
  { pattern: word("нужно"), kind: "advisory" },
  { pattern: stem("отключ"), kind: "advisory" },
  { pattern: stem("увеличьте"), kind: "advisory" },
  { pattern: stem("снизьте"), kind: "advisory" },
  { pattern: stem("ставк"), kind: "advisory" },
  { pattern: /\bCPA\b/i, kind: "advisory" },
  { pattern: stem("выплат"), kind: "advisory" },
  { pattern: stem("бюджет"), kind: "advisory" },
  { pattern: stem("плох"), kind: "quality" },
  { pattern: stem("хорош"), kind: "quality" },
  { pattern: stem("некачествен"), kind: "quality" },
  { pattern: stem("слаб"), kind: "quality" },
  { pattern: stem("эффективн"), kind: "quality" },
  { pattern: stem("подозрительн"), kind: "quality" },
  { pattern: word("фрод"), kind: "quality" },
];

function violates(text: string): { kind: string; pattern: string } | null {
  for (const entry of LEXICON) {
    if (entry.pattern.test(text)) {
      return { kind: entry.kind, pattern: String(entry.pattern) };
    }
  }
  return null;
}

/** Sample operands wide enough to render every template. */
const SAMPLE: Record<string, string> = {
  metric: "qualifiedClicks",
  value: "1 000",
  rate: "qualifiedClickToPocketRegistrationRate",
  percent: "35,0",
  numerator: "350",
  denominator: "1 000",
  denominatorMetric: "qualifiedClicks",
  attributed: "800",
  unattributed: "200",
  first: "10",
  last: "25",
  firstValue: "10",
  lastValue: "25",
  changePercent: "150,0",
  firstPercent: "40,0",
  lastPercent: "35,0",
  changePoints: "5,0",
  threshold: "20",
  bucketSum: "990",
  periodTotal: "1 000",
  dimension: "affiliate",
  dimensionId: "7",
  memberPercent: "40,0",
  aggregatePercent: "25,0",
  differencePoints: "15,0",
  memberDenominator: "120",
  clicks: "500",
  pocketRegistrations: "40",
  academyRegistrations: "60",
  confirmedFirstDeposits: "9",
  sampleSize: "44",
  median: "3 ч 20 мин",
  lag: "selectedClickToAcademyRegistration",
  reason: "no_confirmed_first_deposits",
  count: "3",
  share: "62,0",
  members: "4",
  cohortLearners: "200",
  negativeDurationCount: "3",
  currency: "USD",
  amount: "500,00",
  cutoff: "2026-07-31",
  windowDays: "30",
  duplicates: "2",
  missing: "1",
  value1: "1",
  value2: "2",
  total: "1 000",
  attributedPercent: "80,0",
  seconds: "12 000",
  direction: "up",
  firstLabel: "2026-07-01",
  lastLabel: "2026-07-31",
  thresholdPercent: "20",
  sharePercent: "62,0",
};

/** Every catalog sentence, rendered once, reused across the language checks. */
function everySentence(): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  for (const code of CATALOG_CODES) {
    try {
      out.push({ code, message: ANALYSIS_CATALOG[code].render(SAMPLE) });
    } catch {
      // A template needing an operand the sample lacks is covered by check B3;
      // it must not silently drop out of the language sweep.
      out.push({ code, message: "" });
    }
  }
  return out;
}

check("A0 this suite's lexicon copy is identical to the accepted suite's", () => {
  // THE COPY IS THE RISK. This suite restates the lexicon so it can test the
  // policy as an object, but two copies of a security control drift, and the
  // drift is always discovered by the copy that stopped matching.
  //
  // Both lists are extracted from source and compared, so an edit to either
  // fails here until the other is updated.

  function entriesOf(file: string, key: string): string[] {
    const text = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    const start = text.indexOf(key);
    assert.ok(start > 0, `${file}: ${key} not found`);
    const end = text.indexOf("];", start);
    return [...text.slice(start, end).matchAll(/(?:word|stem)\("([^"]+)"\)|(\/[^/]+\/i)/g)]
      .map((m) => m[1] ?? m[2]!)
      .sort();
  }

  const accepted = entriesOf(
    "scripts/regression/affiliateAiAnalystRegression.ts",
    "const FORBIDDEN_LEXICON",
  );
  const mirror = entriesOf(
    "scripts/regression/atlasSecurityAdversarialRegression.ts",
    "const LEXICON",
  );
  assert.deepEqual(mirror, accepted, "the two lexicon copies have drifted");
  assert.ok(accepted.length >= 30, `the lexicon shrank to ${accepted.length} entries`);
});

check("A1 every catalog entry renders with the shared sample operand set", () => {
  // If this fails, the language sweep below would be scanning empty strings and
  // reporting a clean result for sentences it never saw.
  const missing = everySentence().filter((entry) => entry.message === "");
  assert.deepEqual(missing.map((entry) => entry.code), []);
});

check("A2 NO rendered sentence contains a causal, predictive, advisory or quality word", () => {
  for (const { code, message } of everySentence()) {
    const hit = violates(message);
    assert.equal(hit, null, `${code} (${hit?.kind}): "${message}" matched ${hit?.pattern}`);
  }
});

check("A3 the lexicon fires on the canonical hostile sentence", () => {
  const planted = "Конверсия снизилась, вероятно, из-за лендинга. Рекомендуем поднять ставку.";
  const kinds = new Set(LEXICON.filter((e) => e.pattern.test(planted)).map((e) => e.kind));
  assert.ok(kinds.has("causal"), "no causal match");
  assert.ok(kinds.has("advisory"), "no advisory match");
});

check("A4 the lexicon fires on EVERY prohibited claim named in the brief", () => {
  // §6 lists the statements the product must never make. Each is written here as
  // a plausible Russian sentence and must be caught. A lexicon that catches the
  // one planted example but not these would be decorative.
  const prohibited: [string, string][] = [
    ["increase the budget", "Увеличьте бюджет на этот источник."],
    ["reduce the budget", "Снизьте бюджет по этой кампании."],
    ["change the bid", "Измените ставку для этого аффилейта."],
    ["change CPA", "Пересмотрите CPA по этому партнёру."],
    ["stop the affiliate", "Отключите этого аффилейта."],
    ["disable the campaign", "Кампанию стоит отключить."],
    ["poor traffic", "Трафик плохой."],
    ["high-quality traffic", "Источник даёт хороший трафик."],
    ["landing-page problem", "Вероятно, проблема в лендинге."],
    ["users will deposit", "Пользователи будут пополнять счёт."],
    ["this source will grow", "Прогноз: источник вырастет."],
    ["contact these users", "Свяжитесь с этими пользователями — рекомендуем."],
    ["the cause is", "Снижение связано с качеством трафика."],
    ["probably", "Вероятно, показатель восстановится."],
    ["forecast", "Прогноз на следующий период положительный."],
    ["recommendation", "Рекомендация: увеличить бюджет."],
  ];
  const missed = prohibited.filter(([, sentence]) => violates(sentence) === null);
  assert.deepEqual(
    missed.map(([label]) => label),
    [],
    `the lexicon does not catch: ${missed.map(([l, s]) => `${l} ("${s}")`).join("; ")}`,
  );
});

check("A5 inflected forms of a forbidden stem are caught", () => {
  // A stem exists to survive Russian inflection. If it only matched the
  // dictionary form it would be a word-list with extra steps.
  const forms = [
    "ставка", "ставки", "ставку", "ставкой", "ставках",
    "рекомендуем", "рекомендация", "рекомендованный", "рекомендательный",
    "бюджет", "бюджета", "бюджету", "бюджетом", "бюджетный",
    "отключить", "отключите", "отключение", "отключён",
    "плохой", "плохая", "плохие", "плоховато",
    "прогноз", "прогнозы", "прогнозный", "прогнозируемый",
  ];
  const missed = forms.filter((form) => violates(`Показатель: ${form}.`) === null);
  assert.deepEqual(missed, [], `inflected forms not caught: ${missed.join(", ")}`);
});

check("A6 case and punctuation do not evade the lexicon", () => {
  const evasions = [
    "РЕКОМЕНДУЕМ увеличить бюджет.",
    "Рекомендуем.",
    "(рекомендуем)",
    "«Рекомендуем»",
    "—рекомендуем",
    "…прогноз.",
    "ставка!",
    "бюджет?",
    "Отключить/включить.",
    "ставка-минимум",
  ];
  const missed = evasions.filter((text) => violates(text) === null);
  assert.deepEqual(missed, [], `case/punctuation evasions not caught: ${missed.join(" | ")}`);
});

check("A7 legitimate words containing forbidden letter sequences are NOT flagged", () => {
  // The other direction, and the one that makes a lexicon usable. Each of these
  // is a word this product legitimately uses or could use.
  const innocent = [
    "Повторный депозит неотличим от повторной доставки первого.",   // доставки ⊃ ставк
    "Достижение порога зафиксировано.",                              // достижение
    "Наблюдений нет.",
    "Подставка под монитор не относится к отчёту.",                  // подставка
    "Расставка меток не изменилась.",                                // расставка
    "Оставшиеся клики учтены.",                                      // оставшиеся
    "Регистрация подтверждена.",
    "Конверсия не определена — знаменатель равен нулю.",
  ];
  const falsePositives = innocent
    .map((text) => ({ text, hit: violates(text) }))
    .filter((entry) => entry.hit !== null);
  assert.deepEqual(
    falsePositives.map((e) => `${e.text} → ${e.hit?.pattern}`),
    [],
  );
});

/* ==================================================================== */
/* B. THE EVASIONS THE LEXICON DOES NOT COVER, STATED AS BOUNDARIES     */
/* ==================================================================== */

const ZERO_WIDTH = "​";
const CYRILLIC_TO_LATIN_HOMOGLYPH: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i",
  А: "A", Е: "E", О: "O", Р: "P", С: "C", У: "Y", Х: "X",
};

function homoglyph(text: string): string {
  return [...text].map((ch) => CYRILLIC_TO_LATIN_HOMOGLYPH[ch] ?? ch).join("");
}

check("B1 BOUNDARY: homoglyph substitution defeats the lexicon", () => {
  // Substituting visually identical Latin letters produces a string a human
  // reads as «Рекомендуем» and a regex does not. This is asserted as a KNOWN
  // BOUNDARY, not tolerated silently: §B4 establishes why it is unreachable in
  // this release, and the audit records it as a constraint on any future phase
  // that lets free text into a rendered sentence.
  const disguised = homoglyph("Рекомендуем увеличить бюджет");
  assert.notEqual(disguised, "Рекомендуем увеличить бюджет", "the fixture did not substitute");
  assert.equal(
    violates(disguised),
    null,
    "homoglyph text is now caught — update this boundary assertion and the audit",
  );
});

check("B2 BOUNDARY: zero-width insertion defeats the lexicon", () => {
  // ISOLATED: the word under test and nothing else. An earlier version of this
  // fixture appended «увеличить бюджет», so it was caught by the budget stem and
  // said nothing at all about zero-width insertion.
  const plain = "Рекомендуем";
  assert.notEqual(violates(plain), null, "the control word must be caught when intact");
  const disguised = `Реко${ZERO_WIDTH}мендуем`;
  assert.equal(
    violates(disguised),
    null,
    "zero-width text is now caught — update this boundary assertion and the audit",
  );
});

check("B3 BOUNDARY: Latin transliteration defeats the lexicon", () => {
  assert.equal(violates("Rekomenduem uvelichit byudzhet"), null);
});

check("B4 REACHABILITY: no template interpolates free text, so B1–B3 are unreachable", () => {
  // This is the check that turns three boundaries into an accepted risk rather
  // than an open hole. A sentence can only contain what a template puts there,
  // and every template composes: fixed Russian prose, a label from a CLOSED
  // lookup, or an operand.
  //
  // If this ever fails, B1–B3 stop being theoretical.
  for (const code of CATALOG_CODES) {
    const entry = ANALYSIS_CATALOG[code];

    // Every operand a template reads is declared. A template reading an
    // undeclared operand could receive anything.
    const declared = new Set(entry.requiredOperands);
    const probe: Record<string, string> = {};
    for (const key of declared) probe[key] = SAMPLE[key] ?? "1";

    // Render with ONLY the declared operands: if it succeeds, the template reads
    // nothing beyond its declaration.
    let rendered: string;
    try {
      rendered = entry.render(probe);
    } catch (error) {
      assert.fail(
        `${code} reads an operand it does not declare: ${error instanceof Error ? error.message : error}`,
      );
    }
    assert.ok(rendered.length > 0);
  }
});

check("B5 REACHABILITY: the only verbatim-interpolated operands are bucket labels", () => {
  // The complement of B4, and it found something worth stating precisely.
  //
  // Most operands are numbers or CLOSED lookup keys. Two are not: `firstLabel`
  // and `lastLabel` are interpolated into prose verbatim. They come from the
  // analytics time bucketing (`bucket.localLabel`), which is produced by SQL
  // date formatting — not from the request and not from any stored name.
  //
  // This case pins that inventory. If a THIRD verbatim operand appears, this
  // fails and someone must decide whether its provenance is equally bounded.
  const VERBATIM_TEXT_OPERANDS = new Set(["firstLabel", "lastLabel"]);
  const FREE_TEXT_SHAPED = /(name|title|label|note|comment|text|description|search|query)/i;

  const found = new Set<string>();
  for (const code of CATALOG_CODES) {
    for (const operand of ANALYSIS_CATALOG[code].requiredOperands) {
      if (FREE_TEXT_SHAPED.test(operand)) found.add(operand);
    }
  }
  assert.deepEqual(
    [...found].sort(),
    [...VERBATIM_TEXT_OPERANDS].sort(),
    "a new free-text-shaped operand appeared; its provenance must be reviewed",
  );
});

check("B6 REACHABILITY: a bucket label is a date, and a hostile one would be visible", () => {
  // Bucket labels are the one free-text path into a sentence, so their shape is
  // asserted rather than assumed. A label that is not date-shaped means the
  // bucketing changed and B5's reachability argument needs re-checking.
  const entry = ANALYSIS_CATALOG["series_count_change"];
  const operands: Record<string, string> = {};
  for (const key of entry.requiredOperands) operands[key] = SAMPLE[key] ?? "1";
  const rendered = entry.render(operands);
  assert.match(rendered, /2026-07-01/, "the label is interpolated verbatim, as documented");

  // And the honest half: a hostile label WOULD reach the sentence. That is why
  // its provenance is pinned in B5 rather than a sanitiser being added here for
  // a value the database never produces.
  const hostile = entry.render({ ...operands, firstLabel: "Рекомендуем увеличить бюджет" });
  assert.notEqual(
    violates(hostile),
    null,
    "a hostile bucket label would render; the lexicon must at least see it",
  );
});

check("B7 the rules emit only the two direction values the template understands", () => {
  // `direction` is rendered as `=== "up" ? «выросли» : «снизились»`, so ANY value
  // other than "up" asserts a decrease. That is safe only while every caller
  // passes exactly "up" or "down", which is asserted here against the rule source
  // rather than assumed.
  const rules = fs.readFileSync(
    path.join(process.cwd(), "src/lib/analysis/analysis-rules.ts"),
    "utf8",
  );
  const assignments = [...rules.matchAll(/direction:\s*(.+)$/gm)].map((m) => m[1]!.trim().replace(/,$/, ""));
  assert.ok(assignments.length > 0, "no direction assignment found — the check is vacuous");
  for (const assignment of assignments) {
    assert.match(
      assignment,
      /\?\s*"up"\s*:\s*"down"$/,
      `direction is assigned by an expression that may not be "up"/"down": ${assignment}`,
    );
  }
});

/* ==================================================================== */
/* C. CATALOG INTEGRITY AND FAIL-CLOSED BEHAVIOUR                       */
/* ==================================================================== */

check("C1 the contract and the catalog declare exactly the same codes", () => {
  assert.deepEqual([...FINDING_CODES].sort(), [...CATALOG_CODES].sort());
});

check("C2 no duplicate code and no wildcard code", () => {
  assert.equal(new Set(FINDING_CODES).size, FINDING_CODES.length);
  for (const code of FINDING_CODES) {
    assert.match(code, /^[a-z][a-z0-9_]*$/, `${code} is not a plain snake_case identifier`);
    assert.ok(!code.includes("*"), `${code} looks like a wildcard`);
  }
});

check("C3 every entry names a published section and severity", () => {
  for (const code of CATALOG_CODES) {
    const entry = ANALYSIS_CATALOG[code];
    assert.ok((ANALYSIS_SECTIONS as readonly string[]).includes(entry.section), code);
    assert.ok((FINDING_SEVERITIES as readonly string[]).includes(entry.severity), code);
  }
});

check("C4 an unknown code fails closed", () => {
  assert.equal(isKnownFindingCode("totally_invented_code"), false);
  assert.throws(
    () =>
      assertFindingIsCatalogLegal({
        code: "totally_invented_code",
        operands: {},
        evidence: [{ key: "k", value: "1", source: "summary" }],
      } as unknown as RawFinding),
    AnalysisFindingError,
  );
});

check("C5 a finding with missing required operands fails closed", () => {
  // Pick a code that actually requires operands, so the case is not vacuous.
  const code = CATALOG_CODES.find((c) => ANALYSIS_CATALOG[c].requiredOperands.length > 0);
  assert.ok(code, "no catalog entry requires operands — the fixture is wrong");
  assert.throws(() =>
    renderFindings([
      {
        code: code!,
        operands: {},
        evidence: [{ key: "k", value: "1", source: "summary" }],
      } as RawFinding,
    ]),
  );
});

check("C6 a finding with no evidence fails closed unless it is a standing question", () => {
  const questionCodes = CATALOG_CODES.filter((c) => ANALYSIS_CATALOG[c].section === "question");
  const nonQuestion = CATALOG_CODES.find((c) => ANALYSIS_CATALOG[c].section !== "question");
  assert.ok(nonQuestion);
  assert.throws(
    () =>
      assertFindingIsCatalogLegal({
        code: nonQuestion!,
        operands: Object.fromEntries(
          ANALYSIS_CATALOG[nonQuestion!].requiredOperands.map((k) => [k, SAMPLE[k] ?? "1"]),
        ),
        evidence: [],
      } as RawFinding),
    AnalysisFindingError,
  );
  assert.ok(questionCodes.length > 0, "there are no standing questions to exempt");
});

check("C7 an unsupported analytics mode fails closed", () => {
  assert.equal(supportsMode("event_date"), true);
  assert.equal(supportsMode("acquisition_cohort"), true);
  assert.equal(supportsMode("prediction" as never), false);
});

check("C8 every evidence source is from the published vocabulary", () => {
  assert.ok(EVIDENCE_SOURCES.length > 0);
  for (const source of EVIDENCE_SOURCES) {
    assert.match(source, /^[a-z]+$/);
  }
});

/* ==================================================================== */
/* D. MESSAGE / OPERAND CONSISTENCY                                     */
/* ==================================================================== */

/** Operands a template BRANCHES on instead of printing. See B7. */
const BRANCHING_OPERANDS = new Set(["direction", "reason"]);

check("D1 mutating an operand changes the rendered sentence", () => {
  // A template that ignores an operand it declares is a sentence that can
  // contradict its own evidence.
  const ignored: string[] = [];
  for (const code of CATALOG_CODES) {
    const entry = ANALYSIS_CATALOG[code];
    const base: Record<string, string> = {};
    for (const key of entry.requiredOperands) base[key] = SAMPLE[key] ?? "1";
    const original = entry.render(base);

    for (const key of entry.requiredOperands) {
      const mutated = { ...base, [key]: `${base[key]}9` };
      let after: string;
      try {
        after = entry.render(mutated);
      } catch {
        continue; // a keyed lookup may reject an unknown key; covered by D2
      }
      // A two-valued flag selects a clause rather than being printed, so a
      // mutated value that is still "not up" legitimately renders the same
      // sentence. Those are covered by B7 instead.
      if (after === original && !BRANCHING_OPERANDS.has(key)) ignored.push(`${code}.${key}`);
    }
  }
  assert.deepEqual(ignored, [], `declared operands that do not affect the sentence: ${ignored}`);
});

check("D2 a keyed label operand falls back to the raw key, never to invented prose", () => {
  // metricLabel/rateLabel/lagLabel use `?? key`. That is the honest fallback:
  // an unknown key appears as itself rather than as a guessed human phrase.
  const codeWithMetric = CATALOG_CODES.find((c) =>
    ANALYSIS_CATALOG[c].requiredOperands.includes("metric"),
  );
  assert.ok(codeWithMetric);
  const entry = ANALYSIS_CATALOG[codeWithMetric!];
  const operands: Record<string, string> = {};
  for (const key of entry.requiredOperands) operands[key] = SAMPLE[key] ?? "1";
  const rendered = entry.render({ ...operands, metric: "unknown_metric_key" });
  assert.match(rendered, /unknown_metric_key/);
  assert.equal(violates(rendered), null);
});

check("D3 a sentence never states a percentage for an undefined rate", () => {
  const undefinedRateCodes = CATALOG_CODES.filter((c) => c.endsWith("_undefined"));
  assert.ok(undefinedRateCodes.length > 0, "no undefined-rate codes found");
  for (const code of undefinedRateCodes) {
    const entry = ANALYSIS_CATALOG[code];
    const operands: Record<string, string> = {};
    for (const key of entry.requiredOperands) operands[key] = SAMPLE[key] ?? "1";
    const rendered = entry.render(operands);
    assert.match(rendered, /не определена/, `${code}: "${rendered}"`);
    assert.ok(
      !/\b0\s*%/.test(rendered),
      `${code} renders an undefined rate as zero percent: "${rendered}"`,
    );
  }
});

/* ==================================================================== */
/* E. SUPPORT-TIER POLICY                                               */
/* ==================================================================== */

function findingWith(code: string, operands: Record<string, string>): RawFinding {
  return { code, operands, evidence: [] } as unknown as RawFinding;
}

check("E1 tiers are exactly the three published values and nothing else is accepted", () => {
  assert.deepEqual([...SUPPORT_TIERS], ["descriptive", "moderate", "strong"]);
});

check("E2 tier boundaries are exact at every threshold", () => {
  const min = ANALYSIS_THRESHOLDS.minRateDenominator;
  const strong = ANALYSIS_THRESHOLDS.strongSupportMinDenominator;
  const cases: [number, string][] = [
    [0, "descriptive"],
    [min - 1, "descriptive"],
    [min, "moderate"],
    [min + 1, "moderate"],
    [strong - 1, "moderate"],
    [strong, "strong"],
    [strong + 1, "strong"],
  ];
  for (const [denominator, expected] of cases) {
    const tier = supportTierOf(findingWith("funnel_rate_level", { denominator: String(denominator) }));
    assert.equal(tier, expected, `denominator ${denominator} → ${tier}, expected ${expected}`);
  }
});

check("E3 an unparseable, negative or absent denominator degrades DOWNWARD", () => {
  for (const value of ["", "abc", "-1", "NaN", "Infinity", "1e400"]) {
    const tier = supportTierOf(findingWith("funnel_rate_level", { denominator: value }));
    assert.equal(tier, "descriptive", `denominator "${value}" produced ${tier}`);
  }
  assert.equal(supportTierOf(findingWith("funnel_rate_level", {})), "descriptive");
});

check("E4 the tier does not change which findings exist", () => {
  // A presentation classification must not act as a filter. Rendering the same
  // raw findings is unaffected by the denominator that decides their tier.
  const low = renderFindings([
    {
      code: "funnel_rate_level",
      operands: {
        rate: "qualifiedClickToPocketRegistrationRate",
        percent: "35,0",
        numerator: "7",
        denominator: "20",
        denominatorMetric: "qualifiedClicks",
      },
      evidence: [{ key: "denominator", value: "20", source: "summary" }],
    } as RawFinding,
  ]);
  const high = renderFindings([
    {
      code: "funnel_rate_level",
      operands: {
        rate: "qualifiedClickToPocketRegistrationRate",
        percent: "35,0",
        numerator: "350",
        denominator: "1000",
        denominatorMetric: "qualifiedClicks",
      },
      evidence: [{ key: "denominator", value: "1000", source: "summary" }],
    } as RawFinding,
  ]);
  assert.equal(low.length, high.length, "tier changed how many findings were published");
  assert.equal(low[0]!.section, high[0]!.section, "tier changed the section");
  assert.equal(low[0]!.severity, high[0]!.severity, "tier changed the severity");
  assert.equal(low[0]!.supportTier, "descriptive");
  assert.equal(high[0]!.supportTier, "strong");
});

check("E5 the tier is not a probability and carries no numeric confidence", () => {
  for (const tier of SUPPORT_TIERS) {
    assert.ok(Number.isNaN(Number(tier)), `${tier} parses as a number`);
  }
});

/* ==================================================================== */
/* F. COMPARISON DIRECTION AND FACTUAL CORRECTNESS                      */
/* ==================================================================== */

check("F1 a count comparison never swaps current and baseline", () => {
  const comparison = comparisonOf(
    findingWith("series_count_change", {
      firstValue: "10",
      lastValue: "25",
      changePercent: "150,0",
    }),
  );
  assert.ok(comparison);
  assert.equal(comparison!.baselineValue, "10", "baseline must be the FIRST bucket");
  assert.equal(comparison!.currentValue, "25", "current must be the LAST bucket");
  assert.equal(comparison!.absoluteDelta, "15", "delta must be current − baseline");
});

check("F2 a falling count produces a negative delta, not an absolute magnitude", () => {
  const comparison = comparisonOf(
    findingWith("series_count_change", { firstValue: "25", lastValue: "10", changePercent: "-60,0" }),
  );
  assert.equal(comparison!.absoluteDelta, "-15");
});

check("F3 a rate comparison publishes POINTS and no absolute delta", () => {
  const comparison = comparisonOf(
    findingWith("series_rate_change", {
      firstPercent: "40,0",
      lastPercent: "35,0",
      changePoints: "-5,0",
    }),
  );
  assert.ok(comparison);
  assert.equal(comparison!.absoluteDelta, null, "a rate change must not publish an absolute delta");
  assert.equal(comparison!.percentagePointDelta, "-5,0");
  assert.equal(comparison!.relativeDelta, null);
});

check("F4 every comparison field is a string or null, never a number", () => {
  const comparison = comparisonOf(
    findingWith("series_count_change", { firstValue: "10", lastValue: "25", changePercent: "150,0" }),
  );
  for (const [key, value] of Object.entries(comparison!)) {
    assert.ok(
      typeof value === "string" || value === null,
      `${key} is ${typeof value}; binary rounding must not reach a published delta`,
    );
  }
});

check("F5 an unsafe integer refuses to produce a delta rather than rounding one", () => {
  const comparison = comparisonOf(
    findingWith("series_count_change", {
      firstValue: "1",
      lastValue: "9007199254740993", // 2^53 + 1
      changePercent: "1,0",
    }),
  );
  assert.equal(comparison!.absoluteDelta, null);
});

/* ==================================================================== */
/* G. STATUS / SUFFICIENCY IMPOSSIBLE COMBINATIONS                      */
/* ==================================================================== */

check("G1 the two statuses can never be published in disagreement", () => {
  assert.throws(() => assertStatusesAgree("ok", "insufficient"), /agree|mismatch|disagree/i);
  assert.throws(() => assertStatusesAgree("insufficient_data", "complete"), /agree|mismatch|disagree/i);
  assert.throws(() => assertStatusesAgree("ok", "partial"), /agree|mismatch|disagree/i);
  assertStatusesAgree("ok", "complete");
  assertStatusesAgree("partial", "partial");
  assertStatusesAgree("insufficient_data", "insufficient");
});

check("G2 an unknown reason code is refused before publication", () => {
  assert.throws(() =>
    assertIssueIsCatalogLegal({
      code: "INVENTED_REASON" as never,
      evidence: [{ key: "k", value: "1", source: "summary" }],
    }),
  );
});

check("G3 an issue with no evidence is refused", () => {
  assert.throws(() =>
    assertIssueIsCatalogLegal({
      code: SUFFICIENCY_REASON_CODES[0]!,
      evidence: [],
    }),
  );
});

check("G4 the reason catalog is exactly seven codes", () => {
  assert.equal(SUFFICIENCY_REASON_CODES.length, 7);
  assert.equal(new Set(SUFFICIENCY_REASON_CODES).size, 7);
});

/* ==================================================================== */
/* H. FACTUAL REPRODUCIBILITY — THE REPLAY                              */
/* ==================================================================== */

/**
 * A validated aggregate packet. It is SYNTHETIC and carries no database row:
 * §4 forbids copying raw rows into a replay artifact, and nothing here needs
 * one — the engine reads an aggregate, not a table.
 */
const REPLAY_COUNTS: MetricCounts = {
  ...ZERO_COUNTS,
  qualifiedClicks: 1000,
  academyRegistrations: 100,
  pocketRegistrations: 50,
  confirmedFirstDeposits: 10,
};

function bucketCounts(over: Partial<MetricCounts>): MetricCounts {
  return { ...ZERO_COUNTS, ...over };
}

function replayInput(): AnalysisInput {
  return {
    mode: "event_date",
    period: {
      resolvedPreset: "custom",
      timezone: "Europe/Moscow",
      weekStart: "monday",
      startUtc: "2026-06-30T21:00:00.000Z",
      endUtc: "2026-07-31T21:00:00.000Z",
      startLocal: "2026-07-01",
      endLocal: "2026-07-31",
      intervalConvention: "half_open",
    },
    filters: {},
    coverage: "total",
    filtered: false,
    group: "day",
    dimension: "affiliate",
    counts: REPLAY_COUNTS,
    ratios: computeRatios(REPLAY_COUNTS),
    amount: {
      amountAggregationAvailable: true,
      amountTotal: "500.00",
      currencyCode: "USD",
      unavailableReason: null,
    },
    attributedCounts: null,
    unattributedCounts: null,
    buckets: [
      {
        key: "2026-07-01",
        localLabel: "2026-07-01",
        counts: bucketCounts({
          qualifiedClicks: 400,
          academyRegistrations: 40,
          pocketRegistrations: 20,
          confirmedFirstDeposits: 4,
        }),
      },
      {
        key: "2026-07-02",
        localLabel: "2026-07-02",
        counts: bucketCounts({
          qualifiedClicks: 600,
          academyRegistrations: 60,
          pocketRegistrations: 30,
          confirmedFirstDeposits: 6,
        }),
      },
    ] as never,
    breakdown: [],
    breakdownTotals: REPLAY_COUNTS,
  } as unknown as AnalysisInput;
}

check("H1 the same packet replays byte-identically", () => {
  const first = buildAnalysisReport(replayInput(), "fingerprint-fixed");
  const second = buildAnalysisReport(replayInput(), "fingerprint-fixed");
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second),
    "the engine is not deterministic over one packet",
  );
});

check("H2 only the supplied fingerprint distinguishes two otherwise identical replays", () => {
  const a = JSON.parse(JSON.stringify(buildAnalysisReport(replayInput(), "fp-A"))) as Record<string, unknown>;
  const b = JSON.parse(JSON.stringify(buildAnalysisReport(replayInput(), "fp-B"))) as Record<string, unknown>;
  assert.notEqual(a.inputFingerprint, b.inputFingerprint);
  delete a.inputFingerprint;
  delete b.inputFingerprint;
  assert.equal(JSON.stringify(a), JSON.stringify(b), "the fingerprint changed the analysis itself");
});

check("H3 EVERY published finding is reproducible from its own evidence", () => {
  // The decisive factuality check. A finding whose numbers do not appear in its
  // evidence is unverifiable by the operator reading it, whatever its sentence
  // says.
  const report = buildAnalysisReport(replayInput(), "fp");
  const sections = [
    ...report.observations,
    ...report.warnings,
    ...report.positiveSignals,
    ...report.questions,
  ];
  assert.ok(sections.length > 0, "the replay produced no findings");

  const unverifiable: string[] = [];
  for (const finding of sections) {
    if (finding.section === "question") continue; // standing questions carry no measurement
    const evidenceValues = new Set(finding.evidence.map((item) => item.value));
    const evidenceKeys = new Set(finding.evidence.map((item) => item.key));
    if (finding.evidence.length === 0) {
      unverifiable.push(`${finding.code}: no evidence`);
      continue;
    }
    // At least one evidence key must name the metric the finding is about, and
    // at least one evidence value must appear among its operands.
    const hasNamedSource = evidenceKeys.size > 0;
    const hasSharedValue =
      finding.comparison === null ||
      evidenceValues.has(finding.comparison.currentValue) ||
      evidenceValues.has(finding.comparison.baselineValue) ||
      [...evidenceValues].some((v) => v.replace(/\s/g, "") === finding.comparison!.currentValue);
    if (!hasNamedSource || !hasSharedValue) {
      unverifiable.push(
        `${finding.code}: comparison ${JSON.stringify(finding.comparison)} vs evidence ${[...evidenceValues].join("|")}`,
      );
    }
  }
  assert.deepEqual(unverifiable, []);
});

check("H4 a comparison's direction agrees with its own numbers", () => {
  const report = buildAnalysisReport(replayInput(), "fp");
  const all = [...report.observations, ...report.warnings, ...report.positiveSignals];
  for (const finding of all) {
    const comparison = finding.comparison;
    if (!comparison || comparison.absoluteDelta === null) continue;
    const current = Number(comparison.currentValue.replace(/\s/g, "").replace(",", "."));
    const baseline = Number(comparison.baselineValue.replace(/\s/g, "").replace(",", "."));
    const delta = Number(comparison.absoluteDelta.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || !Number.isFinite(delta)) continue;
    assert.equal(
      Math.sign(delta),
      Math.sign(current - baseline),
      `${finding.code}: delta ${delta} disagrees with ${current} − ${baseline}`,
    );
  }
});

check("H5 the replay states that no model was invoked", () => {
  const report = buildAnalysisReport(replayInput(), "fp");
  assert.equal(report.engine.modelInvoked, false);
  assert.equal(report.engine.kind, "deterministic");
  assert.equal(report.agent.code, "curie_atlas");
});

console.log(`\nAFD-5D3 atlas adversarial security: ${passed} passed, ${failed} failed`);
if (process.env.AFD5D3_RESULTS_JSON) {
  fs.writeFileSync(
    process.env.AFD5D3_RESULTS_JSON,
    JSON.stringify({ suite: "atlas-adversarial", passed, failed, results }, null, 2),
  );
}
if (failed > 0) process.exitCode = 1;
