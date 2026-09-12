/**
 * AFD-5B2A-FINAL — the acceptance manifest contract.
 *
 * WHY THIS EXISTS
 * The AFD-5B2A acceptance sweep was an ad-hoc bash loop. It reported "4 failed"
 * and still exited 0, because the loop's exit status was the exit status of the
 * last command rather than a verdict about the run. A manifest that reports
 * failures must never exit zero.
 *
 * This module is the verdict. It is deliberately split from process spawning so
 * that the contract can be tested against a synthetic executor: every rule below
 * is a pure function of a manifest plus a list of results.
 *
 * THE CONTRACT
 *   1. zero non-excluded failures                 -> exit 0
 *   2. one or more non-excluded failures          -> non-zero
 *   3. excluded suites are recorded separately, never as failures
 *   4. a suite may not be both runnable and excluded/forbidden
 *   5. a missing result row                       -> non-zero
 *   6. a duplicate result row                     -> non-zero
 *   7. producer interruption                      -> non-zero
 *   8. impossible expected totals                 -> configuration failure
 *   9. the summary is written before the final exit
 *  10. every waiter is bounded and tied to an exact child pid
 */

export type SuiteClassification =
  | "runnable"
  | "excluded_by_phase_boundary"
  | "excluded_by_environment"
  | "forbidden";

const EXCLUSION_CLASSIFICATIONS: SuiteClassification[] = [
  "excluded_by_phase_boundary",
  "excluded_by_environment",
];

export type ManifestEntry = {
  /** The npm script name, e.g. `test:regression:sql-audit`. */
  script: string;
  /** Why an excluded or forbidden suite carries that classification. */
  reason?: string;
  /** Excluded entries only: which kind of exclusion this is. */
  classification?: SuiteClassification;
  /** Environment variables that must be present before the suite may run. */
  requiredEnv?: string[];
  /** Per-suite bound in milliseconds. Falls back to the manifest default. */
  timeoutMs?: number;
};

export type AcceptanceManifest = {
  schema: "ata.acceptance-manifest/1";
  phase: string;
  defaultTimeoutMs: number;
  runnable: ManifestEntry[];
  excluded: ManifestEntry[];
  forbidden: ManifestEntry[];
};

export type SuiteOutcome = "passed" | "failed" | "timeout" | "interrupted" | "not_run";

export type SuiteResult = {
  script: string;
  outcome: SuiteOutcome;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  assertionsPassed: number;
  assertionsFailed: number;
  /** Set when the runner refused to start the suite (missing required env). */
  configurationError?: string;
};

export type ManifestSummary = {
  schema: "ata.acceptance-manifest-summary/1";
  phase: string;
  startedAt: string;
  finishedAt: string;
  interrupted: boolean;
  interruptSignal: string | null;
  inventoryTotal: number;
  runnableTotal: number;
  excludedTotal: number;
  forbiddenTotal: number;
  executedTotal: number;
  passedTotal: number;
  failedTotal: number;
  skippedTotal: number;
  missingTotal: number;
  duplicateTotal: number;
  assertionsPassed: number;
  assertionsFailed: number;
  configurationErrors: string[];
  missing: string[];
  duplicates: string[];
  failed: string[];
  excluded: Array<{ script: string; reason: string; classification: SuiteClassification }>;
  forbidden: Array<{ script: string; reason: string }>;
  forbiddenExecuted: string[];
  results: SuiteResult[];
  exitCode: number;
  verdict: "PASS" | "FAIL" | "CONFIGURATION_FAILURE";
};

export class ManifestConfigurationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`manifest configuration failure:\n  - ${problems.join("\n  - ")}`);
    this.name = "ManifestConfigurationError";
    this.problems = problems;
  }
}

/**
 * Structural validation. Anything wrong here is a configuration failure, which
 * is reported distinctly from a test failure: a broken manifest tells you
 * nothing about the product, and must never be reported as though it did.
 */
