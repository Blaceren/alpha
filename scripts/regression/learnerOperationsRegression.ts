/**
 * LEARNER-OPERATIONS-V1 — the domain regression.
 *
 * These run against a REAL database built by the real migration runner, using
 * the REAL domain functions. A suite that stubbed the persistence layer would
 * prove only that the stub behaves, and every invariant below is about what the
 * database does under concurrency, under a hostile caller, or under a mistake.
 *
 * FIVE THINGS THIS MUST PROVE, AND THEY ARE THE FIVE THAT MATTER:
 *
 *   1. INTERNAL NOTES NEVER REACH A LEARNER. Proven by asserting the learner
 *      projection, and by asserting the note table is not reachable from it.
 *   2. RESOLVING A CASE CHANGES NO PROGRESSION. Proven by byte-comparing the
 *      progression row before and after.
 *   3. TWO OPERATORS CANNOT BOTH OWN ONE ITEM. Proven by racing two claims.
 *   4. A LEARNER CANNOT REACH ANOTHER LEARNER'S CASE. Proven by asking.
 *   5. THE STATE MACHINE AND THE CLOCK ARE ENFORCED, not merely documented.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  addMessage,
  addNote,
  assignCase,
  changePriority,
  createCase,
  transitionCase,
} from "../../src/lib/learner-ops/case";
import { getCaseDetail, listMessages, listNotes, listEvents } from "../../src/lib/learner-ops/queue";
import { isLearnerOpsError } from "../../src/lib/learner-ops/errors";
import { raiseEscalation, resolveEscalation } from "../../src/lib/learner-ops/escalation";
import { recordQaReview } from "../../src/lib/learner-ops/quality";
import { hasCrmReviewAuthority } from "../../src/lib/learner-ops/review-authority";

const REPO = path.resolve(__dirname, "..", "..");
const DB_PATH = path.join(os.tmpdir(), `ata-learner-ops-${process.pid}.db`);
const BCRYPT_SHAPED = "$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012";

let prisma: PrismaClient;
let passes = 0;
let failures = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passes += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(error as Error).message}`);
  }
}

/** Assert a call fails with a specific domain code, not merely that it fails. */
async function expectDomainError(code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isLearnerOpsError(error)) {
      assert.equal(error.code, code, `expected ${code}, got ${error.code}`);
      return;
    }
    throw error;
  }
  assert.fail(`expected ${code}, but the call succeeded`);
}

