/**
 * AFD-5D2A — the guard against the CRM deriving analytical meaning again.
 *
 * AFD-5D2 shipped a browser that decided, on its own, whether a report was
 * `partial`. It was disclosed and it was the wrong owner. This suite is what
 * stops it coming back: it reads the feature's own source and fails the build if
 * any of the removed reasoning reappears.
 *
 * WHY A SOURCE SCAN AND NOT ONLY A BEHAVIOUR TEST. A behaviour test proves the
 * UI renders the backend's value for the fixtures it was given. It cannot prove
 * that no code path computes a value for a fixture nobody wrote. The forbidden
 * thing here is a CAPABILITY, so the assertion is about the code rather than
 * about one execution of it.
 *
 * WHAT IS ALLOWED. Formatting, labelling, ordering, showing and hiding. What is
 * forbidden is deciding what a number MEANS.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FEATURE_DIR = path.join(process.cwd(), "src", "features", "curie-atlas");
const CONTRACT = path.join(process.cwd(), "src", "data", "contracts", "api", "curie-atlas.ts");
const CLIENT = path.join(process.cwd(), "src", "application", "api", "curie-atlas-client.ts");
/** The contract is scanned by a stricter, dedicated case — see below. */
const relativeContract = path.relative(process.cwd(), CONTRACT);

