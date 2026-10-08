/**
 * «Очистить всё» (DD-349, owner 2026-10-06): the learner's own list of notifications
 * can be cleared from the bell's window. Proven on a disposable database migrated
 * by the real runner:
 *
 *   - the migration that adds `clearedAt` is applied, with every other one;
 *   - clearing hides every notification in the learner's list and reads them,
 *     and deletes nothing — the rows stay, stamped;
 *   - another learner's list is untouched;
 *   - a notification that arrives after the clear is in the list again;
 *   - the column holds epoch milliseconds only (its CHECK refuses anything else).
 *
 * This script never reads DATABASE_URL from the environment.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "ata-notifications-clear-"));
const dbUrl = `file:${path.join(scratchDir, "regression.sqlite")}`;
process.env.DATABASE_URL = dbUrl;

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanupScratch() {
  if (scratchDir.startsWith(os.tmpdir()) && path.basename(scratchDir).startsWith("ata-notifications-clear-")) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function main() {
  const migrate = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  assert.equal(migrate.status, 0, `migrate failed: ${migrate.stderr}`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const { learnerListWhere, clearLearnerNotifications } = await import("@/lib/notification-list");
  const { EXPECTED_MIGRATION_COUNT } = await import("./support/migrationCount");

  const alice = await db.user.create({ data: { email: "clear-alice@example.invalid", name: "Alice", role: "user", passwordHash: "x" } });
  const bob = await db.user.create({ data: { email: "clear-bob@example.invalid", name: "Bob", role: "user", passwordHash: "x" } });
  const note = (userId: number, title: string, readAt: Date | null = null) =>
    db.notification.create({ data: { userId, type: "support_reply", title, message: "m", readAt } });
  await note(alice.id, "a1");
  await note(alice.id, "a2");
  await note(alice.id, "a3", new Date("2026-10-05T10:00:00.000Z"));
  await note(bob.id, "b1");
  const list = (userId: number) => db.notification.findMany({ where: learnerListWhere(userId) });
  const unread = (userId: number) => db.notification.count({ where: { ...learnerListWhere(userId), readAt: null } });

  try {
    await check("every migration applied, the cleared column among them", async () => {
      const rows = await db.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
      assert.equal(rows.length, EXPECTED_MIGRATION_COUNT);
      assert.ok(rows.some((row) => row.migration_name === "20261006120000_notification_cleared_at"));
    });

    await check("before: the list holds what arrived, two unread", async () => {
      assert.equal((await list(alice.id)).length, 3);
      assert.equal(await unread(alice.id), 2);
    });

    const at = new Date("2026-10-06T12:00:00.000Z");
    await check("clearing hides the whole list and reads it — three cleared", async () => {
      assert.equal(await clearLearnerNotifications(alice.id, at, db), 3);
      assert.equal((await list(alice.id)).length, 0);
      assert.equal(await unread(alice.id), 0);
    });

    await check("nothing is deleted: the rows stay, stamped cleared and read", async () => {
      const rows = await db.notification.findMany({ where: { userId: alice.id } });
      assert.equal(rows.length, 3);
      for (const row of rows) {
        assert.equal(row.clearedAt?.toISOString(), at.toISOString());
        assert.ok(row.readAt);
      }
      // A row read before the clear keeps the moment it was read.
      assert.equal(rows.find((row) => row.title === "a3")!.readAt!.toISOString(), "2026-10-05T10:00:00.000Z");
    });

    await check("another learner's list is untouched", async () => {
      assert.equal((await list(bob.id)).length, 1);
      assert.equal(await unread(bob.id), 1);
    });

    await check("what arrives after the clear is in the list again; clearing an empty list clears nothing", async () => {
      await note(alice.id, "a4");
      assert.equal((await list(alice.id)).length, 1);
      assert.equal(await unread(alice.id), 1);
      assert.equal(await clearLearnerNotifications(alice.id, new Date(), db), 1);
      assert.equal(await clearLearnerNotifications(alice.id, new Date(), db), 0);
    });

    await check("the column holds epoch milliseconds only", async () => {
      await assert.rejects(
        db.$executeRawUnsafe(`UPDATE "Notification" SET "clearedAt" = 'yesterday' WHERE "userId" = ${bob.id}`),
      );
    });
  } finally {
    await db.$disconnect();
  }
}

main()
  .catch((error) => {
    failed += 1;
    console.error(error);
  })
  .finally(() => {
    cleanupScratch();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  });
