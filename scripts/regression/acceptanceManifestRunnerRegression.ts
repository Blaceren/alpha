/**
 * AFD-5B2A-FINAL — focused regression for the acceptance-manifest runner.
 *
 * The defect this suite exists to prevent: the AFD-5B2A acceptance sweep
 * reported "83 attempted, 79 passed, 4 failed" and exited **0**. A manifest that
 * reports failures must never exit zero.
 *
 * Part 1 drives the pure verdict function through every branch of the contract.
 * Part 2 spawns the REAL producer against synthetic npm scripts in a temporary
 * directory — including a deliberately failing suite — and asserts the process
 * exit status the harness actually observed. No live service, database, port or
 * account is involved: the synthetic package.json has no dependencies and its
 * "suites" are one-line `node -e` programs.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertExpectedTotals,
  parseAssertions,
  summarise,
  validateManifest,
  type AcceptanceManifest,
  type SuiteOutcome,
  type SuiteResult,
} from "../../src/lib/testing/acceptanceManifest";
import {
  classifyAll,
  classifyListener,
  isDescendantOf,
  parseListeners,
  phaseOwned,
  type Listener,
  type OwnershipContext,
} from "../../src/lib/testing/listenerOwnership";
import { firstLeak, leaksValue } from "../../src/lib/testing/leakDetection";

/**
 * The one suite no acceptance sweep may ever run, named once.
 *
 * It reads the live POSTBACK_SECRET, sends a real callback to the live DEV
 * backend and creates a live account. Every shipped manifest is checked below
 * for it — historical ones included, because there is no phase in which running
 * it becomes acceptable.
 */
const FORBIDDEN_SUITE = "test:regression:pocketcta-disposable-e2e";

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function manifestOf(input: Partial<AcceptanceManifest>): AcceptanceManifest {
  return {
    schema: "ata.acceptance-manifest/1",
    phase: "TEST",
    defaultTimeoutMs: 60_000,
    runnable: [{ script: "a" }, { script: "b" }],
    excluded: [],
    forbidden: [],
    ...input,
  };
}

function resultOf(script: string, outcome: SuiteOutcome, assertions = { passed: 3, failed: 0 }): SuiteResult {
  return {
    script,
    outcome,
    exitCode: outcome === "passed" ? 0 : 1,
    signal: null,
    durationMs: 10,
    assertionsPassed: assertions.passed,
    assertionsFailed: assertions.failed,
  };
}

function run(manifest: AcceptanceManifest, results: SuiteResult[], interrupted = false) {
  return summarise({
    manifest,
    results,
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:10:00.000Z",
    interrupted,
    interruptSignal: interrupted ? "SIGTERM" : null,
  });
}

const RUNNER = path.join(process.cwd(), "scripts", "regression", "acceptanceManifestRun.ts");

/** Spawns the real producer in a throwaway directory of synthetic npm scripts. */
function spawnProducer(input: {
  scripts: Record<string, string>;
  manifest: Partial<AcceptanceManifest>;
  extraArgs?: string[];
  env?: Record<string, string>;
}): { status: number | null; stdout: string; stderr: string; summary: Record<string, unknown> | null; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-manifest-runner-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "synthetic-manifest-fixture", private: true, scripts: input.scripts }, null, 2)}\n`,
  );
  const manifestPath = path.join(dir, "manifest.json");
  const outPath = path.join(dir, "summary.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifestOf(input.manifest), null, 2)}\n`);

  const result = spawnSync(
    "npx",
    ["tsx", RUNNER, "--manifest", manifestPath, "--out", outPath, ...(input.extraArgs ?? [])],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...(input.env ?? {}) },
      timeout: 240_000,
    },
  );
  const summary = fs.existsSync(outPath)
    ? (JSON.parse(fs.readFileSync(outPath, "utf8")) as Record<string, unknown>)
    : null;
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", summary, dir };
}

const scratchDirs: string[] = [];