export function validateManifest(manifest: AcceptanceManifest): string[] {
  const problems: string[] = [];

  if (manifest.schema !== "ata.acceptance-manifest/1") {
    problems.push(`unknown manifest schema ${String(manifest.schema)}`);
  }
  if (!Number.isInteger(manifest.defaultTimeoutMs) || manifest.defaultTimeoutMs <= 0) {
    problems.push(`defaultTimeoutMs must be a positive integer, got ${String(manifest.defaultTimeoutMs)}`);
  }

  const buckets: Array<[SuiteClassification, ManifestEntry[]]> = [
    ["runnable", manifest.runnable],
    ["excluded_by_phase_boundary", manifest.excluded],
    ["forbidden", manifest.forbidden],
  ];

  const seen = new Map<string, SuiteClassification>();
  for (const [classification, entries] of buckets) {
    if (!Array.isArray(entries)) {
      problems.push(`${classification} bucket is not a list`);
      continue;
    }
    for (const entry of entries) {
      if (typeof entry?.script !== "string" || entry.script.trim() === "") {
        problems.push(`${classification} bucket contains an entry with no script name`);
        continue;
      }
      const previous = seen.get(entry.script);
      if (previous !== undefined) {
        // Rule 4: a suite cannot be both failed and excluded, which starts by
        // making it impossible for a suite to hold two classifications at once.
        problems.push(
          `${entry.script} appears in both ${previous} and ${classification} — a suite may hold exactly one classification`,
        );
        continue;
      }
      seen.set(entry.script, classification);
      if (classification !== "runnable" && (entry.reason ?? "").trim() === "") {
        problems.push(`${entry.script} is ${classification} but carries no reason`);
      }
      if (classification === "runnable" && entry.classification !== undefined) {
        problems.push(`${entry.script} is runnable but declares classification ${entry.classification}`);
      }
      if (
        classification === "excluded_by_phase_boundary" &&
        entry.classification !== undefined &&
        !EXCLUSION_CLASSIFICATIONS.includes(entry.classification)
      ) {
        problems.push(`${entry.script} declares an exclusion classification that is not an exclusion: ${entry.classification}`);
      }
      if (entry.timeoutMs !== undefined && (!Number.isInteger(entry.timeoutMs) || entry.timeoutMs <= 0)) {
        problems.push(`${entry.script} has a non-positive timeoutMs`);
      }
    }
  }

  if (manifest.runnable.length === 0) {
    problems.push("the runnable bucket is empty — an acceptance sweep that runs nothing proves nothing");
  }

  return problems;
}

/**
 * Rule 8, the other half: the expected total must be *derived* from the
 * reviewed inventory, never carried forward from a previous phase. A caller
 * that asserts a total which the inventory cannot produce gets a configuration
 * failure, not a silently rescaled run.
 */
export function assertExpectedTotals(
  manifest: AcceptanceManifest,
  expected: { runnable?: number; excluded?: number; forbidden?: number; inventory?: number },
): string[] {
  const problems: string[] = [];
  const actual = {
    runnable: manifest.runnable.length,
    excluded: manifest.excluded.length,
    forbidden: manifest.forbidden.length,
    inventory: manifest.runnable.length + manifest.excluded.length + manifest.forbidden.length,
  };
  for (const key of ["runnable", "excluded", "forbidden", "inventory"] as const) {
    const want = expected[key];
    if (want === undefined) continue;
    if (!Number.isInteger(want) || want < 0) {
      problems.push(`expected ${key} total ${String(want)} is impossible`);
      continue;
    }
    if (want !== actual[key]) {
      problems.push(`expected ${key} total ${want} but the reviewed inventory holds ${actual[key]}`);
    }
  }
  return problems;
}

/**
 * The verdict itself. Pure, so the focused tests can drive every branch without
 * spawning a single process.
 */
