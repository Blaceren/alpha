/**
 * AFD-5D2 — the browser-journey orchestrator.
 *
 * ONE PRODUCER. It migrates and seeds the isolated database, starts the pinned
 * backend candidate in its OWN PROCESS GROUP, runs Playwright (which starts the
 * CRM itself), and then stops the backend group recursively.
 *
 * THE BACKEND IS STOPPED BY GROUP, NOT BY NAME. `process.kill(-pid)` reaches the
 * `next` worker the wrapper forks; signalling only the wrapper is precisely how
 * AGENT-FOUNDATION-1 orphaned a producer and spent an hour misattributing the
 * resulting failures.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import {
  BACKEND_BRANCH,
  BACKEND_DIR,
  PASSWORD,
  assertBackendUnchanged,
  backendUrl,
  cleanupDb,
  countRows,
  AGENT_CORE_TABLES,
  dbUrl,
  migrate,
  startBackend,
  stopAll,
  waitForHttp,
} from "./atlas-e2e";

async function main() {
  cleanupDb();
  console.log(`backend candidate ${BACKEND_BRANCH}`);
  assertBackendUnchanged();

  migrate();

  const stagedSeed = `${BACKEND_DIR}/node_modules/.afd5d3-seed.ts`;
  fs.copyFileSync(`${process.cwd()}/tests-e2e-atlas/support/seed.ts`, stagedSeed);
  const seeded = spawnSync("npx", ["tsx", stagedSeed], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl, ATLAS_E2E_PASSWORD: PASSWORD },
    encoding: "utf8",
  });
  fs.rmSync(stagedSeed, { force: true });
  if (seeded.status !== 0) throw new Error(`seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

  const backend = startBackend();
  let status = 1;

  try {
    await waitForHttp(`${backendUrl}/api/crm/v1/session`);

    const result = spawnSync(
      "npx",
      ["playwright", "test", "--config=playwright.atlas.config.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ATLAS_E2E_BACKEND_ORIGIN: backendUrl,
          ATLAS_E2E_PASSWORD: PASSWORD,
        },
        stdio: "inherit",
      },
    );
    status = result.status ?? 1;

    // The claim this phase rests on, re-checked after a whole browser journey.
    for (const table of AGENT_CORE_TABLES) {
      const rows = countRows(table);
      if (rows !== 0) {
        console.error(`FAIL ${table} must stay empty after the journey, found ${rows}`);
        status = 1;
      }
    }
    if (status === 0) console.log("\nzero Agent Core rows after the full browser journey");
  } finally {
    stopAll();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (backend.logs().includes("Error:")) {
      console.error(`--- backend log tail ---\n${backend.logs().slice(-1500)}`);
    }
    assertBackendUnchanged();
    cleanupDb();
  }

  process.exitCode = status;
}

main().catch((error) => {
  console.error(error);
  stopAll();
  cleanupDb();
  process.exitCode = 1;
});
