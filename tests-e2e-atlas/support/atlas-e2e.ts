/**
 * AFD-5D2 — the isolated Curie Atlas integration harness.
 *
 * IT LIVES IN THE CRM REPOSITORY BECAUSE THE BACKEND IS READ-ONLY THIS PHASE.
 * Earlier affiliate phases put their orchestrator in the backend repo; this one
 * cannot, so the harness starts the backend candidate from its own worktree
 * without editing a single file there. Running a program is not modifying it,
 * and the backend worktree is asserted tracked-clean before and after.
 *
 * WHAT IT PROVES THAT A UNIT SUITE CANNOT. That the route exists at the pinned
 * backend candidate and answers through the CRM's own origin; that the proxy
 * allow-list actually forwards it; that the session cookie and the CSRF token
 * survive the hop; that the permission matrix is enforced by the BACKEND rather
 * than by a hidden button; and — the claim this whole phase rests on — that
 * running the analysis creates ZERO rows in the nine Agent Core tables.
 *
 * ISOLATION. Two loopback ports nobody else owns, a throwaway database built
 * from the candidate's own migrations, synthetic staff, an ephemeral session
 * secret. It never touches the runtime database, the deployed services, the live
 * learner or the CRM admin, and it makes no outbound request to any external
 * host.
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** The exact backend candidate this phase is verified against. */
/**
 * AFD-5D2A pins the CONTRACT-CLOSURE backend rather than a fixed commit: this
 * phase changes the backend, so a hard-coded hash would be stale the moment the
 * commit is made. The branch is asserted instead, and the worktree must be
 * tracked-clean at both ends of every run.
 */
export const BACKEND_BRANCH = "audit/atlas-security-afd5d3";
export const BACKEND_DIR = "/home/ubuntu/workspaces/ata-atlas-security-afd5d3";
export const CRM_DIR = "/home/ubuntu/workspaces/ata-suite/crm-atlas-security-afd5d3";

/**
 * Ports owned by live runtimes or external listeners. Binding one would collide
 * with a real service, so the harness refuses to.
 */
const FORBIDDEN_PORTS = new Set([3100, 3010, 3110, 3020, 3050, 3200, 3300, 3400, 5177]);

function pickPort(base: number): number {
  const port = base + (process.pid % 20);
  if (FORBIDDEN_PORTS.has(port)) throw new Error(`port ${port} is reserved by a live runtime`);
  return port;
}

export const backendPort = pickPort(3624);
export const crmPort = pickPort(3664);
export const backendUrl = `http://127.0.0.1:${backendPort}`;
export const crmUrl = `http://127.0.0.1:${crmPort}`;

export const dbPath = `/tmp/ata-afd5d3-e2e-${process.pid}.db`;
export const dbUrl = `file:${dbPath}`;

export const PASSWORD = "CurieAtlasE2E123!";
export const SESSION_SECRET = "afd5d3-isolated-e2e-session-secret-value";
export const ATTRIBUTION_SECRET = "Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MFFXRVJUWXVpb3A9";

/** The nine Agent Core tables. Asserted empty after every analysis. */
export const AGENT_CORE_TABLES = [
  "AgentRun",
  "AgentFinding",
  "AgentEvidenceReference",
  "AgentHandoff",
  "AgentActionProposal",
  "AgentActionDecision",
  "AgentActionExecution",
  "AgentEvaluation",
  "ModelInvocation",
] as const;

/* ------------------------------------------------------------------ process */

export interface Managed {
  child: ChildProcess;
  logs: () => string;
}

const started: Managed[] = [];

/**
 * Spawn a server in its OWN process group.
 *
 * `detached: true` gives the child its own group id, so it can later be stopped
 * with `process.kill(-pid)` — the whole group, including the `next` worker the
 * wrapper forks. Signalling only the wrapper is exactly how AGENT-FOUNDATION-1
 * orphaned a producer, and this harness is written so that cannot happen here.
 */