export function summarise(input: {
  manifest: AcceptanceManifest;
  results: SuiteResult[];
  startedAt: string;
  finishedAt: string;
  interrupted: boolean;
  interruptSignal: string | null;
}): ManifestSummary {
  const { manifest, results } = input;

  const runnableScripts = manifest.runnable.map((entry) => entry.script);
  const runnableSet = new Set(runnableScripts);
  const forbiddenSet = new Set(manifest.forbidden.map((entry) => entry.script));

  const counts = new Map<string, number>();
  for (const result of results) counts.set(result.script, (counts.get(result.script) ?? 0) + 1);

  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([script]) => script).sort();
  const missing = runnableScripts.filter((script) => !counts.has(script)).sort();
  const forbiddenExecuted = [...counts.keys()].filter((script) => forbiddenSet.has(script)).sort();
  const unknown = [...counts.keys()].filter((script) => !runnableSet.has(script) && !forbiddenSet.has(script)).sort();

  // Only runnable rows can decide the verdict. An excluded or forbidden suite
  // that somehow produced a row is reported in its own field, never as a
  // runnable failure.
  const runnableResults = results.filter((result) => runnableSet.has(result.script));
  const failed = runnableResults
    .filter((result) => result.outcome === "failed" || result.outcome === "timeout" || result.outcome === "interrupted")
    .map((result) => result.script)
    .sort();
  const configurationErrors = results
    .filter((result) => result.configurationError !== undefined)
    .map((result) => `${result.script}: ${result.configurationError}`)
    .sort();

  const executedTotal = runnableResults.filter((result) => result.outcome !== "not_run").length;
  const skippedTotal = runnableResults.filter((result) => result.outcome === "not_run").length;

  const assertionsPassed = results.reduce((total, result) => total + result.assertionsPassed, 0);
  const assertionsFailed = results.reduce((total, result) => total + result.assertionsFailed, 0);

  const hardProblems = [
    ...configurationErrors.map((entry) => `configuration: ${entry}`),
    ...unknown.map((script) => `result row for a suite that is in no bucket: ${script}`),
    ...forbiddenExecuted.map((script) => `forbidden suite executed: ${script}`),
  ];

  const verdict: ManifestSummary["verdict"] =
    hardProblems.length > 0
      ? "CONFIGURATION_FAILURE"
      : failed.length === 0 &&
          missing.length === 0 &&
          duplicates.length === 0 &&
          // A sweep that skipped work proves nothing about the work it skipped.
          runnableResults.filter((result) => result.outcome === "not_run").length === 0 &&
          !input.interrupted
        ? "PASS"
        : "FAIL";

  return {
    schema: "ata.acceptance-manifest-summary/1",
    phase: manifest.phase,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    interrupted: input.interrupted,
    interruptSignal: input.interruptSignal,
    inventoryTotal: manifest.runnable.length + manifest.excluded.length + manifest.forbidden.length,
    runnableTotal: manifest.runnable.length,
    excludedTotal: manifest.excluded.length,
    forbiddenTotal: manifest.forbidden.length,
    executedTotal,
    passedTotal: runnableResults.filter((result) => result.outcome === "passed").length,
    failedTotal: failed.length,
    skippedTotal,
    missingTotal: missing.length,
    duplicateTotal: duplicates.length,
    assertionsPassed,
    assertionsFailed,
    configurationErrors: [...configurationErrors, ...unknown.map((s) => `${s}: result row for a suite in no bucket`), ...forbiddenExecuted.map((s) => `${s}: forbidden suite executed`)],
    missing,
    duplicates,
    failed,
    excluded: manifest.excluded.map((entry) => ({
      script: entry.script,
      reason: entry.reason ?? "",
      classification: entry.classification ?? ("excluded_by_phase_boundary" as const),
    })),
    forbidden: manifest.forbidden.map((entry) => ({ script: entry.script, reason: entry.reason ?? "" })),
    forbiddenExecuted,
    results,
    exitCode: verdict === "PASS" ? 0 : 1,
    verdict,
  };
}

/**
 * Suite output parser. Every regression suite in this repository ends with a
 * line of the shape `<name>: N passed, M failed`. A runnable suite whose output
 * carries no such line is not silently credited with zero assertions — the
 * caller decides, and the runner below treats it as a failure when the suite
 * also exited non-zero.
 */
export function parseAssertions(stdout: string): { passed: number; failed: number } | null {
  const matches = [...stdout.matchAll(/(\d+)\s+passed,\s+(\d+)\s+failed/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return { passed: Number(last[1]), failed: Number(last[2]) };
}