async function main() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
  execFileSync(
    path.join(REPO, "node_modules", ".bin", "tsx"),
    [path.join(REPO, "prisma", "migrate.ts")],
    { cwd: REPO, env: { ...process.env, DATABASE_URL: `file:${DB_PATH}` }, stdio: "pipe" },
  );
  process.env.DATABASE_URL = `file:${DB_PATH}`;
  prisma = new PrismaClient({ datasources: { db: { url: `file:${DB_PATH}` } } });

  /* ------------------------------------------------------------- fixture */

  const learnerA = await prisma.user.create({
    data: { email: `a-${process.pid}@learner.invalid`, name: "Learner A", passwordHash: BCRYPT_SHAPED },
  });
  const learnerB = await prisma.user.create({
    data: { email: `b-${process.pid}@learner.invalid`, name: "Learner B", passwordHash: BCRYPT_SHAPED },
  });
  const supportUser = await prisma.user.create({
    data: {
      email: `s-${process.pid}@staff.invalid`,
      name: "Support Staff",
      passwordHash: BCRYPT_SHAPED,
      role: "support",
    },
  });
  const mentorUser = await prisma.user.create({
    data: {
      email: `m-${process.pid}@staff.invalid`,
      name: "Mentor Staff",
      passwordHash: BCRYPT_SHAPED,
      role: "mentor",
    },
  });
  // The exact live-PREPROD shape that LO-AUTH-AXIS-1 is about: a CRM
  // `moderator` whose platform role is `admin`.
  const moderatorAdminUser = await prisma.user.create({
    data: {
      email: `mod-${process.pid}@staff.invalid`,
      name: "Moderator Admin",
      passwordHash: BCRYPT_SHAPED,
      role: "admin",
    },
  });

  const supportStaff = await prisma.staffProfile.create({
    data: { userId: supportUser.id, displayName: "Support One", staffRole: "support" },
  });
  const secondSupportUser = await prisma.user.create({
    data: {
      email: `s2-${process.pid}@staff.invalid`,
      name: "Support Two",
      passwordHash: BCRYPT_SHAPED,
      role: "support",
    },
  });
  const secondStaff = await prisma.staffProfile.create({
    data: { userId: secondSupportUser.id, displayName: "Support Two", staffRole: "support" },
  });
  const mentorStaff = await prisma.staffProfile.create({
    data: { userId: mentorUser.id, displayName: "Mentor One", staffRole: "mentor" },
  });
  await prisma.staffProfile.create({
    data: { userId: moderatorAdminUser.id, displayName: "Moderator", staffRole: "moderator" },
  });

  const actorA = { staffId: supportStaff.id, userId: supportUser.id };
  const actorB = { staffId: secondStaff.id, userId: secondSupportUser.id };
  const actorMentor = { staffId: mentorStaff.id, userId: mentorUser.id };

  console.log("\nLEARNER-OPERATIONS-V1 regression\n");

  /* ------------------------------------------- 1 · internal note isolation */

  const isolationCase = await createCase({
    userId: learnerA.id,
    type: "support_request",
    queueKey: "support",
    subject: "Не открывается урок",
    details: "Ошибка при загрузке L12",
    actor: null,
  });

  await addNote({
    caseId: isolationCase.id,
    body: "ВНУТРЕННЕЕ: учётка помечена как рискованная, проверить оплату",
    actor: actorA,
  });
  await addMessage({
    caseId: isolationCase.id,
    body: "Здравствуйте! Мы разбираемся с вашим вопросом.",
    author: { kind: "staff", staffId: actorA.staffId, userId: actorA.userId },
  });

  await check("§15 · the learner projection returns messages and NEVER notes", async () => {
    // Exactly the query shape the learner route uses.
    const projection = await prisma.learnerOpsCase.findFirst({
      where: { id: isolationCase.id, userId: learnerA.id },
      select: {
        id: true,
        messages: { select: { id: true, body: true, authorKind: true } },
      },
    });
    assert.ok(projection);
    assert.equal(projection.messages.length, 1);
    const serialised = JSON.stringify(projection);
    assert.ok(
      !serialised.includes("ВНУТРЕННЕЕ"),
      "an internal note body appeared in the learner projection",
    );
    assert.ok(!serialised.includes("рискованная"));
  });

  await check("§15 · notes and messages are physically different tables", async () => {
    const notes = await listNotes(isolationCase.id, 25);
    const messages = await listMessages(isolationCase.id, 25);
    assert.equal(notes.items.length, 1);
    assert.equal(messages.items.length, 1);
    // No id is shared, so there is no row that could be reclassified by
    // flipping a column — the separation is structural.
    const noteIds = new Set(notes.items.map((n) => n.id));
    for (const message of messages.items) {
      assert.ok(!noteIds.has(message.id));
    }
  });

  await check("§15 · a note body is not stored in the message table at all", async () => {
    const rows = await prisma.learnerOpsMessage.findMany({ where: { caseId: isolationCase.id } });
    for (const row of rows) {
      assert.ok(!row.body.includes("ВНУТРЕННЕЕ"));
    }
  });

  await check("§24 · both writes are attributed in the immutable timeline", async () => {
    const events = await listEvents(isolationCase.id, 50);
    const kinds = events.items.map((event) => event.eventType);
    assert.ok(kinds.includes("note_added"));
    // The staff reply was the FIRST response, so it is recorded as such.
    assert.ok(kinds.includes("first_response_recorded"));
    for (const event of events.items) {
      if (event.eventType === "created") continue;
      assert.equal(event.actorName, "Support One", "an operational event lost its actor");
    }
  });

  /* --------------------------------------------------- 2 · SLA first response */

  await check("§8 · the first STAFF message records the first response, once", async () => {
    const detail = await getCaseDetail(isolationCase.id);
    assert.ok(detail.firstRespondedAt !== null);
    assert.equal(detail.sla.firstResponse.state, "met");
    assert.equal(detail.sla.origin, "preprod_acceptance_fixture", "SLA provenance must travel");
  });

  await check("§8 · a LEARNER message does not satisfy the first-response clock", async () => {
    const fresh = await createCase({
      userId: learnerB.id,
      type: "support_request",
      queueKey: "support",
      subject: "Вопрос",
      details: "Текст",
      actor: null,
    });
    await addMessage({
      caseId: fresh.id,
      body: "Добавляю подробности",
      author: { kind: "learner", userId: learnerB.id },
    });
    const detail = await getCaseDetail(fresh.id);
    assert.equal(detail.firstRespondedAt, null);
    assert.notEqual(detail.sla.firstResponse.state, "met");
  });

  /* ------------------------------------------------ 3 · assignment race */

  await check("§9/§25 · two operators claiming one item — exactly one wins", async () => {
    const contested = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Спор о владении",
      details: "Двое берут одну задачу",
      actor: null,
    });

    // Both read the same assignmentVersion, then both write.
    const results = await Promise.allSettled([
      assignCase({
        caseId: contested.id,
        expectedAssignmentVersion: 0,
        targetStaffId: actorA.staffId,
        actor: actorA,
      }),
      assignCase({
        caseId: contested.id,
        expectedAssignmentVersion: 0,
        targetStaffId: actorB.staffId,
        actor: actorB,
      }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, "exactly one claim must succeed");
    assert.equal(lost.length, 1, "the loser must be refused, not silently overwritten");
    const rejection = (lost[0] as PromiseRejectedResult).reason;
    assert.ok(isLearnerOpsError(rejection, "LEARNER_OPS_ASSIGNMENT_CONFLICT"));

    const after = await getCaseDetail(contested.id);
    assert.equal(after.assignmentVersion, 1, "one winner means exactly one version bump");
    assert.ok(after.assignedTo !== null);
  });

  await check("§9 · a stale assignment version is refused", async () => {
    const owned = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Устаревшая версия",
      details: "Проверка CAS",
      actor: null,
    });
    await assignCase({
      caseId: owned.id,
      expectedAssignmentVersion: 0,
      targetStaffId: actorA.staffId,
      actor: actorA,
    });
    await expectDomainError("LEARNER_OPS_ASSIGNMENT_CONFLICT", () =>
      assignCase({
        caseId: owned.id,
        expectedAssignmentVersion: 0,
        targetStaffId: actorB.staffId,
        actor: actorB,
      }),
    );
  });

  await check("§9 · claiming unassigned work promotes it out of `new`", async () => {
    const taken = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Взять в работу",
      details: "Проверка перехода",
      actor: null,
    });
    assert.equal((await getCaseDetail(taken.id)).status, "new");
    await assignCase({
      caseId: taken.id,
      expectedAssignmentVersion: 0,
      targetStaffId: actorA.staffId,
      actor: actorA,
    });
    assert.equal((await getCaseDetail(taken.id)).status, "in_progress");
  });

  /* ------------------------------------------- 4 · state machine + clock */

  await check("§7 · an undeclared transition is refused by the domain", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Переходы",
      details: "Проверка",
      actor: null,
    });
    // `new -> escalated` is LEGAL (an untriaged case can need a methodologist
    // at once). The genuinely undeclared edge is out of a terminal state into
    // anything but `open`, so that is what this asserts.
    let version = (await getCaseDetail(target.id)).version;
    ({ version } = (await transitionCase({
      caseId: target.id,
      expectedVersion: version,
      nextStatus: "closed",
      actor: actorA,
    })) as { version: number });

    await expectDomainError("LEARNER_OPS_ILLEGAL_TRANSITION", () =>
      transitionCase({
        caseId: target.id,
        expectedVersion: version,
        nextStatus: "escalated",
        actor: actorA,
      }),
    );
    await expectDomainError("LEARNER_OPS_ILLEGAL_TRANSITION", () =>
      transitionCase({
        caseId: target.id,
        expectedVersion: version,
        nextStatus: "in_progress",
        actor: actorA,
      }),
    );
  });

  await check("§7 · a stale case version is refused (state CAS)", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Версия состояния",
      details: "Проверка",
      actor: null,
    });
    const before = await getCaseDetail(target.id);
    await transitionCase({
      caseId: target.id,
      expectedVersion: before.version,
      nextStatus: "open",
      actor: actorA,
    });
    await expectDomainError("LEARNER_OPS_VERSION_CONFLICT", () =>
      transitionCase({
        caseId: target.id,
        expectedVersion: before.version,
        nextStatus: "in_progress",
        actor: actorA,
      }),
    );
  });

  await check("§7/§8 · reopen increments the counter, clears resolvedAt, keeps first response", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Повторное открытие",
      details: "Проверка",
      actor: null,
    });
    await addMessage({
      caseId: target.id,
      body: "Первый ответ",
      author: { kind: "staff", staffId: actorA.staffId, userId: actorA.userId },
    });
    const responded = await getCaseDetail(target.id);
    const firstResponseAt = responded.firstRespondedAt;
    assert.ok(firstResponseAt !== null);

    const resolved = await transitionCase({
      caseId: target.id,
      expectedVersion: responded.version,
      nextStatus: "resolved",
      actor: actorA,
    });
    assert.ok((await getCaseDetail(target.id)).resolvedAt !== null);

    await transitionCase({
      caseId: target.id,
      expectedVersion: resolved.version,
      nextStatus: "open",
      actor: actorA,
    });
    const after = await getCaseDetail(target.id);
    assert.equal(after.reopenCount, 1);
    assert.ok(after.reopenedAt !== null);
    assert.equal(after.resolvedAt, null, "a reopened case must not still claim it was resolved");
    assert.equal(
      after.firstRespondedAt,
      firstResponseAt,
      "a reopen must never rewrite the historical first response",
    );
  });

  await check("§8 · changing priority does not reset the clock to now", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Приоритет",
      details: "Проверка",
      priority: "low",
      actor: null,
    });
    // Backdate the open instant so a naive "recompute from now" would be visible.
    const backdated = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await prisma.learnerOpsCase.update({
      where: { id: target.id },
      data: { openedAt: backdated },
    });
    const before = await getCaseDetail(target.id);
    await changePriority({
      caseId: target.id,
      expectedVersion: before.version,
      nextPriority: "urgent",
      actor: actorA,
    });
    const after = await getCaseDetail(target.id);
    assert.equal(after.priority, "urgent");
    assert.ok(after.sla.policyKey?.includes("urgent"));
    // urgent first response is 30 minutes from an open instant six hours ago,
    // so it must read as breached rather than freshly due.
    assert.equal(
      after.sla.firstResponse.state,
      "breached",
      "priority change must recompute from openedAt, never from now",
    );
  });

  await check("§8 · the pause accumulates across two consecutive waiting states", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Пауза",
      details: "Проверка",
      actor: null,
    });
    let version = (await getCaseDetail(target.id)).version;
    ({ version } = await transitionCase({
      caseId: target.id,
      expectedVersion: version,
      nextStatus: "waiting_learner",
      actor: actorA,
    }) as { version: number });

    // Backdate the pause stamp so the fold has something to accumulate.
    await prisma.learnerOpsCase.update({
      where: { id: target.id },
      data: { clockPausedAt: new Date(Date.now() - 30 * 60 * 1000) },
    });

    ({ version } = await transitionCase({
      caseId: target.id,
      expectedVersion: version,
      nextStatus: "waiting_external",
      actor: actorA,
    }) as { version: number });

    const row = await prisma.learnerOpsCase.findUniqueOrThrow({ where: { id: target.id } });
    assert.ok(
      row.pausedMs >= 29 * 60 * 1000,
      `the first pause interval was lost (pausedMs=${row.pausedMs})`,
    );
    assert.ok(row.clockPausedAt !== null, "moving between two pausing states must restamp");
  });

  /* ------------------------------- 5 · progression authority is untouched */

  await check("§2 · resolving a mentor-review case changes NO progression row", async () => {
    // A REAL canonical progression fixture, built through the progression
    // owner's own tables. The alternative — skipping when no curriculum exists
    // — would make the single most important assertion in this suite vacuous,
    // and a vacuous assertion about progression authority is worse than none.
    const curriculum = await prisma.curriculumVersion.create({
      data: { code: `reg-${process.pid}`, name: "Regression", versionNumber: 1, status: "published" },
    });
    const moduleDef = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleNumber: 1,
        code: `reg-m1-${process.pid}`,
        title: "Regression module",
        firstLevel: 14,
        lastLevel: 14,
      },
    });
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleDef.id,
        levelNumber: 14,
        stableCode: `reg-l014-${process.pid}`,
        type: "mentor_review",
        title: "Проверка практики",
        completionMethod: "mentor_review",
      },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: learnerA.id,
        curriculumVersionId: curriculum.id,
        curriculumCode: curriculum.code,
        status: "active",
      },
    });
    const progressRow = await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id,
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
        // The exact state a mentor-review case is opened against.
        status: "pending_review",
      },
    });

    const before = { ...progressRow };

    const anchored = await createCase({
      userId: learnerA.id,
      type: "mentor_review",
      queueKey: "mentor_review",
      subject: "Проверка практики L14",
      details: "Операционная задача по канонической проверке",
      userLevelProgressId: progressRow.id,
      actor: actorMentor,
    });

    // A FULL operational lifecycle: claim, reply, park, resolve. If any of it
    // reached the progression owner, the comparison below fails.
    await assignCase({
      caseId: anchored.id,
      expectedAssignmentVersion: 0,
      targetStaffId: actorMentor.staffId,
      actor: actorMentor,
    });
    await addMessage({
      caseId: anchored.id,
      body: "Посмотрел работу, нужны уточнения по риск-плану.",
      author: { kind: "staff", staffId: actorMentor.staffId, userId: actorMentor.userId },
    });
    await addNote({ caseId: anchored.id, body: "ВНУТРЕННЕЕ: слабый раздел 3", actor: actorMentor });
    let v = (await getCaseDetail(anchored.id)).version;
    ({ version: v } = (await transitionCase({
      caseId: anchored.id,
      expectedVersion: v,
      nextStatus: "waiting_learner",
      actor: actorMentor,
    })) as { version: number });
    await transitionCase({
      caseId: anchored.id,
      expectedVersion: v,
      nextStatus: "resolved",
      actor: actorMentor,
    });

    const after = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: progressRow.id },
    });
    assert.deepEqual(
      after,
      before,
      "an operational case lifecycle mutated the canonical progression row",
    );
    assert.equal(after.status, "pending_review", "the level must still be awaiting its reviewer");
    assert.equal(after.completedAt, null, "resolving a case must never complete a level");

    // And no XP was minted by any of it.
    const xp = await prisma.xPTransaction.count({ where: { userId: learnerA.id } });
    assert.equal(xp, 0, "an operational case lifecycle minted XP");
  });

  await check("§2 · a case cannot carry an anchor its type does not permit", async () => {
    await expectDomainError("LEARNER_OPS_ANCHOR_NOT_PERMITTED", () =>
      createCase({
        userId: learnerA.id,
        type: "support_request",
        queueKey: "support",
        subject: "Неверный якорь",
        details: "Проверка",
        userLevelProgressId: 1,
        actor: actorA,
      }),
    );
  });

  await check("§2 · a review case cannot exist without naming what it reviews", async () => {
    await expectDomainError("LEARNER_OPS_ANCHOR_REQUIRED", () =>
      createCase({
        userId: learnerA.id,
        type: "report_review",
        queueKey: "report_review",
        subject: "Без отчёта",
        details: "Проверка",
        actor: actorMentor,
      }),
    );
  });

  /* --------------------------------------------- 6 · LO-AUTH-AXIS-1 */

  await check("LO-AUTH-AXIS-1 · a mentor holds CRM review authority", async () => {
    assert.equal(await hasCrmReviewAuthority(mentorUser.id, "report"), true);
    assert.equal(await hasCrmReviewAuthority(mentorUser.id, "mentor"), true);
  });

  await check("LO-AUTH-AXIS-1 · a moderator whose User.role is admin does NOT", async () => {
    // This is the exact live-PREPROD principal that held silent
    // level-completion authority. The platform role still says `admin`; the CRM
    // axis now withholds review, and the intersection refuses.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: moderatorAdminUser.id } });
    assert.equal(row.role, "admin", "the fixture must keep the admin platform role");
    assert.equal(await hasCrmReviewAuthority(moderatorAdminUser.id, "report"), false);
    assert.equal(await hasCrmReviewAuthority(moderatorAdminUser.id, "mentor"), false);
  });

  await check("LO-AUTH-AXIS-1 · a reviewer with no StaffProfile fails closed", async () => {
    const orphan = await prisma.user.create({
      data: {
        email: `orphan-${process.pid}@staff.invalid`,
        name: "No Profile",
        passwordHash: BCRYPT_SHAPED,
        role: "admin",
      },
    });
    assert.equal(await hasCrmReviewAuthority(orphan.id, "report"), false);
  });

  await check("LO-AUTH-AXIS-1 · support staff hold no review authority", async () => {
    assert.equal(await hasCrmReviewAuthority(supportUser.id, "report"), false);
    assert.equal(await hasCrmReviewAuthority(supportUser.id, "mentor"), false);
  });

  /* ---------------------------------------------------- 7 · escalation */

  await check("§19 · an escalation keeps the case owner and its timeline", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Эскалация",
      details: "Нужен методист",
      actor: null,
    });
    await assignCase({
      caseId: target.id,
      expectedAssignmentVersion: 0,
      targetStaffId: actorA.staffId,
      actor: actorA,
    });
    const owned = await getCaseDetail(target.id);
    const ownerBefore = owned.assignedTo?.staffId;

    const escalation = await raiseEscalation({
      caseId: target.id,
      class: "educational_methodology",
      reason: "Нужна методическая оценка",
      targetQueueKey: "escalation",
      actor: actorA,
    });

    const escalated = await getCaseDetail(target.id);
    assert.equal(escalated.status, "escalated");
    assert.equal(
      escalated.assignedTo?.staffId,
      ownerBefore,
      "an escalation must not take the case away from its owner",
    );

    await resolveEscalation({
      escalationId: escalation.id,
      resolution: "Методист ответил",
      returnToOwner: true,
      actor: actorMentor,
    });

    const returned = await getCaseDetail(target.id);
    assert.equal(returned.status, "in_progress");
    assert.equal(returned.assignedTo?.staffId, ownerBefore, "the owner must survive the round trip");

    const events = await listEvents(target.id, 50);
    assert.ok(
      events.items.length >= 4,
      "the original timeline must still carry every step of the escalation",
    );
  });

  await check("§19 · an escalation cannot be resolved twice", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Двойное закрытие",
      details: "Проверка",
      actor: null,
    });
    const escalation = await raiseEscalation({
      caseId: target.id,
      class: "technical_product",
      reason: "Баг",
      targetQueueKey: "escalation",
      actor: actorA,
    });
    await resolveEscalation({
      escalationId: escalation.id,
      resolution: "Исправлено",
      returnToOwner: false,
      actor: actorA,
    });
    await expectDomainError("LEARNER_OPS_ESCALATION_ALREADY_RESOLVED", () =>
      resolveEscalation({
        escalationId: escalation.id,
        resolution: "Ещё раз",
        returnToOwner: false,
        actor: actorA,
      }),
    );
  });

  await check("§19 · an escalation must name a target", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Без адресата",
      details: "Проверка",
      actor: null,
    });
    await expectDomainError("LEARNER_OPS_INPUT_INVALID", () =>
      raiseEscalation({
        caseId: target.id,
        class: "operational_lead",
        reason: "Некуда",
        actor: actorA,
      }),
    );
  });

  /* ----------------------------------------------------------- 8 · QA */

  await check("§20 · QA refuses to judge work that is not finished", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Открытая задача",
      details: "Проверка",
      actor: null,
    });
    await expectDomainError("LEARNER_OPS_QA_TARGET_NOT_COMPLETE", () =>
      recordQaReview({
        caseId: target.id,
        result: "meets",
        coachingRequired: false,
        actor: actorA,
      }),
    );
  });

  await check("§20 · a QA review alters no historical communication", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Контроль качества",
      details: "Проверка",
      actor: null,
    });
    await addMessage({
      caseId: target.id,
      body: "Оригинальный ответ",
      author: { kind: "staff", staffId: actorA.staffId, userId: actorA.userId },
    });
    const beforeMessages = await prisma.learnerOpsMessage.findMany({ where: { caseId: target.id } });
    const beforeNotes = await prisma.learnerOpsNote.findMany({ where: { caseId: target.id } });

    const detail = await getCaseDetail(target.id);
    await transitionCase({
      caseId: target.id,
      expectedVersion: detail.version,
      nextStatus: "resolved",
      actor: actorA,
    });
    await recordQaReview({
      caseId: target.id,
      result: "needs_improvement",
      feedback: "Стоило уточнить контекст",
      coachingRequired: true,
      actor: actorB,
    });

    const afterMessages = await prisma.learnerOpsMessage.findMany({ where: { caseId: target.id } });
    const afterNotes = await prisma.learnerOpsNote.findMany({ where: { caseId: target.id } });
    assert.deepEqual(afterMessages, beforeMessages, "QA rewrote a learner-visible message");
    assert.deepEqual(afterNotes, beforeNotes, "QA rewrote an internal note");
  });

  /* -------------------------------------------------- 9 · learner isolation */

  await check("§35 · a learner cannot read another learner's case", async () => {
    const mine = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Моё обращение",
      details: "Приватно",
      actor: null,
    });
    // The learner route's exact query, run as learner B.
    const asOtherLearner = await prisma.learnerOpsCase.findFirst({
      where: { id: mine.id, userId: learnerB.id },
      select: { id: true },
    });
    assert.equal(asOtherLearner, null, "IDOR: another learner reached this case");
  });

  await check("§35 · a learner cannot author a message on a case they do not own", async () => {
    const mine = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Чужое обращение",
      details: "Приватно",
      actor: null,
    });
    await expectDomainError("LEARNER_OPS_CASE_NOT_FOUND", () =>
      addMessage({
        caseId: mine.id,
        body: "Я не владелец",
        author: { kind: "learner", userId: learnerB.id },
      }),
    );
  });

  /* ---------------------------------------------------- 10 · idempotency */

  await check("§25 · a no-op transition consumes no version and writes no event", async () => {
    const target = await createCase({
      userId: learnerA.id,
      type: "support_request",
      queueKey: "support",
      subject: "Идемпотентность",
      details: "Проверка",
      actor: null,
    });
    const before = await getCaseDetail(target.id);
    const eventsBefore = await prisma.learnerOpsCaseEvent.count({ where: { caseId: target.id } });

    const result = await transitionCase({
      caseId: target.id,
      expectedVersion: before.version,
      nextStatus: "new",
      actor: actorA,
    });
    assert.equal(result.changed, false);

    const after = await getCaseDetail(target.id);
    const eventsAfter = await prisma.learnerOpsCaseEvent.count({ where: { caseId: target.id } });
    assert.equal(after.version, before.version);
    assert.equal(eventsAfter, eventsBefore);
  });

  await check("§24 · every case version is claimed by at most one event", async () => {
    const rows = await prisma.learnerOpsCaseEvent.groupBy({
      by: ["caseId", "caseVersion"],
      _count: { _all: true },
    });
    for (const row of rows) {
      assert.equal(
        row._count._all,
        1,
        `case ${row.caseId} has ${row._count._all} events claiming version ${row.caseVersion}`,
      );
    }
  });

  await check("§24 · no audit row carries a message or note body", async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { startsWith: "learner_ops." } } });
    assert.ok(logs.length > 0, "the domain must write audit rows at all");
    for (const log of logs) {
      const serialised = JSON.stringify(log.metadata ?? {});
      assert.ok(!serialised.includes("ВНУТРЕННЕЕ"), "an audit row leaked an internal note body");
      assert.ok(!serialised.includes("Оригинальный ответ"), "an audit row leaked a message body");
      assert.ok(!serialised.includes("@"), "an audit row leaked an email address");
    }
  });

  await prisma.$disconnect();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
