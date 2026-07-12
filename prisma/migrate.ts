import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");

function splitSqlStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);

  const migrationNames = fs
    .readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const migrationPath = path.join(migrationsRoot, migrationName, "migration.sql");
    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    const checksum = crypto
      .createHash("sha256")
      .update(migrationSql)
      .digest("hex");

    const existingMigration = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "_prisma_migrations" WHERE "migration_name" = ? AND "rolled_back_at" IS NULL',
      migrationName,
    );

    if (existingMigration.length > 0) {
      console.log(`Migration ${migrationName} already applied.`);
      continue;
    }

    const migrationId = crypto.randomUUID();
    const statements = splitSqlStatements(migrationSql);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'INSERT INTO "_prisma_migrations" ("id", "checksum", "migration_name", "applied_steps_count") VALUES (?, ?, ?, ?)',
        migrationId,
        checksum,
        migrationName,
        0,
      );

      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }

      await tx.$executeRawUnsafe(
        'UPDATE "_prisma_migrations" SET "finished_at" = CURRENT_TIMESTAMP, "applied_steps_count" = ? WHERE "id" = ?',
        statements.length,
        migrationId,
      );
    });

    console.log(`Migration ${migrationName} applied.`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
