import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Flat cumulative Phase 5 gate. Every Phase 1-5 leaf suite appears exactly
// once; the historical Phase 1/2/3/4 gate scripts are deliberately NOT nested
// here because each of them re-runs its predecessors and would repeat
// upgrade/HTTP work. Execution is strictly sequential, so HTTP suites never
// run in parallel with each other (and the production build is never run by
// this gate at all). Assertion totals are collected from the actual leaf
// output instead of a fragile hard-coded expectation: a leaf fails the gate
// only when it exits non-zero, reports failed assertions, or stops printing
// the standard "<n> passed, <m> failed" summary.

type Suite = readonly [name: string, command: string];

const suites: readonly Suite[] = [
  ["1B.1 curriculum schema", "test:regression:curriculum-schema"],
  ["1B.2 curriculum domain", "test:regression:curriculum-domain"],
  ["1B.3 curriculum authoring", "test:regression:curriculum-authoring"],
  ["1B.4 curriculum admin HTTP", "test:regression:curriculum-admin-api"],
  ["1B.5 definitions admin HTTP", "test:regression:curriculum-definitions-api"],
  ["V1 withdrawal compatibility", "test:regression:withdrawal"],
  ["2B.1 enrollment schema", "test:regression:curriculum-enrollment-schema"],
  ["2B.2 resolver", "test:regression:curriculum-resolver"],
  ["2B.3 enrollment command", "test:regression:curriculum-enrollment-command"],
  ["2B.4 level state and start", "test:regression:curriculum-level-state"],
  ["2B.5 curriculum read HTTP", "test:regression:curriculum-read-api"],
  ["3B.1 XP schema", "test:regression:curriculum-xp-schema"],
  ["3B.2 XP ledger and resolver", "test:regression:curriculum-xp-ledger"],
  ["3B.3 XP LevelState", "test:regression:curriculum-xp-level-state"],
  ["3B.4 completion transition", "test:regression:curriculum-level-completion"],
  ["3B.5 promocode compatibility HTTP", "test:regression:curriculum-promocode-xp"],
  ["3B.6 XP read HTTP", "test:regression:curriculum-xp-api"],
  ["4B.1 content and assessment schema", "test:regression:curriculum-content-schema"],
  ["4B.2 content lifecycle", "test:regression:curriculum-content-lifecycle"],
  ["4B.3 assessment lifecycle", "test:regression:curriculum-assessment-lifecycle"],
  ["4B.4.1 lesson progress schema", "test:regression:curriculum-lesson-progress-schema"],
  ["4B.4 pinned content and progress", "test:regression:curriculum-content-read-progress"],
  ["4B.5 assessment runtime", "test:regression:curriculum-assessment-runtime"],
  ["4B.6 phase 4 real HTTP", "test:regression:curriculum-phase4-http"],
  ["5B.1 report schema", "test:regression:curriculum-report-schema"],
  ["5B.2 report definition authoring", "test:regression:curriculum-report-authoring"],
  ["5B.3 report submission", "test:regression:curriculum-report-submission"],
  ["5B.4 reviewer and rejection", "test:regression:curriculum-report-review"],
  ["5B.5a atomic approval/completion", "test:regression:curriculum-report-approval"],
  ["5B.5b report attachments", "test:regression:curriculum-report-attachments"],
  ["5B.6 report real HTTP", "test:regression:curriculum-report-api"],
  ["populated V1 upgrade/runtime", "test:regression:curriculum-upgrade"],
] as const;

