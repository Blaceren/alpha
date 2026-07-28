import { spawnSync } from "node:child_process";
import fs from "node:fs";

// Phase 3 completion gate. Every suite is deliberately sequential; the Next
// HTTP regressions are never run beside another suite or a build.

const SUITES: Array<{
  name: string;
  command: string;
  expectedAssertions?: number;
}> = [
  {
    name: "3B.1 XP schema",
    command: "test:regression:curriculum-xp-schema",
    expectedAssertions: 47,
  },
  {
    name: "3B.2 XP ledger and resolver",
    command: "test:regression:curriculum-xp-ledger",
    expectedAssertions: 66,
  },
  {
    name: "3B.3 XP LevelState",
    command: "test:regression:curriculum-xp-level-state",
    expectedAssertions: 81,
  },
  {
    name: "3B.4 completion transition",
    command: "test:regression:curriculum-level-completion",
    expectedAssertions: 79,
  },
  {
    name: "3B.5 promocode compatibility",
    command: "test:regression:curriculum-promocode-xp",
    expectedAssertions: 67,
  },
  {
    name: "3B.6 XP read API",
    command: "test:regression:curriculum-xp-api",
    expectedAssertions: 62,
  },
  {
    name: "populated upgrade/runtime",
    command: "test:regression:curriculum-upgrade",
    expectedAssertions: 30,
  },
  {
    name: "Phase 2 cumulative gate",
    command: "test:regression:curriculum-phase2",
  },
];

// Phase 2 runs its own upgrade suite, and its nested Phase 1 gate runs upgrade
// once more. These totals make that repetition explicit rather than inflating
// the unique coverage claim.
const PHASE_3_EXECUTED_ASSERTIONS = 867;
const PHASE_3_UNIQUE_ASSERTIONS = 807;

const gateDbPath = `/tmp/ata-phase3-gate-noop-${process.pid}.db`;
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? `file:${gateDbPath}`,
};

function cleanupGateDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${gateDbPath}${suffix}`, { force: true });
  }
}

function run(suite: (typeof SUITES)[number]) {
  console.log(`\n=== [phase3-gate] running ${suite.name} ===`);
  const result = spawnSync("npm", ["run", suite.command], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const code = result.status ?? 1;
  console.log(`=== [phase3-gate] ${suite.name} exit ${code} ===`);
  if (code !== 0) return code;

  if (suite.expectedAssertions !== undefined) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const exact = new RegExp(
      `(?:^|\\n)[^\\n]*${suite.expectedAssertions} passed, 0 failed(?:\\n|$)`,
      "i",
    );
    if (!exact.test(output)) {
      console.error(
        `[phase3-gate] ${suite.name} did not report expected ${suite.expectedAssertions}/0 assertions`,
      );
      return 1;
    }
  }
  return 0;
}

function leftoverTestListeners() {
  const result = spawnSync(
    "bash",
    ["-lc", "ss -tln 2>/dev/null | grep -oE ':(38|39)[0-9]{2} ' || true"],
    { encoding: "utf8" },
  );
  return (result.stdout ?? "").trim();
}

function leftoverRuntimeArtifacts() {
  const prefixes = [
    "ata-curriculum-",
    "ata-phase1-",
    "ata-phase2-",
    "ata-phase3-",
  ];
  return fs
    .readdirSync("/tmp")
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
    .sort();
}

function main() {
  cleanupGateDb();
  for (const suite of SUITES) {
    const code = run(suite);
    if (code !== 0) {
      cleanupGateDb();
      process.exit(code);
    }
  }

  cleanupGateDb();

  const listeners = leftoverTestListeners();
  if (listeners) {
    console.error(`[phase3-gate] leftover test listeners: ${listeners}`);
    process.exit(1);
  }
  const artifacts = leftoverRuntimeArtifacts();
  if (artifacts.length > 0) {
    console.error(`[phase3-gate] leftover runtime artifacts: ${artifacts.join(", ")}`);
    process.exit(1);
  }

  console.log(`\n[phase3-gate] total executed assertions: ${PHASE_3_EXECUTED_ASSERTIONS}`);
  console.log(`[phase3-gate] unique assertions: ${PHASE_3_UNIQUE_ASSERTIONS}`);
  console.log("[phase3-gate] all Phase 3 suites passed; no listeners or runtime artifacts remain.");
}

main();
