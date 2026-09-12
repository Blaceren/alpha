/**
 * PHASE-1 ADMIN regression — administrative FORWARD progression correction.
 *
 * Every scenario owns a temporary SQLite fixture. No HTTP route, no live
 * database, no notification provider and no external owner is used, and the
 * canonical PREPROD database is never opened.
 *
 * The suite is organised around the things that would be dangerous if they were
 * wrong, not around the code that was written: what may NOT be completed, what
 * may NOT be fabricated, what the funnel may NOT be told, and what must remain
 * true about the enrollment afterwards.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PrismaClient,
  type LevelDefinition,
  type LevelDefinitionType,
} from "@prisma/client";

const dbPath = `/tmp/ata-progression-adjustment-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const EVALUATION_TIME = new Date("2026-08-30T12:00:00.000Z");
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function setFlags() {
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_XP_ENABLED = "true";
}

type LevelSpec = {
  type?: LevelDefinitionType;
  completionMethod?: string;
  xpReward?: number;
};

/** The canonical ATA shape in miniature: L1 external, L3 report, checkpoints, mentor. */
const ATA_SHAPED: LevelSpec[] = [
  { type: "external_event", completionMethod: "pocket_postback", xpReward: 0 }, // L1
  { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 }, //        L2
  { type: "report", completionMethod: "report_approval", xpReward: 500 }, //        L3
  { type: "financial_checkpoint", completionMethod: "balance_check", xpReward: 0 }, // L4
  { type: "lesson", completionMethod: "manual", xpReward: 150 }, //                 L5
  { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 }, //        L6
  { type: "mentor_review", completionMethod: "mentor_review", xpReward: 250 }, //   L7
  { type: "lesson", completionMethod: "assessment_pass", xpReward: 100 }, //        L8
];

