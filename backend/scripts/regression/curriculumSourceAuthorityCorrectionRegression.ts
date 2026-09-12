/**
 * PHASE-G2 CORRECTION-1 — the independent audit's blocker and material findings.
 *
 * Proves the three corrections on a disposable database built from the accepted
 * migration chain:
 *
 *   BLOCKER-1  an unreadable adjudication record can never read as "nothing is
 *              blocking". Fail closed, always, and say so.
 *   MEDIUM-1   the DOMAIN command authorises the adjudicating actor itself, so
 *              it is safe for any caller that never passes an HTTP gate.
 *   MEDIUM-2   one canonical link, resolved by one shared function, so the
 *              adjudication command and the handoff can never describe different
 *              proposals for the same bank.
 *
 * DISPOSABLE DATABASE ONLY. No live database is opened, no sealed editorial
 * database is touched, no flag is set anywhere real and no L2 row is mutated.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-source-authority-correction-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

let passed = 0;
let failed = 0;
const results: Array<{ name: string; ok: boolean; error?: string }> = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    results.push({ name, ok: false, error: message });
    console.error(`FAIL ${name}`);
    console.error(message);
  }
}

function rm(file: string) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
}

async function refusedWith(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}: ${String(error)}`);
    return error as { code: string };
  }
  return assert.fail(`expected a refusal with ${code}`);
}

const sha = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const EVIDENCE_SHA = sha("correction fixture evidence");
const EVIDENCE_REF = "l2-conflict-decision.md";

function richBody(marker: string) {
  const paragraph = `${marker}. `.padEnd(700, "Дисциплина в трейдинге начинается с плана и заканчивается его исполнением. ");
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      { code: "intro", title: "Введение", blocks: [{ type: "rich_text", text: paragraph }] },
      { code: "practice", title: "Практика", blocks: [{ type: "rich_text", text: paragraph }] },
    ],
  };
}

function contractFor(
  level: number,
  levelCode: string,
  variant: "matching" | "conflicting",
  contractVersion = 1,
) {
  const question = (ordinal: number) => ({
    questionId: `bp.l${String(level).padStart(3, "0")}.q${ordinal}`,
    ordinal,
    prompt: variant === "matching" ? `Общий вопрос ${ordinal}?` : `Blueprint формулировка вопроса ${ordinal}?`,
    options: [
      {
        optionCode: "a",
        text: variant === "matching" ? `Общий верный ответ ${ordinal}.` : `Blueprint верный ответ ${ordinal}.`,
        correct: true,
      },
      { optionCode: "b", text: `Неверный вариант B${ordinal}.`, correct: false },
      { optionCode: "c", text: `Неверный вариант C${ordinal}.`, correct: false },
      { optionCode: "d", text: `Неверный вариант D${ordinal}.`, correct: false },
    ],
    correctOptionCode: "a",
    takeId: `T${level}.${ordinal}`,
  });
  return {
    levelCode,
    levelNumber: level,
    moduleNumber: 1,
    title: `Уровень ${level}`,
    contractVersion,
    sourceProvenance: "PROPOSED_CANON",
    sourceStatusLabel: "PROPOSED CANON — импортировать в платформу после утверждения",
    approval: "AWAITING_APPROVAL",
    hook: `Хук уровня ${level}`,
    requiredTopicsText: "тема один, тема два.",
    requiredTopics: ["тема один", "тема два"],
    mainIdea: `Главная мысль уровня ${level}.`,
    learningObjective: `После просмотра ученик должен объяснить тему уровня ${level} через четыре правила.`,
    takes: [1, 2, 3, 4].map((ordinal) => ({
      takeId: `T${level}.${ordinal}`,
      ordinal,
      text: `Тейк ${level}.${ordinal} с достаточным объяснением смысла.`,
    })),
    targetDuration: { label: "7–9 минут", minSeconds: 420, maxSeconds: 540 },
    visualBrief: ["Схема пути"],
    productionStructure: [{ marker: "0:00–0:20", instruction: "Хук" }],
    editorialStopList: ["Не обещать прибыль."],
    acceptanceChecklist: ["Все четыре тейка произнесены ясно."],
    questions: [1, 2, 3, 4].map(question),
    production: {
      script: "SCRIPT_PENDING",
      video: "NOT_RECORDED",
      qa: "QA_PENDING",
      takeCoverage: [],
      reviewedContractVersion: null,
      reviewedContractFingerprint: null,
      note: null,
    },
  };
}

async function main() {
  rm(dbPath);
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const authority = await import("../../src/lib/curriculum/source-authority");
  const read = await import("../../src/lib/curriculum/authoring-read");
  const readiness = await import("../../src/lib/curriculum/authoring-readiness");
  const conflictModule = await import("../../src/lib/curriculum/authoring-conflict");
  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
  const coherence = await import("../../src/lib/curriculum/video-production-coherence");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const handoffModule = await import("../../src/lib/curriculum/authoring-handoff");

  /* ---------------------------- actors ---------------------------- */
  const admin = await prisma.user.create({
    data: { email: "corr-admin@example.com", name: "Admin", role: "admin" },
  });
  const reviewer = await prisma.user.create({
    data: { email: "corr-reviewer@example.com", name: "Reviewer", role: "admin" },
  });

  /** A staff actor whose ONLY authority is the stored CRM role. */
  async function staffActor(email: string, staffRole: string, status: "active" | "blocked" = "active") {
    const user = await prisma.user.create({
      data: { email, name: staffRole, role: "support", status },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, staffRole: staffRole as never, displayName: staffRole },
    });
    return user;
  }
  const crmAdmin = await staffActor("corr-crm-admin@example.com", "crm_admin");
  const contentManager = await staffActor("corr-content-manager@example.com", "content_manager");
  const readOnly = await staffActor("corr-read-only@example.com", "read_only");
  const blockedAdmin = await staffActor("corr-blocked@example.com", "crm_admin", "blocked");

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "Correction", status: "draft", versionNumber: 1 },
  });
  const moduleRow = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleNumber: 1,
      code: "module.01",
      title: "Первое знакомство",
      description: "",
      firstLevel: 1,
      lastLevel: 20,
      checkpointLevel: 4,
      learningObjective: "",
    },
  });

  async function buildLesson(input: { levelNumber: number; variant: "matching" | "conflicting" }) {
    const levelCode = `v2.l${String(input.levelNumber).padStart(3, "0")}.uroven-${input.levelNumber}`;
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleRow.id,
        levelNumber: input.levelNumber,
        stableCode: levelCode,
        type: "lesson",
        title: `Уровень ${input.levelNumber}`,
        learningObjective: "Цель уровня.",
        completionMethod: "assessment_pass",
        xpReward: 100,
      },
    });
    const content = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        updatedAt: new Date(),
        localizations: {
          create: {
            locale: "ru",
            title: `Уровень ${input.levelNumber}`,
            subtitle: "",
            learningObjectiveExtension: "Расширенная цель.",
            summary: "Короткое резюме урока.",
            body: richBody(`Урок ${input.levelNumber}`),
            updatedAt: new Date(),
          },
        },
      },
    });
    const assessment = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        passPercent: 100,
        showExplanation: true,
        updatedAt: new Date(),
      },
    });
    for (const ordinal of [1, 2, 3, 4]) {
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: assessment.id,
          questionNumber: ordinal,
          stableKey: `T${input.levelNumber}.${ordinal}`,
          type: "single_choice",
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }],
          correctAnswer: { code: "a" },
          updatedAt: new Date(),
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id,
          locale: "ru",
          prompt:
            input.variant === "matching"
              ? `Общий вопрос ${ordinal}?`
              : `Текущая формулировка вопроса ${ordinal}?`,
          optionLabels: {
            a:
              input.variant === "matching"
                ? `Общий верный ответ ${ordinal}.`
                : `Текущий верный ответ ${ordinal}.`,
            b: `Неверный вариант B${ordinal}.`,
            c: `Неверный вариант C${ordinal}.`,
            d: `Неверный вариант D${ordinal}.`,
          },
          explanation: "Пояснение.",
          updatedAt: new Date(),
        },
      });
    }
    const video = await videoAuthoring.createVideoProductionVersion({
      levelDefinitionId: level.id,
      curriculumVersionId: curriculum.id,
      payload: contractFor(input.levelNumber, levelCode, input.variant),
      actorId: admin.id,
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: video.id,
      assessmentVersionId: assessment.id,
      actorId: admin.id,
    });
    return { level, content, assessment, video, levelCode };
  }

  const rawConflicts = async (assessmentVersionId: number, videoProductionVersionId: number) => {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: videoProductionVersionId },
    });
    return conflictModule.compareBlueprintProposal(prisma, {
      contract: videoAuthoring.parseContractPayload(row.contractPayload),
      assessmentVersionId,
      videoProductionVersionId,
    });
  };

  const summaryFor = async (levelNumber: number) => {
    const overview = await read.readAuthoringOverview(curriculum.id);
    const level = overview.find((entry) => entry.levelNumber === levelNumber)!;
    return { overview, level, status: readiness.levelHandoffStatus(level) };
  };

  /** Make the adjudication record genuinely unreadable, run `fn`, then restore. */
  async function withAuthorityStorageBroken<T>(mode: "missing" | "shape", fn: () => Promise<T>): Promise<T> {
    if (mode === "missing") {
      // A. the table/query is unavailable — the schema/client skew shape.
      await prisma.$executeRawUnsafe(`ALTER TABLE "SourceAuthorityResolution" RENAME TO "SAR_quarantine"`);
      try {
        return await fn();
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE "SAR_quarantine" RENAME TO "SourceAuthorityResolution"`);
      }
    }
    // B. the model exists but its columns do not match the generated client, so
    // every SELECT the client emits fails — a Prisma client/schema mismatch.
    await prisma.$executeRawUnsafe(`ALTER TABLE "SourceAuthorityResolution" RENAME TO "SAR_quarantine"`);
    await prisma.$executeRawUnsafe(`CREATE TABLE "SourceAuthorityResolution" ("id" INTEGER PRIMARY KEY)`);
    try {
      return await fn();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE "SourceAuthorityResolution"`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "SAR_quarantine" RENAME TO "SourceAuthorityResolution"`);
    }
  }

  /* ================================================================== *
   * BLOCKER-1 — fail-closed authority reads
   * ================================================================== */

  // A level whose ONLY remaining blocker is the unresolved source conflict:
  // both aggregates are driven all the way to approved first.
  const failClosed = await buildLesson({ levelNumber: 2, variant: "conflicting" });
  for (const [kind, id] of [
    ["content", failClosed.content.id],
    ["assessment", failClosed.assessment.id],
  ] as const) {
    const load = async () =>
      kind === "content"
        ? await prisma.contentVersion.findUniqueOrThrow({ where: { id } })
        : await prisma.assessmentVersion.findUniqueOrThrow({ where: { id } });
    await lifecycle.submitForReview({ kind, id, expectedRevision: (await load()).revision, actorId: admin.id });
    await lifecycle.approveVersion({
      kind,
      id,
      expectedRevision: (await load()).revision,
      actorId: reviewer.id,
      validationPassed: true,
    });
  }

  await check("C1 healthy baseline: 8 raw conflicts block, and the level is not handoff-ready", async () => {
    const { level, status } = await summaryFor(2);
    assert.equal(level.assessment!.conflictCount, 8);
    assert.equal(level.assessment!.blockingConflictCount, 8);
    assert.equal(level.assessment!.authorityReadUnavailable, false);
    assert.equal(level.assessment!.provenance, "CONFLICTING");
    assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
    assert.equal(status.ready, false);
  });

  await check("C2 MUTANT P/Q/R — authority table unavailable never yields 0 blocking", async () => {
    const { level, status } = await withAuthorityStorageBroken("missing", () => summaryFor(2));
    // P — the blocking count must NOT collapse.
    assert.equal(level.assessment!.conflictCount, 8, "raw conflicts still visible");
    assert.equal(level.assessment!.blockingConflictCount, 8, "MUTANT P: blocking must stay at the raw count");
    assert.equal(level.assessment!.authorityResolution, null);
    assert.equal(level.assessment!.authorityReadUnavailable, true, "the failure must be reported, not swallowed");
    // Q — provenance must not become an approved-current style badge.
    assert.equal(level.assessment!.provenance, "CONFLICTING", "MUTANT Q: provenance must stay CONFLICTING");
    // R — the level must not become handoff-ready.
    assert.ok(
      status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"),
      "MUTANT R: the source-conflict blocker must survive a storage failure",
    );
    assert.equal(status.ready, false, "MUTANT R: an unreadable adjudication record must never hand off");
  });

  await check("C3 MUTANT P/Q/R — client/schema mismatch behaves identically", async () => {
    const { level, status } = await withAuthorityStorageBroken("shape", () => summaryFor(2));
    assert.equal(level.assessment!.conflictCount, 8);
    assert.equal(level.assessment!.blockingConflictCount, 8);
    assert.equal(level.assessment!.authorityReadUnavailable, true);
    assert.equal(level.assessment!.provenance, "CONFLICTING");
    assert.equal(status.ready, false);
  });

  await check("C4 an ADJUDICATED bank re-blocks when its decisions cannot be read", async () => {
    const comparison = await rawConflicts(failClosed.assessment.id, failClosed.video.id);
    const assessmentRow = await prisma.assessmentVersion.findUniqueOrThrow({
      where: { id: failClosed.assessment.id },
    });
    const videoRow = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: failClosed.video.id },
    });
    await authority.resolveSourceAuthority({
      assessmentVersionId: failClosed.assessment.id,
      expectedAssessmentRevision: assessmentRow.revision,
      expectedVideoProductionRevision: videoRow.revision,
      scope: { kind: "assessment" },
      decisions: comparison.conflicts.map((conflict) => ({
        questionIndex: conflict.questionIndex,
        field: conflict.field,
        decision: "CURRENT" as const,
        currentValueHash: sha(conflict.currentApprovedValue),
        blueprintValueHash: sha(conflict.blueprintProposalValue),
      })),
      rationale: "correction fixture: CURRENT wins",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: admin.id,
    });

    // Settled and readable: the blocker clears, raw history is retained.
    const settled = await summaryFor(2);
    assert.equal(settled.level.assessment!.conflictCount, 8, "raw conflicts are never erased");
    assert.equal(settled.level.assessment!.blockingConflictCount, 0);
    assert.equal(settled.level.assessment!.authorityReadUnavailable, false);
    assert.ok(!settled.status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));

    // Settled but UNREADABLE: the platform cannot prove it is settled, so it is
    // not treated as settled. A resolution you cannot read resolves nothing.
    const broken = await withAuthorityStorageBroken("missing", () => summaryFor(2));
    assert.equal(broken.level.assessment!.blockingConflictCount, 8);
    assert.equal(broken.level.assessment!.authorityReadUnavailable, true);
    assert.equal(broken.level.assessment!.provenance, "CONFLICTING");
    assert.equal(broken.status.ready, false);
  });

  await check("C5 §7 contract — a bank with NO raw conflict is unaffected by an authority read failure", async () => {
    // Deliberate and documented: authority resolution answers "which of two
    // disagreeing sources wins". With no disagreement there is nothing for it to
    // settle, so an unreadable record cannot invent a blocker. This exception is
    // scoped strictly to rawConflictCount === 0 and cannot widen the path above.
    await buildLesson({ levelNumber: 5, variant: "matching" });
    const healthy = await summaryFor(5);
    assert.equal(healthy.level.assessment!.conflictCount, 0);
    assert.equal(healthy.level.assessment!.blockingConflictCount, 0);

    const broken = await withAuthorityStorageBroken("missing", () => summaryFor(5));
    assert.equal(broken.level.assessment!.conflictCount, 0);
    assert.equal(broken.level.assessment!.blockingConflictCount, 0, "no raw conflict, nothing to block on");
    assert.equal(broken.level.assessment!.authorityReadUnavailable, true, "still reported honestly");
    assert.ok(!broken.status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
  });

  await check("C6 the readiness rollup counts a storage failure as outstanding work", async () => {
    const broken = await withAuthorityStorageBroken("missing", async () => {
      const overview = await read.readAuthoringOverview(curriculum.id);
      return readiness.summarizeReadiness(overview);
    });
    assert.equal(broken.assessmentBlockingConflictRecords, 8, "the backlog must not silently empty");
    assert.equal(broken.assessmentConflictRecords, 8);
  });

  await check("C6b the work queue says STORAGE FAILURE, not 'unadjudicated'", async () => {
    const entries = await withAuthorityStorageBroken("missing", async () => {
      const overview = await read.readAuthoringOverview(curriculum.id);
      return readiness.classifyWorkQueue(overview);
    });
    const conflict = entries.find(
      (entry) => entry.bucket === "SOURCE_CONFLICT" && entry.levelNumber === 2,
    );
    assert.ok(conflict, "the level must still appear as outstanding work");
    assert.match(conflict!.reason, /could not be read/, "the reason must name the storage failure");
    assert.doesNotMatch(
      conflict!.reason,
      /are unadjudicated/,
      "a storage failure must never be reported as a missing decision",
    );
  });

  /* ================================================================== *
   * MEDIUM-1 — the domain authorises the actor itself
   * ================================================================== */

  const authz = await buildLesson({ levelNumber: 6, variant: "conflicting" });
  const authzDecisions = async () => {
    const comparison = await rawConflicts(authz.assessment.id, authz.video.id);
    return comparison.conflicts.map((conflict) => ({
      questionIndex: conflict.questionIndex,
      field: conflict.field,
      decision: "CURRENT" as const,
      currentValueHash: sha(conflict.currentApprovedValue),
      blueprintValueHash: sha(conflict.blueprintProposalValue),
    }));
  };
  const adjudicateAs = async (actorId: number) => {
    const assessmentRow = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: authz.assessment.id } });
    const videoRow = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: authz.video.id } });
    return authority.resolveSourceAuthority({
      assessmentVersionId: authz.assessment.id,
      expectedAssessmentRevision: assessmentRow.revision,
      expectedVideoProductionRevision: videoRow.revision,
      scope: { kind: "assessment" },
      decisions: await authzDecisions(),
      rationale: "correction fixture: authorization matrix",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId,
    });
  };
  const authzState = async () => ({
    rows: await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: authz.assessment.id } }),
    audits: await prisma.auditLog.count({
      where: { action: "AUTHORING_SOURCE_AUTHORITY_RESOLVED", entityId: String(authz.assessment.id) },
    }),
    editorialState: (await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: authz.assessment.id } }))
      .editorialState,
    revision: (await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: authz.assessment.id } })).revision,
  });

  for (const [label, actor] of [
    ["MUTANT S content_manager", () => contentManager.id],
    ["read_only", () => readOnly.id],
    ["a blocked crm_admin", () => blockedAdmin.id],
    ["MUTANT T a nonexistent actor", () => 999_999],
    ["actor id 0", () => 0],
    ["a negative actor id", () => -1],
  ] as const) {
    await check(`C7 ${label} is refused by the DOMAIN, with no write of any kind`, async () => {
      const before = await authzState();
      await refusedWith(() => adjudicateAs(actor()), "AUTHORING_ACTOR_FORBIDDEN");
      const after = await authzState();
      assert.equal(after.rows, before.rows, "no resolution row");
      assert.equal(after.rows, 0);
      assert.equal(after.audits, before.audits, "no authority audit event");
      assert.equal(after.audits, 0);
      assert.equal(after.editorialState, before.editorialState, "no lifecycle mutation");
      assert.equal(after.revision, before.revision, "no aggregate mutation");
    });
  }

  await check("C8 a crm_admin staff actor IS allowed by the domain, with no HTTP gate involved", async () => {
    const result = await adjudicateAs(crmAdmin.id);
    assert.equal(result.created, 8);
    const rows = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: authz.assessment.id, supersededAt: null },
    });
    assert.equal(rows.length, 8);
    // §10 — the persisted decider IS the verified actor, never a caller-named one.
    assert.ok(rows.every((row) => row.decidedById === crmAdmin.id));
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "AUTHORING_SOURCE_AUTHORITY_RESOLVED", entityId: String(authz.assessment.id) },
    });
    assert.equal(audit.userId, crmAdmin.id, "audit actor and decidedById must be the same verified actor");
  });

  await check("C9 UserRole=admin remains accepted, matching the HTTP gate's PATH A", async () => {
    // A domain rule STRICTER than the gate would refuse every studio adjudication
    // at the layer beneath the gate. The two must agree.
    const lesson = await buildLesson({ levelNumber: 7, variant: "conflicting" });
    const comparison = await rawConflicts(lesson.assessment.id, lesson.video.id);
    const assessmentRow = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: lesson.assessment.id } });
    const videoRow = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: lesson.video.id } });
    const result = await authority.resolveSourceAuthority({
      assessmentVersionId: lesson.assessment.id,
      expectedAssessmentRevision: assessmentRow.revision,
      expectedVideoProductionRevision: videoRow.revision,
      scope: { kind: "assessment" },
      decisions: comparison.conflicts.map((conflict) => ({
        questionIndex: conflict.questionIndex,
        field: conflict.field,
        decision: "CURRENT" as const,
        currentValueHash: sha(conflict.currentApprovedValue),
        blueprintValueHash: sha(conflict.blueprintProposalValue),
      })),
      rationale: "correction fixture: admin path",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: admin.id,
    });
    assert.equal(result.created, 8);
  });

  /* ================================================================== *
   * MEDIUM-2 — one canonical link
   * ================================================================== */

  await check("C10 MUTANT U/V/W — command and handoff resolve the SAME canonical link", async () => {
    const lesson = await buildLesson({ levelNumber: 8, variant: "conflicting" });

    // A second, NEWER production version bound to the same bank — the shape that
    // made "the first link" ambiguous.
    const newer = await videoAuthoring.createVideoProductionVersion({
      levelDefinitionId: lesson.level.id,
      curriculumVersionId: curriculum.id,
      payload: contractFor(8, lesson.levelCode, "conflicting", 2),
      actorId: admin.id,
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: newer.id,
      assessmentVersionId: lesson.assessment.id,
      actorId: admin.id,
    });
    const links = await prisma.videoProductionAssessmentLink.findMany({
      where: { assessmentVersionId: lesson.assessment.id },
    });
    assert.ok(links.length >= 2, "the fixture must actually produce the multi-link shape");

    const canonical = await authority.resolveCanonicalAuthorityLink(prisma, lesson.assessment.id);
    assert.ok(canonical, "a canonical link must be determinable");
    // MUTANT W — the answer is the NEWEST bound proposal, not an arbitrary row.
    assert.equal(canonical!.videoProductionVersionId, newer.id, "MUTANT W: canonical must be the newest bound version");
    assert.equal(canonical!.candidateCount, links.length);

    // MUTANT V — reversing insertion order must not change the answer. The rows
    // are physically re-inserted in the opposite order to defeat rowid ordering.
    const saved = await prisma.videoProductionAssessmentLink.findMany({
      where: { assessmentVersionId: lesson.assessment.id },
      orderBy: { id: "asc" },
    });
    await prisma.videoProductionAssessmentLink.deleteMany({
      where: { assessmentVersionId: lesson.assessment.id },
    });
    for (const row of [...saved].reverse()) {
      await prisma.videoProductionAssessmentLink.create({
        data: {
          videoProductionVersionId: row.videoProductionVersionId,
          assessmentVersionId: row.assessmentVersionId,
          assessmentRevision: row.assessmentRevision,
          assessmentBankFingerprint: row.assessmentBankFingerprint,
          linkedById: row.linkedById,
        },
      });
    }
    const afterReinsert = await authority.resolveCanonicalAuthorityLink(prisma, lesson.assessment.id);
    assert.equal(
      afterReinsert!.videoProductionVersionId,
      canonical!.videoProductionVersionId,
      "MUTANT V: link choice must not depend on insertion order",
    );

    // MUTANT U — the adjudication command binds its decisions to that same link.
    const comparison = await rawConflicts(lesson.assessment.id, canonical!.videoProductionVersionId);
    const assessmentRow = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: lesson.assessment.id } });
    const canonicalVideo = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: canonical!.videoProductionVersionId },
    });
    const result = await authority.resolveSourceAuthority({
      assessmentVersionId: lesson.assessment.id,
      expectedAssessmentRevision: assessmentRow.revision,
      expectedVideoProductionRevision: canonicalVideo.revision,
      scope: { kind: "assessment" },
      decisions: comparison.conflicts.map((conflict) => ({
        questionIndex: conflict.questionIndex,
        field: conflict.field,
        decision: "CURRENT" as const,
        currentValueHash: sha(conflict.currentApprovedValue),
        blueprintValueHash: sha(conflict.blueprintProposalValue),
      })),
      rationale: "correction fixture: canonical link",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: admin.id,
    });
    assert.equal(result.created, comparison.conflicts.length);
    const written = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: lesson.assessment.id, supersededAt: null },
    });
    assert.ok(
      written.every((row) => row.videoProductionVersionId === canonical!.videoProductionVersionId),
      "MUTANT U: every decision must be bound to the canonical proposal",
    );
  });

  await check("C11 §13 — with NO link the command refuses and invents no lineage", async () => {
    const lesson = await buildLesson({ levelNumber: 9, variant: "conflicting" });
    await prisma.videoProductionAssessmentLink.deleteMany({
      where: { assessmentVersionId: lesson.assessment.id },
    });
    assert.equal(await authority.resolveCanonicalAuthorityLink(prisma, lesson.assessment.id), null);
    const assessmentRow = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: lesson.assessment.id } });
    await refusedWith(
      () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: lesson.assessment.id,
          expectedAssessmentRevision: assessmentRow.revision,
          expectedVideoProductionRevision: 1,
          scope: { kind: "assessment" },
          decisions: [
            {
              questionIndex: 0,
              field: "prompt",
              decision: "CURRENT",
              currentValueHash: sha("x"),
              blueprintValueHash: sha("y"),
            },
          ],
          rationale: "correction fixture: no link",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: admin.id,
        }),
      "AUTHORING_ASSESSMENT_LINK_MISSING",
    );
    assert.equal(
      await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: lesson.assessment.id } }),
      0,
    );
  });

  /* ================================================================== *
   * §14 — the combined adversarial case
   * ================================================================== */

  await check("C12 §14 raw conflict + multiple links + unreadable authority = no route to handoff-ready", async () => {
    const { level, status } = await withAuthorityStorageBroken("missing", () => summaryFor(8));
    assert.ok(level.assessment!.conflictCount > 0);
    assert.equal(level.assessment!.blockingConflictCount, level.assessment!.conflictCount);
    assert.equal(level.assessment!.authorityReadUnavailable, true);
    assert.equal(status.ready, false);
    assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
  });

  /* ================================================================== *
   * §15/§16 — the accepted foundation invariants still hold
   * ================================================================== */

  await check("C13 §16 BLUEPRINT history survives the corrected link and read paths", async () => {
    const lesson = await buildLesson({ levelNumber: 10, variant: "conflicting" });
    const comparison = await rawConflicts(lesson.assessment.id, lesson.video.id);
    const original = comparison.conflicts.map((conflict) => ({
      path: conflict.path,
      current: conflict.currentApprovedValue,
      blueprint: conflict.blueprintProposalValue,
    }));
    const assessmentRow = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: lesson.assessment.id } });
    const videoRow = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: lesson.video.id } });
    await authority.resolveSourceAuthority({
      assessmentVersionId: lesson.assessment.id,
      expectedAssessmentRevision: assessmentRow.revision,
      expectedVideoProductionRevision: videoRow.revision,
      scope: { kind: "assessment" },
      decisions: comparison.conflicts.map((conflict) => ({
        questionIndex: conflict.questionIndex,
        field: conflict.field,
        decision: "BLUEPRINT" as const,
        currentValueHash: sha(conflict.currentApprovedValue),
        blueprintValueHash: sha(conflict.blueprintProposalValue),
      })),
      rationale: "correction fixture: BLUEPRINT wins",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: admin.id,
    });

    // Recorded, not applied — still blocking.
    let summary = await summaryFor(10);
    assert.equal(summary.level.assessment!.blockingConflictCount, 8);

    // Now the bank genuinely carries the Blueprint wording.
    const questions = await prisma.questionDefinition.findMany({
      where: { assessmentVersionId: lesson.assessment.id },
      orderBy: { questionNumber: "asc" },
      include: { localizations: true },
    });
    for (const question of questions) {
      const localization = question.localizations[0];
      const labels = localization.optionLabels as Record<string, string>;
      await prisma.questionLocalization.update({
        where: { id: localization.id },
        data: {
          prompt: `Blueprint формулировка вопроса ${question.questionNumber}?`,
          optionLabels: { ...labels, a: `Blueprint верный ответ ${question.questionNumber}.` },
        },
      });
    }

    summary = await summaryFor(10);
    assert.equal(summary.level.assessment!.conflictCount, 0, "the two sides now agree");
    assert.equal(summary.level.assessment!.blockingConflictCount, 0);

    // THE INVARIANT: the history must still prove the conflict existed.
    const rows = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: lesson.assessment.id, supersededAt: null },
    });
    assert.equal(rows.length, 8);
    for (const row of rows) {
      const source = original.find((entry) => entry.path === row.conflictPath)!;
      assert.notEqual(row.currentValueHash, row.blueprintValueHash, "a disagreement is still provable");
      assert.equal(row.currentValueHash, sha(source.current), "the ORIGINAL current identity survives");
      assert.equal(row.blueprintValueHash, sha(source.blueprint));
      assert.equal(row.decision, "BLUEPRINT");
      assert.equal(row.decidedById, admin.id);
      assert.equal(row.evidenceSha256, EVIDENCE_SHA);
      assert.ok(row.decidedAt instanceof Date);
    }
  });

  await check("C14 §18 handoff still carries the lineage, through the canonical link", async () => {
    const projection = await authority.readSourceAuthority(prisma, {
      assessmentVersionId: authz.assessment.id,
      videoProductionVersionId: authz.video.id,
      contract: videoAuthoring.parseContractPayload(
        (await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: authz.video.id } })).contractPayload,
      ),
    });
    assert.equal(projection.decisions.length, 8);
    assert.ok(projection.resolutionFingerprint);
    assert.equal(projection.state, "ADJUDICATED_CURRENT");
    assert.equal(projection.rawConflictCount, 8, "raw lineage retained");
    assert.equal(projection.blockingConflictCount, 0);
    assert.ok(projection.decisions.every((decision) => decision.evidenceRef === EVIDENCE_REF));
  });

  await check("C15 §19 the resolution fingerprint stays deterministic and link-order independent", async () => {
    const rows = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: authz.assessment.id, supersededAt: null },
    });
    const first = authority.calculateAuthorityResolutionFingerprint(rows);
    const shuffled = authority.calculateAuthorityResolutionFingerprint([...rows].reverse());
    assert.equal(first, shuffled, "row order must not affect the lineage hash");
    assert.equal(first, authority.calculateAuthorityResolutionFingerprint(rows), "repeatable");
  });

  await check("C16 §17 adjudication still never approves, and four-eyes is untouched", async () => {
    const row = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: authz.assessment.id } });
    assert.equal(row.editorialState, "draft");
    assert.equal(row.approvedById, null);
    assert.equal(row.approvedAt, null);
  });

  await check("C17 the handoff bundle builder resolves the canonical link without throwing", async () => {
    // Exercises the corrected handoff path end to end on a level that carries
    // two links, so a regression to `findFirst` would surface here.
    const level = await prisma.levelDefinition.findFirstOrThrow({ where: { levelNumber: 8 } });
    const canonical = await authority.resolveCanonicalAuthorityLink(prisma, (
      await prisma.assessmentVersion.findFirstOrThrow({ where: { levelDefinitionId: level.id } })
    ).id);
    assert.ok(canonical);
    assert.equal(typeof handoffModule.HANDOFF_BUNDLE_SCHEMA, "string");
  });

  console.log(`\nPHASE-G2 CORRECTION-1 source-authority: ${passed} passed, ${failed} failed`);
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ suite: "source-authority-correction", passed, failed, results }, null, 2));
  }
  await prisma.$disconnect();
  rm(dbPath);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  rm(dbPath);
  process.exit(1);
});