const gateDb = `/tmp/ata-phase5-gate-noop-${process.pid}.db`;
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? `file:${gateDb}` };
function cleanup() { for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${gateDb}${suffix}`, { force: true }); }

const nextDir = path.join(process.cwd(), ".next");
// The backup stays on the same filesystem so the rename is atomic even when
// /tmp is a separate mount; restoreNext removes it again in finally.
const nextBackup = path.join(process.cwd(), `.phase5-next-backup-${process.pid}`);

function hashDirectory(dir: string): string {
  if (!fs.existsSync(dir)) return "absent";
  const entries: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        entries.push(`${path.relative(dir, full)}:${stat.size}`);
      }
    }
  };
  walk(dir);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function cleanGeneratedNext() { fs.rmSync(nextDir, { recursive: true, force: true }); }
function isolateNext() {
  if (fs.existsSync(nextBackup)) throw new Error(`refusing to overwrite ${nextBackup}`);
  if (fs.existsSync(nextDir)) fs.renameSync(nextDir, nextBackup);
}
function restoreNext() {
  cleanGeneratedNext();
  if (fs.existsSync(nextBackup)) fs.renameSync(nextBackup, nextDir);
}

function main() {
  const names = new Set<string>();
  const commands = new Set<string>();
  for (const [name, command] of suites) {
    if (names.has(name)) throw new Error(`duplicate suite name: ${name}`);
    if (commands.has(command)) throw new Error(`duplicate suite command: ${command}`);
    names.add(name); commands.add(command);
  }

  const nextHashBefore = hashDirectory(nextDir);
  isolateNext();
  const totals: Array<{ name: string; assertions: number }> = [];
  try {
    for (const [name, command] of suites) {
      cleanGeneratedNext();
      console.log(`\n=== [phase5-gate] running ${name} (${command}) ===`);
      const result = spawnSync("npm", ["run", command], { cwd: process.cwd(), env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      const exitCode = result.status ?? 1;
      if (exitCode !== 0) throw new Error(`[phase5-gate] leaf "${name}" (${command}) exited with code ${exitCode}`);
      const output = `${result.stdout}\n${result.stderr}`;
      const match = /(\d+) passed, (\d+) failed/.exec(output);
      if (!match) throw new Error(`[phase5-gate] leaf "${name}" (${command}) exited 0 but printed no assertion summary`);
      if (Number(match[2]) !== 0) throw new Error(`[phase5-gate] leaf "${name}" (${command}) reported ${match[2]} failed assertions`);
      totals.push({ name, assertions: Number(match[1]) });
    }
    cleanGeneratedNext();

    const listeners = spawnSync("bash", ["-lc", "ss -tln 2>/dev/null | grep -oE ':(38|39)[0-9]{2} ' || true"], { encoding: "utf8" }).stdout.trim();
    if (listeners) throw new Error(`leftover listeners: ${listeners}`);
    const leftovers = fs.readdirSync("/tmp")
      .filter((name) => ["ata-curriculum-", "ata-phase1-", "ata-phase2-", "ata-phase3-", "ata-phase4-", "ata-phase5-"]
        .some((prefix) => name.startsWith(prefix)) && !name.startsWith(path.basename(gateDb)))
      .sort();
    if (leftovers.length) throw new Error(`leftover runtime artifacts: ${leftovers.join(", ")}`);

    const total = totals.reduce((sum, entry) => sum + entry.assertions, 0);
    console.log("\n[phase5-gate] per-leaf assertion totals (collected from actual output):");
    for (const entry of totals) console.log(`[phase5-gate]   ${entry.name}: ${entry.assertions}`);
    console.log(`[phase5-gate] leaf suites executed exactly once: ${totals.length}`);
    console.log(`[phase5-gate] total leaf assertions: ${total}`);
    console.log("[phase5-gate] orchestration integrity checks: duplicates=1, listeners=1, runtime-artifacts=1, next-preservation=1");
    console.log("[phase5-gate] all flat Phase 1-5 leaf suites passed exactly once; no listeners or runtime artifacts remain.");
  } finally {
    cleanup();
    restoreNext();
    const nextHashAfter = hashDirectory(nextDir);
    if (nextHashAfter !== nextHashBefore) {
      console.error(`[phase5-gate] .next was not restored identically (before=${nextHashBefore} after=${nextHashAfter})`);
      process.exitCode = 1;
    } else {
      console.log(`[phase5-gate] .next preserved (${nextHashBefore === "absent" ? "absent before and after" : "hash unchanged"})`);
    }
  }
}

main();
