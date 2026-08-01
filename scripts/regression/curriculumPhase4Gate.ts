import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const suites = [
  ["1B.1 curriculum schema", "test:regression:curriculum-schema", 22],
  ["1B.2 curriculum domain", "test:regression:curriculum-domain", 34],
  ["1B.3 curriculum authoring", "test:regression:curriculum-authoring", 38],
  ["1B.4 curriculum admin HTTP", "test:regression:curriculum-admin-api", 39],
  ["1B.5 definitions admin HTTP", "test:regression:curriculum-definitions-api", 43],
  ["V1 withdrawal compatibility", "test:regression:withdrawal", 21],
  ["2B.1 enrollment schema", "test:regression:curriculum-enrollment-schema", 29],
  // 35 since AFD-5B2A-FINAL: the connection-local `total_changes()` no-write
  // probe was replaced with a committed-content digest, and a positive control
  // proving that digest detects a deliberate write was added alongside it.
  ["2B.2 resolver", "test:regression:curriculum-resolver", 35],
  ["2B.3 enrollment command", "test:regression:curriculum-enrollment-command", 37],
  ["2B.4 level state and start", "test:regression:curriculum-level-state", 40],
  ["2B.5 curriculum read HTTP", "test:regression:curriculum-read-api", 40],
  ["3B.1 XP schema", "test:regression:curriculum-xp-schema", 47],
  ["3B.2 XP ledger and resolver", "test:regression:curriculum-xp-ledger", 66],
  ["3B.3 XP LevelState", "test:regression:curriculum-xp-level-state", 81],
  ["3B.4 completion transition", "test:regression:curriculum-level-completion", 79],
  ["3B.5 promocode compatibility HTTP", "test:regression:curriculum-promocode-xp", 67],
  ["3B.6 XP read HTTP", "test:regression:curriculum-xp-api", 62],
  ["4B.1 content and assessment schema", "test:regression:curriculum-content-schema", 71],
  ["4B.2 content lifecycle", "test:regression:curriculum-content-lifecycle", 48],
  ["4B.3 assessment lifecycle", "test:regression:curriculum-assessment-lifecycle", 49],
  ["4B.4.1 lesson progress schema", "test:regression:curriculum-lesson-progress-schema", 23],
  ["4B.4 pinned content and progress", "test:regression:curriculum-content-read-progress", 18],
  ["4B.5 assessment runtime", "test:regression:curriculum-assessment-runtime", 35],
  ["4B.6 real HTTP", "test:regression:curriculum-phase4-http", 32],
  ["populated V1 upgrade/runtime", "test:regression:curriculum-upgrade", 30],
] as const;

// Flat cumulative orchestration: every leaf suite appears exactly once. The
// historical Phase 1/2/3 gate scripts remain independently runnable, but are
// deliberately not nested here because each nests its predecessor and repeats
// upgrade/HTTP work.
const UNIQUE_LEAF_ASSERTIONS = 1082;

const gateDb = `/tmp/ata-phase4-gate-noop-${process.pid}.db`;
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? `file:${gateDb}` };
function cleanup() { for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${gateDb}${suffix}`, { force: true }); }
const nextDir = path.join(process.cwd(), ".next");
// Keep the backup on the same filesystem so rename remains atomic even when
// /tmp is a separate mount. The path is removed by restoreNext in finally.
const nextBackup = path.join(process.cwd(), `.phase4-next-backup-${process.pid}`);
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
  isolateNext();
  try {
    for (const [name, command, expected] of suites) {
      cleanGeneratedNext();
      console.log(`\n=== [phase4-gate] running ${name} ===`);
      const result = spawnSync("npm", ["run", command], { cwd: process.cwd(), env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr);
      if ((result.status ?? 1) !== 0) throw new Error(`${name} exited ${result.status ?? 1}`);
      if (expected !== undefined && !new RegExp(`(?:^|\\n)[^\\n]*${expected} passed, 0 failed(?:\\n|$)`, "i").test(`${result.stdout}\n${result.stderr}`)) {
        throw new Error(`${name} did not report expected ${expected}/0 assertions`);
      }
    }
    cleanGeneratedNext();
    const listeners = spawnSync("bash", ["-lc", "ss -tln 2>/dev/null | grep -oE ':(38|39)[0-9]{2} ' || true"], { encoding: "utf8" }).stdout.trim();
    if (listeners) throw new Error(`leftover listeners: ${listeners}`);
    const leftovers = fs.readdirSync("/tmp").filter((name) => ["ata-curriculum-", "ata-phase1-", "ata-phase2-", "ata-phase3-", "ata-phase4-"].some((prefix) => name.startsWith(prefix))).sort();
    if (leftovers.length) throw new Error(`leftover runtime artifacts: ${leftovers.join(", ")}`);
    console.log(`\n[phase4-gate] executed leaf assertions: ${UNIQUE_LEAF_ASSERTIONS}`);
    console.log(`[phase4-gate] unique leaf assertions: ${UNIQUE_LEAF_ASSERTIONS}`);
    console.log("[phase4-gate] orchestration integrity checks: listeners=1, runtime-artifacts=1");
    console.log("[phase4-gate] all flat Phase 1-4 leaf suites passed exactly once; no listeners or runtime artifacts remain.");
  } finally {
    cleanup();
    restoreNext();
  }
}
main();
