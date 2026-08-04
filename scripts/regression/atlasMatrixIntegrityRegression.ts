/**
 * AFD-5D2A — the machine-readable Atlas matrices are CHECKED, not asserted.
 *
 * WHY THIS SUITE EXISTS. This phase shipped two CSV matrices describing the
 * reason-code catalog and the support-tier rules. Both were written by hand, and
 * both were WRONG on first draft:
 *
 *   - the support matrix listed seven finding codes that do not exist;
 *   - it named its threshold columns `below_10` / `10_to_99`, when the published
 *     `minRateDenominator` is 30.
 *
 * A document that describes behaviour and is never executed drifts from it
 * silently, and a reviewer reading a confident table has no way to tell. So the
 * matrices are committed to `config/` as the canonical copies and this suite
 * reads them back and checks every cell against the SOURCE — the runtime
 * catalog, the published thresholds, and the real functions.
 *
 * THE CHECKS ARE BEHAVIOURAL WHERE THEY CAN BE. A tier cell is not compared to
 * a constant; `supportTierOf` is CALLED with the denominator that cell claims to
 * describe, and its answer must match. The CSV is executable documentation.
 *
 * NO PRODUCT CODE IS TOUCHED, no new metric is computed and nothing here runs in
 * a request path.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ANALYSIS_THRESHOLDS, type RawFinding } from "../../src/lib/analysis/analysis-contract";
import { CATALOG_CODES } from "../../src/lib/analysis/analysis-catalog";
import {
  SUFFICIENCY_REASON_CODES,
  UNEMITTED_REASON_CODES,
} from "../../src/lib/analysis/analysis-sufficiency";
import {
  SUPPORT_TIERS,
  supportTierOf,
  comparisonOf,
} from "../../src/lib/analysis/analysis-support";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(error instanceof Error ? error.message : String(error));
  }
}

/* ------------------------------------------------------------- CSV reading */

/**
 * A minimal RFC-4180 reader: enough for quoted fields containing commas, which
 * both matrices use. Deliberately not a dependency — a parser is easier to trust
 * when it is ten lines long and sits beside its only caller.
 */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  assert.ok(header, "the matrix has no header row");
  return rows
    .filter((entry) => entry.some((cell) => cell.trim() !== ""))
    .map((entry) => {
      const record: Record<string, string> = {};
      header!.forEach((column, index) => {
        record[column] = entry[index] ?? "";
      });
      return record;
    });
}

const configDir = path.join(process.cwd(), "config");
const reasonRows = parseCsv(
  fs.readFileSync(path.join(configDir, "atlas-reason-code-matrix.csv"), "utf8"),
);
const supportRows = parseCsv(
  fs.readFileSync(path.join(configDir, "atlas-support-tier-matrix.csv"), "utf8"),
);

function finding(code: string, operands: Record<string, string> = {}): RawFinding {
  return { code, operands, evidence: [] } as unknown as RawFinding;
}

/* ================= A. the reason-code matrix ========================= */

check("A1 the reason matrix lists EXACTLY the published reason codes", () => {
  const documented = reasonRows.map((row) => row.code).sort();
  const published = [...SUFFICIENCY_REASON_CODES].sort();
  // Set equality in both directions: an invented code fails, and so does a
  // published code the matrix forgot — which is the failure a reader cannot see.
  assert.deepEqual(documented, published);
});

check("A2 no reason row is duplicated", () => {
  const seen = new Set<string>();
  for (const row of reasonRows) {
    assert.equal(seen.has(row.code!), false, `duplicate reason row: ${row.code}`);
    seen.add(row.code!);
  }
});

check("A3 the matrix's emitted/unemitted column agrees with the source", () => {
  for (const row of reasonRows) {
    const documentedAsUnemitted = /^NO\b/i.test(row.emitted_by_this_release ?? "");
    const actuallyUnemitted = (UNEMITTED_REASON_CODES as readonly string[]).includes(row.code!);
    assert.equal(
      documentedAsUnemitted,
      actuallyUnemitted,
      `${row.code}: matrix says emitted=${row.emitted_by_this_release}, source says unemitted=${actuallyUnemitted}`,
    );
  }
});

check("A4 every reason row names a mode the analysis actually has", () => {
  for (const row of reasonRows) {
    assert.ok(
      ["both", "event_date", "acquisition_cohort", "none"].includes(row.mode ?? ""),
      `${row.code}: unknown mode "${row.mode}"`,
    );
  }
});

/* ================= B. the support-tier matrix ======================== */

check("B1 the support matrix lists EXACTLY the runtime catalog codes", () => {
  const documented = supportRows.map((row) => row.finding_code).sort();
  const published = [...CATALOG_CODES].sort();
  // This is the check that would have caught the first draft, which contained
  // seven finding codes that had never existed.
  assert.deepEqual(documented, published);
});

check("B2 no support row is duplicated", () => {
  const seen = new Set<string>();
  for (const row of supportRows) {
    assert.equal(seen.has(row.finding_code!), false, `duplicate row: ${row.finding_code}`);
    seen.add(row.finding_code!);
  }
});

