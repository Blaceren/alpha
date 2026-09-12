import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const workspace = path.resolve(process.cwd());
const databasePath = path.resolve(workspace, "prisma", "beta-reset-test.db");
const uploadsPath = path.resolve(workspace, "storage", "beta-reset-test-uploads");
const databaseUrl = "file:./beta-reset-test.db";

function assertInsideWorkspace(candidate: string) {
  const relative = path.relative(workspace, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe verification path: ${candidate}`);
  }
}

function runNpm(script: string, env: NodeJS.ProcessEnv) {
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args = isWindows ? ["/d", "/s", "/c", "npm.cmd", "run", script] : ["run", script];
  const result = spawnSync(command, args, {
    cwd: workspace,
    env,
    encoding: "utf8",
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}`);
  return result.stdout ?? "";
}

async function main() {
  assertInsideWorkspace(databasePath);
  assertInsideWorkspace(uploadsPath);
  await fs.rm(databasePath, { force: true });
  await fs.rm(uploadsPath, { recursive: true, force: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    LOCAL_UPLOADS_DIR: path.relative(workspace, uploadsPath),
    ALLOW_PRODUCTION_BETA_RESET: "false",
  };
  runNpm("prisma:migrate", env);
  runNpm("prisma:seed", env);

  process.env.DATABASE_URL = databaseUrl;
  let prisma = new PrismaClient();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "user@test.com" } });
  await prisma.testerFeedback.create({
    data: { userId: user.id, role: "user", type: "bug", severity: "high", title: "Beta reset verification", message: "Must be removed" },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "BETA_RESET_VERIFY_DIRTY" } });
  await fs.mkdir(uploadsPath, { recursive: true });
  await fs.writeFile(path.join(uploadsPath, "dirty.txt"), "remove me", "utf8");
  await prisma.$disconnect();

  const resetOutput = runNpm("beta:reset", env);
  const backupMatch = resetOutput.match(/Pre-reset SQLite backup created and verified: (.+)/);
  const backupPath = backupMatch?.[1]?.trim();
  if (!backupPath) throw new Error("beta:reset did not report its safety backup path");
  assertInsideWorkspace(backupPath);

  prisma = new PrismaClient();
  const [baselineUser, activeProgress, feedbackCount, auditCount] = await Promise.all([
    prisma.user.findUnique({ where: { email: "user@test.com" } }),
    prisma.userTaskProgress.findFirst({ where: { user: { email: "user@test.com" }, status: "active" }, include: { task: true } }),
    prisma.testerFeedback.count(),
    prisma.auditLog.count(),
  ]);
  await prisma.$disconnect();
  const uploadEntries = await fs.readdir(uploadsPath);

  if (baselineUser?.xp !== 420 || activeProgress?.task.stepNumber !== 4) {
    throw new Error("beta:reset did not restore the seeded XP/task baseline");
  }
  if (feedbackCount !== 0 || auditCount !== 0 || uploadEntries.length !== 0) {
    throw new Error("beta:reset did not clean feedback, audit or isolated uploads");
  }

  await fs.rm(databasePath, { force: true });
  await fs.rm(uploadsPath, { recursive: true, force: true });
  await fs.rm(backupPath, { force: true });
  console.log("BETA_RESET_VERIFY_DONE: isolated backup, reset, baseline and cleanup passed");
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