async function main() {
  cleanupDb();
  const migration = spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  setFlags();
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const adjustment = await import("../../src/lib/curriculum/progression-adjustment");
  const progressionRead = await import("../../src/lib/curriculum/progression-read");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const roles = await import("../../src/lib/crm/roles");
  const pairs = await import("../../src/lib/curriculum/completion-pairs");

  let sequence = 0;

  async function reset() {
    await prisma.growthEventOutbox.deleteMany();
    await prisma.growthEvent.deleteMany();
    await prisma.xPTransaction.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    // CrmUserOwner/-History and CrmUserNote all reference StaffProfile with
    // Restrict, so staff rows come out last.
    await prisma.crmUserOwnerHistory.deleteMany();
    await prisma.crmUserOwner.deleteMany();
    await prisma.crmUserNote.deleteMany();
    await prisma.staffProfile.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
  }

  async function createUser(label: string, role: "user" | "admin" = "user") {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        role,
        status: "active",
      },
    });
  }

  async function createOperator(label: string) {
    const user = await createUser(label, "user");
    const profile = await prisma.staffProfile.create({
      data: {
        userId: user.id,
        displayName: label,
        staffRole: "progression_operator",
      },
    });
    return { user, profile };
  }

  /** Build a curriculum and enroll a learner at level 1. */
  async function createScenario(specs: LevelSpec[] = ATA_SHAPED) {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `ata-v2-${sequence}`,
        versionNumber: sequence,
        status: "published",
        publishedAt: EVALUATION_TIME,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "Module",
        firstLevel: 1,
        lastLevel: specs.length,
      },
    });
    const levels: LevelDefinition[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index]!;
      const levelNumber = index + 1;
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.adjust-${version.id}`,
            type: spec.type ?? "lesson",
            title: `Level ${levelNumber}`,
            completionMethod: spec.completionMethod ?? "lesson",
            xpReward: spec.xpReward ?? 0,
            requiredXp: 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            status: "active",
          },
        }),
      );
    }
    const learner = await createUser("learner");
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: learner.id,
        curriculumVersionId: version.id,
        curriculumCode: "ata-v2",
        status: "active",
        highestCompletedLevel: 0,
        currentLevel: 1,
      },
    });
    const operator = await createOperator("operator");
    return { version, levels, learner, enrollment, operator };
  }

  /**
   * Place a learner at a chosen level by administratively completing everything
   * below it. Used only to REACH a starting position for a test; the assertions
   * are always about the call under test.
   */
  async function placeAt(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    levelNumber: number,
  ) {
    if (levelNumber === 1) return;
    await prisma.userCurriculumEnrollment.update({
      where: { id: scenario.enrollment.id },
      data: { highestCompletedLevel: levelNumber - 1, currentLevel: levelNumber },
    });
    for (const level of scenario.levels.filter((l) => l.levelNumber < levelNumber)) {
      await prisma.userLevelProgress.create({
        data: {
          enrollmentId: scenario.enrollment.id,
          curriculumVersionId: scenario.version.id,
          levelDefinitionId: level.id,
          status: "completed",
          startedAt: EVALUATION_TIME,
          completedAt: EVALUATION_TIME,
        },
      });
    }
  }

  function stableCodeFor(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    levelNumber: number,
  ) {
    const level = scenario.levels.find((l) => l.levelNumber === levelNumber);
    assert.ok(level, `level ${levelNumber} missing`);
    return level.stableCode;
  }

  /** A full snapshot of everything a correction could possibly touch. */
  async function snapshot() {
    return {
      progress: await prisma.userLevelProgress.count(),
      enrollments: await prisma.userCurriculumEnrollment.findMany({
        select: { id: true, currentLevel: true, highestCompletedLevel: true, status: true, lastMeaningfulActionAt: true },
        orderBy: { id: "asc" },
      }),
      xp: await prisma.xPTransaction.count(),
      audit: await prisma.auditLog.count(),
      growth: await prisma.growthEvent.count(),
      users: await prisma.user.findMany({
        select: { id: true, level: true, xp: true },
        orderBy: { id: "asc" },
      }),
    };
  }

  async function baseInput(
    scenario: Awaited<ReturnType<typeof createScenario>>,
    targetLevelNumber: number,
    overrides: Record<string, unknown> = {},
  ) {
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: scenario.enrollment.id },
    });
    return {
      actorStaffProfileId: scenario.operator.profile.id,
      actorUserId: scenario.operator.user.id,
      learnerUserId: scenario.learner.id,
      targetStableCode: stableCodeFor(scenario, targetLevelNumber),
      expectedCurrentLevel: enrollment.currentLevel,
      expectedCurriculumVersionId: scenario.version.id,
      reasonCode: "preprod_qa" as const,
      reasonText: "PREPROD acceptance rehearsal for progression correction.",
      requestId: `req-${process.pid}-${(sequence += 1)}`,
      evaluationTime: EVALUATION_TIME,
      ...overrides,
    };
  }

  async function expectRefusal(
    fn: () => Promise<unknown>,
    code: string,
  ): Promise<void> {
    const before = await snapshot();
    let thrown: unknown = null;
    try {
      await fn();
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, `expected ${code} but the call succeeded`);
    assert.ok(
      adjustment.isProgressionAdjustmentError(thrown),
      `expected a ProgressionAdjustmentError, got ${String(thrown)}`,
    );
    assert.equal((thrown as { code: string }).code, code);
    const after = await snapshot();
    assert.deepEqual(after, before, `${code} must write nothing`);
  }

  /* ---------------------------------------------------------------- */
  /* Vocabulary                                                        */
  /* ---------------------------------------------------------------- */

  await check("admin-correctable pairs are the production pairs minus the protected gates", () => {
    const correctable = [...pairs.ADMIN_CORRECTABLE_COMPLETION_PAIRS].sort();
    assert.deepEqual(correctable, [
      "final_exam:assessment_pass",
      "lesson:assessment_pass",
      "lesson:lesson",
      "lesson:manual",
      "mentor_review:mentor_review",
      "report:report_approval",
    ]);
    assert.equal(pairs.isAdminCorrectablePair("financial_checkpoint", "balance_check"), false);
    assert.equal(pairs.isAdminCorrectablePair("external_event", "pocket_postback"), false);
    assert.equal(pairs.isProtectedAuthorityPair("financial_checkpoint", "balance_check"), true);
    assert.equal(pairs.isProtectedAuthorityPair("external_event", "pocket_postback"), true);
  });

  /* ---------------------------------------------------------------- */
  /* Permission matrix — negative controls for every role              */
  /* ---------------------------------------------------------------- */

  await check("only progression_operator holds curriculum_progress_override", () => {
    const holders = roles.CRM_STAFF_ROLES.filter((role) =>
      roles.STAFF_ROLE_PERMISSIONS[role].includes("curriculum_progress_override"),
    );
    assert.deepEqual(holders, ["progression_operator"]);
  });

  await check("support/moderator/mentor/crm_manager/analyst/read_only/content_manager cannot override", () => {
    for (const role of [
      "support",
      "moderator",
      "mentor",
      "crm_manager",
      "crm_admin",
      "analyst",
      "read_only",
      "content_manager",
      "retention_manager",
    ] as const) {
      assert.equal(
        roles.canOverrideProgression(roles.STAFF_ROLE_PERMISSIONS[role]),
        false,
        `${role} must not hold the override`,
      );
    }
    assert.equal(
      roles.canOverrideProgression(roles.STAFF_ROLE_PERMISSIONS.progression_operator),
      true,
    );
  });

  await check("progression_operator holds exactly one permission and no others", () => {
    assert.deepEqual([...roles.STAFF_ROLE_PERMISSIONS.progression_operator], [
      "curriculum_progress_override",
    ]);
    assert.equal(roles.isEligibleOwnerRole("progression_operator"), false);
  });

  await check("progression read gate accepts learner_ops_view OR the override", () => {
    assert.equal(roles.canViewProgression(["learner_ops_view"]), true);
    assert.equal(roles.canViewProgression(["curriculum_progress_override"]), true);
    assert.equal(roles.canViewProgression(["view_audit"]), false);
    assert.equal(roles.canViewProgression([]), false);
  });

  /* ---------------------------------------------------------------- */
  /* progression_operator — usable, and ONLY for this                   */
  /* ---------------------------------------------------------------- */

  await check("a progression_operator session resolves with exactly one permission", async () => {
    await reset();
    const scenario = await createScenario();
    const session = await import("../../src/lib/crm/session");
    const profile = await prisma.staffProfile.findUniqueOrThrow({
      where: { id: scenario.operator.profile.id },
    });
    assert.equal(profile.staffRole, "progression_operator");
    // The server-side resolver is the only thing that computes permissions.
    assert.deepEqual(roles.resolveEffectivePermissions(profile.staffRole), [
      "curriculum_progress_override",
    ]);
    void session;
  });

  await check("the operator can LIST learners and find the target", async () => {
    await reset();
    const scenario = await createScenario();
    const users = await import("../../src/lib/crm/users");
    const permissions = roles.resolveEffectivePermissions("progression_operator");
    const query = users.parseCrmUsersQuery(new URLSearchParams(), permissions);
    const page = await users.listCrmUsers(query, permissions, scenario.operator.profile.id);
    assert.ok(
      page.items.some((item) => item.userId === String(scenario.learner.id)),
      "the operator must be able to find the learner they are asked to correct",
    );
    // Identity stays masked: the list is reachable, PII is not.
    const row = page.items.find((item) => item.userId === String(scenario.learner.id))!;
    assert.equal(row.email.visibility, "masked");
  });

  await check("the operator can OPEN the learner detail, with a masked email", async () => {
    await reset();
    const scenario = await createScenario();
    const detail = await import("../../src/lib/crm/user-detail");
    const permissions = roles.resolveEffectivePermissions("progression_operator");
    const view = await detail.resolveCrmUserDetail(scenario.learner.id, permissions);
    assert.equal(view.userId, String(scenario.learner.id));
    assert.equal(view.email.visibility, "masked");
  });

  await check("the operator can READ progression and is AUTHORIZED to adjust", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const permissions = roles.resolveEffectivePermissions("progression_operator");
    assert.equal(roles.canViewProgression(permissions), true);
    assert.equal(roles.canOverrideProgression(permissions), true);

    const snap = await progressionRead.resolveLearnerProgressionSnapshot(scenario.learner.id);
    assert.equal(snap.kind, "enrolled");

    const plan = await adjustment.previewProgressionAdjustment({
      learnerUserId: scenario.learner.id,
      targetStableCode: stableCodeFor(scenario, 6),
    });
    assert.equal(plan.canApply, true);

    const receipt = await adjustment.adjustLearnerProgression(await baseInput(scenario, 6));
    assert.equal(receipt.created, true);
  });

  await check("the operator can do NOTHING else — every other capability refuses", async () => {
    const permissions = roles.resolveEffectivePermissions("progression_operator");
    const refusals: [string, boolean][] = [
      ["assign owner", roles.canAssignOwner(permissions)],
      ["reveal lead PII", roles.canRevealLeadPii(permissions)],
      ["view affiliates", roles.canViewAffiliates(permissions)],
      ["view owner history", roles.canViewOwnerHistory(permissions)],
      ["read curriculum authoring", roles.canReadCurriculumAuthoring(permissions)],
      ["author curriculum", roles.canAuthorCurriculum(permissions)],
      ["approve curriculum", roles.canApproveCurriculum(permissions)],
      ["adjudicate source authority", roles.canAdjudicateCurriculumSourceAuthority(permissions)],
      ["view learner ops", roles.canViewLearnerOps(permissions)],
      ["handle learner ops", roles.canHandleLearnerOps(permissions)],
      ["escalate", roles.canEscalateLearnerOps(permissions)],
      ["resolve escalation", roles.canResolveLearnerOpsEscalation(permissions)],
      ["manage queues", roles.canManageLearnerOpsQueues(permissions)],
      ["learner ops QA", roles.canPerformLearnerOpsQa(permissions)],
      ["learner ops analytics", roles.canViewLearnerOpsAnalytics(permissions)],
      ["administer learner ops", roles.canAdministerLearnerOps(permissions)],
      ["report review", roles.canPerformReportReview(permissions)],
      ["mentor review", roles.canPerformMentorReview(permissions)],
    ];
    for (const [name, allowed] of refusals) {
      assert.equal(allowed, false, `progression_operator must not be able to ${name}`);
    }
    // The raw permission set, asserted whole so a future grant cannot slip in.
    for (const forbidden of [
      "view_exact_financials",
      "view_identity_full_email",
      "reveal_pii",
      "export",
      "manage_settings",
      "view_audit",
      "community_moderate",
      "edit_user_notes",
      "view_user_notes",
      "create_user_notes",
    ] as const) {
      assert.equal(
        permissions.includes(forbidden),
        false,
        `progression_operator must not hold ${forbidden}`,
      );
    }
  });

  /* ---------------------------------------------------------------- */
  /* Preview purity                                                    */
  /* ---------------------------------------------------------------- */

  await check("preview writes absolutely nothing", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const before = await snapshot();
    const plan = await adjustment.previewProgressionAdjustment({
      learnerUserId: scenario.learner.id,
      targetStableCode: stableCodeFor(scenario, 7),
    });
    assert.equal(plan.canApply, true);
    assert.deepEqual(plan.levels.map((l) => l.levelNumber), [5, 6]);
    const after = await snapshot();
    assert.deepEqual(after, before, "preview must be pure");
  });

  await check("preview reports the protected gate and refuses to plan past it", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 2);
    const plan = await adjustment.previewProgressionAdjustment({
      learnerUserId: scenario.learner.id,
      targetStableCode: stableCodeFor(scenario, 6),
    });
    assert.equal(plan.canApply, false);
    assert.equal(plan.refusalCode, "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED");
    assert.equal(plan.blocker?.levelNumber, 4);
    assert.equal(plan.blocker?.reason, "protected_authority_gate");
    // It stops AT the blocker and shows only what is reachable.
    assert.deepEqual(plan.levels.map((l) => l.levelNumber), [2, 3]);
  });

  await check("preview always reports no tool and no Community change", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const plan = await adjustment.previewProgressionAdjustment({
      learnerUserId: scenario.learner.id,
      targetStableCode: stableCodeFor(scenario, 8),
    });
    assert.deepEqual([...plan.toolsUnlocked], []);
    assert.deepEqual([...plan.communitySpacesOpened], []);
  });

  /* ---------------------------------------------------------------- */
  /* Forward                                                           */
  /* ---------------------------------------------------------------- */

  await check("+1 on an assessment level completes it as admin_correction", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 6);
    const receipt = await adjustment.adjustLearnerProgression(
      await baseInput(scenario, 7),
    );
    assert.equal(receipt.created, true);
    assert.deepEqual([...receipt.levelsCompleted], [6]);
    assert.equal(receipt.fromCurrentLevel, 6);
    assert.equal(receipt.toCurrentLevel, 7);
    assert.equal(receipt.xpAwarded, 100);

    const level = scenario.levels.find((l) => l.levelNumber === 6)!;
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: scenario.enrollment.id, levelDefinitionId: level.id },
    });
    assert.equal(progress.status, "completed");
    assert.equal(progress.completionMethod, "admin_correction");
    const evidence = progress.completionEvidence as Record<string, unknown>;
    assert.equal(evidence.kind, "administrative_progression_correction");
    assert.equal(evidence.reasonCode, "preprod_qa");
    assert.equal(evidence.actorStaffProfileId, scenario.operator.profile.id);
    assert.match(String(evidence.requestIdHash), /^sha256:[a-f0-9]{64}$/);
  });

  await check("+1 on a manual level completes and credits 150", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const receipt = await adjustment.adjustLearnerProgression(
      await baseInput(scenario, 6),
    );
    assert.equal(receipt.xpAwarded, 150);
    const xp = await prisma.xPTransaction.findFirstOrThrow({
      where: { enrollmentId: scenario.enrollment.id },
    });
    assert.equal(xp.sourceType, "admin_correction");
    assert.equal(xp.amount, 150);
    assert.equal(xp.createdById, scenario.operator.user.id);
    // NOT level-linked, deliberately — see `LEVEL_LINKED_SOURCES` in xp.ts. The
    // deployed Backend reads a level-linked administrative award as a corrupt
    // ENROLLMENT, so this is what keeps that release a valid rollback anchor.
    // The level lives in the sourceId instead.
    assert.equal(xp.levelDefinitionId, null, "administrative XP must not be level-linked");
    assert.match(xp.sourceId ?? "", /:l5$/);
  });

  await check("multi-level forward completes the whole interval atomically", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const receipt = await adjustment.adjustLearnerProgression(
      await baseInput(scenario, 8),
    );
    assert.deepEqual([...receipt.levelsCompleted], [5, 6, 7]);
    assert.equal(receipt.toCurrentLevel, 8);
    // 150 (manual) + 100 (assessment) + 250 (mentor) — the canonical amounts.
    assert.equal(receipt.xpAwarded, 500);
    assert.equal(receipt.xpTransactionIds.length, 3);
  });

  await check("a level with no progress row is started through the canonical owner", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const rowsBefore = await prisma.userLevelProgress.count({
      where: { enrollmentId: scenario.enrollment.id },
    });
    assert.equal(rowsBefore, 4, "levels 1-4 only");
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 6));
    const level = scenario.levels.find((l) => l.levelNumber === 5)!;
    const created = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: scenario.enrollment.id, levelDefinitionId: level.id },
    });
    assert.equal(created.status, "completed");
    // The row was materialised through the canonical start owner — and the
    // owner emitted NOTHING, because an operator creating a progress row is not
    // a learner opening a level. Case C below proves an ordinary learner start
    // still emits its event unchanged.
    const started = await prisma.growthEvent.count({ where: { eventType: "level_started" } });
    assert.equal(started, 0, "an administratively materialised row is not a learner start");
  });

  await check("an admin correction may resolve a level sitting in pending_review", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 7);
    const mentorLevel = scenario.levels.find((l) => l.levelNumber === 7)!;
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: scenario.enrollment.id,
        curriculumVersionId: scenario.version.id,
        levelDefinitionId: mentorLevel.id,
        status: "pending_review",
        startedAt: EVALUATION_TIME,
      },
    });
    const receipt = await adjustment.adjustLearnerProgression(
      await baseInput(scenario, 8),
    );
    assert.deepEqual([...receipt.levelsCompleted], [7]);
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: scenario.enrollment.id, levelDefinitionId: mentorLevel.id },
    });
    assert.equal(progress.status, "completed");
    assert.equal(progress.completionMethod, "admin_correction");
  });

  await check("parking a learner exactly AT a checkpoint is allowed", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 2);
    // Target L4 (the checkpoint) => completes L2 and L3 only, never L4 itself.
    const receipt = await adjustment.adjustLearnerProgression(
      await baseInput(scenario, 4),
    );
    assert.deepEqual([...receipt.levelsCompleted], [2, 3]);
    assert.equal(receipt.toCurrentLevel, 4);
    const checkpoint = scenario.levels.find((l) => l.levelNumber === 4)!;
    const row = await prisma.userLevelProgress.findFirst({
      where: { enrollmentId: scenario.enrollment.id, levelDefinitionId: checkpoint.id },
    });
    assert.equal(row, null, "the checkpoint itself must remain untouched");
  });

  /* ---------------------------------------------------------------- */
  /* Protected gates and backward — refusal with zero writes           */
  /* ---------------------------------------------------------------- */

  await check("an interval containing a financial checkpoint is wholly refused", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 2);
    await expectRefusal(
      async () => adjustment.adjustLearnerProgression(await baseInput(scenario, 6)),
      "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED",
    );
  });

  await check("an interval containing the Pocket registration level is wholly refused", async () => {
    await reset();
    const scenario = await createScenario();
    await expectRefusal(
      async () => adjustment.adjustLearnerProgression(await baseInput(scenario, 3)),
      "PROGRESSION_ADJUST_GATE_LEVEL_REFUSED",
    );
  });

  await check("backward is refused with a typed error and no writes", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 6);
    await expectRefusal(
      async () => adjustment.adjustLearnerProgression(await baseInput(scenario, 2)),
      "PROGRESSION_ADJUST_BACKWARD_UNSUPPORTED",
    );
  });

  await check("targeting the current level is refused as no change", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 6);
    await expectRefusal(
      async () => adjustment.adjustLearnerProgression(await baseInput(scenario, 6)),
      "PROGRESSION_ADJUST_NO_CHANGE",
    );
  });

  await check("self-adjustment is refused", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const input = await baseInput(scenario, 6);
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression({
          ...input,
          learnerUserId: scenario.operator.user.id,
          actorUserId: scenario.operator.user.id,
        }),
      "PROGRESSION_ADJUST_FORBIDDEN",
    );
  });

  await check("being the learner's CRM owner is NOT a refusal", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await prisma.crmUserOwner.create({
      data: {
        userId: scenario.learner.id,
        ownerId: scenario.operator.profile.id,
        version: 1,
      },
    });
    const receipt = await adjustment.adjustLearnerProgression(
      await baseInput(scenario, 6),
    );
    assert.equal(receipt.created, true);
  });

  /* ---------------------------------------------------------------- */
  /* Concurrency                                                       */
  /* ---------------------------------------------------------------- */

  await check("a stale expectedCurrentLevel is refused with no writes", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 6);
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression(
          await baseInput(scenario, 8, { expectedCurrentLevel: 5 }),
        ),
      "PROGRESSION_ADJUST_STALE_STATE",
    );
  });

  await check("a stale expectedCurriculumVersionId is refused with no writes", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 6);
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression(
          await baseInput(scenario, 7, { expectedCurriculumVersionId: scenario.version.id + 999 }),
        ),
      "PROGRESSION_ADJUST_WRONG_CURRICULUM",
    );
  });

  await check("replaying the same requestId returns the original receipt and writes nothing new", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const input = await baseInput(scenario, 8);
    const first = await adjustment.adjustLearnerProgression(input);
    assert.equal(first.created, true);

    const after = await snapshot();
    const replay = await adjustment.adjustLearnerProgression(input);
    assert.equal(replay.created, false);
    assert.equal(replay.auditLogId, first.auditLogId);
    assert.deepEqual([...replay.levelsCompleted], [...first.levelsCompleted]);
    assert.equal(replay.toCurrentLevel, first.toCurrentLevel);
    assert.deepEqual(await snapshot(), after, "a replay must write nothing");

    const envelopes = await prisma.auditLog.count({
      where: { action: "CURRICULUM_PROGRESSION_ADJUSTED" },
    });
    assert.equal(envelopes, 1, "exactly one envelope per request identity");
  });

  /* ---------------------------------------------------------------- */
  /* Non-fabrication                                                   */
  /* ---------------------------------------------------------------- */

  await check("a corrected report level creates NO ReportSubmission, revision or review", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 3);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 4));
    assert.equal(await prisma.reportSubmission.count(), 0);
    assert.equal(await prisma.reportRevision.count(), 0);
    assert.equal(await prisma.reportReview.count(), 0);
    assert.equal(await prisma.reportReviewScore.count(), 0);
    const level = scenario.levels.find((l) => l.levelNumber === 3)!;
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: scenario.enrollment.id, levelDefinitionId: level.id },
    });
    assert.equal(progress.completionMethod, "admin_correction");
  });

  await check("a corrected mentor level creates no mentor artefact and no approval event", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 7);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 8));
    assert.equal(
      await prisma.growthEvent.count({ where: { eventType: "mentor_review_approved" } }),
      0,
      "no mentor approval may be claimed",
    );
    assert.equal(
      await prisma.growthEvent.count({ where: { eventType: "mentor_review_submitted" } }),
      0,
    );
    const level = scenario.levels.find((l) => l.levelNumber === 7)!;
    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: scenario.enrollment.id, levelDefinitionId: level.id },
    });
    assert.equal(progress.completionMethod, "admin_correction");
  });

  await check("no assessment attempt is fabricated for a corrected assessment level", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 6);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 7));
    assert.equal(await prisma.assessmentAttempt.count(), 0);
  });

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * THE INVARIANT, STATED ONCE: for one administrative adjustment the organic
   * GrowthEvent delta is ZERO. Not "zero completions" — zero events of any
   * learner-behaviour kind, including the `level_started` an administratively
   * materialised progress row would otherwise produce. An operator creating the
   * current progress row does not mean the learner opened that level.
   */
  async function growthDeltaFor(fn: () => Promise<unknown>) {
    const before = await prisma.growthEvent.findMany({ select: { eventType: true } });
    await fn();
    const after = await prisma.growthEvent.findMany({ select: { eventType: true } });
    const delta = new Map<string, number>();
    for (const row of after) delta.set(row.eventType, (delta.get(row.eventType) ?? 0) + 1);
    for (const row of before) delta.set(row.eventType, (delta.get(row.eventType) ?? 0) - 1);
    return [...delta.entries()].filter(([, count]) => count !== 0);
  }

  await check("A. unstarted single-level correction produces ZERO organic growth events", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    // L5 has no progress row: the correction must materialise it through the
    // canonical start owner and still emit nothing.
    const rows = await prisma.userLevelProgress.count({
      where: { enrollmentId: scenario.enrollment.id },
    });
    assert.equal(rows, 4, "level 5 must be unstarted for this case to mean anything");
    const delta = await growthDeltaFor(async () =>
      adjustment.adjustLearnerProgression(await baseInput(scenario, 6)),
    );
    assert.deepEqual(delta, [], `expected no growth events, got ${JSON.stringify(delta)}`);
  });

  await check("B. multi-level correction with EVERY level unstarted produces ZERO", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const delta = await growthDeltaFor(async () =>
      adjustment.adjustLearnerProgression(await baseInput(scenario, 8)),
    );
    assert.deepEqual(delta, [], `expected no growth events, got ${JSON.stringify(delta)}`);
    // …and the levels really were completed, so this is not vacuous.
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: scenario.enrollment.id },
    });
    assert.equal(enrollment.currentLevel, 8);
  });

  await check("C. a NORMAL learner start still emits level_started, unchanged", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const delta = await growthDeltaFor(async () =>
      levelState.startCurrentCurriculumLevel({
        actorUserId: scenario.learner.id,
        db: prisma,
        asOf: EVALUATION_TIME,
      }),
    );
    assert.deepEqual(delta, [["level_started", 1]]);
  });

  await check("D. a NORMAL learner completion still emits its events, unchanged", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await levelState.startCurrentCurriculumLevel({
      actorUserId: scenario.learner.id,
      db: prisma,
      asOf: EVALUATION_TIME,
    });
    const level = scenario.levels.find((l) => l.levelNumber === 5)!;
    const completionModule = await import("../../src/lib/curriculum/completion");
    const delta = await growthDeltaFor(async () =>
      completionModule.completeCurriculumLevel({
        db: prisma,
        enrollmentId: scenario.enrollment.id,
        levelDefinitionId: level.id,
        sourceType: "level_completion",
        sourceId: `manual-completion:normal-${process.pid}-0001`,
        actorId: scenario.learner.id,
        evaluationTime: EVALUATION_TIME,
      }),
    );
    const kinds = delta.map(([type]) => type).sort();
    assert.deepEqual(kinds, ["academy_activation", "level_completed"]);
  });

  await check("E. correction through a report level emits no learner-success event at all", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 3);
    const delta = await growthDeltaFor(async () =>
      adjustment.adjustLearnerProgression(await baseInput(scenario, 4)),
    );
    assert.deepEqual(delta, [], `expected no growth events, got ${JSON.stringify(delta)}`);
    for (const eventType of [
      "level_started",
      "level_completed",
      "academy_activation",
      "report_submitted",
      "report_approved",
      "mentor_review_submitted",
      "mentor_review_approved",
      "assessment_completed",
    ] as const) {
      assert.equal(
        await prisma.growthEvent.count({ where: { eventType } }),
        0,
        `${eventType} must not be emitted by an administrative correction`,
      );
    }
  });

  await check("an administrative start audit names the OPERATOR, not the learner", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 6));
    const started = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_LEVEL_STARTED" },
    });
    assert.equal(started.userId, scenario.operator.user.id);
    const meta = started.metadata as Record<string, unknown>;
    assert.equal(meta.actorUserId, scenario.operator.user.id);
    assert.equal(meta.userId, scenario.learner.id, "the learner is still identified");
    assert.ok(meta.administrative, "an administrative start must say so");
  });

  await check("a normal learner start audit is unchanged and carries no administrative mark", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await levelState.startCurrentCurriculumLevel({
      actorUserId: scenario.learner.id,
      db: prisma,
      asOf: EVALUATION_TIME,
    });
    const started = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_LEVEL_STARTED" },
    });
    assert.equal(started.userId, scenario.learner.id);
    const meta = started.metadata as Record<string, unknown>;
    assert.equal(meta.administrative, undefined);
  });

  /* ---------------------------------------------------------------- */
  /* Legacy isolation                                                  */
  /* ---------------------------------------------------------------- */

  await check("legacy User.level and User.xp are untouched", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: scenario.learner.id } });
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 8));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: scenario.learner.id } });
    assert.equal(after.level, before.level);
    assert.equal(after.xp, before.xp);
    assert.equal(after.level, 1, "V1 storage is not V2 authority and must not move");
    assert.equal(after.xp, 0);
  });

  /* ---------------------------------------------------------------- */
  /* Audit                                                             */
  /* ---------------------------------------------------------------- */

  await check("one envelope audit row carries actor, before, after, reason and reference", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const input = await baseInput(scenario, 8, { referenceId: "LO-CASE-42" });
    const receipt = await adjustment.adjustLearnerProgression(input);

    const envelope = await prisma.auditLog.findUniqueOrThrow({
      where: { id: receipt.auditLogId },
    });
    assert.equal(envelope.action, "CURRICULUM_PROGRESSION_ADJUSTED");
    assert.equal(envelope.entityType, "UserCurriculumEnrollment");
    assert.equal(envelope.userId, scenario.operator.user.id);
    const meta = envelope.metadata as Record<string, unknown>;
    assert.equal(meta.actorStaffProfileId, scenario.operator.profile.id);
    assert.equal(meta.actorUserId, scenario.operator.user.id);
    assert.equal(meta.learnerUserId, scenario.learner.id);
    assert.equal(meta.fromCurrentLevel, 5);
    assert.equal(meta.toCurrentLevel, 8);
    assert.deepEqual(meta.levelsCompleted, [5, 6, 7]);
    assert.equal(meta.reasonCode, "preprod_qa");
    assert.equal(meta.referenceId, "LO-CASE-42");
    assert.ok(String(meta.reasonText).length >= 10);
    assert.match(String(meta.requestIdHash), /^sha256:[a-f0-9]{64}$/);
    assert.equal(meta.result, "applied");
    // The raw request identity must never be stored.
    assert.ok(!JSON.stringify(meta).includes(input.requestId));

    // Per-level completion audit remains intact and names the administrative source.
    const perLevel = await prisma.auditLog.findMany({
      where: { action: "CURRICULUM_LEVEL_COMPLETED" },
      orderBy: { id: "asc" },
    });
    assert.equal(perLevel.length, 3);
    for (const row of perLevel) {
      const rowMeta = row.metadata as Record<string, unknown>;
      assert.equal(rowMeta.sourceType, "admin_correction");
      assert.ok(rowMeta.administrative, "administrative context must be present");
    }
  });

  await check("a non-administrative source may not carry administrative provenance", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    const completion = await import("../../src/lib/curriculum/completion");
    const before = await snapshot();
    // The other half of the provenance rule: provenance is REQUIRED for
    // `admin_correction` and REFUSED for every other source, so an ordinary
    // completion cannot be dressed up to look administrative.
    const result = await completion.completeCurriculumLevel({
      enrollmentId: scenario.enrollment.id,
      levelDefinitionId: scenario.levels[4]!.id,
      sourceType: "level_completion",
      sourceId: "manual-completion:probe-0001",
      administrativeProvenance: {
        reasonCode: "preprod_qa",
        actorStaffProfileId: scenario.operator.profile.id,
        requestIdHash: `sha256:${"0".repeat(64)}`,
        referenceId: null,
      },
    });
    assert.equal(result.kind, "rejected");
    if (result.kind === "rejected") {
      assert.equal(result.code, "COMPLETION_INPUT_INVALID");
    }
    assert.deepEqual(await snapshot(), before, "the refusal must write nothing");
  });

  /* ---------------------------------------------------------------- */
  /* Invariants                                                        */
  /* ---------------------------------------------------------------- */

  await check("after a correction the canonical level state resolves and is not corrupt", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 8));

    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: scenario.enrollment.id },
    });
    assert.equal(enrollment.currentLevel, enrollment.highestCompletedLevel + 1);
    assert.equal(enrollment.currentLevel, 8);

    const completed = await prisma.userLevelProgress.findMany({
      where: { enrollmentId: enrollment.id, status: "completed" },
      include: { levelDefinition: { select: { levelNumber: true } } },
    });
    const numbers = completed.map((r) => r.levelDefinition.levelNumber).sort((a, b) => a - b);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7], "completed prefix must be contiguous");

    const states = await levelState.resolveUserCurriculumLevelStates({
      userId: scenario.learner.id,
    });
    assert.equal(states.kind, "resolved", `level state must resolve, got ${states.kind}`);
    if (states.kind === "resolved") {
      const available = states.levels.filter((l) => l.state === "available");
      assert.ok(available.length <= 1, "at most one available level");
    }
  });

  await check("the CRM progression snapshot reports canonical V2 state, not legacy", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 8));
    const snap = await progressionRead.resolveLearnerProgressionSnapshot(scenario.learner.id);
    assert.equal(snap.kind, "enrolled");
    if (snap.kind !== "enrolled") return;
    assert.equal(snap.currentLevel, 8);
    assert.equal(snap.highestCompletedLevel, 7);
    assert.equal(snap.completedLevelCount, 7);
    assert.equal(snap.consistent, true);
    assert.equal(snap.curriculumCode, "ata-v2");
    assert.equal(snap.currentLevelDefinition?.levelNumber, 8);
    assert.equal(snap.xpTotal, 500, "V2 ledger total, never User.xp");
  });

  await check("the snapshot reports inconsistency instead of failing closed", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    // Inject the exact shape the audit warned about: a counter pushed ahead of
    // the durable rows. An operator must be able to SEE this.
    await prisma.userCurriculumEnrollment.update({
      where: { id: scenario.enrollment.id },
      data: { currentLevel: 8, highestCompletedLevel: 4 },
    });
    const snap = await progressionRead.resolveLearnerProgressionSnapshot(scenario.learner.id);
    assert.equal(snap.kind, "enrolled");
    if (snap.kind !== "enrolled") return;
    assert.equal(snap.consistent, false);
  });

  /* ---------------------------------------------------------------- */
  /* Presentation non-inference                                        */
  /* ---------------------------------------------------------------- */

  await check("Learner 360 cannot report an approved report for a corrected level", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 3);
    await adjustment.adjustLearnerProgression(await baseInput(scenario, 4));

    const learner360 = await import("../../src/lib/learner-ops/learner-360");
    const view = await learner360.getLearner360({
      userId: scenario.learner.id,
      permissions: ["learner_ops_view"],
    });

    // The report level is COMPLETED, and the reports section is EMPTY, because
    // it reads `ReportSubmission` — the real artefact — and an administrative
    // correction creates none. A surface that inferred "approved" from
    // `UserLevelProgress.status === "completed"` would fail here.
    const progression = (view as { progression: { value: { completedLevels: number } } })
      .progression;
    assert.equal(progression.value.completedLevels, 3);
    const reports = (view as { reports: { value: unknown[] } }).reports;
    assert.deepEqual(reports.value, [], "no report may be claimed for a correction");
  });

  /* ---------------------------------------------------------------- */
  /* Input validation                                                  */
  /* ---------------------------------------------------------------- */

  await check("a missing or too-short reason is refused", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await expectRefusal(
      async () => adjustment.adjustLearnerProgression(await baseInput(scenario, 6, { reasonText: "short" })),
      "PROGRESSION_ADJUST_INPUT_INVALID",
    );
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression(
          await baseInput(scenario, 6, { reasonCode: "not_a_reason" }),
        ),
      "PROGRESSION_ADJUST_INPUT_INVALID",
    );
  });

  await check("markup in the reason text is refused", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression(
          await baseInput(scenario, 6, {
            reasonText: "<script>alert(1)</script> correcting the learner state",
          }),
        ),
      "PROGRESSION_ADJUST_INPUT_INVALID",
    );
  });

  await check("an unknown learner and an unenrolled learner are refused", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression(
          await baseInput(scenario, 6, { learnerUserId: 9_999_999 }),
        ),
      "PROGRESSION_ADJUST_LEARNER_NOT_FOUND",
    );
    const stranger = await createUser("stranger");
    await expectRefusal(
      async () =>
        adjustment.adjustLearnerProgression(
          await baseInput(scenario, 6, { learnerUserId: stranger.id }),
        ),
      "PROGRESSION_ADJUST_NOT_ENROLLED",
    );
  });

  await check("a blocked learner is refused", async () => {
    await reset();
    const scenario = await createScenario();
    await placeAt(scenario, 5);
    await prisma.user.update({
      where: { id: scenario.learner.id },
      data: { status: "blocked" },
    });
    await expectRefusal(
      async () => adjustment.adjustLearnerProgression(await baseInput(scenario, 6)),
      "PROGRESSION_ADJUST_LEARNER_INACTIVE",
    );
  });

  await prisma.$disconnect();
  cleanupDb();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
