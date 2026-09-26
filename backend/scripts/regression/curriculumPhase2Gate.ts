import { spawnSync } from "node:child_process";
import fs from "node:fs";

// Phase 2 completion gate: strict sequential execution, first-failure exit
// propagation, and final listener/runtime cleanup verification.

const SUITES: Array<{ name: string; command: string }> = [
  { name: "2B.1 enrollment schema", command: "test:regression:curriculum-enrollment-schema" },
  { name: "2B.2 resolver", command: "test:regression:curriculum-resolver" },
  { name: "2B.3 enrollment command", command: "test:regression:curriculum-enrollment-command" },
  { name: "2B.4 level state and start", command: "test:regression:curriculum-level-state" },
  { name: "2B.5 read API", command: "test:regression:curriculum-read-api" },
  { name: "populated V1 upgrade", command: "test:regression:curriculum-upgrade" },
  { name: "Phase 1 cumulative gate", command: "test:regression:curriculum-phase1" },
];

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "file:/tmp/ata-phase2-gate-noop.db",
};

function run(name: string, command: string): number {
  console.log(`\n=== [phase2-gate] running ${name} ===`);
  const result = spawnSync("npm", ["run", command], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\n[phase2-gate] FAILED at ${name} (exit ${result.status ?? "signal"})`);
  }
  return result.status ?? 1;
}

function leftoverTestListeners(): string {
  const result = spawnSync(
    "bash",
    ["-lc", "ss -tln 2>/dev/null | grep -oE ':(38|39)[0-9]{2} ' || true"],
    { encoding: "utf8" },
  );
  return (result.stdout ?? "").trim();
}

function leftoverRuntimeArtifacts(): string[] {
  const prefixes = [
    "ata-curriculum-enrollment-schema-",
    "ata-curriculum-resolver-",
    "ata-curriculum-enrollment-command-",
    "ata-curriculum-level-state-",
    "ata-curriculum-read-api-",
    "ata-curriculum-upgrade-",
  ];
  return fs
    .readdirSync("/tmp")
    .filter((name) => prefixes.some((prefix) => name.startsWith(prefix)))
    .sort();
}

function main() {
  for (const suite of SUITES) {
    const code = run(suite.name, suite.command);
    if (code !== 0) process.exit(code);
  }

  const listeners = leftoverTestListeners();
  if (listeners) {
    console.error(`\n[phase2-gate] leftover test listeners detected: ${listeners}`);
    process.exit(1);
  }

  const artifacts = leftoverRuntimeArtifacts();
  if (artifacts.length > 0) {
    console.error(`\n[phase2-gate] leftover runtime artifacts detected: ${artifacts.join(", ")}`);
    process.exit(1);
  }

  console.log("\n[phase2-gate] all Phase 2 suites passed; no listeners or runtime artifacts remain.");
}

main();
