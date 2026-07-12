import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

function resolveSqlitePath() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  if (!databaseUrl.startsWith("file:")) {
    throw new Error("db:backup supports only SQLite DATABASE_URL values starting with file:.");
  }

  const sqlitePath = databaseUrl.slice("file:".length);
  return path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve(process.cwd(), "prisma", sqlitePath);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function verifySqlite(filePath: string) {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 16 || header.toString("utf8") !== "SQLite format 3\u0000") {
      throw new Error(`Backup verification failed: ${filePath} is not a SQLite database.`);
    }
  } finally {
    await handle.close();
  }
}

async function main() {
  const sourcePath = resolveSqlitePath();
  const backupsDir = path.resolve(process.cwd(), "backups");
  const backupPath = path.join(backupsDir, `sqlite-${timestamp()}.db`);

  await fs.access(sourcePath);
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.copyFile(sourcePath, backupPath);
  await verifySqlite(backupPath);

  console.log(`SQLite backup created and verified: ${backupPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
