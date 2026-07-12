import { spawn, spawnSync } from "node:child_process";

const port = process.env.SMOKE_PORT ?? "3009";
const baseUrl = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${port}`;
const healthUrl = `${baseUrl.replace(/\/$/, "")}/api/health`;
const readinessUrl = `${baseUrl.replace(/\/$/, "")}/api/readiness`;
const isWindows = process.platform === "win32";

function productionSafeValue(value: string | undefined, fallback: string, devFallback: string) {
  return value && value !== devFallback ? value : fallback;
}

function runCommand(command: string, args: string[], options: { detached?: boolean } = {}) {
  const sessionSecret = productionSafeValue(
    process.env.SESSION_SECRET,
    "local-production-smoke-session-secret-32",
    "local-dev-session-secret",
  );
  const postbackSecret = productionSafeValue(
    process.env.POSTBACK_SECRET,
    "local-production-smoke-postback-secret-32",
    "dev-postback-secret",
  );

  return spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SMOKE_BASE_URL: baseUrl,
      SMOKE_ALLOW_REMOTE_SEED: process.env.SMOKE_ALLOW_REMOTE_SEED ?? "false",
      SESSION_SECRET: sessionSecret,
      POSTBACK_SECRET: postbackSecret,
      SMOKE_POSTBACK_SECRET: productionSafeValue(
        process.env.SMOKE_POSTBACK_SECRET,
        postbackSecret,
        "dev-postback-secret",
      ),
      APP_URL: process.env.APP_URL ?? baseUrl,
      STORAGE_DRIVER: process.env.STORAGE_DRIVER ?? "local",
      LOCAL_UPLOADS_DIR: process.env.LOCAL_UPLOADS_DIR ?? "storage/uploads",
    },
    shell: isWindows,
    stdio: options.detached ? ["ignore", "pipe", "pipe"] : "inherit",
    detached: options.detached,
  });
}

async function waitForHealth(timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(healthUrl, { cache: "no-store" });

      if (response.ok) {
        return;
      }

      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Production server health check failed: ${lastError}`);
}

async function waitForReadiness(timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(readinessUrl, { cache: "no-store" });
      const body = await response.text();

      if (response.ok) {
        return;
      }

      lastError = `status ${response.status}: ${body}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Production server readiness check failed: ${lastError}`);
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const server = runCommand("npm", ["run", "start", "--", "--port", port], {
    detached: true,
  });

  server.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForHealth();
    await waitForReadiness();
    const integrationSmoke = runCommand("npm", ["run", "smoke:integration"]);
    const integrationSmokeCode = await waitForExit(integrationSmoke);

    if (integrationSmokeCode !== 0) {
      process.exitCode = integrationSmokeCode;
      return;
    }

    const mvpSmoke = runCommand("npm", ["run", "smoke:mvp"]);
    const mvpSmokeCode = await waitForExit(mvpSmoke);

    if (mvpSmokeCode !== 0) {
      process.exitCode = mvpSmokeCode;
    }
  } finally {
    if (isWindows) {
      spawnSync("taskkill", ["/pid", String(server.pid), "/f", "/t"], {
        shell: true,
        stdio: "ignore",
      });
    } else if (server.pid) {
      process.kill(-server.pid, "SIGTERM");
    }

    server.stdout?.destroy();
    server.stderr?.destroy();
    server.unref();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  process.exit(process.exitCode ?? 0);
});
