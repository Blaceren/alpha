import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function resolveSqlitePath() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) {
    throw new Error("beta:reset supports only a SQLite DATABASE_URL starting with file:.");
  }
  const sqlitePath = databaseUrl.slice("file:".length);
  return path.isAbsolute(sqlitePath) ? sqlitePath : path.resolve(process.cwd(), "prisma", sqlitePath);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function verifySqlite(filePath: string) {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    if (header.toString("utf8") !== "SQLite format 3\u0000") {
      throw new Error(`${filePath} is not a valid SQLite database.`);
    }
  } finally {
    await handle.close();
  }
}

async function main() {
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && (
    process.env.ALLOW_PRODUCTION_BETA_RESET !== "true" ||
    process.env.BETA_RESET_CONFIRM !== "RESET_BETA_DATA"
  )) {
    throw new Error("Refusing beta reset in production. Set ALLOW_PRODUCTION_BETA_RESET=true and BETA_RESET_CONFIRM=RESET_BETA_DATA explicitly.");
  }

  const sourcePath = resolveSqlitePath();
  const backupsDir = path.resolve(process.cwd(), "backups");
  const backupPath = path.join(backupsDir, `pre-beta-reset-${timestamp()}.db`);
  await verifySqlite(sourcePath);
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.copyFile(sourcePath, backupPath);
  await verifySqlite(backupPath);
  console.log(`Pre-reset SQLite backup created and verified: ${backupPath}`);

  const isWindows = process.platform === "win32";
  const npmCommand = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const npmArgs = isWindows ? ["/d", "/s", "/c", "npm.cmd", "run", "prisma:seed"] : ["run", "prisma:seed"];
  const result = spawnSync(npmCommand, npmArgs, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(isProduction ? { ALLOW_PRODUCTION_SEED: "true" } : {}),
    },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`Beta reset seed failed with exit code ${result.status ?? "unknown"}. Backup is preserved at ${backupPath}`);
  }

  await verifySqlite(sourcePath);
  console.log("Closed beta data reset completed. Seed baseline and upload cleanup restored.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
