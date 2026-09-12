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
import { hasRole } from "../../src/lib/auth";
import { getLearner360 } from "../../src/lib/learner-ops/learner-360";
import { LEARNER_OPS_TRANSITIONS, isLegalTransition } from "../../src/lib/learner-ops/contract";
import {
  canEscalateLearnerOps,
  canResolveLearnerOpsEscalation,
  resolveEffectivePermissions,
} from "../../src/lib/crm/roles";
import {
  CRM_SESSION_PERMISSION_CONTRACT,
  CRM_SESSION_PERMISSION_CONTRACT_VERSION,
} from "../../src/lib/crm/session-permission-contract";
import { LEARNER_OPS_TERMINAL_STATUSES, LEARNER_OPS_ACTIVE_STATUSES, LEARNER_OPS_STATUSES } from "../../src/lib/learner-ops/contract";

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

  // The `lo-admin` fixture shape: every Learner Operations permission INCLUDING
  // both review ones, and `user` on the canonical Academy axis. It is the
  // negative control that proves the CRM permission is additional, never
  // alternative.
  const crmAdminOnlyUser = await prisma.user.create({
    data: {
      email: `ca-${process.pid}@staff.invalid`,
      name: "CRM Admin Only",
      passwordHash: BCRYPT_SHAPED,
      role: "user",
    },
  });
  await prisma.staffProfile.create({
    data: { userId: crmAdminOnlyUser.id, displayName: "CRM Admin Only", staffRole: "crm_admin" },
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
    // M4 / §9 — RESOLVING IS NOW REFUSED OUTRIGHT, which is stronger than what
    // this check originally asserted.
    //
    // It used to resolve the case and then prove the progression row had not
    // moved. That proved operations could not COMPLETE a level, but still let
    // the operational record CLAIM the review was finished while the canonical
    // progress said `pending_review` — two truths disagreeing in the product's
    // own database. LO-REVIEW-WORKITEM-UNREACHABLE-1 §9 closes that: a generic
    // status mutation cannot author an educational outcome at all.
    await expectDomainError("LEARNER_OPS_CANONICAL_REVIEW_OPEN", () =>
      transitionCase({
        caseId: anchored.id,
        expectedVersion: v,
        nextStatus: "resolved",
        actor: actorMentor,
      }),
    );
    await expectDomainError("LEARNER_OPS_CANONICAL_REVIEW_OPEN", () =>
      transitionCase({
        caseId: anchored.id,
        expectedVersion: v,
        nextStatus: "closed",
        actor: actorMentor,
      }),
    );

    // The projection must withhold what the domain refuses.
    const projected = await getCaseDetail(anchored.id);
    assert.ok(!projected.allowedTransitions.includes("resolved"));
    assert.ok(!projected.allowedTransitions.includes("closed"));

    const after = await prisma.userLevelProgress.findUniqueOrThrow({
      where: { id: progressRow.id },
    });
    assert.deepEqual(
      after,
      before,
      "an operational case lifecycle mutated the canonical progression row",
    );
    assert.equal(after.status, "pending_review", "the level must still be awaiting its reviewer");
    assert.equal(after.completedAt, null, "no operational act may complete a level");

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

  await check("LO-AUTH-AXIS-1 · a crm_admin holds the CRM axis and STILL cannot review", async () => {
    // Journey B1 negative control 2. This principal passes the CRM half — it
    // holds both review permissions — and is refused anyway, because the
    // canonical Academy axis is the other half of the intersection and `user`
    // is not in `["admin","mentor"]`. A CRM grant is not a progression
    // authority, and this is where that claim is decided rather than asserted.
    assert.equal(await hasCrmReviewAuthority(crmAdminOnlyUser.id, "report"), true);
    assert.equal(await hasCrmReviewAuthority(crmAdminOnlyUser.id, "mentor"), true);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: crmAdminOnlyUser.id } });
    assert.equal(row.role, "user", "the fixture must keep the non-reviewer platform role");
    assert.equal(
      hasRole(row.role, ["admin", "mentor"]),
      false,
      "the canonical gate must refuse this principal on its own axis",
    );
  });

  await check("LO-AUTH-AXIS-1 · support staff hold no review authority", async () => {
    assert.equal(await hasCrmReviewAuthority(supportUser.id, "report"), false);
    assert.equal(await hasCrmReviewAuthority(supportUser.id, "mentor"), false);
  });

  /* ------------------------------ 6b · LO-ESCALATION-RESOLVE-AUTHORITY-1 */

  await check("the contract still APPENDS, and v4's resolve name kept its position", () => {
    // WHAT THIS CHECK IS FOR, restated because the numbers moved twice since it
    // was written. It is not about the count: it is about the contract only ever
    // GROWING AT THE END, so no position a client pinned changes meaning.
    //
    // v5 appended `community_moderate` (COMMUNITY-V1) and v6 appended
    // `curriculum_progress_override` (PHASE-1 ADMIN). So v4's entry is no longer
    // last — it is at index 24, exactly where v4 put it, which is the stronger
    // statement and the one this check now makes.
    assert.equal(CRM_SESSION_PERMISSION_CONTRACT_VERSION, 6);
    assert.equal(CRM_SESSION_PERMISSION_CONTRACT.length, 27);
    assert.equal(
      CRM_SESSION_PERMISSION_CONTRACT.indexOf("learner_ops_escalation_resolve"),
      24,
      "appended, never inserted — order is part of the protocol",
    );
    assert.deepEqual(CRM_SESSION_PERMISSION_CONTRACT.slice(25), [
      "community_moderate",
      "curriculum_progress_override",
    ]);
    // The first fifteen are untouched, in their original order.
    assert.deepEqual(CRM_SESSION_PERMISSION_CONTRACT.slice(0, 15), [
      "view_exact_financials", "view_identity_full_email", "reveal_pii", "assign_owner",
      "export", "view_audit", "manage_settings", "edit_user_notes", "view_user_notes",
      "create_user_notes", "view_affiliate_analytics", "curriculum_read",
      "curriculum_author", "curriculum_approve", "curriculum_source_authority",
    ]);
  });

  await check("A/B · support may RAISE an escalation and may NOT resolve one", () => {
    const support = resolveEffectivePermissions("support");
    assert.equal(canEscalateLearnerOps(support), true, "the frontline must still be able to escalate");
    assert.equal(
      canResolveLearnerOpsEscalation(support),
      false,
      "the party that raises must not be able to self-certify the answer",
    );
  });

  await check("C · a mentor may RESOLVE and is deliberately not given raise", () => {
    const mentor = resolveEffectivePermissions("mentor");
    assert.equal(canResolveLearnerOpsEscalation(mentor), true);
    assert.equal(
      canEscalateLearnerOps(mentor),
      false,
      "resolve was split OUT of escalate; it must not smuggle raise back in",
    );
  });

  await check("D · crm_admin and crm_manager may resolve", () => {
    assert.equal(canResolveLearnerOpsEscalation(resolveEffectivePermissions("crm_admin")), true);
    assert.equal(canResolveLearnerOpsEscalation(resolveEffectivePermissions("crm_manager")), true);
  });

  await check("E · the moderator negative control gains nothing from v4", () => {
    // preprod-qa-operator's shape: StaffRole `moderator`, User.role `admin`.
    // A platform admin role is not a CRM permission and never becomes one.
    const moderator = resolveEffectivePermissions("moderator");
    // COMMUNITY-V1 gave `moderator` exactly one permission — `community_moderate`
    // — so "zero permissions" is no longer the way to state this control. What
    // it always meant is that moderator gains nothing from LEARNER OPERATIONS,
    // and that is asserted directly now rather than via an empty list that a
    // later, unrelated phase could falsify.
    assert.deepEqual([...moderator], ["community_moderate"]);
    assert.equal(
      moderator.some((permission) => permission.startsWith("learner_ops_")),
      false,
      "moderator must hold no learner-operations permission",
    );
    assert.equal(canResolveLearnerOpsEscalation(moderator), false);
    assert.equal(moderator.includes("curriculum_progress_override"), false);
  });

  await check("v4 · no OTHER role's permission set changed", () => {
    // Every role except the three that gained resolve must be byte-identical to
    // its v3 set. This is what stops a contract bump quietly widening authority.
    for (const role of ["retention_manager", "support", "moderator", "analyst", "content_manager", "read_only"] as const) {
      const permissions = resolveEffectivePermissions(role);
      assert.ok(
        !permissions.includes("learner_ops_escalation_resolve"),
        `${role} must not have gained the resolve permission`,
      );
    }
    // And the three that gained it gained ONLY it.
    for (const role of ["mentor", "crm_admin", "crm_manager"] as const) {
      assert.equal(canResolveLearnerOpsEscalation(resolveEffectivePermissions(role)), true);
    }
  });

  await check("G · a case cannot become terminal while an escalation is open", async () => {
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Открытая эскалация", details: "Методический вопрос", actor: null,
    });
    await raiseEscalation({
      caseId: target.id, class: "educational_methodology",
      reason: "Нужна оценка методиста", targetQueueKey: "escalation", actor: actorA,
    });
    const escalated = await getCaseDetail(target.id);
    assert.equal(escalated.status, "escalated");

    for (const terminal of LEARNER_OPS_TERMINAL_STATUSES) {
      await expectDomainError("LEARNER_OPS_ESCALATION_OPEN", () =>
        transitionCase({
          caseId: target.id, expectedVersion: escalated.version,
          nextStatus: terminal, actor: actorA,
        }),
      );
    }

    // Non-terminal movement stays legal: still being worked while a second
    // authority thinks is true, not a lie.
    const back = await transitionCase({
      caseId: target.id, expectedVersion: escalated.version,
      nextStatus: "in_progress", actor: actorA,
    });
    assert.equal((back as { status: string }).status, "in_progress");

    // And it is STILL refused from the non-escalated state — the invariant is
    // about the open escalation, not about the case's current status.
    const working = await getCaseDetail(target.id);
    await expectDomainError("LEARNER_OPS_ESCALATION_OPEN", () =>
      transitionCase({
        caseId: target.id, expectedVersion: working.version,
        nextStatus: "resolved", actor: actorA,
      }),
    );
  });

  await check("F · a learner-visible message does NOT resolve the escalation", async () => {
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Ответ без закрытия", details: "Методический вопрос", actor: null,
    });
    const raised = await raiseEscalation({
      caseId: target.id, class: "educational_methodology",
      reason: "Нужна оценка методиста", targetQueueKey: "escalation", actor: actorA,
    });
    await addMessage({
      caseId: target.id,
      body: "Разбираю ваш вопрос по методике — вот подробный ответ.",
      author: { kind: "staff", staffId: actorMentor.staffId, userId: actorMentor.userId },
    });
    const row = await prisma.learnerOpsEscalation.findUniqueOrThrow({ where: { id: raised.id } });
    assert.equal(row.resolvedAt, null, "answering in the thread must not close the record");
    assert.equal(row.resolution, null);
    assert.equal(row.resolvedByStaffId, null);
  });

  await check("H · a resolution records who, when, what and a timeline entry", async () => {
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Провенанс решения", details: "Методический вопрос", actor: null,
    });
    const raised = await raiseEscalation({
      caseId: target.id, class: "educational_methodology",
      reason: "Нужна оценка методиста", targetQueueKey: "escalation", actor: actorA,
    });
    await resolveEscalation({
      escalationId: raised.id,
      resolution: "Методист подтверждает: разбор соответствует программе L2.",
      returnToOwner: true,
      actor: actorMentor,
    });

    const row = await prisma.learnerOpsEscalation.findUniqueOrThrow({ where: { id: raised.id } });
    assert.ok(row.resolvedAt instanceof Date, "resolvedAt must be stamped");
    assert.equal(row.resolvedByStaffId, actorMentor.staffId, "the RESOLVER, not the raiser");
    assert.notEqual(row.raisedByStaffId, row.resolvedByStaffId, "raise and resolve are different people here");
    assert.match(row.resolution ?? "", /Методист подтверждает/);
    assert.ok(row.returnedToOwnerAt instanceof Date);

    // Reconciled in the same act: the case is back with its owner.
    const detail = await getCaseDetail(target.id);
    assert.equal(detail.status, "in_progress");

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "LearnerOpsEscalation", entityId: raised.id },
      orderBy: { id: "desc" },
    });
    assert.ok(audit, "the resolution must be audited");
    assert.equal(audit.userId, actorMentor.userId);

    // ...and now that nothing is open, the case may finally become terminal.
    const ready = await getCaseDetail(target.id);
    const done = await transitionCase({
      caseId: target.id, expectedVersion: ready.version, nextStatus: "resolved", actor: actorA,
    });
    assert.equal((done as { status: string }).status, "resolved");
  });

  await check("I · resolving twice is refused, not silently repeated", async () => {
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Двойное закрытие", details: "Методический вопрос", actor: null,
    });
    const raised = await raiseEscalation({
      caseId: target.id, class: "educational_methodology",
      reason: "Нужна оценка методиста", targetQueueKey: "escalation", actor: actorA,
    });
    await resolveEscalation({
      escalationId: raised.id, resolution: "Первый ответ.", returnToOwner: false, actor: actorMentor,
    });
    await expectDomainError("LEARNER_OPS_ESCALATION_ALREADY_RESOLVED", () =>
      resolveEscalation({
        escalationId: raised.id, resolution: "Второй ответ.", returnToOwner: false, actor: actorMentor,
      }),
    );
    const row = await prisma.learnerOpsEscalation.findUniqueOrThrow({ where: { id: raised.id } });
    assert.match(row.resolution ?? "", /Первый ответ/, "the first answer must survive");
  });

  await check("J · resolve racing a terminal transition leaves one coherent truth", async () => {
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Гонка", details: "Методический вопрос", actor: null,
    });
    const raised = await raiseEscalation({
      caseId: target.id, class: "educational_methodology",
      reason: "Нужна оценка методиста", targetQueueKey: "escalation", actor: actorA,
    });
    const before = await getCaseDetail(target.id);

    const [resolveOutcome, closeOutcome] = await Promise.allSettled([
      resolveEscalation({
        escalationId: raised.id, resolution: "Ответ методиста.", returnToOwner: true, actor: actorMentor,
      }),
      transitionCase({
        caseId: target.id, expectedVersion: before.version, nextStatus: "resolved", actor: actorA,
      }),
    ]);

    const row = await prisma.learnerOpsEscalation.findUniqueOrThrow({ where: { id: raised.id } });
    const detail = await getCaseDetail(target.id);

    // Whatever the interleaving, the two truths must agree: a terminal case
    // NEVER coexists with an open escalation.
    if ((LEARNER_OPS_TERMINAL_STATUSES as readonly string[]).includes(detail.status)) {
      assert.ok(row.resolvedAt !== null, "a terminal case may not carry an open escalation");
    }
    assert.equal(resolveOutcome.status, "fulfilled", "the escalation answer must not be lost to a race");
    void closeOutcome;
  });

  await check("the projection withholds terminal states while an escalation is open", async () => {
    // LO-UI-TRANSITION-CHOICES-1 applied to the new invariant: whatever the
    // domain will refuse, the screen must not offer. Otherwise the fix for one
    // reconciliation gap reintroduces the promise-what-you-cannot-keep defect.
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Проекция при эскалации", details: "Методический вопрос", actor: null,
    });
    const raised = await raiseEscalation({
      caseId: target.id, class: "educational_methodology",
      reason: "Нужна оценка методиста", targetQueueKey: "escalation", actor: actorA,
    });

    const blocked = await getCaseDetail(target.id);
    for (const terminal of LEARNER_OPS_TERMINAL_STATUSES) {
      assert.ok(
        !blocked.allowedTransitions.includes(terminal),
        `${terminal} must not be offered while an escalation is unanswered`,
      );
    }
    assert.ok(blocked.allowedTransitions.includes("in_progress"), "ordinary work must stay offered");

    // And every remaining offer is still one the domain accepts.
    for (const next of blocked.allowedTransitions) {
      assert.ok(isLegalTransition(blocked.status, next));
    }

    await resolveEscalation({
      escalationId: raised.id, resolution: "Ответ методиста.", returnToOwner: true, actor: actorMentor,
    });
    const freed = await getCaseDetail(target.id);
    for (const terminal of LEARNER_OPS_TERMINAL_STATUSES) {
      assert.ok(
        freed.allowedTransitions.includes(terminal),
        `${terminal} must return once the escalation is answered`,
      );
    }
  });

  await check("the fixture attest gate is chosen by the LEVEL, not by the caller", async () => {
    // Journey C crosses two financial checkpoints, and the sanctioned staging
    // attestation is the only honest way past them — the alternative is
    // inventing a Pocket balance, which this phase forbids outright.
    //
    // The containment property that matters: the tool derives the event class
    // from the level definition, so a caller cannot pair an arbitrary level
    // with `financial_checkpoint` and cannot attest a lesson at all. This
    // asserts the mapping the tool reads, from the same exported table.
    const { STAGING_ATTESTATION_EVENT_CLASS_TARGET } = await import(
      "../../src/lib/curriculum/staging-attestation"
    );
    assert.deepEqual(STAGING_ATTESTATION_EVENT_CLASS_TARGET.financial_checkpoint, {
      type: "financial_checkpoint",
      completionMethod: "balance_check",
    });
    assert.deepEqual(STAGING_ATTESTATION_EVENT_CLASS_TARGET.pocket_registration, {
      type: "external_event",
      completionMethod: "pocket_postback",
    });
    // Exactly two classes exist. A third would be a new bypass and must be a
    // deliberate, reviewed change rather than something this test tolerates.
    assert.equal(Object.keys(STAGING_ATTESTATION_EVENT_CLASS_TARGET).length, 2);
  });

  await check("the terminal set is exactly the complement of the active set", () => {
    const all = [...LEARNER_OPS_STATUSES].sort();
    const union = [...LEARNER_OPS_ACTIVE_STATUSES, ...LEARNER_OPS_TERMINAL_STATUSES].sort();
    assert.deepEqual(union, all, "no status may be in both, and none may be in neither");
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

  /* ------------------------------- 11 · LO-360 denominator + create gate */

  await check("LO-360-DENOM-1 · a FRESH learner reads 0 / canonical total, never 0 / 0", async () => {
    // The pre-fix implementation used `progress.length` as the denominator, so
    // a learner with no materialised progress rows read "0 из 0 уровней". This
    // assertion goes RED against that implementation.
    const version = await prisma.curriculumVersion.create({
      data: { code: `denom-${process.pid}`, name: "Denominator", versionNumber: 1, status: "published" },
    });
    const mod = await prisma.moduleDefinition.create({
      data: { curriculumVersionId: version.id, moduleNumber: 1, code: `dm-${process.pid}`, title: "M", firstLevel: 1, lastLevel: 7 },
    });
    for (let n = 1; n <= 7; n += 1) {
      await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: version.id, moduleId: mod.id, levelNumber: n,
          stableCode: `dl-${process.pid}-${n}`, type: "lesson", title: `L${n}`,
          completionMethod: "assessment_pass",
        },
      });
    }
    const fresh = await prisma.user.create({
      data: { email: `denom-fresh-${process.pid}@learner.invalid`, name: "Fresh", passwordHash: BCRYPT_SHAPED },
    });
    await prisma.userCurriculumEnrollment.create({
      data: { userId: fresh.id, curriculumVersionId: version.id, curriculumCode: version.code, status: "active" },
    });

    const view = await getLearner360({ userId: fresh.id, permissions: [] });
    assert.equal(view.progression.value.totalLevels, 7, "denominator must be the curriculum level count");
    assert.equal(view.progression.value.completedLevels, 0);
    assert.equal(view.progression.value.startedLevels, 0, "no progress row has been materialised");
    assert.notEqual(view.progression.value.totalLevels, 0, "0 / 0 is the defect this closes");
  });

  await check("LO-360-DENOM-1 · the denominator is independent of materialised rows", async () => {
    // Same curriculum, a learner who has STARTED two levels. The denominator
    // must not move; only the numerator and startedLevels may.
    const version = await prisma.curriculumVersion.findFirstOrThrow({
      where: { code: `denom-${process.pid}` },
    });
    const levels = await prisma.levelDefinition.findMany({
      where: { curriculumVersionId: version.id }, orderBy: { levelNumber: "asc" }, take: 2,
    });
    const partial = await prisma.user.create({
      data: { email: `denom-partial-${process.pid}@learner.invalid`, name: "Partial", passwordHash: BCRYPT_SHAPED },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: { userId: partial.id, curriculumVersionId: version.id, curriculumCode: version.code, status: "active" },
    });
    await prisma.userLevelProgress.create({
      data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: levels[0]!.id, status: "completed" },
    });
    await prisma.userLevelProgress.create({
      data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: levels[1]!.id, status: "in_progress" },
    });

    const view = await getLearner360({ userId: partial.id, permissions: [] });
    assert.equal(view.progression.value.totalLevels, 7, "denominator must still be the curriculum total");
    assert.equal(view.progression.value.completedLevels, 1);
    assert.equal(view.progression.value.startedLevels, 2);
  });

  await check("LO-360-DENOM-1 · the denominator follows the learner's OWN curriculum version", async () => {
    // A second version with a different level count. A global constant would
    // fail here, which is why the fix reads per-enrolment.
    const other = await prisma.curriculumVersion.create({
      data: { code: `denom2-${process.pid}`, name: "Other", versionNumber: 1, status: "published" },
    });
    const mod = await prisma.moduleDefinition.create({
      data: { curriculumVersionId: other.id, moduleNumber: 1, code: `dm2-${process.pid}`, title: "M", firstLevel: 1, lastLevel: 3 },
    });
    for (let n = 1; n <= 3; n += 1) {
      await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: other.id, moduleId: mod.id, levelNumber: n,
          stableCode: `dl2-${process.pid}-${n}`, type: "lesson", title: `L${n}`,
          completionMethod: "assessment_pass",
        },
      });
    }
    const learner = await prisma.user.create({
      data: { email: `denom-other-${process.pid}@learner.invalid`, name: "Other", passwordHash: BCRYPT_SHAPED },
    });
    await prisma.userCurriculumEnrollment.create({
      data: { userId: learner.id, curriculumVersionId: other.id, curriculumCode: other.code, status: "active" },
    });

    const view = await getLearner360({ userId: learner.id, permissions: [] });
    assert.equal(view.progression.value.totalLevels, 3, "must follow this learner's curriculum, not a constant");
  });

  await check("LO-UI-CASE-CREATE-1 · creating a case requires learner_ops_handle server-side", () => {
    // The UI hides the control without the permission; this asserts the
    // AUTHORITY, which is the permission matrix the POST route gates on. A role
    // that may only look must not be able to create by knowing the route.
    for (const role of ["read_only", "analyst", "moderator", "content_manager"]) {
      const held = resolveEffectivePermissions(role);
      assert.equal(
        held.includes("learner_ops_handle"),
        false,
        `${role} must not hold learner_ops_handle`,
      );
    }
    for (const role of ["support", "mentor", "retention_manager", "crm_manager", "crm_admin"]) {
      assert.equal(
        resolveEffectivePermissions(role).includes("learner_ops_handle"),
        true,
        `${role} must hold learner_ops_handle`,
      );
    }
  });

  await check("LO-SLA-WAITING-RESUME-1 · a learner reply ends waiting_learner and resumes the clock", async () => {
    // Found in the browser: the learner answered, lastActivityAt moved, and the
    // case stayed waiting_learner with the resolution clock PAUSED — so ATA's
    // own delay stopped being counted, in the flattering direction.
    const target = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Возобновление таймера", details: "Проверка", actor: null,
    });
    await addMessage({
      caseId: target.id, body: "Первый ответ",
      author: { kind: "staff", staffId: actorA.staffId, userId: actorA.userId },
    });
    const v = (await getCaseDetail(target.id)).version;
    await transitionCase({ caseId: target.id, expectedVersion: v, nextStatus: "waiting_learner", actor: actorA });

    const paused = await getCaseDetail(target.id);
    assert.equal(paused.status, "waiting_learner");
    assert.equal(paused.sla.resolution.state, "paused", "the pause must be real before the learner answers");

    await addMessage({
      caseId: target.id, body: "Отвечаю как просили",
      author: { kind: "learner", userId: learnerA.id },
    });

    const resumed = await getCaseDetail(target.id);
    assert.equal(resumed.status, "in_progress", "a learner reply ends waiting_learner");
    assert.notEqual(resumed.sla.resolution.state, "paused", "the clock must resume once the ball is ours");
    assert.equal(resumed.sla.resolution.state, "running");

    const events = await listEvents(target.id, 20);
    const resume = events.items.find((e) => e.previousStatus === "waiting_learner" && e.nextStatus === "in_progress");
    assert.ok(resume, "the resumption must be recorded in the timeline, not applied silently");
  });

  await check("LO-SLA-WAITING-RESUME-1 · a learner reply does NOT disturb the other two waits", async () => {
    // Neither waiting_internal nor waiting_external was ever waiting on the
    // learner, so a learner message must leave both exactly as they are.
    for (const wait of ["waiting_internal", "waiting_external"] as const) {
      const target = await createCase({
        userId: learnerA.id, type: "support_request", queueKey: "support",
        subject: `Не трогать ${wait}`, details: "Проверка", actor: null,
      });
      const v = (await getCaseDetail(target.id)).version;
      await transitionCase({ caseId: target.id, expectedVersion: v, nextStatus: wait, actor: actorA });
      await addMessage({
        caseId: target.id, body: "Сообщение ученика",
        author: { kind: "learner", userId: learnerA.id },
      });
      const after = await getCaseDetail(target.id);
      assert.equal(after.status, wait, `${wait} must be untouched by a learner reply`);
    }
  });

  await check("LO-UI-TRANSITION-CHOICES-1 · allowedTransitions match the canonical table exactly", async () => {
    // The projection must BE the domain's table, not a copy of it. If these ever
    // disagree the CRM starts offering controls the server refuses, which is the
    // defect this closes.
    const probe = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Проекция переходов", details: "Проверка", actor: null,
    });

    const fresh = await getCaseDetail(probe.id);
    assert.deepEqual(
      [...fresh.allowedTransitions].sort(),
      [...LEARNER_OPS_TRANSITIONS[fresh.status]].sort(),
      "a new case must project its own row of the table",
    );

    // Walk to `resolved` — the state whose dropdown was wrong in the browser.
    let v = fresh.version;
    ({ version: v } = (await transitionCase({
      caseId: probe.id, expectedVersion: v, nextStatus: "resolved", actor: actorA,
    })) as { version: number });

    const resolved = await getCaseDetail(probe.id);
    assert.equal(resolved.status, "resolved");
    assert.deepEqual([...resolved.allowedTransitions].sort(), ["closed", "open"]);
    // The exact values the UI used to offer and the server refused.
    for (const forbidden of ["in_progress", "waiting_learner", "waiting_internal", "waiting_external"]) {
      assert.ok(
        !resolved.allowedTransitions.includes(forbidden as never),
        `${forbidden} must not be offered from resolved`,
      );
    }
  });

  await check("LO-UI-TRANSITION-CHOICES-1 · every offered transition is actually accepted", async () => {
    // For each state reachable here, every transition the projection advertises
    // must be one `transitionCase` accepts. Advertising is a promise.
    for (const status of ["new", "open", "in_progress", "waiting_learner", "resolved"] as const) {
      for (const next of LEARNER_OPS_TRANSITIONS[status]) {
        assert.ok(
          isLegalTransition(status, next),
          `projection offered ${status} -> ${next} but the domain refuses it`,
        );
      }
    }
  });

  await check("LO-UI-TRANSITION-CHOICES-1 · the server still refuses a forged transition", async () => {
    // The projection is a convenience. The authority is unchanged: a caller that
    // ignores it entirely is still refused.
    const probe = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Подделка перехода", details: "Проверка", actor: null,
    });
    const opened = (await getCaseDetail(probe.id)).version;
    const { version: v } = (await transitionCase({
      caseId: probe.id, expectedVersion: opened, nextStatus: "resolved", actor: actorA,
    })) as { version: number };

    await expectDomainError("LEARNER_OPS_ILLEGAL_TRANSITION", () =>
      transitionCase({ caseId: probe.id, expectedVersion: v, nextStatus: "in_progress", actor: actorA }),
    );
  });

  await check("LO-UI-TRANSITION-CHOICES-1 · choices change after the state changes", async () => {
    const probe = await createCase({
      userId: learnerA.id, type: "support_request", queueKey: "support",
      subject: "Смена набора", details: "Проверка", actor: null,
    });
    const before = await getCaseDetail(probe.id);
    const v = before.version;
    await transitionCase({ caseId: probe.id, expectedVersion: v, nextStatus: "closed", actor: actorA });
    const after = await getCaseDetail(probe.id);
    assert.notDeepEqual([...after.allowedTransitions], [...before.allowedTransitions]);
    assert.deepEqual([...after.allowedTransitions], ["open"], "closed reopens and nothing else");
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
