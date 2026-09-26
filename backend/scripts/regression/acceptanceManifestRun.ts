/**
 * AFD-5B2A-FINAL — the safe-manifest producer.
 *
 * Runs every runnable suite in the reviewed acceptance manifest, sequentially,
 * each in its own process group with a bounded wait tied to that exact child
 * pid. Writes the summary BEFORE exiting, and exits non-zero whenever any
 * runnable suite fails, is missing, is duplicated, or the producer itself is
 * interrupted.
 *
 * Usage:
 *   npx tsx scripts/regression/acceptanceManifestRun.ts \
 *     --manifest config/acceptance-manifest-afd5b2a.json \
 *     --out /path/to/summary.json \
 *     [--expect-runnable N] [--expect-inventory N] [--log-dir DIR] [--dry-run]
 *
 * Safety: it never signals by name, never uses pkill/pgrep, and never touches a
 * suite classified `forbidden` — a forbidden suite is not even spawnable from
 * here, because only the runnable bucket is iterated.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  assertExpectedTotals,
  parseAssertions,
  summarise,
  validateManifest,
  type AcceptanceManifest,
  type ManifestEntry,
  type SuiteResult,
} from "../../src/lib/testing/acceptanceManifest";
import {
  classifyAll,
  phaseOwned,
  readListeners,
  type ClassifiedListener,
  type OwnershipContext,
} from "../../src/lib/testing/listenerOwnership";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const manifestPath = arg("manifest");
const outPath = arg("out");
const logDir = arg("log-dir");
const dryRun = flag("dry-run");

function die(message: string): never {
  console.error(`acceptance-manifest: ${message}`);
  process.exit(2);
}

if (!manifestPath) die("--manifest is required");
if (!outPath) die("--out is required");

// Bound after the guards above so the nested writers below cannot be reached
// with an undefined path — the summary must always have somewhere to land.
const summaryPath: string = outPath;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as AcceptanceManifest;

// ---------------------------------------------------------------------------
// Configuration failures, before a single suite is spawned.
// ---------------------------------------------------------------------------
const problems = [
  ...validateManifest(manifest),
  ...assertExpectedTotals(manifest, {
    runnable: arg("expect-runnable") === undefined ? undefined : Number(arg("expect-runnable")),
    excluded: arg("expect-excluded") === undefined ? undefined : Number(arg("expect-excluded")),
    forbidden: arg("expect-forbidden") === undefined ? undefined : Number(arg("expect-forbidden")),
    inventory: arg("expect-inventory") === undefined ? undefined : Number(arg("expect-inventory")),
  }),
];

// A runnable suite must actually exist as an npm script, or the sweep would
// count a typo as a product failure.
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
for (const entry of manifest.runnable ?? []) {
  if (pkg.scripts[entry.script] === undefined) {
    problems.push(`runnable suite ${entry.script} is not an npm script in package.json`);
  }
}
// A runnable suite whose required environment is absent is a configuration
// failure, never a product verdict: a missing dependency says nothing about
// whether the code is correct.
for (const entry of manifest.runnable ?? []) {
  for (const key of entry.requiredEnv ?? []) {
    if ((process.env[key] ?? "") === "") {
      problems.push(`runnable suite ${entry.script} requires ${key}, which is not set`);
    }
  }
}

if (problems.length > 0) {
  const summary = {
    schema: "ata.acceptance-manifest-summary/1",
    phase: manifest.phase ?? "unknown",
    verdict: "CONFIGURATION_FAILURE",
    configurationErrors: problems,
    exitCode: 2,
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.error("acceptance-manifest: CONFIGURATION FAILURE");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(2);
}

if (logDir) fs.mkdirSync(logDir, { recursive: true });

// ---------------------------------------------------------------------------
// Interruption. Rule 7: an interrupted producer never reports PASS.
// ---------------------------------------------------------------------------
let interrupted = false;
let interruptSignal: string | null = null;
let currentChildPid: number | null = null;

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    interrupted = true;
    interruptSignal = signal;
    if (currentChildPid !== null && currentChildPid > 0) {
      // Exact process group of the child this producer started. Never a name.
      try { process.kill(-currentChildPid, "SIGTERM"); } catch { /* already gone */ }
    }
  });
}

/**
 * Between suites the producer must hand over a quiet machine, not merely a
 * reaped child: several suites assert as their own teardown check that their
 * port is free, and a socket outlives its process by a moment.
 *
 * The first version of this guard matched a port-number regex over the shared
 * bands. That was wrong, and expensively so: two listeners on port 3400 (IPv4
 * and IPv6) predate the phase entirely, so the guard waited its full bound
 * before every suite and could never be satisfied. **A port number is not
 * ownership evidence.** Ownership now comes from the socket — see
 * `src/lib/testing/listenerOwnership.ts`:
 *
 *   - listeners in the opening baseline are ignored, always;
 *   - only a listener whose owning process descends from THIS producer and
 *     works inside the worktree under test is waited for;
 *   - anything else — external, root-owned, or unattributable — is recorded and
 *     never waited for, and nothing here is ever signalled.
 */
