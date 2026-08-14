/**
 * G4-R9 — THE DIVERGENCE THE REPLAY GUARDS CANNOT SEE.
 *
 * WHAT WAS WRONG. Migration 47's sixteen backfill statements are each guarded by
 * `NOT EXISTS (... WHERE eventType = ? AND sourceOwner = ? AND sourceEventId = ?)`.
 * That guard keys on IDENTITY ALONE. It makes a replay idempotent, which is what
 * it was written for — but it also means a replay run to REPAIR the projection
 * cannot tell "this event is already correct" from "this event exists and its
 * projected columns no longer match the owner row". Both skip. Silently.
 *
 * So the repair primitive exists and cannot verify itself, which is the half of
 * G4-R9 that has nothing to do with Pocket and nothing to do with any provider.
 * This tool is that missing half: it does not repair, it REPORTS.
 *
 * WHAT IT DOES. For every verifiable family it recomputes, from the owner
 * tables, the projection the migration would produce, and compares it with the
 * ledger on four axes:
 *
 *   MISSING       an owner row that should have produced an event and did not
 *   ORPHANED      an event with no owner row behind it any more
 *   DIVERGENT     an event that exists by key while a projected column disagrees
 *                 with its owner — the case the guards skip
 *   DUPLICATEKEYS two events claiming one key, which the unique index should
 *                 make impossible
 *
 * POCKET-REG-SECURITY-CLOSURE-1 (F2/P4) — BOTH ORIGINS ARE VERIFIED.
 *
 * This tool originally compared the owner tables against `origin='backfill'`
 * rows only, and said so deliberately: when it was written the ledger held
 * nothing else. The first real Pocket registration made that scope a defect.
 * The owner row existed, its canonical event existed as `origin='runtime'`, and
 * the comparison could not see the event — so a perfectly healthy ledger
 * reported `missing`, on every family with live activity. A verifier that fails
 * on correct data is worse than no verifier, because the next REAL divergence
 * arrives inside a report everybody has learned to ignore.
 *
 * So the ledger side now reads every origin, and:
 *
 *   * a runtime event satisfies its owner row exactly as a backfilled one does;
 *   * every event is column-checked regardless of origin, so this change
 *     WIDENS divergence detection rather than relaxing it;
 *   * provenance is preserved and printed per family (`[backfill=N runtime=N]`),
 *     so "projected from history" and "emitted by a live transaction" remain
 *     distinguishable at a glance.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 *   * It does not write. No INSERT, no UPDATE, no DELETE, no migration, no
 *     PRAGMA. Discovering a missing event is not licence to create one: the
 *     repair decision belongs to a human with the failure in front of them.
 *   * It does not treat a runtime event as self-justifying: if a runtime event
 *     has no owner row it is ORPHANED, and if its columns disagree with the
 *     owner it is DIVERGENT, exactly as a backfilled one would be.
 *   * It prints no payload, no email, no secret and no free text from any row —
 *     ids, counts and column NAMES only.
 *
 * COVERAGE IS DECLARED, NOT ASSUMED. Every family the ledger can hold is listed
 * below, and the ones this tool cannot verify say so in the output rather than
 * being quietly absent. A verifier that silently checks a subset is worse than
 * one that checks nothing, because it produces a clean report either way.
 *
 * USAGE
 *
 *   DATABASE_URL="file:/path/to/a/COPY.sqlite" npx tsx \
 *     scripts/ops/verifyGrowthLedgerProjection.ts
 *
 * Exit 0 = no divergence. Exit 1 = divergence found. Exit 2 = it could not run.
 *
 * Point it at a COPY. It only reads, but a verifier that requires the live file
 * is a verifier somebody will eventually run during an incident.
 */
import { PrismaClient } from "@prisma/client";

type Row = {
  sourceEventId: string;
  occurredAt: bigint | number | null;
  userId: number | null;
  sourceEntityType: string | null;
  sourceOwner: string | null;
  /** POCKET-REG-SECURITY-CLOSURE-1 (F2): provenance, reported never collapsed. */
  origin?: string | null;
};