export function startServer(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Managed {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout?.on("data", (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    logs += String(chunk);
  });
  const managed: Managed = { child, logs: () => logs };
  started.push(managed);
  return managed;
}

/** Stop every server this harness started, by its EXACT process group. */
export function stopAll(): void {
  for (const managed of started.splice(0)) {
    const pid = managed.child.pid;
    if (pid === undefined) continue;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** Wait for a URL to answer, bounded, with a reachable completion condition. */
export async function waitForHttp(url: string, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

/* ---------------------------------------------------------------- database */

export function cleanupDb(): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Build the isolated database from the CANDIDATE's own migrations. */
export function migrate(): void {
  const result = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: BACKEND_DIR, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`migration failed:\n${result.stdout}\n${result.stderr}`);
  }
}

/** Run one SQL statement against the isolated database through sqlite3. */
export function sql(statement: string): string {
  const result = spawnSync("sqlite3", [dbPath, statement], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Count rows, for the Agent Core emptiness assertions. */
export function countRows(table: string): number {
  return Number(sql(`SELECT COUNT(*) FROM "${table}";`));
}

/* ------------------------------------------------------------------ backend */

/**
 * The backend environment, mirroring the accepted AFD-5D1 isolated E2E exactly.
 *
 * `NODE_ENV` is DELETED rather than set: `next dev` refuses to run under
 * `production`, and the value inherited from the parent shell is what makes an
 * otherwise identical harness fail with an unhelpful error.
 *
 * The captcha keys are Cloudflare's official TEST credentials behind the
 * repository's explicit `turnstile_test` marker. They accept any token, contact
 * nothing, and exist so login works in isolation — they are not a real secret
 * and never reach a real Cloudflare endpoint.
 */
const CAPTCHA_TEST_MARKER = "unsafe-official-turnstile-test-keys-isolated-only";
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const MSK = "Europe/Moscow";

export function backendEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // EXPLICITLY development. `next dev` refuses to run under `production`, and
    // the DEV runtime on this host exports NODE_ENV=production, so a harness
    // that merely inherited the parent environment would fail with an error
    // that says nothing about the real cause.
    NODE_ENV: "development",
    DATABASE_URL: dbUrl,
    SESSION_SECRET,
    APP_URL: backendUrl,
    PUBLIC_APP_URL: "https://atlas-e2e.example",
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
    EMAIL_VERIFICATION_REQUIRED: "false",
    AFFILIATE_ATTRIBUTION_ENABLED: "true",
    ATTRIBUTION_TOKEN_SECRET: ATTRIBUTION_SECRET,
    POCKET_POSTBACK_ENABLED: "false",
    ATA_ENVIRONMENT: "dev",
    CAPTCHA_PROVIDER: "turnstile_test",
    CAPTCHA_TEST_MODE: CAPTCHA_TEST_MARKER,
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
    ATA_BUSINESS_TIMEZONE: MSK,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function crmEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "development",
    CRM_MODE: "api",
    CRM_BACKEND_ORIGIN: backendUrl,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export function startBackend(): Managed {
  return startServer(
    "npx",
    ["next", "dev", "--port", String(backendPort), "--hostname", "127.0.0.1"],
    { cwd: BACKEND_DIR, env: backendEnv() },
  );
}

export function startCrm(): Managed {
  return startServer(
    "npx",
    ["next", "dev", "--port", String(crmPort), "--hostname", "127.0.0.1"],
    {
      cwd: CRM_DIR,
      env: crmEnv(),
    },
  );
}

/* -------------------------------------------------------------- assertions */

/** Assert the backend worktree was not modified by running it. */
export function assertBackendUnchanged(): void {
  const branch = spawnSync(
    "git",
    ["-C", BACKEND_DIR, "rev-parse", "--abbrev-ref", "HEAD"],
    { encoding: "utf8" },
  ).stdout.trim();
  if (branch !== BACKEND_BRANCH) {
    throw new Error(`backend branch moved: expected ${BACKEND_BRANCH}, found ${branch}`);
  }
  const status = spawnSync(
    "git",
    ["-C", BACKEND_DIR, "status", "--porcelain", "--untracked-files=no"],
    { encoding: "utf8" },
  ).stdout.trim();
  if (status !== "") {
    throw new Error(`backend worktree is dirty:\n${status}`);
  }
}