const OPENING_BASELINE = readListeners();
const BASELINE_KEYS = new Set(OPENING_BASELINE.map((listener) => listener.key));
const OWNERSHIP: OwnershipContext = {
  producerPid: process.pid,
  worktreeRoot: process.cwd(),
  producerUid: typeof process.getuid === "function" ? process.getuid() : undefined,
  baselineKeys: BASELINE_KEYS,
};
/** External listeners that appeared during the run: reported, never signalled. */
const externalAppearances = new Map<string, string>();

/** 15 s: long enough for a Next server's socket to close, short enough to notice. */
const SETTLE_BOUND_MS = Number(arg("settle-ms") ?? 15_000);

type SettleResult = { waitedMs: number; leaked: ClassifiedListener[] };

async function settlePhaseOwnedListeners(label: string): Promise<SettleResult> {
  const startedAt = Date.now();
  const deadline = startedAt + SETTLE_BOUND_MS;

  const snapshot = () => classifyAll(readListeners(), OWNERSHIP);
  let classified = snapshot();
  let owned = phaseOwned(classified);
  while (owned.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    classified = snapshot();
    owned = phaseOwned(classified);
  }

  for (const listener of classified) {
    if (listener.classification === "external_new" || listener.classification === "unknown") {
      if (!externalAppearances.has(listener.key)) {
        externalAppearances.set(listener.key, `${listener.family} ${listener.localAddress}:${listener.port} — ${listener.reason}`);
      }
    }
  }

  const waitedMs = Date.now() - startedAt;
  if (owned.length > 0) {
    console.log(
      `      LEAK: ${owned.length} phase-owned listener(s) still bound ${(waitedMs / 1000).toFixed(1)}s after the previous suite, before ${label}: ` +
        owned.map((l) => `${l.family} ${l.localAddress}:${l.port} (pid ${String(l.pid)})`).join(", "),
    );
  } else if (waitedMs > 1000) {
    console.log(`      note: waited ${(waitedMs / 1000).toFixed(1)}s for phase-owned listeners to close before ${label}`);
  }
  return { waitedMs, leaked: owned };
}

