/**
 * Stop the fixture backend and dispose of the run's database.
 *
 * Teardown owns the two things that used to leak: a listener on the fixture port,
 * and a database carrying this run's decisions into the next one. The run
 * directory is removed unless MR1R_KEEP_FIXTURE is set, which is how a failing run
 * is investigated without keeping the fixture alive by default.
 */
import fs from "node:fs";
import net from "node:net";
import { resolveReviewE2EConfig, RUN_DIR_ENV } from "./support/review-e2e-config";

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

export default async function globalTeardown(): Promise<void> {
  const runDir = process.env[RUN_DIR_ENV];
  if (!runDir || !fs.existsSync(runDir)) return;
  const config = resolveReviewE2EConfig();

  const pidFile = `${runDir}/backend.pid`;
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    for (const signal of ["SIGTERM", "SIGKILL"] as const) {
      if (await portFree(config.backendPort, config.host)) break;
      try {
        process.kill(-pid, signal);
      } catch {
        /* already gone */
      }
      for (let i = 0; i < 20; i += 1) {
        if (await portFree(config.backendPort, config.host)) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  if (!(await portFree(config.backendPort, config.host))) {
    throw new Error(
      `fixture backend is still listening on ${config.host}:${config.backendPort} after teardown`,
    );
  }

  if (process.env.MR1R_KEEP_FIXTURE === "true") {
    process.stdout.write(`[mr1r-fixture] kept for inspection: ${runDir}\n`);
    return;
  }
  fs.rmSync(runDir, { recursive: true, force: true });
  process.stdout.write("[mr1r-fixture] backend stopped, run directory removed\n");
}
