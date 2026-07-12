import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

async function verifySqlite(filePath: string) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < 16) throw new Error("Backup is empty or not a file.");
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    await handle.read(header, 0, header.length, 0);
    if (header.toString("utf8") !== "SQLite format 3\u0000") {
      throw new Error("Backup does not have a valid SQLite header.");
    }
  } finally {
    await handle.close();
  }
  console.log(`SQLite backup verified: ${filePath} (${stat.size} bytes)`);
}

async function main() {
  const backupsDir = path.resolve(process.cwd(), "backups");
  const requested = process.argv[2];
  let filePath: string;

  if (requested) {
    filePath = path.isAbsolute(requested) ? requested : path.resolve(backupsDir, requested);
  } else {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".db"))
      .map(async (entry) => {
        const candidate = path.join(backupsDir, entry.name);
        return { candidate, mtimeMs: (await fs.stat(candidate)).mtimeMs };
      }));
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    if (!candidates[0]) throw new Error("No SQLite backups found.");
    filePath = candidates[0].candidate;
  }

  await verifySqlite(filePath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
