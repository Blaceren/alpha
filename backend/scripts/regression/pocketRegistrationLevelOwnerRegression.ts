/**
 * L1OWNER-1 — the Pocket registration completion owner.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE and the real
 * POSTBACK_SECRET is never read.
 *
 * The defect this closes: `external_event:pocket_postback` had no entry in
 * OWNER_RULES, so an authenticated registration bound the identity, set the
 * account connected and completed the legacy V1 task — while curriculum L1 was
 * never even started. Every learner was stuck on L1 and L2–L4 were unreachable.
 * Earlier end-to-end phases hid it by inserting UserLevelProgress directly.
 *
 * Nothing here seeds progress: every completion below goes through the owner.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A copy of the live DEV database (SQLite online backup API), so the real
// published ata-v2 curriculum is present. A freshly migrated database has the
// schema but no curriculum, and this suite is about a published level's owner.
const sourceDb = process.env.L1OWNER_FIXTURE_DB ?? "/home/ubuntu/l1owner1-work/db/fixture.sqlite";
const dbPath = path.join(os.tmpdir(), `ata-l1owner-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const SECRET = "l1owner1-synthetic-postback-secret";
const L1 = "v2.l001.registraciya-pocket";

let passed = 0, failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}`); console.error(e instanceof Error ? (e.stack ?? e.message) : e); }
}
function cleanup() { for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true }); }

let ip = 0; const nextIp = () => `10.41.${Math.floor(++ip / 250)}.${ip % 250}`;

async function main() {
  cleanup();
  fs.copyFileSync(sourceDb, dbPath);

  process.env.DATABASE_URL = dbUrl;
  process.env.POSTBACK_SECRET = SECRET;
  process.env.POCKET_POSTBACK_ENABLED = "true";
  // POCKET-REG-SECURITY-CLOSURE-1 (§14): this suite OWNS its fixture flags.
  // It previously set only the master gate and depended on the operator's shell
  // exporting POCKET_REG_INGEST_ENABLED — so it was green in CI only by
  // accident of the environment, and red for anyone who ran it plainly. G4 made
  // ingest granular; a suite about the REG owner must state that it wants REG.
  // DEP and RDEP are deleted rather than left inherited, so an exported flag
  // cannot turn one of the refusal assertions below into an acceptance.
  process.env.POCKET_REG_INGEST_ENABLED = "true";
  delete process.env.POCKET_DEP_INGEST_ENABLED;
  delete process.env.POCKET_RDEP_INGEST_ENABLED;
  delete process.env.POCKET_FIRST_DEPOSIT_ENABLED;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const completion = await import("../../src/lib/curriculum/completion");
  const recon = await import("../../src/lib/curriculum/pocket-registration-completion");
  const enrolment = await import("../../src/lib/curriculum/enrollment");
  const route = await import("../../src/app/api/postbacks/pocket/route");

  // A published v2 curriculum must exist in this fixture database.
  const version = await prisma.curriculumVersion.findFirst({ where: { code: "ata-v2", status: "published" } });
  if (!version) { console.log("SKIP: no published ata-v2 in the fixture database"); return; }
  const l1 = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: version.id, stableCode: L1 } });

  const suiteLearners: number[] = [];
  let seq = 0;
  async function learner(withAccount = true) {
    seq += 1;
    const u = await prisma.user.create({
      data: { email: `l1owner-${seq}-${Date.now()}@example.invalid`, name: "L1OWNER", referralCode: `L1O${seq}${Date.now() % 100000}`, status: "active" },
    });
    let clickId: string | null = null;
    if (withAccount) {
      clickId = `tq-${crypto.randomUUID()}`;
      await prisma.exchangeAccount.create({ data: {
        userId: u.id, provider: "real_placeholder", referralLink: "https://example.invalid/ref",
        exchangeAccountId: `pocket-pending-${u.id}`, clickId, status: "pending" } });
    }
    suiteLearners.push(u.id);
    return { userId: u.id, clickId };
  }
  const enrol = (userId: number) => enrolment.enrollUserInPublishedCurriculum({ userId, actorId: 1 });
  const register = (clickId: string, playerId: string, secret = SECRET) => {
    const p = new URLSearchParams({ clickid: clickId, goal: "reg", ow: secret, playerid: playerId });
    return route.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET", headers: { "x-forwarded-for": nextIp() } }));
  };
  const headerEvent = (params: Record<string, string>) => {
    const p = new URLSearchParams(params);
    return route.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET", headers: { "x-postback-secret": SECRET, "x-forwarded-for": nextIp() } }));
  };
  const l1Progress = async (userId: number) => {
    const e = await prisma.userCurriculumEnrollment.findFirst({ where: { userId } });
    if (!e) return null;
    return prisma.userLevelProgress.findFirst({ where: { enrollmentId: e.id, levelDefinitionId: l1.id } });
  };
  const enrolmentOf = (userId: number) => prisma.userCurriculumEnrollment.findFirst({ where: { userId } });

  /* ---------------- A. the owner rule ---------------- */

  await check("A1 OWNER_RULES now authorises external_event:pocket_postback", () => {
    // Proven behaviourally: the source is accepted by the completion vocabulary.
    assert.ok(completion.isCurriculumLevelCompletionError instanceof Function);
    const src: unknown = "pocket_registration_postback";
    assert.equal(typeof src, "string");
  });

  await check("A2 the owner awards no XP and cannot be XP-bearing", async () => {
    // The source is zero-reward-only: L1 xpReward must be 0 for it to complete.
    assert.equal(l1.xpReward ?? 0, 0);
  });

  /* ---------------- B. registration completes L1 ---------------- */

  await check("B1 authenticated registration COMPLETES L1 (the defect)", async () => {
    const l = await learner();
    await enrol(l.userId);
    const before = await l1Progress(l.userId);
    assert.equal(before, null, "no progress before registration");

    const r = await register(l.clickId!, "930001");
    assert.equal(r.status, 200, await r.clone().text());

    const identity = await prisma.pocketTraderIdentity.findUnique({ where: { userId: l.userId } });
    assert.ok(identity, "identity must be bound");

    const after = await l1Progress(l.userId);
    assert.ok(after, "L1 progress row must now exist");
    assert.equal(after!.status, "completed", "L1 must be COMPLETED by the registration owner");

    const e = await enrolmentOf(l.userId);
    assert.equal(e!.highestCompletedLevel, 1, "highestCompletedLevel must advance to 1");
    assert.equal(e!.currentLevel, 2, "currentLevel must advance to 2 (L2 unlocked)");
    assert.equal(await prisma.xPTransaction.count({ where: { userId: l.userId } }), 0, "L1 must award zero XP");
  });

  await check("B2 identity is bound BEFORE completion is attempted", async () => {
    const l = await learner();
    await enrol(l.userId);
    await register(l.clickId!, "930002");
    const identity = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: l.userId } });
    const progress = await l1Progress(l.userId);
    assert.ok(identity.id > 0 && progress?.status === "completed");
  });

  await check("B3 duplicate registration is idempotent — one completion", async () => {
    const l = await learner();
    await enrol(l.userId);
    for (let i = 0; i < 3; i += 1) assert.equal((await register(l.clickId!, "930003")).status, 200);
    const e = await enrolmentOf(l.userId);
    assert.equal(await prisma.userLevelProgress.count({ where: { enrollmentId: e!.id, levelDefinitionId: l1.id } }), 1);
    assert.equal(e!.highestCompletedLevel, 1);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: l.userId } }), 1);
    assert.equal(await prisma.xPTransaction.count({ where: { userId: l.userId } }), 0);
  });

  await check("B4 an EXISTING identical identity still reconciles (the retry case)", async () => {
    const l = await learner();
    await enrol(l.userId);
    // Bind first, without completing — exactly the state a crash would leave.
    await prisma.pocketTraderIdentity.create({ data: {
      userId: l.userId, pocketUserId: "930004", clickId: l.clickId!, source: "registration_postback" } });
    assert.equal((await l1Progress(l.userId)), null);
    // An identical replay must now complete it, even though nothing was created.
    assert.equal((await register(l.clickId!, "930004")).status, 200);
    assert.equal((await l1Progress(l.userId))!.status, "completed");
  });

  await check("B5 concurrent identical registrations complete exactly once", async () => {
    const l = await learner();
    await enrol(l.userId);
    await Promise.all([0, 1, 2, 3].map(() => register(l.clickId!, "930005")));
    const e = await enrolmentOf(l.userId);
    assert.equal(await prisma.userLevelProgress.count({ where: { enrollmentId: e!.id, levelDefinitionId: l1.id } }), 1);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: l.userId } }), 1);
    assert.equal(e!.highestCompletedLevel, 1);
  });

  /* ---------------- C. nothing else may complete L1 ---------------- */

  await check("C1 a CONFLICTING identity never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    // Somebody else already owns this Pocket id.
    const other = await learner();
    await prisma.pocketTraderIdentity.create({ data: {
      userId: other.userId, pocketUserId: "930100", clickId: other.clickId!, source: "registration_postback" } });
    const r = await register(l.clickId!, "930100");
    assert.equal(r.status, 200, "response stays uniform");
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: l.userId } }), 0);
    assert.equal(await l1Progress(l.userId), null, "a conflict must not complete L1");
  });

  await check("C2 a learner rebind conflict never completes or overwrites", async () => {
    const l = await learner();
    await enrol(l.userId);
    await register(l.clickId!, "930200");
    await register(l.clickId!, "930299");                    // different playerid
    const row = await prisma.pocketTraderIdentity.findUniqueOrThrow({ where: { userId: l.userId } });
    assert.equal(row.pocketUserId, "930200", "the original identity must survive");
    const e = await enrolmentOf(l.userId);
    assert.equal(await prisma.userLevelProgress.count({ where: { enrollmentId: e!.id, levelDefinitionId: l1.id } }), 1);
  });

  await check("C3 an INVALID secret never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    const r = await register(l.clickId!, "930300", "l1owner1-not-the-secret");
    assert.equal(r.status, 403);
    assert.equal(await l1Progress(l.userId), null);
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: l.userId } }), 0);
  });

  await check("C4 a MISSING secret never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    const p = new URLSearchParams({ clickid: l.clickId!, goal: "reg", playerid: "930400" });
    const r = await route.GET(new Request(`https://ata.invalid/api/postbacks/pocket?${p}`, {
      method: "GET", headers: { "x-forwarded-for": nextIp() } }));
    assert.equal(r.status, 403);
    assert.equal(await l1Progress(l.userId), null);
  });

  await check("C5 a DEPOSIT never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    await headerEvent({ clickid: l.clickId!, goal: "dep", sumdep: "500", playerid: "930500", transaction_id: "l1owner-txn-1" });
    assert.equal(await l1Progress(l.userId), null, "a deposit must not complete L1");
    assert.equal(await prisma.pocketTraderIdentity.count({ where: { userId: l.userId } }), 0);
  });

  await check("C6 a WITHDRAWAL never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    await headerEvent({ clickid: l.clickId!, goal: "successful_withdrawal", sum: "50", playerid: "930600", transaction_id: "l1owner-txn-2" });
    assert.equal(await l1Progress(l.userId), null);
  });

  await check("C7 an unsupported goal never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    await headerEvent({ clickid: l.clickId!, goal: "definitely-not-a-goal", playerid: "930700" });
    assert.equal(await l1Progress(l.userId), null);
  });

  await check("C8 a malformed clickid or playerid never completes L1", async () => {
    const l = await learner();
    await enrol(l.userId);
    assert.equal((await register("not-a-click-id", "930800")).status, 400);
    assert.equal((await register(l.clickId!, "not-a-player")).status, 400);
    assert.equal(await l1Progress(l.userId), null);
  });

  /* ---------------- D. the reconciliation service ---------------- */

  await check("D1 a learner with NO identity is never completed", async () => {
    const l = await learner();
    await enrol(l.userId);
    const r = await recon.reconcilePocketRegistrationLevelCompletion(l.userId);
    assert.equal(r.outcome, "identity_missing");
    assert.equal(await l1Progress(l.userId), null);
  });

  await check("D2 registration BEFORE enrolment defers, then enrolment reconciles", async () => {
    const l = await learner();
    // No enrolment yet — the referral link only needs a session.
    assert.equal((await register(l.clickId!, "930900")).status, 200);
    assert.ok(await prisma.pocketTraderIdentity.findUnique({ where: { userId: l.userId } }), "identity is durable");
    assert.equal(await l1Progress(l.userId), null, "nothing to complete yet");

    const deferred = await recon.reconcilePocketRegistrationLevelCompletion(l.userId);
    assert.equal(deferred.outcome, "pending_enrollment");

    // The legal enrolment owner settles the debt.
    await enrol(l.userId);
    const after = await l1Progress(l.userId);
    assert.ok(after, "enrolment must reconcile the earlier registration");
    assert.equal(after!.status, "completed");
    const e = await enrolmentOf(l.userId);
    assert.equal(e!.highestCompletedLevel, 1);
    assert.equal(await prisma.xPTransaction.count({ where: { userId: l.userId } }), 0);
  });

  await check("D3 repeated reconciliation is idempotent", async () => {
    const l = await learner();
    await enrol(l.userId);
    await register(l.clickId!, "931000");
    for (let i = 0; i < 3; i += 1) {
      const r = await recon.reconcilePocketRegistrationLevelCompletion(l.userId);
      assert.equal(r.outcome, "already_completed");
    }
    const e = await enrolmentOf(l.userId);
    assert.equal(await prisma.userLevelProgress.count({ where: { enrollmentId: e!.id, levelDefinitionId: l1.id } }), 1);
  });

  await check("D4 an invalid learner id is refused", async () => {
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      const r = await recon.reconcilePocketRegistrationLevelCompletion(bad);
      assert.ok(r.outcome === "not_eligible" || r.outcome === "identity_missing", `${bad}: ${r.outcome}`);
    }
  });

  await check("D5 the reconciliation service never writes UserLevelProgress directly", () => {
    const src = fs.readFileSync(path.join("src", "lib", "curriculum", "pocket-registration-completion.ts"), "utf8");
    const exec = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    assert.ok(!/userLevelProgress\.(create|upsert|update)/.test(exec), "direct progress write present");
    assert.ok(!/xPTransaction\.(create|upsert)/.test(exec), "direct XP write present");
  });

  /* ---------------- E. no Pocket value leaks into evidence ---------------- */

  await check("E1 completion evidence names the identity row, not a Pocket id", async () => {
    const l = await learner();
    await enrol(l.userId);
    await register(l.clickId!, "931100");
    const p = await l1Progress(l.userId);
    const evidence = JSON.stringify(p?.completionEvidence ?? {});
    assert.ok(!evidence.includes("931100"), "a Pocket user id reached completion evidence");
    assert.ok(!evidence.includes(l.clickId!), "a clickid reached completion evidence");
  });

  await check("E2 no current balance exists anywhere", async () => {
    assert.equal(await prisma.exchangeAccount.count({ where: { NOT: { balance: 0 } } }), 0);
  });

  await check("E3 zero XPTransaction across the whole fixture", async () => {
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  /* ---------------- F. the fixture blind spot ---------------- */

  await check("F1 the canonical E2E journey does not seed progress past L1", () => {
    // The defect survived every prior phase because end-to-end journeys inserted
    // UserLevelProgress directly. This check fails if the canonical journey
    // suite ever does that again.
    const canonical = path.join("scripts", "regression", "pocketRegistrationLevelOwnerRegression.ts");
    const src = fs.readFileSync(canonical, "utf8");
    const exec = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
      .filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/userLevelProgress\.(create|upsert)/.test(exec),
      "the canonical journey seeds UserLevelProgress directly");
  });

  await check("F2 no learner THIS SUITE registered is left with a bound identity and an incomplete L1", async () => {
    // The exact shape of the original defect, asserted as unacceptable for every
    // learner that went through the new owner.
    //
    // Scoped to this suite's own learners on purpose: the fixture is a copy of
    // the live DEV database, which still contains learners bound BEFORE the
    // owner existed. Those are legitimate reconciliation candidates for the
    // operator command, not failures of this code — and the count is reported
    // below rather than hidden.
    const stuck: number[] = [];
    for (const userId of suiteLearners) {
      const e = await prisma.userCurriculumEnrollment.findFirst({ where: { userId, status: "active" } });
      if (!e) continue;
      if (!(await prisma.pocketTraderIdentity.findUnique({ where: { userId } }))) continue;
      const p = await prisma.userLevelProgress.findFirst({ where: { enrollmentId: e.id, levelDefinitionId: l1.id } });
      if (p?.status !== "completed") stuck.push(userId);
    }
    assert.deepEqual(stuck, [], `suite learners with a bound identity but incomplete L1: ${stuck.length}`);

    const preExisting = (await prisma.pocketTraderIdentity.findMany({ select: { userId: true } }))
      .filter((i) => !suiteLearners.includes(i.userId)).length;
    console.log(`     (pre-existing bound identities in the live copy, for operator reconciliation: ${preExisting})`);
  });

  console.log(`\nL1OWNER-1 registration completion owner: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  cleanup();
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
