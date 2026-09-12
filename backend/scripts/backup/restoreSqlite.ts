import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

function resolveSqlitePath() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (!databaseUrl.startsWith("file:")) {
    throw new Error("db:restore supports only SQLite DATABASE_URL values starting with file:.");
  }

  const sqlitePath = databaseUrl.slice("file:".length);
  return path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve(process.cwd(), "prisma", sqlitePath);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function verifySqlite(filePath: string) {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 16 || header.toString("utf8") !== "SQLite format 3\u0000") {
      throw new Error(`Refusing restore: ${filePath} is not a SQLite database.`);
    }
  } finally {
    await handle.close();
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const requestedBackup = process.argv.slice(2).find((argument) => argument !== "--dry-run");

  if (!requestedBackup) {
    throw new Error("Usage: npm run db:restore -- <backup-file>");
  }

  const backupsDir = path.resolve(process.cwd(), "backups");
  const backupPath = path.isAbsolute(requestedBackup)
    ? requestedBackup
    : path.resolve(backupsDir, requestedBackup);
  const targetPath = resolveSqlitePath();

  if (!path.isAbsolute(requestedBackup) && !isInside(backupsDir, backupPath)) {
    throw new Error("Relative backup path must stay inside the backups directory.");
  }
  if (path.resolve(backupPath) === path.resolve(targetPath)) {
    throw new Error("Backup source and active database must be different files.");
  }

  await fs.access(backupPath);
  await verifySqlite(backupPath);
  if (dryRun) {
    console.log(`Restore dry run OK. Source: ${backupPath}`);
    console.log(`Restore dry run target: ${targetPath}`);
    console.log(`A pre-restore safety copy will be created in: ${backupsDir}`);
    return;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });

  if (await fileExists(targetPath)) {
    const safetyCopyPath = path.join(backupsDir, `pre-restore-${timestamp()}.db`);
    await fs.copyFile(targetPath, safetyCopyPath);
    console.log(`Current SQLite DB copied before restore: ${safetyCopyPath}`);
  }

  await fs.copyFile(backupPath, targetPath);
  await verifySqlite(targetPath);
  console.log(`SQLite DB restored from: ${backupPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