type FamilySpec = {
  readonly eventType: string;
  readonly sourceOwner: string;
  readonly sourceEntityType: string;
  /**
   * The owner projection, expressed exactly as migration 47 expresses it.
   *
   * Kept as SQL rather than reimplemented in TypeScript on purpose: a
   * hand-ported projection is a second implementation that drifts from the one
   * it is checking, and a checker that drifts is worse than no checker.
   */
  readonly ownerSql: string;
};

/** The normalisation migration 47 applies to every timestamp it projects. */
const MS = (column: string) =>
  `CASE WHEN typeof(${column}) = 'text' THEN strftime('%s', ${column}) * 1000 ELSE CAST(${column} AS INTEGER) END`;

const FAMILIES: readonly FamilySpec[] = [
  {
    eventType: "ata_reg",
    sourceOwner: "auth_register",
    sourceEntityType: "User",
    // Positive registration authority: an AUTH_REGISTER audit row. Role is
    // never consulted — origin is historical, role is current.
    ownerSql: `
      SELECT 'user:' || CAST(u."id" AS TEXT) AS "sourceEventId",
             ${MS('u."createdAt"')} AS "occurredAt",
             u."id" AS "userId"
      FROM "User" u
      WHERE u."id" IN (
        SELECT a."userId" FROM "AuditLog" a
        WHERE a."action" = 'AUTH_REGISTER' AND a."userId" IS NOT NULL
      )`,
  },
  {
    eventType: "curriculum_enrollment",
    sourceOwner: "curriculum_enrollment",
    sourceEntityType: "UserCurriculumEnrollment",
    ownerSql: `
      SELECT 'enrollment:' || CAST(en."id" AS TEXT) AS "sourceEventId",
             ${MS('en."enrolledAt"')} AS "occurredAt",
             en."userId" AS "userId"
      FROM "UserCurriculumEnrollment" en`,
  },
  {
    eventType: "level_started",
    sourceOwner: "curriculum_level_progress",
    sourceEntityType: "UserLevelProgress",
    // A progress row is not a start: financial checkpoints are excluded, which
    // is the G4-H1 correction, and the predicate must be mirrored exactly or
    // this tool reports the correction itself as a divergence.
    ownerSql: `
      SELECT 'progress:' || CAST(p."id" AS TEXT) AS "sourceEventId",
             ${MS('p."startedAt"')} AS "occurredAt",
             en."userId" AS "userId"
      FROM "UserLevelProgress" p
      JOIN "UserCurriculumEnrollment" en ON en."id" = p."enrollmentId"
      JOIN "LevelDefinition" ld ON ld."id" = p."levelDefinitionId"
      WHERE ld."type" <> 'financial_checkpoint'`,
  },
  {
    eventType: "level_completed",
    sourceOwner: "curriculum_level_progress",
    sourceEntityType: "UserLevelProgress",
    ownerSql: `
      SELECT 'progress:' || CAST(p."id" AS TEXT) AS "sourceEventId",
             ${MS('p."completedAt"')} AS "occurredAt",
             en."userId" AS "userId"
      FROM "UserLevelProgress" p
      JOIN "UserCurriculumEnrollment" en ON en."id" = p."enrollmentId"
      JOIN "LevelDefinition" ld ON ld."id" = p."levelDefinitionId"
      WHERE p."status" = 'completed' AND p."completedAt" IS NOT NULL`,
  },
  {
    eventType: "assessment_completed",
    sourceOwner: "curriculum_assessment_attempt",
    sourceEntityType: "AssessmentAttempt",
    // A SUBMITTED attempt, passed or failed. `userId` comes from the attempt
    // itself, not through the enrollment.
    ownerSql: `
      SELECT 'attempt:' || CAST(a."id" AS TEXT) AS "sourceEventId",
             ${MS('a."submittedAt"')} AS "occurredAt",
             a."userId" AS "userId"
      FROM "AssessmentAttempt" a
      JOIN "LevelDefinition" ld ON ld."id" = a."levelDefinitionId"
      WHERE a."submittedAt" IS NOT NULL`,
  },
  {
    eventType: "report_submitted",
    sourceOwner: "curriculum_report_submission",
    sourceEntityType: "ReportSubmission",
    // `firstSubmittedAt`, not `submittedAt`: a resubmission must not move the
    // original submission into a later reporting period.
    ownerSql: `
      SELECT 'submission:' || CAST(s."id" AS TEXT) AS "sourceEventId",
             ${MS('s."firstSubmittedAt"')} AS "occurredAt",
             s."userId" AS "userId"
      FROM "ReportSubmission" s
      JOIN "LevelDefinition" ld ON ld."id" = s."levelDefinitionId"
      WHERE s."firstSubmittedAt" IS NOT NULL`,
  },
  {
    eventType: "pocket_reg",
    sourceOwner: "pocket_identity_binding",
    sourceEntityType: "PocketTraderIdentity",
    ownerSql: `
      SELECT 'pocket:player:' || t."pocketUserId" AS "sourceEventId",
             ${MS('t."createdAt"')} AS "occurredAt",
             t."userId" AS "userId"
      FROM "PocketTraderIdentity" t`,
  },
];

