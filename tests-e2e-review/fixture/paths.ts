/**
 * Filesystem and process layout for one MR-1R reviewer fixture run.
 *
 * Every run owns a directory of its own under `<fixtureDir>/runs/<runId>`, so two
 * runs can never observe each other's database, log or manifest. Nothing here is
 * shared with the live DEV runtime: the only paths this module can produce are
 * under the isolated fixture directory.
 */
import path from "node:path";

/** Repository roots the fixture drives. Both are read-only to this suite. */
export const BACKEND_REPO = "/home/ubuntu/workspaces/ata-report-zero-reward-rr1";

/** The rev3 package the operator approved; the source of the 43 field codes. */
export const CURRICULUM_PACKAGE = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";

/** Paths no fixture run may ever write to, whatever the environment says. */
const FORBIDDEN_DB_SUBSTRINGS = ["/runtime/ata-dev", "ata-dev.sqlite", "ata-prod"];

export interface RunPaths {
  runId: string;
  runDir: string;
  databaseFile: string;
  databaseUrl: string;
  manifestFile: string;
  backendLog: string;
}

export function assertIsolatedDatabase(file: string): void {
  const resolved = path.resolve(file);
  for (const forbidden of FORBIDDEN_DB_SUBSTRINGS) {
    if (resolved.includes(forbidden)) {
      throw new Error(
        `refusing fixture database ${resolved}: it resolves into a live runtime path (${forbidden})`,
      );
    }
  }
  if (!resolved.startsWith("/home/ubuntu/workspaces/")) {
    throw new Error(`refusing fixture database ${resolved}: outside the isolated workspace fixture area`);
  }
}

export function runPaths(fixtureDir: string, runId: string): RunPaths {
  const runDir = path.join(fixtureDir, "runs", runId);
  const databaseFile = path.join(runDir, "mr1r.sqlite");
  assertIsolatedDatabase(databaseFile);
  return {
    runId,
    runDir,
    databaseFile,
    databaseUrl: `file:${databaseFile}`,
    manifestFile: path.join(runDir, "manifest.json"),
    backendLog: path.join(runDir, "backend.log"),
  };
}

/** A run id that is unique per process and sorts chronologically. */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `${stamp}-${process.pid}`;
}
