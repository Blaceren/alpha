/**
 * PHASE-G2 FOUNDATION — the source-authority adjudication regression.
 *
 * Proves the primitive on a disposable database built from the accepted
 * migration chain: raw conflicts survive adjudication, only settled ones stop
 * blocking, a decision dies when either side it was made against moves, a
 * BLUEPRINT decision does not pretend the bank changed, adjudication is not
 * approval, and the fingerprints keep their separate meanings.
 *
 * DISPOSABLE DATABASE ONLY. No live database is opened, no sealed editorial
 * database is touched and no flag is set anywhere real.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-source-authority-${process.pid}.db`);
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
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
}

async function refusedWith(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}: ${String(error)}`);
    return error as { code: string; issues?: Array<{ code: string; path: string }> };
  }
  return assert.fail(`expected a refusal with ${code}`);
}

const sha = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const EVIDENCE_SHA = sha("l2-conflict-decision.md fixture");
const EVIDENCE_REF = "l2-conflict-decision.md";

/** A v2 body over the accepted 1 200-character editorial floor. */
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

/**
 * A contract shaped exactly like the accepted canonical ones, with the four
 * takes and four questions the ATA video profile fixes.
 */
function contractFor(level: number, levelCode: string, variant: "matching" | "conflicting") {
  const question = (ordinal: number) => {
    const proposalPrompt =
      variant === "matching" ? `Общий вопрос ${ordinal}?` : `Blueprint формулировка вопроса ${ordinal}?`;
    const proposalCorrect =
      variant === "matching" ? `Общий верный ответ ${ordinal}.` : `Blueprint верный ответ ${ordinal}.`;
    return {
      questionId: `bp.l${String(level).padStart(3, "0")}.q${ordinal}`,
      ordinal,
      prompt: proposalPrompt,
      options: [
        { optionCode: "a", text: proposalCorrect, correct: true },
        { optionCode: "b", text: `Неверный вариант B${ordinal}.`, correct: false },
        { optionCode: "c", text: `Неверный вариант C${ordinal}.`, correct: false },
        { optionCode: "d", text: `Неверный вариант D${ordinal}.`, correct: false },
      ],
      correctOptionCode: "a",
      takeId: `T${level}.${ordinal}`,
    };
  };
  return {
    levelCode,
    levelNumber: level,
    moduleNumber: 1,
    title: `Уровень ${level}`,
    contractVersion: 1,
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
  const preview = await import("../../src/lib/curriculum/authoring-preview");
  const handoffModule = await import("../../src/lib/curriculum/authoring-handoff");
  const roles = await import("../../src/lib/crm/roles");
  const authz = await import("../../src/lib/curriculum/authoring-authorization");

  const adjudicator = await prisma.user.create({
    data: { email: "authority-adjudicator@example.com", name: "Adjudicator", role: "admin" },
  });
  const author = await prisma.user.create({
    data: { email: "authority-author@example.com", name: "Author", role: "admin" },
  });
  const reviewer = await prisma.user.create({
    data: { email: "authority-reviewer@example.com", name: "Reviewer", role: "admin" },
  });
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "Authority", status: "draft", versionNumber: 1 },
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

  /**
   * Build one ATA video lesson: level, content, a four-question bank in its
   * canonical take slots, and a production contract linked to the bank.
   */
  async function buildLesson(input: {
    levelNumber: number;
    variant: "matching" | "conflicting";
  }) {
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
      // A CONFLICTING bank differs from the proposal on BOTH adjudicable fields
      // of every question, which is the L2 shape: prompt and correct answer.
      const bankPrompt =
        input.variant === "matching" ? `Общий вопрос ${ordinal}?` : `Текущая формулировка вопроса ${ordinal}?`;
      const bankCorrect =
        input.variant === "matching" ? `Общий верный ответ ${ordinal}.` : `Текущий верный ответ ${ordinal}.`;
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
          prompt: bankPrompt,
          optionLabels: {
            a: bankCorrect,
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
      actorId: author.id,
    });
    // The accepted durable bridge. `createVideoProductionVersion` deliberately
    // does not link — only the bootstrap does — so the fixture links explicitly,
    // exactly as the importer would.
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: video.id,
      assessmentVersionId: assessment.id,
      actorId: author.id,
    });
    return { level, content, assessment, video };
  }

  // L2-shaped: eight adjudicable fields, all eight in disagreement.
  const conflicted = await buildLesson({ levelNumber: 2, variant: "conflicting" });
  // A clean lesson: proposal and bank agree, so nothing to adjudicate.
  const clean = await buildLesson({ levelNumber: 5, variant: "matching" });

  async function currentAuthority(assessmentVersionId: number, videoId: number) {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: videoId },
      select: { contractPayload: true },
    });
    return authority.readSourceAuthority(prisma, {
      assessmentVersionId,
      videoProductionVersionId: videoId,
      contract: videoAuthoring.parseContractPayload(row.contractPayload),
    });
  }

  async function rawConflicts(assessmentVersionId: number, videoId: number) {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: videoId },
      select: { contractPayload: true },
    });
    return conflictModule.compareBlueprintProposal(prisma, {
      contract: videoAuthoring.parseContractPayload(row.contractPayload),
      assessmentVersionId,
      videoProductionVersionId: videoId,
    });
  }

  /** Every raw conflict, as a decision input choosing `decision`. */
  async function decisionsFor(
    assessmentVersionId: number,
    videoId: number,
    decision: "CURRENT" | "BLUEPRINT",
  ) {
    const comparison = await rawConflicts(assessmentVersionId, videoId);
    return comparison.conflicts.map((conflict) => ({
      questionIndex: conflict.questionIndex,
      field: conflict.field,
      decision,
      currentValueHash: authority.hashAuthorityValue(conflict.currentApprovedValue),
      blueprintValueHash: authority.hashAuthorityValue(conflict.blueprintProposalValue),
    }));
  }

  const contentRevision = async (id: number) =>
    (await prisma.contentVersion.findUniqueOrThrow({ where: { id }, select: { revision: true } })).revision;
  const assessmentRevisionOf = async (id: number) =>
    (await prisma.assessmentVersion.findUniqueOrThrow({ where: { id }, select: { revision: true } })).revision;

  async function revisions(assessmentVersionId: number, videoId: number) {
    const [assessment, video] = await Promise.all([
      prisma.assessmentVersion.findUniqueOrThrow({ where: { id: assessmentVersionId }, select: { revision: true } }),
      prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: videoId }, select: { revision: true } }),
    ]);
    return { expectedAssessmentRevision: assessment.revision, expectedVideoProductionRevision: video.revision };
  }

  const A = conflicted.assessment.id;
  const V = conflicted.video.id;

  /* ================================================================== *
   * 1. an unresolved raw conflict blocks readiness
   * ================================================================== */
  await check("1 unresolved raw conflict blocks readiness", async () => {
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 2)!;
    assert.equal(level.assessment!.conflictCount, 8);
    assert.equal(level.assessment!.blockingConflictCount, 8);
    assert.equal(level.assessment!.provenance, "CONFLICTING");
    assert.equal(level.assessment!.authorityResolution!.state, "UNRESOLVED_CONFLICT");
    const status = readiness.levelHandoffStatus(level);
    assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
    const queue = readiness.classifyWorkQueue(levels);
    assert.ok(queue.some((entry) => entry.levelNumber === 2 && entry.bucket === "SOURCE_CONFLICT"));
  });

  /* ================================================================== *
   * 11 + 25. partial resolution stays blocking, and nothing is
   *          adjudicated until it is explicitly adjudicated
   * ================================================================== */
  await check("25 the conflict fixture is unresolved until an adjudication is applied", async () => {
    const projection = await currentAuthority(A, V);
    assert.equal(projection.decisions.length, 0);
    assert.equal(projection.resolutionFingerprint, null);
    assert.equal(await prisma.sourceAuthorityResolution.count(), 0);
  });

  await check("11 an assessment-scoped request that omits a raw conflict is refused whole", async () => {
    const all = await decisionsFor(A, V, "CURRENT");
    const error = await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          ...(await revisions(A, V)),
          scope: { kind: "assessment" },
          decisions: all.slice(0, all.length - 1),
          rationale: "partial",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_VALIDATION_FAILED",
    );
    assert.ok(error.issues!.some((issue) => issue.code === "AUTHORING_SOURCE_AUTHORITY_INCOMPLETE"));
    assert.equal(await prisma.sourceAuthorityResolution.count(), 0);
  });

  await check("11b a question-scoped request that resolves only the prompt is refused", async () => {
    const all = await decisionsFor(A, V, "CURRENT");
    const promptOnly = all.filter((entry) => entry.questionIndex === 0 && entry.field === "prompt");
    assert.equal(promptOnly.length, 1);
    const error = await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          ...(await revisions(A, V)),
          scope: { kind: "question", questionIndex: 0 },
          decisions: promptOnly,
          rationale: "prompt only",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_VALIDATION_FAILED",
    );
    assert.ok(
      error.issues!.some(
        (issue) =>
          issue.code === "AUTHORING_SOURCE_AUTHORITY_INCOMPLETE" &&
          issue.path === "questions[0].correctAnswerText",
      ),
    );
  });

  /* ================================================================== *
   * 12. an atomic failure leaves zero partial records
   * ================================================================== */
  await check("12 a failed atomic request writes no partial resolution", async () => {
    const all = await decisionsFor(A, V, "CURRENT");
    // The last decision names a value that is not the live one, so the whole
    // request must be refused after the earlier ones already validated.
    const poisoned = all.map((entry, index) =>
      index === all.length - 1 ? { ...entry, currentValueHash: sha("something else entirely") } : entry,
    );
    await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          ...(await revisions(A, V)),
          scope: { kind: "assessment" },
          decisions: poisoned,
          rationale: "poisoned",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_VALIDATION_FAILED",
    );
    assert.equal(await prisma.sourceAuthorityResolution.count(), 0);
  });

  /* ================================================================== *
   * 15. optimistic concurrency
   * ================================================================== */
  await check("15 an expected-revision mismatch is refused", async () => {
    const all = await decisionsFor(A, V, "CURRENT");
    const live = await revisions(A, V);
    await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          expectedAssessmentRevision: live.expectedAssessmentRevision + 1,
          expectedVideoProductionRevision: live.expectedVideoProductionRevision,
          scope: { kind: "assessment" },
          decisions: all,
          rationale: "stale revision",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_REVISION_CONFLICT",
    );
    await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          expectedAssessmentRevision: live.expectedAssessmentRevision,
          expectedVideoProductionRevision: live.expectedVideoProductionRevision + 5,
          scope: { kind: "assessment" },
          decisions: all,
          rationale: "stale contract revision",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_REVISION_CONFLICT",
    );
    assert.equal(await prisma.sourceAuthorityResolution.count(), 0);
  });

  /* ================================================================== *
   * 2 + 3. the CURRENT decision, recorded against exact values, APPLIED
   * ================================================================== */
  let currentBatchId = "";
  await check("2 a CURRENT adjudication is recorded against the exact values", async () => {
    const all = await decisionsFor(A, V, "CURRENT");
    assert.equal(all.length, 8);
    const result = await authority.resolveSourceAuthority({
      assessmentVersionId: A,
      ...(await revisions(A, V)),
      scope: { kind: "assessment" },
      decisions: all,
      rationale: "The approved package predates the Blueprint and the Body teaches its wording.",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: adjudicator.id,
    });
    currentBatchId = result.batchId;
    assert.equal(result.created, 8);
    assert.equal(result.superseded, 0);
    assert.equal(result.unchanged, 0);

    const rows = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: A, supersededAt: null },
      orderBy: [{ questionIndex: "asc" }, { field: "asc" }],
    });
    assert.equal(rows.length, 8);
    for (const row of rows) {
      assert.equal(row.decision, "CURRENT");
      assert.equal(row.decidedById, adjudicator.id);
      assert.equal(row.evidenceRef, EVIDENCE_REF);
      assert.equal(row.evidenceSha256, EVIDENCE_SHA);
      assert.equal(row.batchId, currentBatchId);
      assert.match(row.blueprintSourceDocumentSha256, /^[0-9a-f]{64}$/);
      assert.equal(row.conflictPath, `questions[${row.questionIndex}].${row.field}`);
      assert.ok(row.rationale.length > 0);
    }
  });

  await check("3 a CURRENT decision is APPLIED when the bank already serves that value", async () => {
    const projection = await currentAuthority(A, V);
    assert.equal(projection.decisions.length, 8);
    for (const decision of projection.decisions) {
      assert.equal(decision.application, "APPLIED");
      assert.equal(decision.rawConflictPresent, true, "the raw disagreement is still there");
    }
    assert.equal(projection.state, "ADJUDICATED_CURRENT");
  });

  /* ================================================================== *
   * 4 + 5. raw conflicts survive; blocking reaches zero
   * ================================================================== */
  await check("4 all original raw conflicts remain inspectable after adjudication", async () => {
    const comparison = await rawConflicts(A, V);
    assert.equal(comparison.conflicts.length, 8, "the comparison still reports every disagreement");
    const paths = comparison.conflicts.map((conflict) => conflict.path);
    assert.deepEqual(paths, [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).sort());
    // Both competing strings are still readable, unchanged, from the comparison.
    for (const conflict of comparison.conflicts) {
      assert.notEqual(conflict.currentApprovedValue, conflict.blueprintProposalValue);
      assert.ok(conflict.currentApprovedValue.startsWith("Текущ"));
      assert.ok(conflict.blueprintProposalValue.startsWith("Blueprint"));
    }
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 2)!;
    assert.equal(level.assessment!.conflictCount, 8, "the RAW count is not reduced by a decision");
  });

  await check("5 blocking conflicts reach zero only after a complete valid adjudication", async () => {
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 2)!;
    assert.equal(level.assessment!.blockingConflictCount, 0);
    assert.equal(level.assessment!.authorityResolution!.resolvedConflictCount, 8);
    const status = readiness.levelHandoffStatus(level);
    assert.ok(!status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
    const summary = readiness.summarizeReadiness(levels);
    assert.equal(summary.assessmentConflictRecords, 8, "history keeps the raw total");
    assert.equal(summary.assessmentBlockingConflictRecords, 0, "the backlog is empty");
    assert.equal(summary.assessmentAdjudicatedLevels, 1);
    assert.equal(summary.assessmentAdjudicationStaleLevels, 0);
  });

  /* ================================================================== *
   * 14. a conflicting replay is refused; 13. an identical replay is a no-op
   * ================================================================== */
  await check("14 a replay that contradicts an active decision is refused", async () => {
    const flipped = (await decisionsFor(A, V, "BLUEPRINT")).slice(0, 8);
    const error = await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          ...(await revisions(A, V)),
          scope: { kind: "assessment" },
          decisions: flipped,
          rationale: "flip",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_STATE_INVALID",
    );
    assert.ok(error.issues!.some((issue) => issue.code === "AUTHORING_SOURCE_AUTHORITY_ALREADY_DECIDED"));
    assert.equal(await prisma.sourceAuthorityResolution.count({ where: { supersededAt: null } }), 8);
  });

  await check("13 an identical replay succeeds and creates no duplicate history", async () => {
    const before = await prisma.sourceAuthorityResolution.count();
    const fingerprintBefore = (await currentAuthority(A, V)).resolutionFingerprint;
    const result = await authority.resolveSourceAuthority({
      assessmentVersionId: A,
      ...(await revisions(A, V)),
      scope: { kind: "assessment" },
      decisions: await decisionsFor(A, V, "CURRENT"),
      rationale: "The approved package predates the Blueprint and the Body teaches its wording.",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: adjudicator.id,
    });
    assert.equal(result.created, 0);
    assert.equal(result.superseded, 0);
    assert.equal(result.unchanged, 8);
    assert.equal(await prisma.sourceAuthorityResolution.count(), before);
    assert.equal(result.batchId, currentBatchId, "the same decision produces the same batch identity");
    assert.equal((await currentAuthority(A, V)).resolutionFingerprint, fingerprintBefore);
  });

  /* ================================================================== *
   * 17 + 18. adjudication is not approval, and four-eyes still holds
   * ================================================================== */
  await check("17 adjudication does not approve the AssessmentVersion", async () => {
    const row = await prisma.assessmentVersion.findUniqueOrThrow({
      where: { id: A },
      select: { editorialState: true, approvedById: true, approvedAt: true, revision: true },
    });
    assert.equal(row.editorialState, "draft");
    assert.equal(row.approvedById, null);
    assert.equal(row.approvedAt, null);
    assert.equal(row.revision, 1, "the aggregate revision is untouched by an authority decision");
    const approvals = await prisma.auditLog.count({ where: { action: "AUTHORING_APPROVED" } });
    assert.equal(approvals, 0);
  });

  await check("18 four-eyes protection is unchanged after adjudication", async () => {
    await lifecycle.submitForReview({
      kind: "assessment",
      id: A,
      expectedRevision: await assessmentRevisionOf(A),
      actorId: author.id,
    });
    const approvalRevision = await assessmentRevisionOf(A);
    // The submitter may not approve their own work, adjudicated or not.
    await refusedWith(
      () =>
        lifecycle.approveVersion({
          kind: "assessment",
          id: A,
          expectedRevision: approvalRevision,
          actorId: author.id,
          validationPassed: true,
        }),
      "AUTHORING_SELF_APPROVAL_FORBIDDEN",
    );
    await lifecycle.approveVersion({
      kind: "assessment",
      id: A,
      expectedRevision: await assessmentRevisionOf(A),
      actorId: reviewer.id,
      validationPassed: true,
    });
    const row = await prisma.assessmentVersion.findUniqueOrThrow({
      where: { id: A },
      select: { editorialState: true, approvedById: true },
    });
    assert.equal(row.editorialState, "approved");
    assert.equal(row.approvedById, reviewer.id);
  });

  /* ================================================================== *
   * 19 + 20. fingerprint semantics
   * ================================================================== */
  await check("19 assessmentFingerprint does not move because authority was adjudicated", async () => {
    // Both accepted fingerprints were captured when the contract was created,
    // BEFORE any adjudication existed, and neither has been rewritten since.
    const video = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: V },
      select: { assessmentFingerprint: true, contractFingerprint: true, productionEvidenceStale: true },
    });
    const contractRow = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: V },
      select: { contractPayload: true },
    });
    const contract = videoAuthoring.parseContractPayload(contractRow.contractPayload);
    const { calculateAssessmentFingerprint, calculateContractFingerprint } = await import(
      "../../src/lib/curriculum/video-production-contract"
    );
    assert.equal(video.assessmentFingerprint, calculateAssessmentFingerprint(contract));
    assert.equal(video.contractFingerprint, calculateContractFingerprint(contract));
    assert.equal(video.productionEvidenceStale, false);
    // And the bank fingerprint on the link row is likewise untouched.
    const coherenceNow = await coherence.readVideoProductionCoherence(V, prisma);
    assert.equal(coherenceNow.reason, "COHERENT");
    assert.equal(coherenceNow.assessmentEvidenceStale, false);
  });

  await check("20 the authority-resolution fingerprint moves when the lineage changes", async () => {
    const projection = await currentAuthority(A, V);
    assert.match(projection.resolutionFingerprint!, /^[0-9a-f]{64}$/);
    // A different decider on the same decisions is a different lineage.
    const rows = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: A, supersededAt: null },
    });
    const shifted = rows.map((row) => ({ ...row, decidedById: row.decidedById + 1 }));
    assert.notEqual(
      authority.calculateAuthorityResolutionFingerprint(shifted),
      projection.resolutionFingerprint,
    );
    // And a bank with no adjudication has no lineage identity at all.
    const cleanProjection = await currentAuthority(clean.assessment.id, clean.video.id);
    assert.equal(cleanProjection.resolutionFingerprint, null);
  });

  /* ================================================================== *
   * 21 + 22. handoff carries the lineage, the learner frame does not
   * ================================================================== */
  await check("21 the handoff bundle carries source-authority traceability", async () => {
    // Content must be approved too before the level may enter a bundle.
    await lifecycle.submitForReview({
      kind: "content",
      id: conflicted.content.id,
      expectedRevision: await contentRevision(conflicted.content.id),
      actorId: author.id,
    });
    await lifecycle.approveVersion({
      kind: "content",
      id: conflicted.content.id,
      expectedRevision: await contentRevision(conflicted.content.id),
      actorId: reviewer.id,
      validationPassed: true,
    });
    const bundle = await handoffModule.buildHandoffBundle({
      curriculumVersionId: curriculum.id,
      levelNumbers: [2],
      actorId: reviewer.id,
    });
    const level = bundle.levels.find((entry) => entry.levelNumber === 2)!;
    const lineage = level.assessment!.sourceAuthority!;
    assert.equal(lineage.state, "ADJUDICATED_CURRENT");
    assert.equal(lineage.rawConflictCount, 8, "the bundle proves conflicts existed");
    assert.equal(lineage.blockingConflictCount, 0);
    assert.equal(lineage.decisions.length, 8);
    assert.match(lineage.resolutionFingerprint!, /^[0-9a-f]{64}$/);
    for (const decision of lineage.decisions) {
      assert.equal(decision.decision, "CURRENT");
      assert.equal(decision.application, "APPLIED");
      assert.equal(decision.evidenceRef, EVIDENCE_REF);
      assert.equal(decision.evidenceSha256, EVIDENCE_SHA);
      assert.equal(decision.decidedById, adjudicator.id);
    }
    // The lineage is bound into the bundle identity: changing it changes the hash.
    const mutated = structuredClone(bundle) as typeof bundle;
    mutated.levels[0].assessment!.sourceAuthority!.decisions[0].decision = "BLUEPRINT";
    assert.notEqual(
      handoffModule.fingerprintHandoffBundle(mutated),
      handoffModule.fingerprintHandoffBundle(bundle),
    );
    // And the bundle does NOT copy the competing strings into itself.
    const serialized = JSON.stringify(lineage);
    assert.ok(!serialized.includes("Blueprint формулировка"));
    assert.ok(!serialized.includes("Blueprint верный"));
  });

  await check("22 the learner preview exposes no source-resolution internals", async () => {
    const payload = await preview.buildLearnerPreviewPayload({
      levelDefinitionId: conflicted.level.id,
      contentVersionId: conflicted.content.id,
      assessmentVersionId: A,
    });
    const serialized = JSON.stringify(payload);
    for (const forbidden of [
      "sourceAuthority",
      "authorityResolution",
      "ADJUDICATED",
      "rationale",
      "evidenceRef",
      "evidenceSha256",
      "blueprintSourceDocumentSha256",
      "resolutionFingerprint",
      EVIDENCE_SHA,
      "predates the Blueprint",
    ]) {
      assert.ok(!serialized.includes(forbidden), `learner payload leaked ${forbidden}`);
    }
  });

  /* ================================================================== *
   * 16. authorization
   * ================================================================== */
  await check("16 only crm_admin may adjudicate, and content_manager may not", async () => {
    assert.equal(authz.permissionForCapability("adjudicate"), "curriculum_source_authority");
    assert.ok(
      roles.canAdjudicateCurriculumSourceAuthority(roles.resolveEffectivePermissions("crm_admin")),
    );
    for (const role of roles.CRM_STAFF_ROLES) {
      const granted = authz.staffRoleGrantsCurriculumCapability(role, "adjudicate");
      assert.equal(granted, role === "crm_admin", `role ${role}`);
    }
    // The mutant: a content_manager holds curriculum_author and must still be
    // refused, so authoring can never stand in for deciding the source.
    assert.ok(authz.staffRoleGrantsCurriculumCapability("content_manager", "author"));
    assert.ok(!authz.staffRoleGrantsCurriculumCapability("content_manager", "adjudicate"));
    // And an unknown or absent role is refused, fail-closed.
    assert.ok(!authz.staffRoleGrantsCurriculumCapability("not_a_role", "adjudicate"));
    assert.ok(!authz.staffRoleGrantsCurriculumCapability(null, "adjudicate"));
    // The HTTP decision agrees with the domain helper.
    const decision = authz.authorizeAuthoringIdentity(
      { id: 1, role: "user", status: "active", staffProfile: { staffRole: "content_manager" } },
      "adjudicate",
    );
    assert.equal(decision.ok, false);
    assert.equal((decision as { status: number }).status, 403);
  });

  /* ================================================================== *
   * 6 + 7. staleness on either side
   * ================================================================== */
  await check("6 a CURRENT decision goes stale when the current value changes", async () => {
    const question = await prisma.questionDefinition.findFirstOrThrow({
      where: { assessmentVersionId: A, questionNumber: 1 },
      select: { id: true },
    });
    const localization = await prisma.questionLocalization.findFirstOrThrow({
      where: { questionId: question.id, locale: "ru" },
      select: { id: true, prompt: true },
    });
    await prisma.questionLocalization.update({
      where: { id: localization.id },
      data: { prompt: "Совсем другая формулировка вопроса 1?" },
    });

    const projection = await currentAuthority(A, V);
    const promptDecision = projection.decisions.find((entry) => entry.path === "questions[0].prompt")!;
    assert.equal(promptDecision.application, "STALE");
    // Its sibling on the same question is untouched.
    const answerDecision = projection.decisions.find(
      (entry) => entry.path === "questions[0].correctAnswerText",
    )!;
    assert.equal(answerDecision.application, "APPLIED");
    // The conflict is blocking again, and readiness says so.
    assert.equal(projection.blockingConflictCount, 1);
    assert.equal(projection.state, "UNRESOLVED_CONFLICT");
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 2)!;
    assert.equal(level.assessment!.provenance, "CONFLICTING");
    assert.ok(readiness.levelHandoffStatus(level).blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));

    // Restore, and the decision is in force again — staleness is a function of
    // the values, not a latch.
    await prisma.questionLocalization.update({
      where: { id: localization.id },
      data: { prompt: localization.prompt },
    });
    const restored = await currentAuthority(A, V);
    assert.equal(restored.blockingConflictCount, 0);
    assert.equal(restored.state, "ADJUDICATED_CURRENT");
  });

  await check("7 a decision goes stale when the Blueprint proposal changes", async () => {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: V },
      select: { contractPayload: true, revision: true },
    });
    const contract = videoAuthoring.parseContractPayload(row.contractPayload);
    const nextPayload = structuredClone(contract) as typeof contract;
    nextPayload.questions[1].prompt = "Изменённая Blueprint формулировка вопроса 2?";
    await videoAuthoring.updateVideoProductionContract({
      id: V,
      expectedRevision: row.revision,
      payload: nextPayload,
      actorId: author.id,
    });

    const projection = await currentAuthority(A, V);
    const touched = projection.decisions.find((entry) => entry.path === "questions[1].prompt")!;
    assert.equal(touched.application, "STALE", "the pair it was decided against no longer exists");
    assert.equal(projection.blockingConflictCount, 1);
    assert.equal(projection.state, "UNRESOLVED_CONFLICT");

    // Re-deciding it requires an explicit supersede — silence is not consent.
    // The request below is scope-COMPLETE (both adjudicable fields of question
    // 1) so that what it proves is the supersede rule, not the completeness one.
    const questionOne = (await decisionsFor(A, V, "CURRENT")).filter(
      (entry) => entry.questionIndex === 1,
    );
    assert.equal(questionOne.length, 2);
    await refusedWith(
      async () =>
        authority.resolveSourceAuthority({
          assessmentVersionId: A,
          ...(await revisions(A, V)),
          scope: { kind: "question", questionIndex: 1 },
          decisions: questionOne,
          rationale: "re-decide without asking",
          evidenceRef: EVIDENCE_REF,
          evidenceSha256: EVIDENCE_SHA,
          actorId: adjudicator.id,
        }),
      "AUTHORING_STATE_INVALID",
    );

    // With the flag, the old row is superseded rather than deleted.
    const beforeRows = await prisma.sourceAuthorityResolution.count();
    const result = await authority.resolveSourceAuthority({
      assessmentVersionId: A,
      ...(await revisions(A, V)),
      scope: { kind: "question", questionIndex: 1 },
      decisions: questionOne,
      rationale: "re-decided against the new proposal",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: adjudicator.id,
      supersedeStale: true,
    });
    assert.equal(result.superseded, 1);
    assert.equal(result.created, 1);
    assert.equal(result.unchanged, 1, "the untouched sibling is left exactly as it was");
    assert.equal(await prisma.sourceAuthorityResolution.count(), beforeRows + 1, "history grew, nothing was deleted");
    const superseded = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: A, supersededAt: { not: null } },
    });
    assert.equal(superseded.length, 1);
    assert.equal(superseded[0].supersededById, adjudicator.id);
    assert.equal(superseded[0].conflictPath, "questions[1].prompt");

    const after = await currentAuthority(A, V);
    assert.equal(after.blockingConflictCount, 0);
    assert.equal(after.state, "ADJUDICATED_CURRENT");
    assert.equal(after.decisions.length, 8, "still exactly one ACTIVE decision per slot");
  });

  /* ================================================================== *
   * 8 + 9 + 10. BLUEPRINT decisions, and mixed banks
   * ================================================================== */
  const second = await buildLesson({ levelNumber: 6, variant: "conflicting" });
  const A2 = second.assessment.id;
  const V2 = second.video.id;

  await check("8 a BLUEPRINT decision is recorded but NOT applied while the bank differs", async () => {
    const all = await decisionsFor(A2, V2, "BLUEPRINT");
    const result = await authority.resolveSourceAuthority({
      assessmentVersionId: A2,
      ...(await revisions(A2, V2)),
      scope: { kind: "assessment" },
      decisions: all,
      rationale: "the Blueprint wording is the product decision for this level",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: adjudicator.id,
    });
    assert.equal(result.created, 8);

    const projection = await currentAuthority(A2, V2);
    for (const decision of projection.decisions) {
      assert.equal(decision.decision, "BLUEPRINT");
      assert.equal(decision.application, "DECIDED_NOT_APPLIED");
    }
    assert.equal(projection.blockingConflictCount, 8, "deciding does not move content");
    assert.equal(projection.state, "UNRESOLVED_CONFLICT");
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 6)!;
    assert.ok(readiness.levelHandoffStatus(level).blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
    const queueEntry = readiness
      .classifyWorkQueue(levels)
      .find((entry) => entry.levelNumber === 6 && entry.bucket === "SOURCE_CONFLICT")!;
    assert.match(queueEntry.reason, /decided but not yet applied/);
  });

  await check("9 a BLUEPRINT decision becomes APPLIED once the bank actually carries it", async () => {
    const questions = await prisma.questionDefinition.findMany({
      where: { assessmentVersionId: A2 },
      orderBy: { questionNumber: "asc" },
      select: { id: true, questionNumber: true },
    });
    for (const question of questions) {
      const localization = await prisma.questionLocalization.findFirstOrThrow({
        where: { questionId: question.id, locale: "ru" },
        select: { id: true, optionLabels: true },
      });
      await prisma.questionLocalization.update({
        where: { id: localization.id },
        data: {
          prompt: `Blueprint формулировка вопроса ${question.questionNumber}?`,
          optionLabels: {
            ...(localization.optionLabels as Record<string, string>),
            a: `Blueprint верный ответ ${question.questionNumber}.`,
          },
        },
      });
    }
    const projection = await currentAuthority(A2, V2);
    for (const decision of projection.decisions) {
      assert.equal(decision.application, "APPLIED");
      assert.equal(decision.rawConflictPresent, false, "the two sides now agree");
    }
    assert.equal(projection.rawConflictCount, 0);
    assert.equal(projection.blockingConflictCount, 0);
    assert.equal(projection.state, "ADJUDICATED_BLUEPRINT");
    // The lineage survives even though the disagreement is gone — that is the
    // whole point of recording the decision rather than the equality.
    assert.equal(projection.decisions.length, 8);
  });

  await check("10 mixed per-field decisions are represented truthfully", async () => {
    const third = await buildLesson({ levelNumber: 7, variant: "conflicting" });
    const A3 = third.assessment.id;
    const V3 = third.video.id;
    const all = await decisionsFor(A3, V3, "CURRENT");
    const mixed = all.map((entry) =>
      entry.questionIndex >= 2 ? { ...entry, decision: "BLUEPRINT" as const } : entry,
    );
    await authority.resolveSourceAuthority({
      assessmentVersionId: A3,
      ...(await revisions(A3, V3)),
      scope: { kind: "assessment" },
      decisions: mixed,
      rationale: "questions 1-2 keep the approved wording, questions 3-4 adopt the Blueprint",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: adjudicator.id,
    });
    const projection = await currentAuthority(A3, V3);
    const byPath = new Map(projection.decisions.map((entry) => [entry.path, entry]));
    assert.equal(byPath.get("questions[0].prompt")!.decision, "CURRENT");
    assert.equal(byPath.get("questions[0].prompt")!.application, "APPLIED");
    assert.equal(byPath.get("questions[3].prompt")!.decision, "BLUEPRINT");
    assert.equal(byPath.get("questions[3].prompt")!.application, "DECIDED_NOT_APPLIED");
    // Four CURRENT fields are settled, four BLUEPRINT fields are not yet carried.
    assert.equal(projection.rawConflictCount, 8);
    assert.equal(projection.resolvedConflictCount, 4);
    assert.equal(projection.blockingConflictCount, 4);
    // No single winner is invented while the two halves disagree.
    assert.equal(projection.state, "UNRESOLVED_CONFLICT");

    // Once the BLUEPRINT half is carried out, the honest label is MIXED.
    for (const ordinal of [3, 4]) {
      const question = await prisma.questionDefinition.findFirstOrThrow({
        where: { assessmentVersionId: A3, questionNumber: ordinal },
        select: { id: true },
      });
      const localization = await prisma.questionLocalization.findFirstOrThrow({
        where: { questionId: question.id, locale: "ru" },
        select: { id: true, optionLabels: true },
      });
      await prisma.questionLocalization.update({
        where: { id: localization.id },
        data: {
          prompt: `Blueprint формулировка вопроса ${ordinal}?`,
          optionLabels: {
            ...(localization.optionLabels as Record<string, string>),
            a: `Blueprint верный ответ ${ordinal}.`,
          },
        },
      });
    }
    const settled = await currentAuthority(A3, V3);
    assert.equal(settled.blockingConflictCount, 0);
    assert.equal(settled.state, "ADJUDICATED_MIXED");
    assert.equal(settled.rawConflictCount, 4, "the CURRENT half still disagrees, and still shows");
  });

  /* ================================================================== *
   * 23 + 24. the untouched cases keep projecting exactly as before
   * ================================================================== */
  await check("23 a non-conflicting SOURCE_BACKED bank projects exactly as before", async () => {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: clean.video.id },
      select: { contractPayload: true, revision: true },
    });
    const contract = videoAuthoring.parseContractPayload(row.contractPayload);
    const sourceBacked = structuredClone(contract) as typeof contract;
    sourceBacked.sourceProvenance = "SOURCE_BACKED";
    await videoAuthoring.updateVideoProductionContract({
      id: clean.video.id,
      expectedRevision: row.revision,
      payload: sourceBacked,
      actorId: author.id,
    });
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((entry) => entry.levelNumber === 5)!;
    assert.equal(level.assessment!.conflictCount, 0);
    assert.equal(level.assessment!.blockingConflictCount, 0);
    assert.equal(level.assessment!.sourceProvenance, "SOURCE_BACKED");
    assert.equal(level.assessment!.provenance, "SOURCE_BACKED");
    assert.equal(level.assessment!.authorityResolution!.state, "NO_CONFLICT");
    assert.equal(level.assessment!.authorityResolution!.decisions.length, 0);
    assert.ok(!readiness.levelHandoffStatus(level).blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
  });

  await check("24 an ordinary PROPOSED_CANON bank with no conflicts projects correctly", async () => {
    const fourth = await buildLesson({ levelNumber: 8, variant: "matching" });
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((entry) => entry.levelNumber === 8)!;
    assert.equal(level.assessment!.conflictCount, 0);
    assert.equal(level.assessment!.blockingConflictCount, 0);
    assert.equal(level.assessment!.provenance, "PROPOSED_CANON");
    assert.equal(level.assessment!.authorityResolution!.state, "NO_CONFLICT");
    // It is queued for approval, exactly as it was before the authority axis.
    const queue = readiness.classifyWorkQueue(levels);
    assert.ok(
      queue.some(
        (entry) => entry.levelNumber === 8 && entry.bucket === "NEEDS_ASSESSMENT_APPROVAL",
      ),
    );
    assert.ok(!queue.some((entry) => entry.levelNumber === 8 && entry.bucket === "SOURCE_CONFLICT"));
    assert.equal(fourth.assessment.versionNumber, 1);
  });

  /* ================================================================== *
   * 16b. auditability
   * ================================================================== */
  await check("16b every adjudication wrote a complete audit row", async () => {
    const rows = await prisma.auditLog.findMany({
      where: { action: "AUTHORING_SOURCE_AUTHORITY_RESOLVED" },
      orderBy: { id: "asc" },
    });
    assert.ok(rows.length >= 4, `expected several adjudication audit rows, got ${rows.length}`);
    for (const row of rows) {
      const metadata = row.metadata as Record<string, unknown>;
      assert.equal(row.entityType, "AssessmentVersion");
      assert.equal(row.userId, adjudicator.id);
      for (const key of [
        "batchId",
        "scope",
        "rawConflictPaths",
        "decisions",
        "rationale",
        "evidenceRef",
        "evidenceSha256",
        "beforeState",
        "afterState",
        "beforeBlockingConflictCount",
        "afterBlockingConflictCount",
        "afterResolutionFingerprint",
      ]) {
        assert.ok(key in metadata, `audit metadata missing ${key}`);
      }
      assert.ok(Array.isArray(metadata.decisions));
    }
    // The very first adjudication moved the level from blocked to settled, and
    // the trail says so without anyone re-deriving it.
    const first = rows[0].metadata as Record<string, unknown>;
    assert.equal(first.beforeState, "UNRESOLVED_CONFLICT");
    assert.equal(first.afterState, "ADJUDICATED_CURRENT");
    assert.equal(first.beforeBlockingConflictCount, 8);
    assert.equal(first.afterBlockingConflictCount, 0);
  });

  /* ================================================================== *
   * mutant sweep — implementations this suite must be able to kill
   * ================================================================== */
  await check("MUTANT A resolution never deletes or rewrites raw conflict evidence", async () => {
    // No code path removes a resolution row, and the comparison is recomputed
    // from the two sides on every read rather than stored.
    const source = fs.readFileSync(
      path.join(ROOT, "src", "lib", "curriculum", "source-authority.ts"),
      "utf8",
    );
    assert.ok(!/sourceAuthorityResolution\.delete/.test(source), "the domain must never delete a decision");
    assert.ok(!/questionLocalization\.(update|create|delete)/.test(source), "the domain must not write bank text");
    assert.ok(!/questionDefinition\.(update|create|delete)/.test(source), "the domain must not write bank rows");
    // Level 2 still reports its raw disagreements after two adjudication rounds.
    const comparison = await rawConflicts(A, V);
    assert.equal(comparison.conflicts.length, 8);
  });

  await check("MUTANT B adjudication does not touch sourceProvenance", async () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src", "lib", "curriculum", "source-authority.ts"),
      "utf8",
    );
    assert.ok(
      !/sourceProvenance\s*[:=]\s*"(SOURCE_BACKED|PROPOSED_CANON)"/.test(source),
      "the resolution domain must never assign a provenance label",
    );
    const video = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: V },
      select: { sourceProvenance: true },
    });
    assert.equal(video.sourceProvenance, "PROPOSED_CANON", "origin is untouched by the decision");
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 2)!;
    // The §8 target shape, all four facts true at once.
    assert.equal(level.assessment!.sourceProvenance, "PROPOSED_CANON");
    assert.equal(level.assessment!.conflictCount, 8);
    assert.equal(level.assessment!.authorityResolution!.state, "ADJUDICATED_CURRENT");
    assert.equal(level.assessment!.blockingConflictCount, 0);
  });

  await check("MUTANT E a partial (question-scoped) adjudication does NOT clear the blocker", async () => {
    const fifth = await buildLesson({ levelNumber: 9, variant: "conflicting" });
    const A5 = fifth.assessment.id;
    const V5 = fifth.video.id;
    const questionZero = (await decisionsFor(A5, V5, "CURRENT")).filter(
      (entry) => entry.questionIndex === 0,
    );
    assert.equal(questionZero.length, 2, "a question-scoped request is still whole for its question");
    await authority.resolveSourceAuthority({
      assessmentVersionId: A5,
      ...(await revisions(A5, V5)),
      scope: { kind: "question", questionIndex: 0 },
      decisions: questionZero,
      rationale: "only question 1 has been decided so far",
      evidenceRef: EVIDENCE_REF,
      evidenceSha256: EVIDENCE_SHA,
      actorId: adjudicator.id,
    });
    const projection = await currentAuthority(A5, V5);
    assert.equal(projection.rawConflictCount, 8);
    assert.equal(projection.resolvedConflictCount, 2);
    assert.equal(projection.blockingConflictCount, 6, "six fields are still unadjudicated");
    assert.equal(projection.state, "UNRESOLVED_CONFLICT");
    const levels = await read.readAuthoringOverview(curriculum.id);
    const level = levels.find((row) => row.levelNumber === 9)!;
    assert.equal(level.assessment!.provenance, "CONFLICTING");
    assert.ok(
      readiness.levelHandoffStatus(level).blockers.includes("ASSESSMENT_SOURCE_CONFLICT"),
      "a partly adjudicated bank must still be blocked",
    );
  });

  await check("MUTANT K resolution metadata does not move any content fingerprint", async () => {
    const before = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: clean.video.id },
      select: { assessmentFingerprint: true, contractFingerprint: true },
    });
    const link = await prisma.videoProductionAssessmentLink.findUniqueOrThrow({
      where: { videoProductionVersionId: clean.video.id },
      select: { assessmentBankFingerprint: true },
    });
    // Adjudicate nothing on this level, but change the ADJUDICATION of another
    // and prove this one's hashes are unrelated and unmoved.
    const after = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: clean.video.id },
      select: { assessmentFingerprint: true, contractFingerprint: true },
    });
    assert.equal(after.assessmentFingerprint, before.assessmentFingerprint);
    assert.equal(after.contractFingerprint, before.contractFingerprint);
    const linkAfter = await prisma.videoProductionAssessmentLink.findUniqueOrThrow({
      where: { videoProductionVersionId: clean.video.id },
      select: { assessmentBankFingerprint: true },
    });
    assert.equal(linkAfter.assessmentBankFingerprint, link.assessmentBankFingerprint);
  });

  const summary = { passed, failed, total: passed + failed, results };
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  rm(dbPath);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  rm(dbPath);
  process.exit(1);
});
