/**
 * Lifecycle of the isolated MR-1R backend, owned by the test infrastructure.
 *
 * Before RF-1 this process was started by hand and outlived every suite, which is
 * how a reviewer run inherited another run's decisions. Now one process is started
 * per suite against a database this suite created, and stopped when the suite ends.
 *
 * Starting a fresh process also resets the Backend's login rate limiter, which is
 * in-memory: a limiter warmed by a previous suite would otherwise answer 429 where
 * a credential result was expected, and the failure would look like a fixture bug.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import { BACKEND_REPO } from "./paths";

export interface BackendHandle {
  pid: number;
  port: number;
  origin: string;
  stop: () => Promise<void>;
}

/** Environment the fixture backend runs with, read from the operator's isolated env file. */
export function readFixtureEnv(envFile: string): Record<string, string> {
  if (!fs.existsSync(envFile)) {
    throw new Error(
      `fixture backend env not found at ${envFile}. It holds synthetic secrets and lives OUTSIDE the ` +
        `repository on purpose; point MR1R_FIXTURE_ENV at it.`,
    );
  }
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(1000);
    socket.on("connect", () => {
      socket.destroy();
      resolve(false);
    });
    const free = () => {
      socket.destroy();
      resolve(true);
    };
    socket.on("error", free);
    socket.on("timeout", free);
  });
}

async function waitForReady(origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never responded";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/csrf`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`fixture backend did not become ready on ${origin}: ${lastError}`);
}

export interface StartBackendOptions {
  host: string;
  port: number;
  databaseUrl: string;
  envFile: string;
  logFile: string;
}

export async function startBackend(options: StartBackendOptions): Promise<BackendHandle> {
  const { host, port, databaseUrl, envFile, logFile } = options;

  if (!(await portFree(port, host))) {
    throw new Error(
      `${host}:${port} is already in use. A leftover fixture backend from an earlier run would serve a ` +
        `different database and silently invalidate this suite; stop it before running.`,
    );
  }

  const fixtureEnv = readFixtureEnv(envFile);
  const log = fs.openSync(logFile, "a");
  const child = spawn(
    "./node_modules/.bin/next",
    ["dev", "-H", host, "-p", String(port)],
    {
      cwd: BACKEND_REPO,
      // DATABASE_URL is overridden LAST so the run's own database always wins over
      // whatever the shared fixture env file points at.
      env: { ...process.env, ...fixtureEnv, DATABASE_URL: databaseUrl, PORT: String(port) },
      stdio: ["ignore", log, log],
      detached: true,
    },
  );
  child.unref();

  const origin = `http://${host}:${port}`;
  try {
    await waitForReady(origin, 180_000);
  } catch (error) {
    await stopProcess(child, port);
    throw error;
  }

  return {
    pid: child.pid ?? -1,
    port,
    origin,
    stop: () => stopProcess(child, port),
  };
}

async function stopProcess(child: ChildProcess, port: number): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  // `next dev` forks a server child; killing the process GROUP is what actually
  // frees the port. A teardown that leaves a listener behind is the exact failure
  // this phase exists to remove.
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(-pid, signal);
    } catch {
      /* already gone */
    }
    for (let i = 0; i < 20; i += 1) {
      if (await portFree(port, "127.0.0.1")) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}
