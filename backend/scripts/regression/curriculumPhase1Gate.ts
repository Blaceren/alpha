import { spawnSync } from "node:child_process";
import path from "node:path";

// Phase 1 completion gate: runs every curriculum regression suite strictly
// sequentially (never in parallel, and never alongside a build), stopping at
// the first failure and propagating its exit code. Finishes by asserting no
// test dev-server listener was left behind. Prints no secrets.

const SUITES: Array<{ name: string; script: string }> = [
  { name: "curriculum-schema", script: "curriculumSchemaRegression.ts" },
  { name: "curriculum-domain", script: "curriculumDomainRegression.ts" },
  { name: "curriculum-authoring", script: "curriculumAuthoringRegression.ts" },
  { name: "curriculum-upgrade", script: "curriculumUpgradeCompatibilityRegression.ts" },
  { name: "curriculum-admin-api", script: "curriculumAdminApiRegression.ts" },
  { name: "curriculum-definitions-api", script: "curriculumDefinitionsAdminApiRegression.ts" },
  // Financial compatibility guard: withdrawal semantics must stay intact.
  { name: "withdrawal", script: "withdrawalSemanticsRegression.ts" },
];

// Harmless placeholder so any @/lib/prisma import constructs without throwing;
// every DB-backed suite overrides DATABASE_URL with its own throwaway temp DB.
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "file:/tmp/ata-phase1-gate-noop.db",
};

function run(name: string, script: string): number {
  console.log(`\n=== [phase1-gate] running ${name} ===`);
  const result = spawnSync("npx", ["tsx", path.join("scripts", "regression", script)], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\n[phase1-gate] FAILED at ${name} (exit ${result.status ?? "signal"})`);
  }
  return result.status ?? 1;
}

function leftoverTestListeners(): string {
  const result = spawnSync("bash", ["-lc", "ss -tln 2>/dev/null | grep -oE ':(38|39)[0-9]{2} ' || true"], {
    encoding: "utf8",
  });
  return (result.stdout ?? "").trim();
}

function main() {
  for (const suite of SUITES) {
    const code = run(suite.name, suite.script);
    if (code !== 0) process.exit(code);
  }

  const leftover = leftoverTestListeners();
  if (leftover) {
    console.error(`\n[phase1-gate] leftover test listeners detected: ${leftover}`);
    process.exit(1);
  }

  console.log("\n[phase1-gate] all curriculum Phase 1 suites passed; no leftover listeners.");
}

main();