async function main() {
  // =========================================================== Part 1 — verdict
  await check("1. every runnable suite passing yields PASS and exit 0", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "passed")]);
    assert.equal(summary.verdict, "PASS");
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.passedTotal, 2);
    assert.equal(summary.failedTotal, 0);
    assert.equal(summary.executedTotal, 2);
  });

  await check("2. one runnable failure yields FAIL and a non-zero exit", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "failed", { passed: 2, failed: 1 })]);
    assert.equal(summary.verdict, "FAIL");
    assert.notEqual(summary.exitCode, 0);
    assert.equal(summary.failedTotal, 1);
    assert.deepEqual(summary.failed, ["b"]);
  });

  await check("3. the reported defect is impossible: failures cannot coexist with exit 0", () => {
    // The exact shape the broken sweep produced: 4 failures, exit 0.
    const manifest = manifestOf({ runnable: Array.from({ length: 83 }, (_, i) => ({ script: `s${i}` })) });
    const results = manifest.runnable.map((entry, index) =>
      index < 4 ? resultOf(entry.script, "failed", { passed: 0, failed: 1 }) : resultOf(entry.script, "passed"),
    );
    const summary = run(manifest, results);
    assert.equal(summary.failedTotal, 4);
    assert.equal(summary.passedTotal, 79);
    assert.notEqual(summary.exitCode, 0);
  });

  await check("4. a timeout counts as a runnable failure, not a pass", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "timeout")]);
    assert.equal(summary.failedTotal, 1);
    assert.notEqual(summary.exitCode, 0);
  });

  await check("5. excluded suites are recorded separately and never counted as failures", () => {
    const manifest = manifestOf({
      runnable: [{ script: "a" }],
      excluded: [{ script: "x", reason: "needs a deployed server", classification: "excluded_by_environment" }],
    });
    const summary = run(manifest, [resultOf("a", "passed")]);
    assert.equal(summary.verdict, "PASS");
    assert.equal(summary.excludedTotal, 1);
    assert.equal(summary.failedTotal, 0);
    assert.deepEqual(summary.excluded[0], {
      script: "x",
      reason: "needs a deployed server",
      classification: "excluded_by_environment",
    });
    assert.equal(summary.failed.includes("x"), false);
  });

  await check("6. an excluded suite defaults to excluded_by_phase_boundary", () => {
    const manifest = manifestOf({ runnable: [{ script: "a" }], excluded: [{ script: "x", reason: "three-product suite" }] });
    const summary = run(manifest, [resultOf("a", "passed")]);
    assert.equal(summary.excluded[0].classification, "excluded_by_phase_boundary");
  });

  await check("7. a suite cannot be both runnable and excluded", () => {
    const problems = validateManifest(manifestOf({ runnable: [{ script: "a" }], excluded: [{ script: "a", reason: "r" }] }));
    assert.equal(problems.length >= 1, true);
    assert.match(problems.join("\n"), /appears in both runnable and excluded_by_phase_boundary/);
  });

  await check("8. a suite cannot be both runnable and forbidden", () => {
    const problems = validateManifest(manifestOf({ runnable: [{ script: "a" }], forbidden: [{ script: "a", reason: "r" }] }));
    assert.match(problems.join("\n"), /appears in both runnable and forbidden/);
  });

  await check("9. a missing result row yields a non-zero exit", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed")]);
    assert.equal(summary.missingTotal, 1);
    assert.deepEqual(summary.missing, ["b"]);
    assert.notEqual(summary.exitCode, 0);
    assert.equal(summary.verdict, "FAIL");
  });

  await check("10. a duplicate result row yields a non-zero exit", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("a", "passed"), resultOf("b", "passed")]);
    assert.equal(summary.duplicateTotal, 1);
    assert.deepEqual(summary.duplicates, ["a"]);
    assert.notEqual(summary.exitCode, 0);
  });

  await check("11. producer interruption yields a non-zero exit even when every executed suite passed", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "passed")], true);
    assert.equal(summary.interrupted, true);
    assert.equal(summary.failedTotal, 0);
    assert.notEqual(summary.exitCode, 0);
    assert.equal(summary.verdict, "FAIL");
  });

  await check("12. suites skipped after an interruption are reported as skipped, not passed", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "not_run")], true);
    assert.equal(summary.skippedTotal, 1);
    assert.equal(summary.passedTotal, 1);
    assert.equal(summary.executedTotal, 1);
    assert.notEqual(summary.exitCode, 0);
  });

  await check("13. a skipped suite prevents PASS even without an interruption", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "not_run")]);
    assert.equal(summary.verdict, "FAIL");
    assert.notEqual(summary.exitCode, 0);
  });

  await check("14. an executed forbidden suite is a configuration failure", () => {
    const manifest = manifestOf({ runnable: [{ script: "a" }], forbidden: [{ script: "danger", reason: "touches live" }] });
    const summary = run(manifest, [resultOf("a", "passed"), resultOf("danger", "passed")]);
    assert.equal(summary.verdict, "CONFIGURATION_FAILURE");
    assert.notEqual(summary.exitCode, 0);
    assert.deepEqual(summary.forbiddenExecuted, ["danger"]);
  });

  await check("15. a result row for a suite in no bucket is a configuration failure", () => {
    const summary = run(manifestOf({}), [resultOf("a", "passed"), resultOf("b", "passed"), resultOf("ghost", "passed")]);
    assert.equal(summary.verdict, "CONFIGURATION_FAILURE");
    assert.notEqual(summary.exitCode, 0);
  });

  await check("16. impossible expected totals are a configuration failure", () => {
    assert.equal(assertExpectedTotals(manifestOf({}), { runnable: 83 }).length, 1);
    assert.equal(assertExpectedTotals(manifestOf({}), { runnable: -1 }).length, 1);
    assert.equal(assertExpectedTotals(manifestOf({}), { runnable: 1.5 }).length, 1);
    assert.equal(assertExpectedTotals(manifestOf({}), { runnable: 2, inventory: 2 }).length, 0);
  });

  await check("17. an arbitrary carried-forward total is rejected against the reviewed inventory", () => {
    const problems = assertExpectedTotals(manifestOf({ runnable: [{ script: "a" }] }), { runnable: 83 });
    assert.match(problems.join("\n"), /expected runnable total 83 but the reviewed inventory holds 1/);
  });

  await check("18. an empty runnable bucket is a configuration failure", () => {
    assert.match(validateManifest(manifestOf({ runnable: [] })).join("\n"), /runnable bucket is empty/);
  });

  await check("19. an excluded or forbidden suite with no reason is a configuration failure", () => {
    assert.match(
      validateManifest(manifestOf({ excluded: [{ script: "x" }] })).join("\n"),
      /is excluded_by_phase_boundary but carries no reason/,
    );
    assert.match(
      validateManifest(manifestOf({ forbidden: [{ script: "y" }] })).join("\n"),
      /is forbidden but carries no reason/,
    );
  });

  await check("20. a non-positive timeout is a configuration failure", () => {
    assert.match(validateManifest(manifestOf({ defaultTimeoutMs: 0 })).join("\n"), /defaultTimeoutMs must be a positive integer/);
    assert.match(
      validateManifest(manifestOf({ runnable: [{ script: "a", timeoutMs: -5 }] })).join("\n"),
      /non-positive timeoutMs/,
    );
  });

  await check("21. an unknown schema is a configuration failure", () => {
    const broken = { ...manifestOf({}), schema: "ata.acceptance-manifest/99" } as unknown as AcceptanceManifest;
    assert.match(validateManifest(broken).join("\n"), /unknown manifest schema/);
  });

  await check("22. assertion totals are summed across every result row", () => {
    const summary = run(manifestOf({}), [
      resultOf("a", "passed", { passed: 77, failed: 0 }),
      resultOf("b", "failed", { passed: 40, failed: 3 }),
    ]);
    assert.equal(summary.assertionsPassed, 117);
    assert.equal(summary.assertionsFailed, 3);
  });

  await check("23. the assertion parser takes the final tally and reports absence honestly", () => {
    assert.deepEqual(parseAssertions("noise\nfoo: 3 passed, 1 failed\nbar: 12 passed, 0 failed\n"), { passed: 12, failed: 0 });
    assert.equal(parseAssertions("no tally here"), null);
  });

  // ======================================================== Part 2 — the producer
  await check("24. the real producer exits non-zero for a synthetic FAILING suite", () => {
    const outcome = spawnProducer({
      scripts: {
        "suite:pass": "node -e \"console.log('synthetic pass: 3 passed, 0 failed')\"",
        "suite:fail": "node -e \"console.log('synthetic fail: 2 passed, 1 failed'); process.exit(1)\"",
      },
      manifest: { runnable: [{ script: "suite:pass" }, { script: "suite:fail" }] },
    });
    scratchDirs.push(outcome.dir);
    assert.notEqual(outcome.status, 0, `producer exited ${String(outcome.status)}\n${outcome.stdout}`);
    assert.equal(outcome.status, 1);
    assert.notEqual(outcome.summary, null);
    assert.equal(outcome.summary?.verdict, "FAIL");
    assert.equal(outcome.summary?.failedTotal, 1);
    assert.equal(outcome.summary?.passedTotal, 1);
    assert.deepEqual(outcome.summary?.failed, ["suite:fail"]);
    // Rule 9: the summary reached disk before the producer exited.
    assert.equal(outcome.summary?.exitCode, 1);
  });

  await check("25. the real producer exits 0 when every synthetic suite passes", () => {
    const outcome = spawnProducer({
      scripts: {
        "suite:one": "node -e \"console.log('one: 5 passed, 0 failed')\"",
        "suite:two": "node -e \"console.log('two: 7 passed, 0 failed')\"",
      },
      manifest: { runnable: [{ script: "suite:one" }, { script: "suite:two" }] },
    });
    scratchDirs.push(outcome.dir);
    assert.equal(outcome.status, 0, `producer exited ${String(outcome.status)}\n${outcome.stdout}${outcome.stderr}`);
    assert.equal(outcome.summary?.verdict, "PASS");
    assert.equal(outcome.summary?.passedTotal, 2);
    assert.equal(outcome.summary?.assertionsPassed, 12);
    assert.equal(outcome.summary?.executedTotal, 2);
    assert.equal(outcome.summary?.skippedTotal, 0);
  });

  await check("26. the real producer records excluded and forbidden suites without running them", () => {
    const outcome = spawnProducer({
      scripts: {
        "suite:one": "node -e \"console.log('one: 5 passed, 0 failed')\"",
        "suite:forbidden": "node -e \"require('fs').writeFileSync('FORBIDDEN_RAN','1')\"",
        "suite:excluded": "node -e \"require('fs').writeFileSync('EXCLUDED_RAN','1')\"",
      },
      manifest: {
        runnable: [{ script: "suite:one" }],
        excluded: [{ script: "suite:excluded", reason: "phase boundary", classification: "excluded_by_phase_boundary" }],
        forbidden: [{ script: "suite:forbidden", reason: "would touch live state" }],
      },
    });
    scratchDirs.push(outcome.dir);
    assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
    assert.equal(outcome.summary?.verdict, "PASS");
    assert.equal(outcome.summary?.excludedTotal, 1);
    assert.equal(outcome.summary?.forbiddenTotal, 1);
    assert.deepEqual(outcome.summary?.forbiddenExecuted, []);
    // The proof that neither ran is the absence of the marker files.
    assert.equal(fs.existsSync(path.join(outcome.dir, "FORBIDDEN_RAN")), false);
    assert.equal(fs.existsSync(path.join(outcome.dir, "EXCLUDED_RAN")), false);
  });

  await check("27. a runnable suite that is not an npm script is a configuration failure, exit 2", () => {
    const outcome = spawnProducer({
      scripts: { "suite:one": "node -e \"console.log('one: 1 passed, 0 failed')\"" },
      manifest: { runnable: [{ script: "suite:one" }, { script: "suite:typo" }] },
    });
    scratchDirs.push(outcome.dir);
    assert.equal(outcome.status, 2);
    assert.equal(outcome.summary?.verdict, "CONFIGURATION_FAILURE");
    assert.match(String((outcome.summary?.configurationErrors as string[]).join("\n")), /suite:typo is not an npm script/);
  });

  await check("28. a missing required environment variable is a configuration failure, not a product failure", () => {
    const outcome = spawnProducer({
      scripts: { "suite:needs-env": "node -e \"require('fs').writeFileSync('RAN','1')\"" },
      manifest: { runnable: [{ script: "suite:needs-env", requiredEnv: ["ATA_MANIFEST_FIXTURE_ABSENT"] }] },
    });
    scratchDirs.push(outcome.dir);
    assert.equal(outcome.status, 2);
    assert.equal(outcome.summary?.verdict, "CONFIGURATION_FAILURE");
    assert.match(
      String((outcome.summary?.configurationErrors as string[]).join("\n")),
      /requires ATA_MANIFEST_FIXTURE_ABSENT, which is not set/,
    );
    // The suite was refused, never spawned: a missing dependency says nothing
    // about whether the product is correct.
    assert.equal(fs.existsSync(path.join(outcome.dir, "RAN")), false);
  });

  await check("29. a supplied required environment variable lets the suite run", () => {
    const outcome = spawnProducer({
      scripts: { "suite:needs-env": "node -e \"console.log('env: 1 passed, 0 failed')\"" },
      manifest: { runnable: [{ script: "suite:needs-env", requiredEnv: ["ATA_MANIFEST_FIXTURE_PRESENT"] }] },
      env: { ATA_MANIFEST_FIXTURE_PRESENT: "yes" },
    });
    scratchDirs.push(outcome.dir);
    assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
    assert.equal(outcome.summary?.verdict, "PASS");
  });

  await check("30. an expected total the inventory cannot produce is a configuration failure", () => {
    const outcome = spawnProducer({
      scripts: { "suite:one": "node -e \"console.log('one: 1 passed, 0 failed')\"" },
      manifest: { runnable: [{ script: "suite:one" }] },
      extraArgs: ["--expect-runnable", "83"],
    });
    scratchDirs.push(outcome.dir);
    assert.equal(outcome.status, 2);
    assert.match(
      String((outcome.summary?.configurationErrors as string[]).join("\n")),
      /expected runnable total 83 but the reviewed inventory holds 1/,
    );
  });

  await check("31. a suite that exceeds its bound is killed and counted as a failure", () => {
    const outcome = spawnProducer({
      scripts: {
        // Sleeps far past its bound; the producer must not wait for it.
        "suite:hang": "node -e \"setTimeout(()=>{},600000)\"",
      },
      manifest: { runnable: [{ script: "suite:hang", timeoutMs: 5000 }] },
    });
    scratchDirs.push(outcome.dir);
    assert.notEqual(outcome.status, 0);
    assert.equal(outcome.summary?.verdict, "FAIL");
    const results = outcome.summary?.results as SuiteResult[];
    assert.equal(results[0].outcome, "timeout");
    assert.equal(results[0].durationMs < 120_000, true, `waited ${results[0].durationMs}ms`);
  });

  /**
   * The CURRENT phase's manifest.
   *
   * The full-inventory rule below can only hold for the manifest of the phase
   * being run. A historical manifest is a record of what a PREVIOUS phase
   * reviewed, and every suite added since is legitimately absent from it —
   * pinning the check to an old file would either fail the moment anybody adds
   * a suite (as AFD-5B2B's three did) or force a phase to retro-edit an
   * accepted artifact.
   *
   * IT WAS DISCOVERED BY SORTING FILENAMES AND TAKING THE LAST, AND THAT WAS
   * WRONG. The heuristic assumed alphabetical order tracks chronology, which
   * held only by luck across `afd5b2a` → `afd5b2b` → `afd5d1` → `product-rc1`.
   * AGENT-FOUNDATION-1 broke it: `acceptance-manifest-agent-foundation-af1.json`
   * sorts BEFORE `acceptance-manifest-product-rc1.json`, so the check selected
   * an accepted historical artifact as "current" and failed against it. The
   * alternative — naming manifests so they happen to sort last — would be
   * gaming the check rather than satisfying it, and would break again on the
   * first phase whose name starts with an early letter.
   *
   * So the current manifest is now named EXPLICITLY, in one place, and a phase
   * that ships a manifest updates it in the same commit. This is the same
   * discipline as `EXPECTED_MIGRATION_COUNT`: a value typed by hand so that an
   * unplanned change fails the gate instead of being silently absorbed.
   */
  const CURRENT_ACCEPTANCE_MANIFEST = "acceptance-manifest-atlas-closure-afd5d3.json";

  const manifestFiles = fs
    .readdirSync(path.join(process.cwd(), "config"))
    .filter((name) => /^acceptance-manifest-.+\.json$/.test(name))
    .sort();
  const currentManifestFile = CURRENT_ACCEPTANCE_MANIFEST;

  await check("32a. the named current manifest exists and is one of the shipped ones", () => {
    assert.ok(
      manifestFiles.includes(CURRENT_ACCEPTANCE_MANIFEST),
      `${CURRENT_ACCEPTANCE_MANIFEST} is named as current but is not shipped in config/`,
    );
  });

  await check("32. every shipped acceptance manifest is structurally valid", () => {
    assert.ok(manifestFiles.length > 0, "no acceptance manifest is shipped");
    for (const name of manifestFiles) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "config", name), "utf8"),
      ) as AcceptanceManifest;
      assert.deepEqual(validateManifest(manifest), [], name);
      // The forbidden suite stays forbidden in EVERY manifest, historical ones
      // included: it reads the live POSTBACK_SECRET and hits the live callback,
      // and there is no phase in which running it is acceptable.
      assert.equal(
        manifest.forbidden.some((entry) => entry.script === FORBIDDEN_SUITE),
        true,
        `${name}: ${FORBIDDEN_SUITE} must remain forbidden`,
      );
      assert.equal(
        manifest.runnable.some((entry) => entry.script === FORBIDDEN_SUITE),
        false,
        `${name}: ${FORBIDDEN_SUITE} must never be runnable`,
      );
    }
  });

  await check("32b. the current manifest covers the WHOLE suite inventory", () => {
    const shipped = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "config", currentManifestFile), "utf8"),
    ) as AcceptanceManifest;
    const scripts = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }).scripts;
    const suites = Object.keys(scripts).filter(
      (n) => n.startsWith("test:regression:") || n.startsWith("smoke:"),
    );
    const inventory = [...shipped.runnable, ...shipped.excluded, ...shipped.forbidden].map(
      (entry) => entry.script,
    );
    // Nothing quietly dropped: a suite that exists but is in no bucket has been
    // silently un-run, which is the failure this whole runner exists to prevent.
    assert.deepEqual([...inventory].sort(), [...suites].sort(), currentManifestFile);
  });

  await check("33. an interrupted producer writes its summary and exits non-zero", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-manifest-runner-"));
    scratchDirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      `${JSON.stringify(
        {
          name: "synthetic-manifest-interrupt",
          private: true,
          scripts: {
            "suite:slow": "node -e \"setTimeout(()=>console.log('slow: 1 passed, 0 failed'), 30000)\"",
            "suite:after": "node -e \"require('fs').writeFileSync('AFTER_RAN','1')\"",
          },
        },
        null,
        2,
      )}\n`,
    );
    const manifestPath = path.join(dir, "manifest.json");
    const outPath = path.join(dir, "summary.json");
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifestOf({ runnable: [{ script: "suite:slow" }, { script: "suite:after" }] }), null, 2)}\n`,
    );

    const { spawn } = await import("node:child_process");
    const producer = spawn("npx", ["tsx", RUNNER, "--manifest", manifestPath, "--out", outPath], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let producerOut = "";
    producer.stdout?.on("data", (chunk: Buffer) => { producerOut += String(chunk); });
    producer.stderr?.on("data", (chunk: Buffer) => { producerOut += String(chunk); });
    const exited = new Promise<number | null>((resolve) => producer.on("close", (code) => resolve(code)));

    // The producer prints its own pid. Signal THAT exact pid — not the `npx`
    // wrapper that launched it, and never a process-name match.
    const deadline = Date.now() + 60_000;
    let producerPid = 0;
    while (Date.now() < deadline && producerPid === 0) {
      const match = producerOut.match(/producer pid (\d+)/);
      if (match) producerPid = Number(match[1]);
      else await new Promise((r) => setTimeout(r, 250));
    }
    assert.notEqual(producerPid, 0, `producer never announced its pid\n${producerOut}`);
    // Let it get into the first suite before interrupting.
    await new Promise((r) => setTimeout(r, 4000));
    process.kill(producerPid, "SIGTERM");
    const status = await exited;

    assert.notEqual(status, 0, "an interrupted producer must not exit 0");
    const summary = JSON.parse(fs.readFileSync(outPath, "utf8")) as Record<string, unknown>;
    assert.equal(summary.interrupted, true);
    assert.equal(summary.verdict, "FAIL");
    assert.equal(summary.interruptSignal, "SIGTERM");
    // Work after the interruption is reported as skipped, never as passed.
    assert.equal(summary.skippedTotal, 1);
    assert.equal(fs.existsSync(path.join(dir, "AFTER_RAN")), false);
  });

  // ============================================ Part 3 — listener ownership
  //
  // The defect these exist to prevent: the first port-settle guard matched a
  // port-number regex over shared bands. Two listeners on port 3400 — IPv4 and
  // IPv6 — predate the phase, so the guard waited its full 90 s bound before
  // every one of 84 suites, about two hours of pure waiting, and could never be
  // satisfied. A port number is not ownership evidence.

  const SS_SAMPLE = [
    // The two pre-existing 3400 listeners, exactly as this host reports them:
    // no visible owning process, both stacks, same port, distinct inodes.
    "LISTEN 0      4096         0.0.0.0:3400  0.0.0.0:*    ino:11111 sk:1 cgroup:/ <->",
    "LISTEN 0      4096            [::]:3400     [::]:*     ino:22222 sk:2 cgroup:/ <->",
    // A root-owned listener that is visible but belongs to someone else.
    "LISTEN 0      511          0.0.0.0:3200  0.0.0.0:*    users:((\"other\",pid=999,fd=3)) uid:0 ino:33333 sk:3 <->",
    // A suite server started by this producer.
    "LISTEN 0      511        127.0.0.1:3931  0.0.0.0:*    users:((\"next-server\",pid=4242,fd=21)) uid:1000 ino:44444 sk:4 <->",
  ].join("\n");

  const WORKTREE = "/home/ubuntu/workspaces/candidate";
  function ownershipOf(overrides: Partial<OwnershipContext> = {}): OwnershipContext {
    return {
      producerPid: 100,
      producerUid: 1000,
      worktreeRoot: WORKTREE,
      baselineKeys: new Set<string>(),
      // pid 4242 -> 300 -> 100 (the producer). pid 999 -> 1.
      readStat: (pid) => ({ 4242: 300, 300: 100, 999: 1 })[pid] ?? null,
      readCwd: (pid) => (pid === 4242 ? `${WORKTREE}/sub` : "/somewhere/else"),
      ...overrides,
    };
  }

  await check("34. ss output is parsed into stable per-socket identities", () => {
    const parsed = parseListeners(SS_SAMPLE);
    assert.equal(parsed.length, 4);
    const [v4, v6] = parsed;
    assert.equal(v4.port, 3400);
    assert.equal(v6.port, 3400);
    assert.equal(v4.family, "tcp4");
    assert.equal(v6.family, "tcp6");
    // Same port, two stacks, two distinct sockets — never conflated.
    assert.notEqual(v4.key, v6.key);
    assert.equal(v4.pid, null, "the 3400 listeners expose no owning pid to this user");
    assert.equal(parsed[3].pid, 4242);
    assert.equal(parsed[3].uid, 1000);
  });

  await check("35. a pre-existing listener on port 3400 is baseline and is never waited for", () => {
    const baseline = parseListeners(SS_SAMPLE).filter((l) => l.port === 3400);
    const context = ownershipOf({ baselineKeys: new Set(baseline.map((l) => l.key)) });
    const classified = classifyAll(parseListeners(SS_SAMPLE), context);
    const on3400 = classified.filter((l) => l.port === 3400);
    assert.equal(on3400.length, 2);
    for (const listener of on3400) assert.equal(listener.classification, "opening_baseline");
    // The guard only ever waits for phase-owned listeners.
    assert.equal(phaseOwned(classified).some((l) => l.port === 3400), false);
  });

  await check("36. both the IPv4 and the IPv6 baseline socket on one port are ignored", () => {
    const parsed = parseListeners(SS_SAMPLE);
    const baseline = parsed.filter((l) => l.port === 3400);
    const context = ownershipOf({ baselineKeys: new Set(baseline.map((l) => l.key)) });
    const classes = baseline.map((l) => classifyListener(l, context).classification);
    assert.deepEqual(classes, ["opening_baseline", "opening_baseline"]);
  });

  await check("37. even off-baseline, an unattributable 3400 listener is never phase-owned", () => {
    // The stronger statement: it is not merely excused by the baseline, it can
    // never be claimed as ours, because nothing attributes it to us.
    const context = ownershipOf();
    const classified = classifyAll(parseListeners(SS_SAMPLE), context).filter((l) => l.port === 3400);
    for (const listener of classified) {
      assert.equal(listener.classification, "unknown");
      assert.match(listener.reason, /no owning pid visible/);
    }
    assert.equal(phaseOwned(classified).length, 0);
  });

  await check("38. an unrelated root-owned listener is external and never phase-owned", () => {
    const context = ownershipOf();
    const listener = parseListeners(SS_SAMPLE).find((l) => l.port === 3200) as Listener;
    const classified = classifyListener(listener, context);
    assert.equal(classified.classification, "external_new");
    assert.match(classified.reason, /uid 0/);
    assert.equal(phaseOwned([classified]).length, 0);
  });

  await check("39. a suite server under the producer, inside the worktree, is phase-owned", () => {
    const context = ownershipOf();
    const listener = parseListeners(SS_SAMPLE).find((l) => l.port === 3931) as Listener;
    const classified = classifyListener(listener, context);
    assert.equal(classified.classification, "phase_owned");
    assert.equal(phaseOwned([classified]).length, 1);
  });

  await check("40. a leaked server reparented away from the producer is still phase-owned", () => {
    // A leak is precisely a listener that outlived its suite, so ancestry is
    // gone by the time it matters. The worktree cwd is what still identifies it.
    const context = ownershipOf({ readStat: (pid) => (pid === 4242 ? 1 : null) });
    const listener = parseListeners(SS_SAMPLE).find((l) => l.port === 3931) as Listener;
    const classified = classifyListener(listener, context);
    assert.equal(classified.classification, "phase_owned");
    assert.match(classified.reason, /leaked it and it was reparented/);
  });

  await check("41. a new external listener is recorded, not claimed and not waited for", () => {
    const context = ownershipOf();
    const newcomer = parseListeners(
      'LISTEN 0 511 127.0.0.1:4999 0.0.0.0:* users:(("other",pid=999,fd=9)) uid:1000 ino:55555 sk:9 <->',
    )[0];
    const classified = classifyListener(newcomer, context);
    assert.equal(classified.classification, "external_new");
    assert.equal(phaseOwned([classified]).length, 0);
  });

  await check("42. process ancestry is computed by exact pid, and is bounded", () => {
    const chain: Record<number, number> = { 50: 40, 40: 30, 30: 20, 20: 10, 10: 1 };
    assert.equal(isDescendantOf(50, 20, (pid) => chain[pid] ?? null), true);
    assert.equal(isDescendantOf(50, 99, (pid) => chain[pid] ?? null), false);
    // A cycle must terminate rather than hang.
    assert.equal(isDescendantOf(7, 99, (pid) => (pid === 7 ? 8 : 7)), false);
  });

  await check("43. the opening baseline is immutable for the life of one manifest run", () => {
    const baselineKeys = new Set(parseListeners(SS_SAMPLE).filter((l) => l.port === 3400).map((l) => l.key));
    const context = ownershipOf({ baselineKeys });
    const before = [...baselineKeys].sort();
    // Classifying repeatedly, including listeners that appear later, must not
    // add to or remove from the baseline.
    classifyAll(parseListeners(SS_SAMPLE), context);
    classifyAll(
      parseListeners('LISTEN 0 511 127.0.0.1:4999 0.0.0.0:* users:(("x",pid=999,fd=9)) uid:1000 ino:55555 sk:9 <->'),
      context,
    );
    assert.deepEqual([...context.baselineKeys].sort(), before);
    assert.deepEqual([...baselineKeys].sort(), before);
  });

  await check("44. baseline port test: a pre-existing listener costs the producer no settle time", async () => {
    // A real listener, held open for the whole run, on a port the old regex
    // guard would have waited 90 s for. It is started BEFORE the producer, so it
    // is in the opening baseline, and it must still be alive afterwards.
    const net = await import("node:net");
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(3457, "127.0.0.1", () => resolve()));
    try {
      const startedAt = Date.now();
      const outcome = spawnProducer({
        scripts: {
          "suite:a": "node -e \"console.log('a: 1 passed, 0 failed')\"",
          "suite:b": "node -e \"console.log('b: 1 passed, 0 failed')\"",
        },
        manifest: { runnable: [{ script: "suite:a" }, { script: "suite:b" }] },
      });
      scratchDirs.push(outcome.dir);
      const elapsedMs = Date.now() - startedAt;
      assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
      // Two trivial suites. The old guard would have spent 180 s here.
      assert.equal(elapsedMs < 60_000, true, `producer took ${elapsedMs}ms with a baseline listener held open`);
      assert.doesNotMatch(outcome.stdout, /waited .* for phase-owned listeners/);
      // Never signalled: still listening.
      assert.equal(server.listening, true, "the baseline listener must not have been touched");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await check("45. positive control: a deliberately leaked phase-owned listener fails the manifest", async () => {
    const outcome = spawnProducer({
      scripts: {
        // Binds a port and detaches a child that keeps holding it after the
        // suite exits — a real leak, in a disposable directory.
        "suite:leak":
          "node -e \"const{spawn}=require('child_process');const c=spawn(process.execPath,['-e'," +
          "\\\"require('net').createServer().listen(3458,'127.0.0.1');setTimeout(()=>process.exit(0),30000)\\\"]," +
          "{detached:true,stdio:'ignore'});c.unref();setTimeout(()=>console.log('leak: 1 passed, 0 failed'),1500)\"",
        "suite:after": "node -e \"console.log('after: 1 passed, 0 failed')\"",
      },
      manifest: { runnable: [{ script: "suite:leak" }, { script: "suite:after" }] },
      extraArgs: ["--settle-ms", "3000"],
    });
    scratchDirs.push(outcome.dir);
    // Both suites pass on their own; the manifest still fails, because a suite
    // left a listener behind.
    assert.notEqual(outcome.status, 0, `producer exited ${String(outcome.status)}\n${outcome.stdout}`);
    assert.match(outcome.stdout, /LEAK: 1 phase-owned listener/);
    const listeners = (outcome.summary?.listeners ?? {}) as { leakedPhaseOwned?: string[] };
    assert.equal((listeners.leakedPhaseOwned ?? []).length >= 1, true);
    assert.match((listeners.leakedPhaseOwned ?? []).join(" "), /:3458/);
    // The producer reports; it does not clean up after the suite. The leaked
    // process ends itself, by its own 30 s timer.
    assert.equal(outcome.summary?.verdict, "FAIL");
  });

  // ============================================== Part 4 — leak detection
  //
  // The redaction assertions in the Pocket suites searched a JSON dump with a
  // raw substring match. A run failed with `http_500 leaked 260` because the
  // random correlation handle was `pp-8bfefe8f-2609-…`. These prove the
  // replacement still detects a real leak — that is the whole point of the
  // change being safe.

  await check("46. positive control: a genuinely leaked value is still detected", () => {
    // Every shape a leak actually takes in JSON.
    assert.equal(leaksValue('{"amount":260}', "260"), true, "bare number value");
    assert.equal(leaksValue('{"amount":"260"}', "260"), true, "quoted string value");
    assert.equal(leaksValue('{"a":1,"amount":260,"b":2}', "260"), true, "mid-object value");
    assert.equal(leaksValue("balance was 260 at the time", "260"), true, "prose");
    assert.equal(leaksValue('{"list":[260]}', "260"), true, "array element");
    assert.equal(leaksValue('{"secret":"pocket-ps1-synthetic-secret-value"}', "pocket-ps1-synthetic-secret-value"), true);
    assert.equal(leaksValue('{"clickId":"tq-ps1-known-click"}', "tq-ps1-known-click"), true);
    assert.equal(
      firstLeak('{"a":"x","amount":260}', ["nothing-here", "260"]),
      "260",
      "firstLeak reports which value leaked",
    );
  });

  await check("47. a random identifier that merely contains the digits is not a leak", () => {
    // The exact false positive that failed a manifest run.
    const serialised =
      '{"outcome":{"kind":"unavailable","reason":"provider_maintenance"},' +
      '"providerRequestId":"pp-8bfefe8f-2609-47f9-8425-eb631f37be89",' +
      '"observedAt":"2026-08-01T20:23:19.051Z"}';
    assert.equal(serialised.includes("260"), true, "the old substring check would have failed here");
    assert.equal(leaksValue(serialised, "260"), false, "but nothing leaked");

    // Other identifier shapes that must not trip it.
    assert.equal(leaksValue('{"id":"cm260abc123"}', "260"), false, "inside a cuid");
    assert.equal(leaksValue('{"at":"2026-08-01T02:60:00.000Z"}', "260"), false, "inside a timestamp");
    assert.equal(leaksValue('{"amount":"1260.00"}', "260"), false, "inside a larger amount");
    assert.equal(leaksValue('{"amount":"260.50"}', "260"), false, "a different amount is not this one");
    assert.equal(firstLeak(serialised, ["260", "999"]), null);
  });

  await check("48. values too short to be evidence are never treated as leaks", () => {
    assert.equal(leaksValue('{"x":"5"}', "5"), false, "a single character matches almost anything");
    assert.equal(leaksValue("anything", ""), false);
    assert.equal(leaksValue("anything", null), false);
    assert.equal(leaksValue("anything", undefined), false);
  });

  await check("49. regex metacharacters in a value are matched literally", () => {
    assert.equal(leaksValue('{"v":"a.c"}', "a.c"), true);
    assert.equal(leaksValue('{"v":"abc"}', "a.c"), false, "the dot must not act as a wildcard");
  });

  await check("50. the runner leaves no scratch directory behind", () => {
    for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
    for (const dir of scratchDirs) assert.equal(fs.existsSync(dir), false);
  });
}

main()
  .then(() => {
    console.log(`\nacceptance manifest runner regression: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
    console.error(error);
    console.log(`\nacceptance manifest runner regression: ${passed} passed, ${failed + 1} failed`);
    process.exit(1);
  });
