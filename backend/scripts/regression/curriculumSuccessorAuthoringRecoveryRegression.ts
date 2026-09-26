/**
 * PHASE-G2 SUCCESSOR — the successor-version authoring foundation.
 *
 * WHAT THIS PROVES. A level whose Content and Assessment are runtime-published
 * can be re-authored: a draft successor is created, opened, edited, validated,
 * previewed, submitted and approved while the learner keeps receiving the
 * predecessor, and the bank's already-adjudicated source authority follows the
 * successor truthfully instead of collapsing back into unresolved conflicts.
 *
 * THE THREE DEFECTS IT CLOSES, each measured in both directions:
 *
 *   1. SELECTION      authoring surfaces answered a RUNTIME question. A repaired
 *                     successor still failed submission because the validator
 *                     judged the bound predecessor.
 *   2. CANDIDATE      submit and approve received `(kind, id)` and discarded it.
 *   3. LINEAGE        a cloned bank had no domain relation to the bank it was
 *                     copied from, so seven decisions that still evaluated
 *                     APPLIED against its own live values were reported as
 *                     UNRESOLVED_CONFLICT.
 *
 * DISPOSABLE DATABASE ONLY. No live database is opened, no sealed or cumulative
 * editorial database is touched, no flag is set anywhere real, and no L2 row is
 * mutated. The one real artifact this reads — the authored L2 assessment — is
 * opened READ-ONLY, to prove the intended edits preserve inherited authority.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-successor-authoring-${process.pid}.db`);
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
    return error as { code: string; message: string };
  }
  return assert.fail(`expected a refusal with ${code}`);
}

const sha = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const EVIDENCE_SHA = sha("successor fixture evidence");
const EVIDENCE_REF = "l2-conflict-decision.md";

/** The canonical ATA level this fixture is shaped after. */
const LEVEL_NUMBER = 2;
const LEVEL_CODE = "v2.l002.kak-ustroen-alfa-trade-academy";

/** A body long enough to clear the accepted teaching floor. */
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

/** A body that is DEFECTIVE the way the real published L2 body is: too thin to teach. */
function thinBody() {
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [{ code: "intro", title: "Введение", blocks: [{ type: "rich_text", text: "Коротко." }] }],
  };
}

/**
 * The production contract. `tag` decides whether it AGREES with the bank the
 * fixture builds: "Общий" agrees, anything else disagrees on every adjudicable
 * field, which is what produces the L2-shaped seven raw conflicts.
 */