function runSuite(entry: ManifestEntry): Promise<SuiteResult> {
  const timeoutMs = entry.timeoutMs ?? manifest.defaultTimeoutMs;
  const startedAt = Date.now();
  return new Promise<SuiteResult>((resolve) => {
    const child = spawn("npm", ["run", "--silent", entry.script], {
      cwd: process.cwd(),
      env: process.env,
      detached: true, // its own process group, so the bound below is exact
      stdio: ["ignore", "pipe", "pipe"],
    });
    currentChildPid = child.pid ?? null;
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => { output += String(chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { output += String(chunk); });

    let timedOut = false;
    // Rule 10: the wait is bounded, and the bound signals exactly this child's
    // process group by pid.
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
        setTimeout(() => {
          try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
        }, 10_000).unref();
      }
    }, timeoutMs);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      currentChildPid = null;
      if (logDir) {
        fs.writeFileSync(path.join(logDir, `${entry.script.replace(/[^a-zA-Z0-9._-]/g, "_")}.log`), output);
      }
      const assertions = parseAssertions(output);
      const outcome = timedOut
        ? "timeout"
        : interrupted && code !== 0
          ? "interrupted"
          : code === 0
            ? "passed"
            : "failed";
      resolve({
        script: entry.script,
        outcome,
        exitCode: code,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
        // A suite that printed no tally is credited with nothing, so a broken
        // suite cannot inflate the assertion total.
        assertionsPassed: assertions?.passed ?? 0,
        assertionsFailed: assertions?.failed ?? (outcome === "passed" ? 0 : 1),
      });
    });
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const results: SuiteResult[] = [];
  // A leaked phase-owned listener fails the manifest; it is never signalled.
  const leakedListeners: ClassifiedListener[] = [];
  const total = manifest.runnable.length;

  console.log(`acceptance-manifest: ${manifest.phase}`);
  console.log(`  runnable ${total}, excluded ${manifest.excluded.length}, forbidden ${manifest.forbidden.length}`);
  console.log(`  producer pid ${process.pid}, started ${startedAt}`);

  for (const [index, entry] of manifest.runnable.entries()) {
    if (interrupted) {
      // Everything after the interruption is honestly reported as not run.
      results.push({
        script: entry.script,
        outcome: "not_run",
        exitCode: null,
        signal: null,
        durationMs: 0,
        assertionsPassed: 0,
        assertionsFailed: 0,
      });
      continue;
    }
    const settle = await settlePhaseOwnedListeners(entry.script);
    if (settle.leaked.length > 0) leakedListeners.push(...settle.leaked);
    process.stdout.write(`  [${String(index + 1).padStart(3)}/${total}] ${entry.script} ... `);
    const result = await runSuite(entry);
    results.push(result);
    console.log(
      `${result.outcome} (exit ${String(result.exitCode)}, ${(result.durationMs / 1000).toFixed(1)}s, ` +
        `${result.assertionsPassed} passed / ${result.assertionsFailed} failed)`,
    );
  }

  const summary = summarise({
    manifest,
    results,
    startedAt,
    finishedAt: new Date().toISOString(),
    interrupted,
    interruptSignal,
  });

  // A leaked phase-owned listener is a real defect and fails the manifest. It is
  // recorded, never signalled — the producer's job is to report, not to clean up
  // after a suite that broke its own teardown contract.
  const listenerReport = {
    settleBoundMs: SETTLE_BOUND_MS,
    openingBaselineCount: OPENING_BASELINE.length,
    openingBaseline: OPENING_BASELINE.map((l) => `${l.family} ${l.localAddress}:${l.port}`),
    leakedPhaseOwned: leakedListeners.map((l) => `${l.family} ${l.localAddress}:${l.port} (pid ${String(l.pid)}) — ${l.reason}`),
    externalAppearances: [...externalAppearances.values()],
  };
  const exitCode = summary.exitCode !== 0 ? summary.exitCode : leakedListeners.length > 0 ? 1 : 0;
  const document = {
    ...summary,
    listeners: listenerReport,
    exitCode,
    verdict: exitCode === 0 ? summary.verdict : summary.verdict === "PASS" ? "FAIL" : summary.verdict,
  };

  // Rule 9: the summary is on disk before the process exits, under every path.
  fs.writeFileSync(summaryPath, `${JSON.stringify(document, null, 2)}\n`);

  console.log("");
  console.log(`  inventory ${summary.inventoryTotal} = runnable ${summary.runnableTotal} + excluded ${summary.excludedTotal} + forbidden ${summary.forbiddenTotal}`);
  console.log(`  executed ${summary.executedTotal}, passed ${summary.passedTotal}, failed ${summary.failedTotal}, skipped ${summary.skippedTotal}`);
  console.log(`  missing ${summary.missingTotal}, duplicate ${summary.duplicateTotal}, forbidden executed ${summary.forbiddenExecuted.length}`);
  console.log(`  assertions ${summary.assertionsPassed} passed, ${summary.assertionsFailed} failed`);
  console.log(`  baseline listeners ignored ${listenerReport.openingBaselineCount}, leaked phase-owned ${listenerReport.leakedPhaseOwned.length}, external appearances ${listenerReport.externalAppearances.length}`);
  if (summary.failed.length > 0) console.log(`  FAILED: ${summary.failed.join(", ")}`);
  if (listenerReport.leakedPhaseOwned.length > 0) console.log(`  LEAKED: ${listenerReport.leakedPhaseOwned.join(", ")}`);
  console.log(`  verdict ${document.verdict}, exit ${exitCode}`);
  process.exit(exitCode);
}

if (dryRun) {
  // Configuration-only mode. Everything above already ran, so reaching here
  // means the manifest is structurally sound and fully provisioned. A dry run
  // deliberately does NOT emit a run summary: it has executed nothing, and a
  // document that says PASS about nothing is exactly the defect being fixed.
  const document = {
    schema: "ata.acceptance-manifest-configuration/1",
    phase: manifest.phase,
    verdict: "CONFIGURATION_OK",
    inventoryTotal: manifest.runnable.length + manifest.excluded.length + manifest.forbidden.length,
    runnableTotal: manifest.runnable.length,
    excludedTotal: manifest.excluded.length,
    forbiddenTotal: manifest.forbidden.length,
    runnable: manifest.runnable.map((entry) => entry.script),
    excluded: manifest.excluded.map((entry) => ({ script: entry.script, reason: entry.reason })),
    forbidden: manifest.forbidden.map((entry) => ({ script: entry.script, reason: entry.reason })),
  };
  fs.writeFileSync(summaryPath, `${JSON.stringify(document, null, 2)}\n`);
  console.log(
    `acceptance-manifest: dry run OK — inventory ${document.inventoryTotal}, runnable ${document.runnableTotal}, ` +
      `excluded ${document.excludedTotal}, forbidden ${document.forbiddenTotal}`,
  );
  process.exit(0);
} else {
  main().catch((error) => {
    const summary = {
      schema: "ata.acceptance-manifest-summary/1",
      phase: manifest.phase,
      verdict: "FAIL",
      producerError: error instanceof Error ? (error.stack ?? error.message) : String(error),
      exitCode: 1,
    };
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.error(error);
    process.exit(1);
  });
}
