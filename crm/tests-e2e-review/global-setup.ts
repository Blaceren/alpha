/**
 * Build the MR-1R reviewer fixture from nothing, then start the backend that
 * serves it — once per suite, before any test runs.
 *
 * Playwright forks its workers after this returns, so the run directory published
 * on `process.env` here is what every worker (and every worker RESTARTED after a
 * failure) reads. Nothing about the fixture survives into the next suite.
 */
import fs from "node:fs";
import { startBackend } from "./fixture/backend";
import { newRunId, runPaths } from "./fixture/paths";
import { REPORT_OWNERS } from "./fixture/identities";
import { seedSchema, seedSubmissions } from "./fixture/seed";
import { resolveReviewE2EConfig, RUN_DIR_ENV } from "./support/review-e2e-config";

export default async function globalSetup(): Promise<void> {
  const config = resolveReviewE2EConfig();
  const paths = runPaths(config.fixtureDir, newRunId());

  const started = Date.now();
  process.stdout.write(`[mr1r-fixture] seeding ${paths.databaseFile}\n`);
  const ids = seedSchema(paths, config.password);

  const backend = await startBackend({
    host: config.host,
    port: config.backendPort,
    databaseUrl: paths.databaseUrl,
    envFile: config.envFile,
    logFile: paths.backendLog,
  });
  process.stdout.write(`[mr1r-fixture] backend pid ${backend.pid} on ${backend.origin}\n`);

  try {
    const submissions = await seedSubmissions(paths, backend.origin, config.password, ids.owners);
    const manifest = {
      runId: paths.runId,
      databaseFile: paths.databaseFile,
      backendPid: backend.pid,
      curriculumVersionId: ids.curriculumVersionId,
      l3LevelDefinitionId: ids.l3LevelDefinitionId,
      assignmentVersionId: ids.assignmentVersionId,
      rubricVersionId: ids.rubricVersionId,
      fieldCount: ids.fieldCount,
      criteria: ["r1-process", "r2-risk", "r3-discipline", "r4-evidence", "r5-reflection", "r6-accuracy", "r7-completeness"],
      scale: ["meets", "revise"],
      rejectionReasons: ["missing-evidence", "incomplete-analysis"],
      identities: ids.identities,
      owners: Object.fromEntries(
        REPORT_OWNERS.map((owner) => [
          owner.key,
          { ...submissions[owner.key]!, name: owner.name, email: owner.email, readOnly: owner.readOnly },
        ]),
      ),
      // Flat aliases the journeys read directly.
      ...Object.fromEntries(REPORT_OWNERS.map((owner) => [owner.key, submissions[owner.key]!])),
    };
    fs.writeFileSync(paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    // A half-seeded fixture must not survive to be mistaken for a good one, and a
    // backend serving it must not keep the port.
    await backend.stop();
    if (process.env.MR1R_KEEP_FIXTURE !== "true") fs.rmSync(paths.runDir, { recursive: true, force: true });
    throw error;
  }

  // Read back by global teardown, which runs in a different process.
  fs.writeFileSync(`${paths.runDir}/backend.pid`, String(backend.pid));
  process.env[RUN_DIR_ENV] = paths.runDir;
  process.stdout.write(
    `[mr1r-fixture] ready in ${Math.round((Date.now() - started) / 1000)}s — ${REPORT_OWNERS.length} pending reports\n`,
  );
}