/** Every shipped source file of the feature. Tests are excluded deliberately. */
function featureSources(): { file: string; source: string }[] {
  const files = fs
    .readdirSync(FEATURE_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
    .map((name) => path.join(FEATURE_DIR, name));
  return [...files, CONTRACT, CLIENT].map((file) => ({
    file: path.relative(process.cwd(), file),
    source: fs.readFileSync(file, "utf8"),
  }));
}

/** Source with comments stripped, so prose about a rule is not read as the rule. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the CRM derives no analytical meaning", () => {
  it("has no function that derives a result status", () => {
    for (const { file, source } of featureSources()) {
      expect(code(source), `${file} derives a status`).not.toMatch(/deriveResultStatus/);
      expect(code(source), `${file} derives sufficiency`).not.toMatch(
        /deriveSufficiency|computeStatus|inferStatus|resolveStatus/,
      );
    }
  });

  it("never decides `partial` or `insufficient` for itself", () => {
    // The three status strings may appear ONLY as object keys in a lookup table
    // or as a type member — never on the right of an assignment or a return.
    for (const { file, source } of featureSources()) {
      const body = code(source);
      expect(body, `${file} returns a status literal`).not.toMatch(
        /return\s+["'](ok|partial|insufficient_data|complete|insufficient)["']/,
      );
      expect(body, `${file} assigns a status literal`).not.toMatch(
        /\bstatus\s*=\s*["'](ok|partial|insufficient_data)["']/,
      );
    }
  });

  it("never inspects an evidence source to reach a verdict", () => {
    // This is precisely what AFD-5D2 did: `availability`/`integrity` implied
    // `partial`. The sources are still LABELLED, but never branched on.
    for (const { file, source } of featureSources()) {
      const body = code(source);
      expect(body, `${file} branches on an evidence source`).not.toMatch(
        /source\s*===\s*["'](availability|integrity)["']/,
      );
      expect(body, `${file} tests membership of availability sources`).not.toMatch(
        /AVAILABILITY_EVIDENCE_SOURCES/,
      );
      expect(body, `${file} filters findings by evidence source`).not.toMatch(
        /evidence\.(some|filter|every)\s*\(/,
      );
    }
  });

  it("never computes a support tier from a denominator", () => {
    for (const { file, source } of featureSources()) {
      const body = code(source);
      expect(body, `${file} reads a denominator`).not.toMatch(/denominator/i);
      expect(body, `${file} names a support threshold`).not.toMatch(
        /minRateDenominator|strongSupportMinDenominator/,
      );
      expect(body, `${file} returns a tier literal`).not.toMatch(
        /return\s+["'](descriptive|moderate|strong)["']/,
      );
    }
  });

  it("never computes a delta", () => {
    // AFD-5D3 NARROWED THE SCOPE OF THIS SCAN, deliberately and by one file.
    //
    // The contract now VALIDATES that a published delta agrees with the two
    // values it relates — `absoluteDelta === currentValue − baselineValue` — so
    // an internally contradictory comparison is refused. That arithmetic is a
    // CHECK, not a derivation: its only output is accept-or-reject, it never
    // reaches a rendered value, and it exists precisely to stop a bad number
    // being displayed.
    //
    // Presentation code is still scanned exactly as before, and the contract is
    // held to a stricter rule in the case below: its arithmetic must live inside
    // `superRefine` and nowhere else.
    for (const { file, source } of featureSources().filter((entry) => entry.file !== relativeContract)) {
      const body = code(source);
      // No `current − baseline` in any spelling.
      expect(body, `${file} subtracts values`).not.toMatch(
        /(current|last|member)[A-Za-z]*\s*-\s*(baseline|first|aggregate)[A-Za-z]*/i,
      );
      // No percentage arithmetic of any kind.
      expect(body, `${file} multiplies by 100`).not.toMatch(/\*\s*100\b/);
      expect(body, `${file} divides`).not.toMatch(/\)\s*\/\s*\(|\w\s*\/\s*\w+Value\b/);
      expect(body, `${file} calls toFixed`).not.toMatch(/toFixed\(/);
      expect(body, `${file} parses a metric into a number`).not.toMatch(
        /(parseFloat|Number)\(\s*(finding|comparison|evidence|item)\./,
      );
    }
  });

  it("the contract's only arithmetic is inside superRefine, and it renders nothing", () => {
    const source = fs.readFileSync(CONTRACT, "utf8");
    const body = code(source);

    // Every arithmetic use of a comparison value must sit inside the refinement.
    const refineStart = body.indexOf("superRefine");
    expect(refineStart, "the contract has no superRefine to contain its arithmetic").toBeGreaterThan(0);
    const beforeRefine = body.slice(0, refineStart);
    expect(beforeRefine, "arithmetic outside superRefine").not.toMatch(
      /(parseFloat|Number)\(\s*comparison\./,
    );

    // The refinement may only ADD ISSUES. It must never return a value, which is
    // what would turn a check into a derivation.
    const refineBody = body.slice(refineStart);
    expect(refineBody).toMatch(/ctx\.addIssue/);
    expect(refineBody, "the refinement transforms the value").not.toMatch(/\.transform\(/);
    expect(refineBody, "the refinement returns a computed value").not.toMatch(
      /return\s+(Number|parseFloat|String)\(/,
    );

    // And no rendered value is produced anywhere in the contract.
    expect(body, "the contract calls toFixed").not.toMatch(/toFixed\(/);
  });

  it("never treats a missing field as a verdict", () => {
    for (const { file, source } of featureSources()) {
      const body = code(source);
      expect(body, `${file} infers insufficiency from an absent field`).not.toMatch(
        /===\s*undefined\s*\)\s*return\s+["'](insufficient|partial)/,
      );
    }
  });

  it("renders the backend status by reading it", () => {
    const overview = fs.readFileSync(path.join(FEATURE_DIR, "atlas-overview.tsx"), "utf8");
    // The positive assertion, so the suite proves what the UI DOES as well as
    // what it does not: the status comes straight off the report.
    expect(overview).toMatch(/const status = report\.status/);
    expect(overview).toMatch(/report\.dataSufficiency\.status/);
  });

  it("renders the backend support tier by reading it", () => {
    const card = fs.readFileSync(path.join(FEATURE_DIR, "atlas-finding-card.tsx"), "utf8");
    expect(card).toMatch(/finding\.supportTier/);
    expect(card).toMatch(/finding\.comparison/);
  });

  it("keeps the reason-code catalog for LABELLING only, never for validation", () => {
    const contract = fs.readFileSync(CONTRACT, "utf8");
    // `code` must stay a plain string in the schema: an enum would turn a new
    // backend reason into a blank page.
    // AFD-5D3 CLOSED THE VOCABULARY, reversing AFD-5D2A. `code` is now an enum,
    // so an unknown reason is a contract violation rather than a labelling gap,
    // and there is deliberately NO fallback sentence: paraphrasing a limitation
    // this release does not understand would be invented analytical meaning.
    expect(contract).toMatch(/code: atlasReasonCodeSchema/);
    const labels = fs.readFileSync(path.join(FEATURE_DIR, "atlas-labels.ts"), "utf8");
    expect(labels).not.toMatch(/REASON_CODE_FALLBACK/);
    expect(labels).toMatch(/Record<AtlasReasonCode, string>/);
  });
});