check("B3 every documented tier is a published tier", () => {
  for (const row of supportRows) {
    for (const column of ["tier_below_min", "tier_at_min", "tier_at_strong"] as const) {
      assert.ok(
        (SUPPORT_TIERS as readonly string[]).includes(row[column]!),
        `${row.finding_code}.${column}: "${row[column]}" is not a published tier`,
      );
    }
  }
});

check("B4 EVERY tier cell is what supportTierOf actually returns", () => {
  // The thresholds come from the source, so the matrix stays honest if they
  // move — nothing here hardcodes 30 or 100.
  const belowMin = ANALYSIS_THRESHOLDS.minRateDenominator - 1;
  const atMin = ANALYSIS_THRESHOLDS.minRateDenominator;
  const atStrong = ANALYSIS_THRESHOLDS.strongSupportMinDenominator;
  assert.ok(belowMin >= 0 && atMin <= atStrong, "thresholds are not ordered");

  for (const row of supportRows) {
    const operand = row.denominator_operand!;
    const cases = [
      ["tier_below_min", belowMin],
      ["tier_at_min", atMin],
      ["tier_at_strong", atStrong],
    ] as const;

    for (const [column, denominator] of cases) {
      const operands = operand === "(none)" ? {} : { [operand]: String(denominator) };
      const actual = supportTierOf(finding(row.finding_code!, operands));
      assert.equal(
        actual,
        row[column],
        `${row.finding_code} at denominator ${denominator}: matrix says ${row[column]}, supportTierOf says ${actual}`,
      );
    }
  }
});

check("B5 a row with no denominator operand is descriptive even if handed one", () => {
  // Proves the `(none)` cells describe the CODE and not merely an empty fixture:
  // a finding absent from the operand map has no denominator to weigh, and
  // supplying a large one must not promote it.
  for (const row of supportRows.filter((entry) => entry.denominator_operand === "(none)")) {
    const tier = supportTierOf(
      finding(row.finding_code!, {
        denominator: "100000",
        clicks: "100000",
        sampleSize: "100000",
        memberDenominator: "100000",
        pocketRegistrations: "100000",
      }),
    );
    assert.equal(tier, "descriptive", `${row.finding_code} was promoted by a stray operand`);
  }
});

check("B6 EVERY comparison_kind cell is what comparisonOf actually returns", () => {
  // Operands sufficient for each comparison shape, taken from the rules that
  // publish them. A code documented as `none` must produce null even when handed
  // every operand the other kinds use.
  const operandsFor: Record<string, Record<string, string>> = {
    count_change: { firstValue: "10", lastValue: "25", changePercent: "150" },
    rate_change: { firstPercent: "10.0", lastPercent: "15.0", changePoints: "5.0" },
    member_vs_aggregate: {
      memberPercent: "40.0",
      aggregatePercent: "25.0",
      differencePoints: "15.0",
    },
  };
  const everyOperand = Object.assign({}, ...Object.values(operandsFor)) as Record<string, string>;

  for (const row of supportRows) {
    const kind = row.comparison_kind!;
    if (kind === "none") {
      assert.equal(
        comparisonOf(finding(row.finding_code!, everyOperand)),
        null,
        `${row.finding_code} is documented as having no comparison but produced one`,
      );
      continue;
    }
    const comparison = comparisonOf(finding(row.finding_code!, operandsFor[kind] ?? {}));
    assert.ok(comparison, `${row.finding_code}: expected a ${kind} comparison, got null`);
    assert.equal(comparison!.kind, kind);
  }
});

check("B7 the small-sample caveat in the matrix is true of the rule", () => {
  // `small_sample_rate` is documented `below_min_only`: the function is total and
  // would answer `moderate` for a large denominator, but the RULE only ever emits
  // the code below the minimum, so in production it is always descriptive.
  const row = supportRows.find((entry) => entry.finding_code === "small_sample_rate");
  assert.ok(row);
  assert.equal(row!.production_reachable, "below_min_only");
  const rules = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "analysis", "analysis-rules.ts"),
    "utf8",
  );
  // The guard that makes the caveat true, read from the rule source itself.
  assert.match(rules, /denominator >= ANALYSIS_THRESHOLDS\.minRateDenominator\) continue;/);
});

check("B8 production_reachable is a value the matrix defines", () => {
  for (const row of supportRows) {
    assert.ok(
      ["yes", "no", "below_min_only"].includes(row.production_reachable ?? ""),
      `${row.finding_code}: unknown production_reachable "${row.production_reachable}"`,
    );
  }
});

/* ================= C. the two matrices agree with each other ========= */

check("C1 every INTEGRITY_WARNING source named in the support matrix is a real code", () => {
  const codes = new Set(CATALOG_CODES as readonly string[]);
  for (const row of supportRows) {
    const note = row.notes ?? "";
    if (!note.includes("source of")) continue;
    assert.ok(codes.has(row.finding_code!), `${row.finding_code} is not a catalog code`);
    // The reason code the note points at must exist in the published catalog.
    const referenced = /source of ([A-Z_]+)/.exec(note)?.[1];
    if (referenced) {
      assert.ok(
        (SUFFICIENCY_REASON_CODES as readonly string[]).includes(referenced),
        `${row.finding_code} cites "${referenced}", which is not a published reason code`,
      );
    }
  }
});

console.log(`\nAFD-5D2A atlas matrix integrity: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