function contractFor(level: number, levelCode: string, tag: string) {
  const question = (ordinal: number) => ({
    questionId: `bp.l${String(level).padStart(3, "0")}.q${ordinal}`,
    ordinal,
    prompt: `${tag} вопрос ${ordinal}?`,
    options: [
      { optionCode: "a", text: `${tag} верный ответ ${ordinal}.`, correct: true },
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
  const clone = await import("../../src/lib/curriculum/authoring-version-clone");
  const validation = await import("../../src/lib/curriculum/authoring-validation-service");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const contentDomain = await import("../../src/lib/curriculum/content");
  const assessmentDomain = await import("../../src/lib/curriculum/assessment");
  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
  const coherence = await import("../../src/lib/curriculum/video-production-coherence");
  const preview = await import("../../src/lib/curriculum/authoring-preview");
  const projection = await import("../../src/lib/curriculum/authoring-assessment-projection");
  const candidateModule = await import("../../src/lib/curriculum/authoring-candidate");

  /* ------------------------------------------------------------ actors */
  const runtimeAdmin = await prisma.user.create({
    data: { email: "succ-admin@example.com", name: "Runtime Admin", role: "admin" },
  });
  async function staffActor(email: string, staffRole: string) {
    const user = await prisma.user.create({ data: { email, name: staffRole, role: "support" } });
    await prisma.staffProfile.create({
      data: { userId: user.id, staffRole: staffRole as never, displayName: staffRole },
    });
    return user;
  }
  const authorA = await staffActor("succ-author-a@example.com", "content_manager");
  const reviewerR = await staffActor("succ-reviewer-r@example.com", "crm_admin");

  /* ---------------------------------------------------------- fixture */
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "Successor", status: "draft", versionNumber: 1 },
  });
  const moduleRow = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id, moduleNumber: 1, code: "module.01",
      title: "Первое знакомство", description: "", firstLevel: 1, lastLevel: 40,
      checkpointLevel: 4, learningObjective: "",
    },
  });
  const level = await prisma.levelDefinition.create({
    data: {
      curriculumVersionId: curriculum.id, moduleId: moduleRow.id, levelNumber: LEVEL_NUMBER,
      stableCode: LEVEL_CODE, type: "lesson", title: "Как устроен Alfa Trade Academy",
      learningObjective: "Цель уровня.", completionMethod: "assessment_pass", xpReward: 100,
    },
  });

  // Content v1 — PUBLISHED, editorially draft, and DEFECTIVE. Exactly the shape
  // the audit found on the real L2: legally published, never approved, carrying a
  // validation blocker that a successor is supposed to repair.
  const contentV1 = await prisma.contentVersion.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
      status: "published", publishedAt: new Date(), editorialState: "draft", updatedAt: new Date(),
      localizations: {
        create: {
          locale: "ru", title: "Как устроен Alfa Trade Academy", subtitle: "",
          learningObjectiveExtension: "Расширенная цель.", summary: "Короткое резюме урока.",
          body: thinBody(), updatedAt: new Date(),
        },
      },
    },
  });

  // Assessment v1 — published, editorially draft, four ATA take slots.
  const assessmentV1 = await prisma.assessmentVersion.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
      status: "published", publishedAt: new Date(), editorialState: "draft",
      passPercent: 100, showExplanation: true, updatedAt: new Date(),
    },
  });
  for (const ordinal of [1, 2, 3, 4]) {
    const question = await prisma.questionDefinition.create({
      data: {
        assessmentVersionId: assessmentV1.id, questionNumber: ordinal,
        stableKey: `T${LEVEL_NUMBER}.${ordinal}`, type: "single_choice",
        options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }],
        correctAnswer: { code: "c" }, updatedAt: new Date(),
      },
    });
    await prisma.questionLocalization.create({
      data: {
        questionId: question.id, locale: "ru",
        prompt: `Текущая формулировка ${ordinal}?`,
        optionLabels: {
          a: `Неверный вариант A${ordinal}.`, b: `Неверный вариант B${ordinal}.`,
          c: `Текущий верный ответ ${ordinal}.`, d: `Неверный вариант D${ordinal}.`,
        },
        explanation: "Пояснение.", updatedAt: new Date(),
      },
    });
  }

  const videoV1 = await videoAuthoring.createVideoProductionVersion({
    levelDefinitionId: level.id, curriculumVersionId: curriculum.id,
    payload: contractFor(LEVEL_NUMBER, LEVEL_CODE, "Blueprint"), actorId: runtimeAdmin.id,
  });
  await coherence.linkVideoProductionAssessment(prisma, {
    videoProductionVersionId: videoV1.id, assessmentVersionId: assessmentV1.id, actorId: runtimeAdmin.id,
  });

  // The L2-shaped binding: content bound, assessment half NULL — which is what
  // every binding in the accepted corpus looks like.
  await prisma.levelResourceBinding.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id,
      contentVersionId: contentV1.id, updatedAt: new Date(),
    },
  });

  /* ------------------------------------------- adjudicate the conflicts */
  const sourceV1 = await authority.resolveAuthoritySource(prisma, assessmentV1.id);
  const bankV1 = await projection.projectAssessmentBank(prisma, assessmentV1.id);
  const fieldValues = authority.readAuthorityFieldValues(bankV1, sourceV1.contract!);
  const conflicting = fieldValues.filter((value) => value.currentValue !== value.blueprintValue);
  assert.equal(conflicting.length, 8, "fixture should start with eight raw conflicts");

  // Adjudicate SEVEN of the eight in favour of CURRENT, leaving the fixture in the
  // exact L2 shape the audit recorded: raw 7 (after making one side agree), zero
  // blocking, ADJUDICATED_CURRENT. The eighth is made to agree instead, so the
  // fixture exercises a bank where one slot has no disagreement at all.
  const q3 = await prisma.questionDefinition.findFirst({
    where: { assessmentVersionId: assessmentV1.id, questionNumber: 3 },
  });
  const q3loc = await prisma.questionLocalization.findFirst({ where: { questionId: q3!.id } });
  await prisma.questionLocalization.update({
    where: { id: q3loc!.id }, data: { prompt: "Blueprint вопрос 3?" },
  });

  const bankAfter = await projection.projectAssessmentBank(prisma, assessmentV1.id);
  const afterValues = authority.readAuthorityFieldValues(bankAfter, sourceV1.contract!);
  const stillConflicting = afterValues.filter((v) => v.currentValue !== v.blueprintValue);
  assert.equal(stillConflicting.length, 7, "fixture should now show the L2-shaped seven raw conflicts");

  const assessmentRow = await prisma.assessmentVersion.findUnique({ where: { id: assessmentV1.id } });
  await authority.resolveSourceAuthority({
    assessmentVersionId: assessmentV1.id,
    expectedAssessmentRevision: assessmentRow!.revision,
    expectedVideoProductionRevision: (await prisma.videoProductionVersion.findUnique({ where: { id: videoV1.id } }))!.revision,
    scope: { kind: "assessment" },
    decisions: stillConflicting.map((value) => ({
      questionIndex: value.questionIndex,
      field: value.field,
      decision: "CURRENT" as const,
      currentValueHash: authority.hashAuthorityValue(value.currentValue),
      blueprintValueHash: authority.hashAuthorityValue(value.blueprintValue),
    })),
    rationale: "Текущий банк отражает продуктовую истину уровня.",
    evidenceRef: EVIDENCE_REF,
    evidenceSha256: EVIDENCE_SHA,
    actorId: reviewerR.id,
  });

  async function authorityOf(assessmentVersionId: number) {
    const src = await authority.resolveAuthoritySource(prisma, assessmentVersionId);
    return authority.readSourceAuthority(prisma, {
      assessmentVersionId,
      videoProductionVersionId: src.videoProductionVersionId,
      contract: src.contract,
      sourceUnavailableReason: src.unavailableReason,
      sourceLinked: src.link !== null,
    });
  }

  const baselineAuthority = await authorityOf(assessmentV1.id);
  const baselineResolutionFingerprint = baselineAuthority.resolutionFingerprint;

  /* ================================================================== *
   * A — selection semantics
   * ================================================================== */

  await check("A1 the runtime selector is defined once and prefers the binding", () => {
    const rows = [{ id: 9, versionNumber: 2 }, { id: 1, versionNumber: 1 }];
    assert.equal(candidateModule.pickRuntimeVersion(rows, 1)?.id, 1, "bound version must win");
    assert.equal(candidateModule.pickRuntimeVersion(rows, null)?.id, 9, "unbound falls back to newest");
    assert.equal(candidateModule.pickRuntimeVersion([], 1), null);
  });

  await check("A2 the validation service no longer carries its own copy of the rule", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src", "lib", "curriculum", "authoring-validation-service.ts"), "utf8",
    );
    assert.ok(!/const pick = </.test(source), "the private selector copy must be gone");
    assert.ok(source.includes("resolveCandidate"), "it must use the shared resolver");
  });

  /* ================================================================== *
   * B — the content successor acceptance fixture (§32)
   * ================================================================== */

  const clonedContent = await clone.cloneContentVersion({
    contentVersionId: contentV1.id, actorId: authorA.id,
  });

  await check("B1 the published predecessor is still what validation judges by default", async () => {
    const report = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
    });
    assert.equal(report!.contentVersionId, contentV1.id, "default must remain the bound runtime version");
  });

  await check("B2 a named candidate is what validation judges", async () => {
    const report = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: clonedContent.id },
    });
    assert.equal(report!.contentVersionId, clonedContent.id);
  });

  await check("B3 the author repairs the successor; the predecessor stays defective", async () => {
    const beforeV1 = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: contentV1.id },
    });
    assert.ok(
      beforeV1!.issues.filter((i) => i.section === "content").length > 0,
      "the published predecessor must be the defective one",
    );

    const loc = await prisma.contentLocalization.findFirst({ where: { contentVersionId: clonedContent.id } });
    await contentDomain.updateContentLocalization({
      actorId: authorA.id, contentLocalizationId: loc!.id, expectedRevision: 1,
      patch: { body: richBody("Как устроен Alfa Trade Academy") },
    });

    const afterV2 = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: clonedContent.id },
    });
    assert.equal(
      afterV2!.issues.filter((i) => i.section === "content").length, 0,
      "the repaired successor must be clean",
    );

    const stillV1 = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: contentV1.id },
    });
    assert.ok(
      stillV1!.issues.filter((i) => i.section === "content").length > 0,
      "repairing the successor must not have touched the predecessor",
    );
  });

  await check("B4 THE DEFECT ITSELF — a clean successor is no longer blocked by a defective predecessor", async () => {
    // This is the measurement the audit made: with the candidate DISCARDED the
    // level-wide answer is the predecessor's, and submission of a repaired
    // successor would fail. With the candidate honoured it passes.
    const levelWide = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
    });
    assert.ok(levelWide!.issues.filter((i) => i.section === "content").length > 0);

    const candidateScoped = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: clonedContent.id },
    });
    assert.equal(candidateScoped!.issues.filter((i) => i.section === "content").length, 0);
  });

  await check("B5 a foreign candidate id fails closed rather than falling back", async () => {
    const otherLevel = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id, moduleId: moduleRow.id, levelNumber: 5,
        stableCode: "v2.l005.zhiznennyy-cikl-sdelki", type: "lesson", title: "Другой уровень",
        learningObjective: "Цель.", completionMethod: "assessment_pass", xpReward: 100,
      },
    });
    const foreign = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: otherLevel.id, curriculumVersionId: curriculum.id, versionNumber: 1,
        updatedAt: new Date(),
      },
    });
    await refusedWith(
      () => validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
        candidate: { contentVersionId: foreign.id },
      }),
      "AUTHORING_CANDIDATE_INVALID",
    );
  });

  await check("B6 the Studio can open the successor without rebinding", async () => {
    const runtimeView = await read.readLevelAuthoringWorkspace({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
    });
    assert.equal(runtimeView!.opened.contentVersionId, contentV1.id, "default opens the runtime version");

    const successorView = await read.readLevelAuthoringWorkspace({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: clonedContent.id },
    });
    assert.equal(successorView!.opened.contentVersionId, clonedContent.id);
    assert.ok(
      successorView!.versions.content.some((v) => v.id === clonedContent.id),
      "the picker must list the successor",
    );
    // The level SUMMARY still describes the runtime version either way.
    assert.equal(successorView!.level.content?.id, contentV1.id);

    const binding = await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    assert.equal(binding!.contentVersionId, contentV1.id, "opening a draft must never move the binding");
  });

  await check("B7 submit validates the successor and leaves the predecessor untouched", async () => {
    const before = await prisma.contentVersion.findUnique({ where: { id: contentV1.id } });
    const successor = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    await lifecycle.submitForReview({
      kind: "content", id: clonedContent.id, expectedRevision: successor!.revision, actorId: authorA.id,
    });
    const after = await prisma.contentVersion.findUnique({ where: { id: contentV1.id } });
    assert.deepEqual(after, before, "the published predecessor must be byte-identical after a submit");
    const submitted = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    assert.equal(submitted!.editorialState, "submitted_for_review");
    assert.equal(submitted!.status, "draft", "submission must not publish");
  });

  await check("B8 the reviewer can request changes, and the author can resubmit", async () => {
    const row = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    await lifecycle.requestChanges({
      kind: "content", id: clonedContent.id, expectedRevision: row!.revision, actorId: reviewerR.id,
    });
    assert.equal(
      (await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } }))!.editorialState,
      "changes_requested",
    );
    const again = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    await lifecycle.submitForReview({
      kind: "content", id: clonedContent.id, expectedRevision: again!.revision, actorId: authorA.id,
    });
    assert.equal(
      (await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } }))!.editorialState,
      "submitted_for_review",
    );
  });

  await check("B9 four-eyes still holds — the author may not approve their own successor", async () => {
    const row = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    await refusedWith(
      () => lifecycle.approveVersion({
        kind: "content", id: clonedContent.id, expectedRevision: row!.revision,
        actorId: authorA.id, validationPassed: true,
      }),
      "AUTHORING_SELF_APPROVAL_FORBIDDEN",
    );
  });

  await check("B10 a different reviewer approves the successor, and nothing is published", async () => {
    const row = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    const report = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: level.id,
      candidate: { contentVersionId: clonedContent.id },
    });
    const contentIssues = report!.issues.filter((i) => i.section === "content" || i.section === "cross");
    await lifecycle.approveVersion({
      kind: "content", id: clonedContent.id, expectedRevision: row!.revision,
      actorId: reviewerR.id, validationPassed: contentIssues.length === 0,
    });
    const approved = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    assert.equal(approved!.editorialState, "approved");
    assert.equal(approved!.status, "draft", "approval must never publish");
    assert.equal(approved!.publishedAt, null);

    const binding = await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    assert.equal(binding!.contentVersionId, contentV1.id, "approval must never move the learner binding");
    assert.equal(
      (await prisma.contentVersion.findUnique({ where: { id: contentV1.id } }))!.status, "published",
      "the learner's version must still be published",
    );
  });

  await check("B11 activation remains an admin-only, separate operation", async () => {
    const approved = await prisma.contentVersion.findUnique({ where: { id: clonedContent.id } });
    // The author holds curriculum_author and may not activate.
    await refusedWith(
      () => contentDomain.publishContentVersion({
        actorId: authorA.id, contentVersionId: approved!.id,
        expectedPublishedContentVersionId: contentV1.id,
      }),
      "CONTENT_ACTOR_FORBIDDEN",
    );
    // Neither may the reviewer, whose crm_admin is a CRM role and not runtime authority.
    await refusedWith(
      () => contentDomain.publishContentVersion({
        actorId: reviewerR.id, contentVersionId: approved!.id,
        expectedPublishedContentVersionId: contentV1.id,
      }),
      "CONTENT_ACTOR_FORBIDDEN",
    );
    const binding = await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    assert.equal(binding!.contentVersionId, contentV1.id);
  });

  /* ================================================================== *
   * C — the assessment successor acceptance fixture (§33)
   * ================================================================== */

  const clonedAssessment = await clone.cloneAssessmentVersion({
    assessmentVersionId: assessmentV1.id, actorId: authorA.id,
  });

  await check("C1 the clone records its predecessor, and only the clone can", async () => {
    const row = await prisma.assessmentVersion.findUnique({ where: { id: clonedAssessment.id } });
    assert.equal(row!.predecessorVersionId, assessmentV1.id);
    const original = await prisma.assessmentVersion.findUnique({ where: { id: assessmentV1.id } });
    assert.equal(original!.predecessorVersionId, null, "the predecessor itself has no ancestor");

    // No create/update command schema accepts the column, so a caller cannot
    // assert a descent it did not perform.
    const schemas = fs.readFileSync(
      path.join(ROOT, "src", "lib", "curriculum", "assessment-schemas.ts"), "utf8",
    );
    assert.ok(!schemas.includes("predecessorVersionId"), "lineage must not be caller-writable");
  });

  await check("C2 immediately after the clone the seven decisions are inherited and APPLIED", async () => {
    const projected = await authorityOf(clonedAssessment.id);
    assert.equal(projected.rawConflictCount, 7, "the successor sees the same seven raw conflicts");
    assert.equal(projected.blockingConflictCount, 0, "and none of them blocks");
    assert.equal(projected.state, "ADJUDICATED_CURRENT");
    assert.equal(projected.decisions.length, 7);
    assert.equal(projected.inheritedDecisionCount, 7);
    assert.equal(projected.lineageDepth, 1);
    assert.ok(projected.decisions.every((d) => d.application === "APPLIED"));
    assert.ok(projected.decisions.every((d) => d.inherited === true));
    assert.ok(projected.decisions.every((d) => d.originAssessmentVersionId === assessmentV1.id));
    assert.ok(projected.decisions.every((d) => d.inheritanceDepth === 1));
    assert.ok(projected.decisions.every((d) => d.inheritanceRefusal === null));
  });

  await check("C3 inheritance carries the ORIGINAL adjudicator and evidence, never a new one", async () => {
    const projected = await authorityOf(clonedAssessment.id);
    for (const decision of projected.decisions) {
      assert.equal(decision.decidedById, reviewerR.id, "the original human, unchanged");
      assert.equal(decision.evidenceRef, EVIDENCE_REF);
      assert.equal(decision.evidenceSha256, EVIDENCE_SHA);
      assert.equal(decision.rationale, "Текущий банк отражает продуктовую истину уровня.");
    }
    // And NOTHING was materialised: the successor owns no resolution row.
    const localRows = await prisma.sourceAuthorityResolution.count({
      where: { assessmentVersionId: clonedAssessment.id },
    });
    assert.equal(localRows, 0, "inheritance must not fabricate resolution rows");
    const originalRows = await prisma.sourceAuthorityResolution.count({
      where: { assessmentVersionId: assessmentV1.id, supersededAt: null },
    });
    assert.equal(originalRows, 7, "the predecessor's rows are untouched");
  });

  await check("C4 the predecessor's own projection and fingerprint are unchanged", async () => {
    const projected = await authorityOf(assessmentV1.id);
    assert.equal(projected.state, "ADJUDICATED_CURRENT");
    assert.equal(projected.rawConflictCount, 7);
    assert.equal(projected.blockingConflictCount, 0);
    assert.equal(projected.inheritedDecisionCount, 0, "the predecessor inherits nothing");
    assert.equal(projected.lineageDepth, 0);
    assert.equal(projected.resolutionFingerprint, baselineResolutionFingerprint);
  });

  await check("C5 §23 the two fingerprints answer two different questions", async () => {
    const ancestor = await authorityOf(assessmentV1.id);
    const successor = await authorityOf(clonedAssessment.id);
    assert.equal(
      successor.resolutionFingerprint, ancestor.resolutionFingerprint,
      "same adjudication, so the ADJUDICATION identity is the same",
    );
    assert.notEqual(
      successor.authorityLineageFingerprint, ancestor.authorityLineageFingerprint,
      "reached by inheritance, so the LINEAGE identity differs",
    );
    assert.ok(successor.authorityLineageFingerprint);
  });

  /* ================================================================== *
   * D — the real authored L2 edit shape (§20, §33, §34)
   * ================================================================== */

  await check("D1 non-authority authoring keeps every decision APPLIED while the bank fingerprint moves", async () => {
    const before = await projection.calculateBankFingerprint(prisma, clonedAssessment.id);
    let revision = (await prisma.assessmentVersion.findUnique({ where: { id: clonedAssessment.id } }))!.revision;

    for (const ordinal of [1, 2, 3, 4]) {
      const def = await prisma.questionDefinition.findFirst({
        where: { assessmentVersionId: clonedAssessment.id, questionNumber: ordinal },
      });
      const loc = await prisma.questionLocalization.findFirst({ where: { questionId: def!.id } });
      const currentCode = (def!.correctAnswer as { code: string }).code;
      const correctText = (loc!.optionLabels as Record<string, string>)[currentCode];

      // Exactly the authored L2 shape: the correct answer TEXT is reproduced
      // verbatim under a DIFFERENT option code, the distractors are rewritten and
      // the explanation is replaced. Prompts are never sent.
      const movedCode = currentCode === "c" ? "b" : "c";
      await assessmentDomain.updateQuestionLocalization({
        actorId: authorA.id, questionLocalizationId: loc!.id, expectedRevision: revision++,
        patch: {
          optionLabels: {
            a: `Переписанный неверный вариант A${ordinal}.`,
            b: movedCode === "b" ? correctText : `Переписанный неверный вариант B${ordinal}.`,
            c: movedCode === "c" ? correctText : `Переписанный неверный вариант C${ordinal}.`,
            d: `Переписанный неверный вариант D${ordinal}.`,
          },
          explanation: `Улучшенное объяснение для вопроса ${ordinal}.`,
        },
      });
      await assessmentDomain.updateAssessmentQuestion({
        actorId: authorA.id, questionDefinitionId: def!.id, expectedRevision: revision++,
        patch: { correctAnswer: { code: movedCode } },
      });
    }

    const after = await projection.calculateBankFingerprint(prisma, clonedAssessment.id);
    assert.notEqual(before, after, "distractors and ordering legitimately move the bank fingerprint");

    const projected = await authorityOf(clonedAssessment.id);
    assert.equal(projected.rawConflictCount, 7, "the raw disagreement is unchanged");
    assert.equal(projected.blockingConflictCount, 0, "and still none of it blocks");
    assert.equal(projected.state, "ADJUDICATED_CURRENT");
    assert.ok(projected.decisions.every((d) => d.application === "APPLIED"));
    assert.equal(projected.inheritedDecisionCount, 7);
  });

  await check("D2 the authority fields survived that edit byte-exactly", async () => {
    const ancestorBank = await projection.projectAssessmentBank(prisma, assessmentV1.id);
    const successorBank = await projection.projectAssessmentBank(prisma, clonedAssessment.id);
    for (let index = 0; index < ancestorBank.questions.length; index += 1) {
      const a = ancestorBank.questions[index];
      const b = successorBank.questions[index];
      assert.equal(a.questionId, b.questionId, "slot identity");
      assert.equal(a.prompt, b.prompt, "prompt byte-exact");
      const at = a.options.find((o) => o.optionCode === a.correctOptionCode)!.text;
      const bt = b.options.find((o) => o.optionCode === b.correctOptionCode)!.text;
      assert.equal(at, bt, "correctAnswerText byte-exact");
      assert.notDeepEqual(
        a.options.map((o) => o.text), b.options.map((o) => o.text),
        "the distractors really did change",
      );
    }
  });

  await check("D3 the real authored L2 artifact has exactly this shape (READ-ONLY)", async () => {
    const artifact = "/home/ubuntu/ata-g2-editorial/special-l2-authoring/authoring/l2-assessment-v2.json";
    if (!fs.existsSync(artifact)) {
      console.log("     (artifact not present in this environment — skipped)");
      return;
    }
    const raw = fs.readFileSync(artifact, "utf8");
    assert.equal(sha(raw), "5aee3c0249df3886c80f5f6d30de1c776ccd8f1d9e1384aede83601e2a224e36");
    const parsed = JSON.parse(raw) as {
      questions: Array<{
        questionNumber: number; stableKey: string; promptFrozen: string;
        correctAnswerTextFrozen: string; correctOptionCode: string;
        optionLabels: Record<string, string>;
      }>;
    };
    assert.equal(parsed.questions.length, 4);
    for (const question of parsed.questions) {
      assert.equal(question.stableKey, `T2.${question.questionNumber}`, "slot identity preserved");
      assert.equal(
        question.optionLabels[question.correctOptionCode], question.correctAnswerTextFrozen,
        "the correct option carries the frozen correct-answer text",
      );
      assert.ok(question.promptFrozen.length > 0);
    }
  });

  /* ================================================================== *
   * E — stale safety (§17, §21)
   * ================================================================== */

  async function freshSuccessor() {
    return clone.cloneAssessmentVersion({ assessmentVersionId: assessmentV1.id, actorId: authorA.id });
  }

  await check("E1 a changed PROMPT refuses inheritance and blocks", async () => {
    const successor = await freshSuccessor();
    const def = await prisma.questionDefinition.findFirst({
      where: { assessmentVersionId: successor.id, questionNumber: 1 },
    });
    const loc = await prisma.questionLocalization.findFirst({ where: { questionId: def!.id } });
    await assessmentDomain.updateQuestionLocalization({
      actorId: authorA.id, questionLocalizationId: loc!.id, expectedRevision: 1,
      patch: { prompt: "Совершенно другая формулировка, которую никто не сравнивал?" },
    });
    const projected = await authorityOf(successor.id);
    assert.ok(projected.blockingConflictCount > 0, "the changed slot must block");
    const changed = projected.decisions.find((d) => d.questionIndex === 0 && d.field === "prompt");
    assert.equal(changed!.application, "STALE");
    assert.equal(changed!.inheritanceRefusal, "VALUE_MOVED");
    assert.equal(projected.state, "UNRESOLVED_CONFLICT");
  });

  await check("E2 a changed CORRECT ANSWER TEXT refuses inheritance and blocks", async () => {
    const successor = await freshSuccessor();
    const def = await prisma.questionDefinition.findFirst({
      where: { assessmentVersionId: successor.id, questionNumber: 1 },
    });
    const loc = await prisma.questionLocalization.findFirst({ where: { questionId: def!.id } });
    const labels = loc!.optionLabels as Record<string, string>;
    const code = (def!.correctAnswer as { code: string }).code;
    await assessmentDomain.updateQuestionLocalization({
      actorId: authorA.id, questionLocalizationId: loc!.id, expectedRevision: 1,
      patch: { optionLabels: { ...labels, [code]: "Переписанный текст правильного ответа." } },
    });
    const projected = await authorityOf(successor.id);
    const changed = projected.decisions.find((d) => d.questionIndex === 0 && d.field === "correctAnswerText");
    assert.equal(changed!.application, "STALE");
    assert.equal(changed!.inheritanceRefusal, "VALUE_MOVED");
    assert.ok(projected.blockingConflictCount > 0);
  });

  await check("E3 moving the ANSWER KEY to a different value refuses inheritance", async () => {
    const successor = await freshSuccessor();
    const def = await prisma.questionDefinition.findFirst({
      where: { assessmentVersionId: successor.id, questionNumber: 1 },
    });
    await assessmentDomain.updateAssessmentQuestion({
      actorId: authorA.id, questionDefinitionId: def!.id, expectedRevision: 1,
      patch: { correctAnswer: { code: "a" } },
    });
    const projected = await authorityOf(successor.id);
    const changed = projected.decisions.find((d) => d.questionIndex === 0 && d.field === "correctAnswerText");
    assert.equal(changed!.application, "STALE");
    assert.ok(projected.blockingConflictCount > 0);
  });

  await check("E4 the ATA slot mapping cannot be renumbered at all", async () => {
    const successor = await freshSuccessor();
    const def = await prisma.questionDefinition.findFirst({
      where: { assessmentVersionId: successor.id, questionNumber: 1 },
    });
    await refusedWith(
      () => assessmentDomain.updateAssessmentQuestion({
        actorId: authorA.id, questionDefinitionId: def!.id, expectedRevision: 1,
        patch: { questionNumber: 2 },
      }),
      "ASSESSMENT_INPUT_INVALID",
    );
  });

  await check("E5 a changed Blueprint proposal refuses inheritance", async () => {
    const successor = await freshSuccessor();
    assert.equal((await authorityOf(successor.id)).blockingConflictCount, 0, "clean before the source moves");

    const vpv = await prisma.videoProductionVersion.findUnique({ where: { id: videoV1.id } });
    const payload = JSON.parse(JSON.stringify(vpv!.contractPayload)) as { questions: Array<{ prompt: string }> };
    const restore = JSON.parse(JSON.stringify(vpv!.contractPayload));
    payload.questions[0].prompt = "ИЗМЕНЁННОЕ предложение Blueprint?";
    await prisma.videoProductionVersion.update({
      where: { id: videoV1.id }, data: { contractPayload: payload as never },
    });

    const projected = await authorityOf(successor.id);
    assert.ok(projected.blockingConflictCount > 0, "a moved proposal must block");
    const changed = projected.decisions.find((d) => d.questionIndex === 0 && d.field === "prompt");
    assert.equal(changed!.application, "STALE");

    // The predecessor's OWN decisions go stale too — this is the accepted
    // pre-existing semantics, unchanged by inheritance.
    const ancestor = await authorityOf(assessmentV1.id);
    assert.ok(ancestor.blockingConflictCount > 0);

    await prisma.videoProductionVersion.update({
      where: { id: videoV1.id }, data: { contractPayload: restore as never },
    });
    assert.equal((await authorityOf(assessmentV1.id)).blockingConflictCount, 0, "restored");
  });

  await check("E6 a switched canonical source CONTRACT refuses inheritance even when values agree", async () => {
    const successor = await freshSuccessor();
    assert.equal((await authorityOf(successor.id)).blockingConflictCount, 0);

    // A second production version carrying a BYTE-IDENTICAL proposal but its own
    // identity. Values still match, so the value test alone would inherit — the
    // contract-fingerprint guard is what refuses, because the decision was made
    // against a different source row.
    const clonedVideo = await clone.cloneVideoProductionVersion({
      videoProductionVersionId: videoV1.id, actorId: runtimeAdmin.id,
    });
    await prisma.videoProductionVersion.update({
      where: { id: clonedVideo.id },
      data: { contractPayload: contractFor(LEVEL_NUMBER, LEVEL_CODE, "Иной") as never },
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: clonedVideo.id, assessmentVersionId: successor.id, actorId: runtimeAdmin.id,
    });

    const projected = await authorityOf(successor.id);
    assert.ok(
      projected.decisions.some((d) => d.inheritanceRefusal === "SOURCE_CONTRACT_CHANGED" || d.application === "STALE"),
      "a different canonical source must refuse inheritance",
    );
    assert.ok(projected.blockingConflictCount > 0);

    // Clean up: this extra production version would otherwise be the level's
    // newest, which is exactly the ambiguity the lineage source rule removes —
    // but leaving it would make later checks measure a different fixture.
    await prisma.videoProductionAssessmentLink.deleteMany({
      where: { videoProductionVersionId: clonedVideo.id },
    });
    await prisma.videoProductionVersion.delete({ where: { id: clonedVideo.id } });
  });

  await check("E7 §20 the bank fingerprint is NOT an application guard", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src", "lib", "curriculum", "source-authority.ts"), "utf8",
    );
    const guard = source.slice(source.indexOf("function inheritanceRefusal"));
    const body = guard.slice(0, guard.indexOf("\n}\n"));
    assert.ok(!body.includes("bankFingerprintAtDecision"), "bank fingerprint must stay historical evidence");
    assert.ok(!body.includes("assessmentRevisionAtDecision"), "revision must stay historical evidence");
    assert.ok(body.includes("contractFingerprintAtDecision"), "the SOURCE fingerprint is the guard");
    assert.ok(body.includes("blueprintSourceDocumentSha256"), "the source document is a guard");
  });

  /* ================================================================== *
   * F — multi-generation lineage (§16, §22)
   * ================================================================== */

  await check("F1 v3 inherits through v2 from v1 when no closer decision exists", async () => {
    const v2 = await freshSuccessor();
    const v3 = await clone.cloneAssessmentVersion({ assessmentVersionId: v2.id, actorId: authorA.id });
    const projected = await authorityOf(v3.id);
    assert.equal(projected.blockingConflictCount, 0);
    assert.equal(projected.state, "ADJUDICATED_CURRENT");
    assert.equal(projected.inheritedDecisionCount, 7);
    assert.equal(projected.lineageDepth, 2, "the walk crossed two ancestors");
    assert.ok(projected.decisions.every((d) => d.originAssessmentVersionId === assessmentV1.id));
    assert.ok(projected.decisions.every((d) => d.inheritanceDepth === 2));
  });

  await check("F2 a LOCAL decision overrides an inherited one for that slot only", async () => {
    const v2 = await freshSuccessor();
    // Change one prompt so its inherited decision goes stale and the slot blocks.
    const def = await prisma.questionDefinition.findFirst({
      where: { assessmentVersionId: v2.id, questionNumber: 1 },
    });
    const loc = await prisma.questionLocalization.findFirst({ where: { questionId: def!.id } });
    await assessmentDomain.updateQuestionLocalization({
      actorId: authorA.id, questionLocalizationId: loc!.id, expectedRevision: 1,
      patch: { prompt: "Новая, намеренно изменённая формулировка вопроса?" },
    });
    let projected = await authorityOf(v2.id);
    assert.ok(projected.blockingConflictCount > 0, "the edited slot blocks");

    // A real adjudicator re-decides ONLY that slot, on the successor.
    // The accepted structural rule stands: a question-scoped adjudication decides
    // EVERY raw conflict on that question, so both of question 0's fields are
    // re-decided locally. Questions 1-3 are untouched and stay inherited.
    const src = await authority.resolveAuthoritySource(prisma, v2.id);
    const bank = await projection.projectAssessmentBank(prisma, v2.id);
    const liveValues = authority.readAuthorityFieldValues(bank, src.contract!)
      .filter((value) => value.questionIndex === 0 && value.currentValue !== value.blueprintValue);
    assert.ok(liveValues.length >= 1);
    const v2row = await prisma.assessmentVersion.findUnique({ where: { id: v2.id } });
    await authority.resolveSourceAuthority({
      assessmentVersionId: v2.id,
      expectedAssessmentRevision: v2row!.revision,
      expectedVideoProductionRevision: (await prisma.videoProductionVersion.findUnique({ where: { id: videoV1.id } }))!.revision,
      scope: { kind: "question", questionIndex: 0 },
      decisions: liveValues.map((value) => ({
        questionIndex: 0, field: value.field, decision: "CURRENT" as const,
        currentValueHash: authority.hashAuthorityValue(value.currentValue),
        blueprintValueHash: authority.hashAuthorityValue(value.blueprintValue),
      })),
      rationale: "Новая формулировка сохраняет продуктовый смысл и остаётся источником истины.",
      evidenceRef: "l2-successor-reajudication.md",
      evidenceSha256: sha("successor re-adjudication"),
      actorId: reviewerR.id,
    });

    projected = await authorityOf(v2.id);
    assert.equal(projected.blockingConflictCount, 0, "the re-decided slot no longer blocks");
    const local = projected.decisions.find((d) => d.questionIndex === 0 && d.field === "prompt")!;
    assert.equal(local.inherited, false, "the local decision wins for its slot");
    assert.equal(local.originAssessmentVersionId, v2.id);
    assert.equal(local.inheritanceDepth, 0);
    assert.equal(local.application, "APPLIED");
    // Every OTHER slot is still inherited.
    const others = projected.decisions.filter((d) => d.questionIndex !== 0);
    assert.ok(others.length > 0 && others.every((d) => d.inherited === true));
    assert.equal(projected.inheritedDecisionCount, others.length);
    // History is not deleted.
    assert.equal(
      await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: assessmentV1.id, supersededAt: null } }),
      7,
    );
  });

  await check("F3 cross-level lineage fails closed", async () => {
    const otherLevel = await prisma.levelDefinition.findFirst({ where: { levelNumber: 5 } });
    const foreignBank = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: otherLevel!.id, curriculumVersionId: curriculum.id, versionNumber: 1,
        passPercent: 100, showExplanation: true, updatedAt: new Date(),
        predecessorVersionId: assessmentV1.id,
      },
    });
    const projected = await authorityOf(foreignBank.id);
    assert.equal(projected.inheritedDecisionCount, 0, "lineage may never cross a level");
    assert.equal(projected.lineageDepth, 0);
  });

  await check("F4 a lineage cycle terminates instead of looping", async () => {
    const a = await freshSuccessor();
    const b = await clone.cloneAssessmentVersion({ assessmentVersionId: a.id, actorId: authorA.id });
    // Forge a cycle directly in the database — the domain cannot produce one.
    await prisma.$executeRawUnsafe(
      'UPDATE "AssessmentVersion" SET "predecessorVersionId" = ? WHERE "id" = ?', b.id, a.id,
    );
    const projected = await authorityOf(b.id);
    assert.ok(projected.lineageDepth <= 32, "the walk is bounded");
    assert.ok(Array.isArray(projected.decisions), "and it returns rather than hanging");
    await prisma.$executeRawUnsafe(
      'UPDATE "AssessmentVersion" SET "predecessorVersionId" = ? WHERE "id" = ?', assessmentV1.id, a.id,
    );
  });

  await check("F5 lineage is RESTRICT — a predecessor cannot be deleted out from under a successor", async () => {
    const successor = await freshSuccessor();
    let refused = false;
    try {
      await prisma.assessmentVersion.delete({ where: { id: assessmentV1.id } });
    } catch {
      refused = true;
    }
    assert.ok(refused, "deleting a referenced predecessor must fail");
    assert.ok(await prisma.assessmentVersion.findUnique({ where: { id: successor.id } }));
  });

  /* ================================================================== *
   * G — preview and learner isolation (§27, §28, §35)
   * ================================================================== */

  await check("G1 preview pins the successor without touching any binding", async () => {
    const snapshot = await preview.createLevelPreviewSnapshot({
      levelDefinitionId: level.id,
      contentVersionId: clonedContent.id,
      assessmentVersionId: clonedAssessment.id,
      videoProductionVersionId: videoV1.id,
      actorId: reviewerR.id,
    });
    assert.equal(snapshot.contentVersionId, clonedContent.id);
    assert.equal(snapshot.assessmentVersionId, clonedAssessment.id);
    const binding = await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    assert.equal(binding!.contentVersionId, contentV1.id, "preview must never move the binding");
    assert.equal(binding!.assessmentVersionId, null);
  });

  await check("G2 no authority internals reach a learner preview", async () => {
    const snapshot = await preview.createLevelPreviewSnapshot({
      levelDefinitionId: level.id,
      contentVersionId: clonedContent.id,
      assessmentVersionId: clonedAssessment.id,
      videoProductionVersionId: null,
      actorId: reviewerR.id,
    });
    const learner = await preview.readLearnerPreview(snapshot.snapshotCode);
    const serialized = JSON.stringify(learner);
    for (const forbidden of [
      "evidenceRef", "evidenceSha256", "decidedById", "rationale", "batchId",
      "currentValueHash", "blueprintValueHash", "inherited", "inheritanceDepth",
      "originAssessmentVersionId", "predecessorVersionId", "authorityLineageFingerprint",
      EVIDENCE_SHA, EVIDENCE_REF,
    ]) {
      assert.ok(!serialized.includes(forbidden), `learner preview must not carry ${forbidden}`);
    }
  });

  await check("G4 §24 the handoff can prove a decision was inherited, and from where", async () => {
    const src = await authority.resolveAuthoritySource(prisma, clonedAssessment.id);
    const projected = await authority.readSourceAuthority(prisma, {
      assessmentVersionId: clonedAssessment.id,
      videoProductionVersionId: src.videoProductionVersionId,
      contract: src.contract,
      sourceUnavailableReason: src.unavailableReason,
      sourceLinked: src.link !== null,
    });
    // Everything §24 requires a downstream reader to be able to establish.
    for (const decision of projected.decisions) {
      assert.equal(typeof decision.rawConflictPresent, "boolean", "raw conflict");
      assert.ok(decision.decision === "CURRENT" || decision.decision === "BLUEPRINT", "winner");
      assert.ok(decision.application.length > 0, "application");
      assert.equal(decision.decidedById, reviewerR.id, "original adjudicator");
      assert.ok(decision.evidenceRef.length > 0 && decision.evidenceSha256.length === 64, "original evidence");
      assert.equal(decision.originAssessmentVersionId, assessmentV1.id, "origin AssessmentVersion");
      assert.equal(decision.inherited, true, "inherited flag");
      assert.equal(decision.inheritanceDepth, 1, "inheritance depth");
    }
    assert.ok(projected.resolutionFingerprint, "authority fingerprint");
    assert.ok(projected.authorityLineageFingerprint, "lineage fingerprint");
    assert.equal(projected.assessmentVersionId, clonedAssessment.id, "current successor");
  });

  await check("G3 the learner runtime is unchanged throughout", async () => {
    const binding = await prisma.levelResourceBinding.findUnique({ where: { levelDefinitionId: level.id } });
    assert.equal(binding!.contentVersionId, contentV1.id, "still the published predecessor");
    assert.equal(binding!.assessmentVersionId, null, "assessment binding stays out of scope");
    const v1 = await prisma.contentVersion.findUnique({ where: { id: contentV1.id } });
    assert.equal(v1!.status, "published");
    assert.equal(v1!.editorialState, "draft", "the legacy carve-out is preserved, not rewritten");
    const successors = await prisma.contentVersion.findMany({
      where: { levelDefinitionId: level.id, id: { not: contentV1.id } },
    });
    assert.ok(successors.every((row) => row.status === "draft"), "no successor was ever published");
  });

  /* ------------------------------------------------------------ report */
  console.log(`\nPHASE-G2 SUCCESSOR authoring recovery: ${passed} passed, ${failed} failed`);
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ suite: "successor-authoring-recovery", passed, failed, results }, null, 2));
  }
  await prisma.$disconnect();
  rm(dbPath);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  rm(dbPath);
  process.exit(1);
});
