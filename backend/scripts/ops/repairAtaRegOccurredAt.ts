/**
 * POCKET-REG-FINAL-INTERNAL-CORRECTION-1 (§11) — bring already-written runtime
 * `ata_reg` rows back onto their owner's instant.
 *
 * WHY THIS IS NOT MIGRATION 48. Migration 48 normalises a STORAGE CLASS that a
 * fresh database would also need corrected if it inherited legacy rows. This
 * repairs a small number of rows that exist only because a specific build
 * emitted `occurredAt: now` for a while. A fresh database has no such rows, so
 * encoding this in migration history would put a PREPROD-shaped no-op into
 * every environment's schema lineage. §14 also forbids bundling unrelated work
 * into migration 48, and this is unrelated to storage class.
 *
 * WHY IT IS NOT A ONE-ROW UPDATE EITHER. A hard-coded row id would be a fact
 * about today rather than a rule. This derives the correct value from the same
 * authority the verifier uses — `User.createdAt`, for users an `AUTH_REGISTER`
 * audit row qualifies — so it repairs exactly the rows that are provably wrong
 * and nothing else.
 *
 * WHAT IT WILL NOT DO
 *   • it will not touch a row whose owner cannot be resolved
 *   • it will not touch a family other than `ata_reg`
 *   • it will not touch `origin = 'backfill'` rows, which were projected FROM
 *     the owner and cannot disagree with it by construction
 *   • it will not create, delete or re-key anything
 *   • it will not run without `--apply`, so the default is a report
 *
 * WHAT IT CHANGES. One column, `GrowthEvent.occurredAt`, to the value the
 * ledger's own contract says it should always have held. `recordedAt` is
 * deliberately untouched: it records when ATA wrote the row down, which did not
 * change and must not be rewritten.
 *
 *   DATABASE_URL="file:/path/to/db.sqlite" npx tsx scripts/ops/repairAtaRegOccurredAt.ts
 *   DATABASE_URL="file:/path/to/db.sqlite" npx tsx scripts/ops/repairAtaRegOccurredAt.ts --apply
 */
import { PrismaClient } from "@prisma/client";

type DivergentRow = {
  id: number;
  eventId: string;
  userId: number;
  eventOccurredAt: bigint | number;
  ownerCreatedAt: bigint | number;
};

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();
  try {
    // The owner authority, spelled exactly as verifyGrowthLedgerProjection.ts
    // spells it: User.createdAt, for users an AUTH_REGISTER audit row qualifies,
    // with migration 47's storage normalisation applied on the way in.
    const divergent = await prisma.$queryRawUnsafe<DivergentRow[]>(`
      SELECT g."id"          AS "id",
             g."eventId"     AS "eventId",
             g."userId"      AS "userId",
             g."occurredAt"  AS "eventOccurredAt",
             CASE WHEN typeof(u."createdAt") = 'text'
                  THEN strftime('%s', u."createdAt") * 1000
                  ELSE CAST(u."createdAt" AS INTEGER) END AS "ownerCreatedAt"
      FROM "GrowthEvent" g
      JOIN "User" u ON u."id" = g."userId"
      WHERE g."eventType" = 'ata_reg'
        AND g."origin" = 'runtime'
        AND g."userId" IS NOT NULL
        AND u."id" IN (
          SELECT a."userId" FROM "AuditLog" a
          WHERE a."action" = 'AUTH_REGISTER' AND a."userId" IS NOT NULL
        )
        AND CAST(g."occurredAt" AS INTEGER) <> CASE WHEN typeof(u."createdAt") = 'text'
              THEN strftime('%s', u."createdAt") * 1000
              ELSE CAST(u."createdAt" AS INTEGER) END
      ORDER BY g."id"
    `);

    console.log("ATA_REG occurredAt REPAIR");
    console.log(`mode: ${apply ? "APPLY" : "REPORT ONLY (pass --apply to write)"}`);
    console.log("");

    if (divergent.length === 0) {
      console.log("No runtime ata_reg row disagrees with its owner. Nothing to repair.");
      return 0;
    }

    console.log(`${divergent.length} row(s) disagree with User.createdAt:`);
    for (const row of divergent) {
      const from = Number(row.eventOccurredAt);
      const to = Number(row.ownerCreatedAt);
      console.log(
        `  GrowthEvent id=${row.id} user=${row.userId} ` +
          `occurredAt ${from} -> ${to}  (delta ${from - to} ms)`,
      );
    }
    console.log("");

    if (!apply) {
      console.log("Nothing written. Re-run with --apply to correct these rows.");
      return 0;
    }

    // One row at a time, each to a value already computed and printed above, so
    // what is written is exactly what was reviewed.
    let updated = 0;
    for (const row of divergent) {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "GrowthEvent" SET "occurredAt" = ? WHERE "id" = ? AND "eventType" = 'ata_reg' AND "origin" = 'runtime'`,
        Number(row.ownerCreatedAt),
        row.id,
      );
      updated += result;
    }
    console.log(`updated ${updated} row(s)`);

    const remaining = await prisma.$queryRawUnsafe<Array<{ n: bigint | number }>>(`
      SELECT COUNT(*) AS n
      FROM "GrowthEvent" g JOIN "User" u ON u."id" = g."userId"
      WHERE g."eventType" = 'ata_reg' AND g."origin" = 'runtime'
        AND CAST(g."occurredAt" AS INTEGER) <> CASE WHEN typeof(u."createdAt") = 'text'
              THEN strftime('%s', u."createdAt") * 1000
              ELSE CAST(u."createdAt" AS INTEGER) END
    `);
    const left = Number(remaining[0]?.n ?? 0);
    console.log(`remaining divergent runtime ata_reg rows: ${left}`);
    return left === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
