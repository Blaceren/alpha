/**
 * POCKET-REG-INGRESS-1 — the activation phase's own isolated matrix.
 *
 * ATA-PREPROD-POCKET-REG-INGRESS-ENABLEMENT-AND-ACTIVATION-1 makes the Pocket
 * receiver publicly routable and turns the REG family on. The accepted suites
 * already prove the auth matrix, the goal allowlist, the identity binder, the
 * idempotency keys and the concurrency races; this suite pins ONLY the cells
 * the activation itself stands on and nothing else covers:
 *
 *   A. the PRE-ACTIVATION state (master on, REG family off) refuses on EVERY
 *      channel — `ow` and the legacy header alike — with zero mutation;
 *   B. the TARGET state (master + REG on) respects prior L1 truth, records a
 *      truthful null for an unattributed learner, never moves a learner who is
 *      past L1, and leaves DEP/RDEP exactly as dead as their switches say.
 *
 * Synthetic database only (a scrubbed curriculum fixture); NO EXTERNAL REQUEST
 * IS MADE, no real secret is read, and nothing here touches live flags.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sourceDb = process.env.L1OWNER_FIXTURE_DB ?? "/home/ubuntu/l1owner1-work/db/fixture.sqlite";
const dbPath = path.join(os.tmpdir(), `ata-pocket-phase-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const SECRET = "pocket-phase-synthetic-secret-01";
const L1 = "v2.l001.registraciya-pocket";

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
function cleanup() {
  for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
}

let ipSeq = 0;
const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
let playerSeq = 0;
const nextPlayerId = () => String(700_000_000 + ++playerSeq);

async function main() {
  cleanup();
  if (!fs.existsSync(sourceDb)) {
    console.log(`SKIP: fixture database ${sourceDb} not present`);
    return;
  }
  fs.copyFileSync(sourceDb, dbPath);

  process.env.DATABASE_URL = dbUrl;
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // Deliberately ABSENT at suite start: the pre-activation state under test.
  delete process.env.POCKET_REG_INGEST_ENABLED;
  delete process.env.POCKET_DEP_INGEST_ENABLED;
  delete process.env.POCKET_RDEP_INGEST_ENABLED;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  // The staging witness, used ONLY to pre-complete L1 for the precedence case.
  process.env.ATA_ENVIRONMENT = "staging";
  process.env.STAGING_ATTESTATION_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const route = await import("../../src/app/api/postbacks/pocket/route");
  const enrolment = await import("../../src/lib/curriculum/enrollment");
  const recon = await import("../../src/lib/curriculum/pocket-registration-completion");
  const levelState = await import("../../src/lib/curriculum/level-state");

  const version = await prisma.curriculumVersion.findFirst({
    where: { code: "ata-v2", status: "published" },
  });
  if (!version) {
    console.log("SKIP: no published ata-v2 in the fixture database");
    return;
  }
  const l1 = await prisma.levelDefinition.findFirstOrThrow({
    where: { curriculumVersionId: version.id, stableCode: L1 },
  });
  const operator = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });

  let seq = 0;
  async function learner() {
    seq += 1;
    const u = await prisma.user.create({
      data: {
        email: `pocket-phase-${seq}-${Date.now()}@example.invalid`,
        name: "POCKET-PHASE",
        referralCode: `PPH${seq}${Date.now() % 100000}`,
        status: "active",
      },
    });
    const clickId = `tq-${crypto.randomUUID()}`;
    await prisma.exchangeAccount.create({
      data: {
        userId: u.id,
        provider: "real_placeholder",
        referralLink: "https://example.invalid/ref",
        exchangeAccountId: `pocket-pending-${u.id}`,
        clickId,
        status: "pending",
      },
    });
    return { userId: u.id, clickId };
  }
  const enrol = (userId: number) =>
    enrolment.enrollUserInPublishedCurriculum({ userId, actorId: operator.id });

  function call(params: Record<string, string>, header?: string) {
    const p = new URLSearchParams(params);
    const headers: Record<string, string> = { "x-forwarded-for": nextIp() };
    if (header) headers["x-postback-secret"] = header;
    return route.GET(
      new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, { method: "GET", headers }),
    );
  }
  const owReg = (clickId: string, playerId: string) =>
    call({ clickid: clickId, goal: "reg", ow: SECRET, playerid: playerId });
  const headerReg = (clickId: string, playerId: string) =>
    call({ clickid: clickId, goal: "reg", playerid: playerId }, SECRET);

  const counts = async () => ({
    ingress: await prisma.providerIngressEvent.count(),
    identity: await prisma.pocketTraderIdentity.count(),
    growth: await prisma.growthEvent.count({ where: { eventType: "pocket_reg" } }),
    outbox: await prisma.growthEventOutbox.count(),
    l1: await prisma.userLevelProgress.count({
      where: { levelDefinitionId: l1.id, status: "completed" },
    }),
    xp: await prisma.xPTransaction.count(),
    postback: await prisma.postbackEvent.count(),
    provider: await prisma.pocketProviderEvent.count(),
  });

  /* ------------------------------------------------------------------ */
  /* A. PRE-ACTIVATION: master ON, REG family OFF                        */
  /* ------------------------------------------------------------------ */

  await check("A1 ow channel: REG family off is 503 with zero mutation", async () => {
    const l = await learner();
    await enrol(l.userId);
    const before = await counts();
    const r = await owReg(l.clickId, nextPlayerId());
    assert.equal(r.status, 503);
    assert.deepEqual(await (r as Response).json(), {
      success: false,
      error: "POCKET_POSTBACK_UNAVAILABLE",
    });
    assert.deepEqual(await counts(), before, "a disabled family mutated something");
  });

  await check("A2 header channel: REG family off is 503 with zero mutation", async () => {
    // The gap this phase closed: the legacy header branch used to honour only
    // the master gate, so with the master on and the family off a
    // header-authenticated goal=reg still bound an identity and projected the
    // canonical event. Reproduced on the parent release before the fix; pinned
    // here forever after it.
    const l = await learner();
    await enrol(l.userId);
    const before = await counts();
    const r = await headerReg(l.clickId, nextPlayerId());
    assert.equal(r.status, 503, "header goal=reg must be unavailable while the family is off");
    assert.deepEqual(await counts(), before, "the header channel mutated with the family off");
    const account = await prisma.exchangeAccount.findFirstOrThrow({
      where: { userId: l.userId },
    });
    assert.equal(account.registrationStatus, false, "registrationStatus moved while REG was off");
  });

  /* ------------------------------------------------------------------ */
  /* B. TARGET STATE: master ON, REG ON — DEP/RDEP stay OFF              */
  /* ------------------------------------------------------------------ */

  process.env.POCKET_REG_INGEST_ENABLED = "true";

  await check("B1 an L1 already completed by staging attestation is respected", async () => {
    const l = await learner();
    const enrolled = await enrol(l.userId);
    assert.equal(enrolled.kind, "enrolled");
    const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow({
      where: { userId: l.userId },
    });

    // The accepted PREPROD QA witness: an operator attestation, recorded
    // durably, completing L1 through the same shipped owners.
    const attestation = await prisma.stagingAttestation.create({
      data: {
        eventClass: "pocket_registration",
        enrollmentId: enrollment.id,
        levelDefinitionId: l1.id,
        requestId: `phase-b1-${l.userId}`,
        attestedById: operator.id,
      },
    });
    const attested = await recon.reconcilePocketRegistrationLevelCompletion(l.userId, {
      stagingAttestation: { attestationId: attestation.id },
    });
    assert.equal(attested.outcome, "completed");

    const progressBefore = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: enrollment.id, levelDefinitionId: l1.id },
    });
    assert.equal(progressBefore.status, "completed");
    // Completion provenance lives in the audit trail and the ledger, not on
    // the progress row: one levelCompleted audit entry naming the attestation
    // as the source.
    const auditsBefore = await prisma.auditLog.findMany({
      where: {
        action: "CURRICULUM_LEVEL_COMPLETED",
        entityType: "UserLevelProgress",
        entityId: String(progressBefore.id),
      },
    });
    assert.equal(auditsBefore.length, 1);
    const metaBefore = auditsBefore[0].metadata as { sourceType?: string };
    assert.equal(metaBefore.sourceType, "staging_attested_registration");

    // Now the REAL provider registration arrives for the same learner.
    const playerId = nextPlayerId();
    const r = await owReg(l.clickId, playerId);
    assert.equal(r.status, 200);
    assert.deepEqual(await (r as Response).json(), { ok: true });

    // Business truth recorded: identity bound, canonical event emitted once,
    // account marked registered.
    const identity = await prisma.pocketTraderIdentity.findUniqueOrThrow({
      where: { userId: l.userId },
    });
    assert.equal(identity.pocketUserId, playerId);
    assert.equal(
      await prisma.growthEvent.count({
        where: { eventType: "pocket_reg", userId: l.userId },
      }),
      1,
    );
    const account = await prisma.exchangeAccount.findFirstOrThrow({ where: { userId: l.userId } });
    assert.equal(account.registrationStatus, true);

    // Progression truth untouched: still ONE completion, provenance still the
    // attestation, no XP, no regression, no second progress row, no second
    // levelCompleted audit entry.
    const progressAfter = await prisma.userLevelProgress.findMany({
      where: { enrollmentId: enrollment.id, levelDefinitionId: l1.id },
    });
    assert.equal(progressAfter.length, 1);
    assert.equal(progressAfter[0].status, "completed");
    assert.equal(progressAfter[0].completedAt?.getTime(), progressBefore.completedAt?.getTime());
    const auditsAfter = await prisma.auditLog.findMany({
      where: {
        action: "CURRICULUM_LEVEL_COMPLETED",
        entityType: "UserLevelProgress",
        entityId: String(progressBefore.id),
      },
    });
    assert.equal(auditsAfter.length, 1, "a real replay double-completed an attested L1");
    const metaAfter = auditsAfter[0].metadata as { sourceType?: string };
    assert.equal(
      metaAfter.sourceType,
      "staging_attested_registration",
      "a replayed real registration rewrote completion provenance",
    );
    assert.equal(await prisma.xPTransaction.count({ where: { userId: l.userId } }), 0);
  });

  await check("B2 an unattributed learner registers with a truthful null", async () => {
    const l = await learner();
    await enrol(l.userId);
    assert.equal(
      await prisma.affiliateAttribution.count({ where: { userId: l.userId } }),
      0,
      "fixture precondition: no attribution",
    );
    const r = await owReg(l.clickId, nextPlayerId());
    assert.equal(r.status, 200);
    const event = await prisma.growthEvent.findFirstOrThrow({
      where: { eventType: "pocket_reg", userId: l.userId },
    });
    assert.equal(event.attributionId, null, "attribution must be null, not fabricated");
    assert.equal(event.acquisitionClickId, null);
    assert.equal(event.provider, "pocket");
    // And the registration itself was NOT refused for the missing attribution:
    const progress = await prisma.userLevelProgress.findFirst({
      where: {
        levelDefinitionId: l1.id,
        status: "completed",
        enrollment: { userId: l.userId },
      },
    });
    assert.ok(progress, "an unattributed but valid registration must still complete L1");
  });

  await check("B3 a learner already past L1 is never moved by a replay", async () => {
    const l = await learner();
    await enrol(l.userId);
    const playerId = nextPlayerId();
    const first = await owReg(l.clickId, playerId);
    assert.equal(first.status, 200);

    // Advance: the learner starts the next level and is now standing on it.
    const started = await levelState.startCurrentCurriculumLevel({ actorUserId: l.userId });
    assert.equal(started.kind, "started");
    assert.notEqual(started.levelDefinition.id, l1.id, "the learner should now be past L1");

    const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow({
      where: { userId: l.userId },
    });
    const progressBefore = await prisma.userLevelProgress.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { id: "asc" },
    });

    const replay = await owReg(l.clickId, playerId);
    assert.equal(replay.status, 200, "an identical replay is acknowledged");

    const progressAfter = await prisma.userLevelProgress.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { id: "asc" },
    });
    assert.equal(progressAfter.length, progressBefore.length, "a replay created progress");
    for (let i = 0; i < progressAfter.length; i += 1) {
      assert.equal(progressAfter[i].status, progressBefore[i].status);
      assert.equal(progressAfter[i].levelDefinitionId, progressBefore[i].levelDefinitionId);
    }
    assert.equal(
      await prisma.growthEvent.count({ where: { eventType: "pocket_reg", userId: l.userId } }),
      1,
      "a replay emitted a second canonical event",
    );
    assert.equal(
      await prisma.pocketTraderIdentity.count({ where: { userId: l.userId } }),
      1,
    );
  });

  await check("B4 DEP stays fail-closed while only REG is on", async () => {
    const l = await learner();
    await enrol(l.userId);
    const before = await counts();
    const r = await call({
      clickid: l.clickId,
      goal: "dep",
      ow: SECRET,
      playerid: nextPlayerId(),
      sum: "55.01",
    });
    assert.equal(r.status, 503, "dep with its family off must be unavailable");
    const after = await counts();
    assert.equal(after.provider, before.provider, "a disabled DEP wrote a provider event");
    assert.equal(after.growth, before.growth);
    assert.equal(after.outbox, before.outbox);
  });

  await check("B5 RDEP stays fail-closed while only REG is on", async () => {
    const l = await learner();
    await enrol(l.userId);
    const before = await counts();
    const r = await call({
      clickid: l.clickId,
      goal: "redep",
      ow: SECRET,
      playerid: nextPlayerId(),
      sum: "205.10",
    });
    assert.equal(r.status, 503, "redep with its family off must be unavailable");
    const after = await counts();
    assert.equal(after.ingress, before.ingress, "a disabled RDEP wrote ingress evidence");
    assert.equal(after.growth, before.growth);
  });

  await check("Z no XP anywhere and no secret in any stored row", async () => {
    assert.equal(await prisma.xPTransaction.count(), 0);
    const audits = await prisma.auditLog.findMany({ select: { metadata: true } });
    for (const a of audits) {
      const text = JSON.stringify(a.metadata ?? {});
      assert.ok(!text.includes(SECRET), "an audit row retained the secret");
    }
  });

  console.log(`\nPOCKET-REG-INGRESS-1 phase matrix: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