/**
 * Families this tool does not verify, and why. Printed, never hidden.
 *
 * `academy_activation`, `report_approved` and `mentor_review_*` are projected
 * through a window function over a set the migration picks a single winner
 * from; re-deriving that here would be a second implementation of the selection
 * rule rather than a check on it. `dep` and `rdep` are provider-owned and are
 * covered by the Pocket reconciliation path instead.
 */
const UNVERIFIED: ReadonlyArray<readonly [string, string]> = [
  ["academy_activation", "first-completion winner is chosen by a window function"],
  ["report_approved", "approval winner is chosen by a window function"],
  ["mentor_review_submitted", "declared unavailable — the submission instant is not owned"],
  ["mentor_review_approved", "approval winner is chosen by a window function"],
  ["traffic_click", "no click rows exist to project from on any accepted database"],
  ["dep", "provider-owned; covered by the Pocket first-deposit reconciliation"],
  ["rdep", "structurally unemittable without a provider event-identity contract"],
];

function toMs(value: bigint | number | null): number | null {
  if (value === null) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

async function main(): Promise<number> {
  const prisma = new PrismaClient();
  let divergences = 0;

  try {
    console.log("GROWTH LEDGER PROJECTION VERIFICATION");
    console.log("read-only · reports divergence · repairs nothing");
    console.log("");

    for (const family of FAMILIES) {
      const ledger = await prisma.$queryRawUnsafe<Row[]>(
        // CAST on the ledger side so both halves of every comparison are plain
        // integers. `occurredAt` is DATETIME in the schema, so an uncast read
        // arrives as a Date object and would differ from the owner projection's
        // integer for every single row — a checker that reports 100% divergence
        // is indistinguishable from one that is broken.
        //
        // POCKET-REG-SECURITY-CLOSURE-1 (F2/P4): BOTH origins are read now.
        //
        // This query used to say `AND "origin" = 'backfill'`. That was correct
        // while the ledger held nothing else, and it became a defect the moment
        // the first real provider registration was accepted: the owner row
        // existed, its event existed as `origin='runtime'`, and the comparison
        // below could not see the event — so a healthy ledger reported
        // `missing`. A verifier that fails on correct data is worse than none,
        // because the next real divergence arrives in a report nobody trusts.
        //
        // Provenance is NOT collapsed: `origin` is selected and reported per
        // family, so "12 backfilled + 1 runtime" stays legible and a runtime
        // row can never be mistaken for a historical one.
        `SELECT "sourceEventId",
                CAST("occurredAt" AS INTEGER) AS "occurredAt",
                "userId", "sourceEntityType", "sourceOwner", "origin"
         FROM "GrowthEvent"
         WHERE "eventType" = ?`,
        family.eventType,
      );
      const owner = await prisma.$queryRawUnsafe<Row[]>(family.ownerSql);

      const ledgerByKey = new Map(ledger.map((row) => [row.sourceEventId, row]));
      const ownerByKey = new Map(owner.map((row) => [row.sourceEventId, row]));
      const backfilled = ledger.filter((row) => row.origin === "backfill").length;
      const runtime = ledger.filter((row) => row.origin === "runtime").length;

      // A key must not be claimed by two events. The unique index on
      // (eventType, sourceOwner, sourceEventId) makes this impossible in the
      // database, and asserting it here means a future index change cannot
      // silently turn a duplicate into a passing comparison.
      const duplicateKeys = ledger.length - ledgerByKey.size;

      const missing: string[] = [];
      const orphaned: string[] = [];
      const divergent: Array<{ key: string; column: string }> = [];

      for (const [key, expected] of ownerByKey) {
        const actual = ledgerByKey.get(key);
        if (!actual) {
          missing.push(key);
          continue;
        }
        // THE CASE THE GUARDS SKIP. The row exists by key, so a replay would
        // pass over it — these comparisons are the only thing that can see it.
        if (toMs(actual.occurredAt) !== toMs(expected.occurredAt)) {
          divergent.push({ key, column: "occurredAt" });
        }
        if (actual.userId !== expected.userId) {
          divergent.push({ key, column: "userId" });
        }
        if (actual.sourceEntityType !== family.sourceEntityType) {
          divergent.push({ key, column: "sourceEntityType" });
        }
        if (actual.sourceOwner !== family.sourceOwner) {
          divergent.push({ key, column: "sourceOwner" });
        }
      }

      for (const key of ledgerByKey.keys()) {
        if (!ownerByKey.has(key)) orphaned.push(key);
      }

      const bad = missing.length + orphaned.length + divergent.length + duplicateKeys;
      divergences += bad;

      console.log(
        `${bad === 0 ? "OK  " : "FAIL"} ${family.eventType.padEnd(24)} ` +
          `ledger=${String(ledger.length).padStart(5)} owner=${String(owner.length).padStart(5)} ` +
          `missing=${missing.length} orphaned=${orphaned.length} divergent=${divergent.length}` +
          (duplicateKeys > 0 ? ` duplicateKeys=${duplicateKeys}` : "") +
          `  [backfill=${backfilled} runtime=${runtime}]`,
      );

      // Bounded detail. Enough to act on, never enough to be a data export.
      for (const key of missing.slice(0, 10)) console.log(`       MISSING   ${key}`);
      for (const key of orphaned.slice(0, 10)) console.log(`       ORPHANED  ${key}`);
      for (const item of divergent.slice(0, 10)) {
        console.log(`       DIVERGENT ${item.key} column=${item.column}`);
      }
    }

    console.log("");
    console.log("NOT VERIFIED BY THIS TOOL:");
    for (const [family, why] of UNVERIFIED) console.log(`  ${family.padEnd(26)} ${why}`);

    console.log("");
    // The outbox is part of the projection: an event with no outbox row is an
    // event nothing downstream can ever consume.
    const [{ orphanCount }] = await prisma.$queryRawUnsafe<Array<{ orphanCount: number }>>(
      // `GrowthEventOutbox.growthEventId` references `GrowthEvent.id` (the
      // integer primary key), NOT the public `eventId` string.
      `SELECT COUNT(*) AS "orphanCount" FROM "GrowthEvent" g
       WHERE NOT EXISTS (SELECT 1 FROM "GrowthEventOutbox" o WHERE o."growthEventId" = g."id")`,
    );
    const outboxOrphans = Number(orphanCount);
    divergences += outboxOrphans;
    console.log(
      `${outboxOrphans === 0 ? "OK  " : "FAIL"} outbox coverage           ` +
        `events with no outbox row=${outboxOrphans}`,
    );

    console.log("");
    console.log(divergences === 0 ? "RESULT: no divergence" : `RESULT: ${divergences} divergence(s)`);
    return divergences === 0 ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    // Fail-closed: an error is never "no divergence".
    console.error("VERIFICATION COULD NOT RUN:", error instanceof Error ? error.message : error);
    process.exit(2);
  });
