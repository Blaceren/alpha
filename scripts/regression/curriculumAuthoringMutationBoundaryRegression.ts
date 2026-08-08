/**
 * PHASE-G0 CORRECTION — the mutation-boundary regression.
 *
 * THIS SUITE IS THE EXPLOIT. Every scenario below is one the independent audit
 * ATA-PRODUCT-PHASE-G0-FINAL-TARGETED-AUDIT-1 executed successfully against the
 * G0 candidate. Each one must now be refused. If any of them starts passing
 * again, the BLOCKER is back.
 *
 * WHAT THE AUDIT PROVED WAS POSSIBLE:
 *   • the learner body of an APPROVED lesson could be rewritten
 *   • an asset could be attached to an APPROVED lesson
 *   • the ANSWER KEY of an APPROVED bank could be changed
 *   • a version SUBMITTED for review could be edited beneath its reviewer
 *   • a legacy child write moved no revision, so a stale editor's later write
 *     was accepted — a silent lost update
 *   • authoring through the legacy route left `lastAuthoredById` NULL, so the
 *     author could then approve their own text and four-eyes never fired
 *
 * DISPOSABLE DATABASE ONLY. Nothing here touches preprod and no flag is set on
 * any real environment.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-authoring-boundary-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;

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

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Assert a rejection carries an exact code, never a message substring. */
async function refusedWith(fn: () => Promise<unknown>, code: string): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}: ${String(error)}`);
    return error;
  }
  return assert.fail(`expected a refusal with ${code}, but the mutation SUCCEEDED`);
}

function lessonBody(marker: string) {
  const paragraph =
    "Дисциплина в торговле начинается с плана, который написан до открытия позиции. " +
    "План отвечает на три вопроса: где вход, где выход и сколько капитала под риском. " +
    "Пока эти ответы не записаны, любое движение цены выглядит как повод действовать. " +
    "Записанный план превращает решение в проверку условий, а не в реакцию на эмоцию. ";
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      {
        code: `intro-${marker}`,
        title: `Введение ${marker}`,
        blocks: [
          { type: "heading", level: 3, text: "Почему план важнее прогноза" },
          { type: "rich_text", text: paragraph.repeat(2) },
          {
            type: "callout",
            variant: "risk",
            title: "Риск",
            body: "Торговля сопряжена с риском потери капитала.",
          },
          { type: "list", ordered: true, items: ["Определите вход", "Определите выход", "Определите риск"] },
        ],
      },
    ],
  };
}

async function main() {
  cleanupDb();
  const runner = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (runner.status !== 0) throw new Error(`${runner.stdout}\n${runner.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  // The exact flag state a live activation of the Authoring Studio implies. The
  // audit's whole point was that these turn the LEGACY surface on too.
  process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const content = await import("../../src/lib/curriculum/content");
  const assessment = await import("../../src/lib/curriculum/assessment");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const constants = await import("../../src/lib/curriculum/constants");

  /* ------------------------------------------------------------------ seed */
  const adminA = await prisma.user.create({
    data: { email: "boundary-a@example.com", name: "Admin A", role: "admin" },
  });
  const adminB = await prisma.user.create({
    data: { email: "boundary-b@example.com", name: "Admin B", role: "admin" },
  });
  const approverC = await prisma.user.create({
    data: { email: "boundary-c@example.com", name: "Approver C", role: "admin" },
  });

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "BOUNDARY-100", name: "Boundary", status: "draft", versionNumber: 1 },
  });
  const courseModule = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleNumber: 1,
      code: "M1",
      title: "Module 1",
      firstLevel: 1,
      lastLevel: 100,
    },
  });
  let levelSeq = 0;
  const makeLevel = async () => {
    levelSeq += 1;
    return prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: courseModule.id,
        levelNumber: levelSeq,
        stableCode: `boundary-l${levelSeq}`,
        type: "lesson",
        title: `Level ${levelSeq}`,
        completionMethod: "content",
      },
    });
  };

  /** A draft ContentVersion with one localization, ready to author. */
  async function makeContent() {
    const level = await makeLevel();
    const version = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        createdById: adminA.id,
      },
    });
    const localization = await prisma.contentLocalization.create({
      data: {
        contentVersionId: version.id,
        locale: "ru",
        title: "Исходный заголовок",
        body: lessonBody("seed") as never,
      },
    });
    return { level, version, localization };
  }

  /** A draft AssessmentVersion carrying one question. */
  async function makeAssessment() {
    const level = await makeLevel();
    const version = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        passPercent: 70,
        createdById: adminA.id,
      },
    });
    const question = await prisma.questionDefinition.create({
      data: {
        assessmentVersionId: version.id,
        questionNumber: 1,
        stableKey: `q-${level.id}`,
        type: "single_choice",
        options: [{ code: "a" }, { code: "b" }] as never,
        correctAnswer: { code: "a" } as never,
      },
    });
    return { level, version, question };
  }

  /** Walk an aggregate to `approved` through the accepted lifecycle. */
  async function approve(kind: "content" | "assessment", id: number) {
    const start = await lifecycle.readAggregate(kind, id);
    const next = await lifecycle.bumpAggregate(prisma as never, {
      kind,
      id,
      expectedRevision: start.revision,
      actorId: adminA.id,
    });
    await lifecycle.submitForReview({ kind, id, expectedRevision: next, actorId: adminB.id });
    await lifecycle.approveVersion({
      kind,
      id,
      expectedRevision: next,
      actorId: approverC.id,
      validationPassed: true,
    });
    return next;
  }

  try {
    /* =============================================== 1-3 approved immutability */

    await check("1 an APPROVED ContentVersion refuses a legacy localization rewrite", async () => {
      const { version, localization } = await makeContent();
      const revision = await approve("content", version.id);
      const before = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });

      await refusedWith(
        () =>
          content.updateContentLocalization({
            actorId: adminA.id,
            contentLocalizationId: localization.id,
            expectedRevision: revision,
            patch: { title: "ПОДМЕНЕНО ПОСЛЕ ОДОБРЕНИЯ" },
          }),
        "AUTHORING_APPROVED_IMMUTABLE",
      );

      const after = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });
      assert.deepEqual(after, before, "not one byte of the approved lesson may change");
      const aggregate = await lifecycle.readAggregate("content", version.id);
      assert.equal(aggregate.revision, revision, "a refused write moves no revision");
      assert.equal(aggregate.editorialState, "approved");
    });

    await check("2 an APPROVED ContentVersion refuses a legacy BODY rewrite", async () => {
      const { version, localization } = await makeContent();
      const revision = await approve("content", version.id);
      await refusedWith(
        () =>
          content.updateContentLocalization({
            actorId: adminA.id,
            contentLocalizationId: localization.id,
            expectedRevision: revision,
            patch: { body: lessonBody("post-approval-swap") as never },
          }),
        "AUTHORING_APPROVED_IMMUTABLE",
      );
      const after = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });
      assert.ok(
        !JSON.stringify(after!.body).includes("post-approval-swap"),
        "the learner body of an approved lesson must be unchanged",
      );
    });

    await check("3 an APPROVED ContentVersion refuses a legacy asset attach", async () => {
      const { version } = await makeContent();
      const revision = await approve("content", version.id);
      await refusedWith(
        () =>
          content.createContentAsset({
            actorId: adminA.id,
            contentVersionId: version.id,
            expectedRevision: revision,
            kind: "video",
            assetCode: "smuggled-video",
            locale: "ru",
            url: "https://cdn.example.com/smuggled.mp4",
            mimeType: "video/mp4",
            sizeBytes: 1024,
            durationSeconds: 60,
            checksum: null,
            sortOrder: 1,
          }),
        "AUTHORING_APPROVED_IMMUTABLE",
      );
      assert.equal(
        await prisma.contentAsset.count({ where: { contentVersionId: version.id } }),
        0,
        "no asset may be attached to an approved version",
      );
    });

    /* ============================================ 4 submitted immutability */

    await check("4 a SUBMITTED ContentVersion refuses an edit beneath its reviewer", async () => {
      const { version, localization } = await makeContent();
      const start = await lifecycle.readAggregate("content", version.id);
      const next = await lifecycle.bumpAggregate(prisma as never, {
        kind: "content",
        id: version.id,
        expectedRevision: start.revision,
        actorId: adminA.id,
      });
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: next,
        actorId: adminB.id,
      });

      await refusedWith(
        () =>
          content.updateContentLocalization({
            actorId: adminA.id,
            contentLocalizationId: localization.id,
            expectedRevision: next,
            patch: { title: "ИЗМЕНЕНО ВО ВРЕМЯ РЕВЬЮ" },
          }),
        "AUTHORING_SUBMITTED_IMMUTABLE",
      );
      const after = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });
      assert.equal(after!.title, "Исходный заголовок");
    });

    /* ========================================== 5 approved answer-key change */

    await check("5 an APPROVED AssessmentVersion refuses an answer-key change", async () => {
      const { version, question } = await makeAssessment();
      const revision = await approve("assessment", version.id);

      await refusedWith(
        () =>
          assessment.updateAssessmentQuestion({
            actorId: adminA.id,
            questionDefinitionId: question.id,
            expectedRevision: revision,
            patch: { correctAnswer: { code: "b" } },
          }),
        "AUTHORING_APPROVED_IMMUTABLE",
      );
      const after = await prisma.questionDefinition.findUnique({ where: { id: question.id } });
      assert.deepEqual(after!.correctAnswer, { code: "a" }, "the approved answer key is unchanged");

      await refusedWith(
        () =>
          assessment.createAssessmentQuestion({
            actorId: adminA.id,
            assessmentVersionId: version.id,
            expectedRevision: revision,
            questionNumber: 2,
            stableKey: "smuggled",
            type: "single_choice",
            skillTag: null,
            options: [{ code: "a" }, { code: "b" }],
            correctAnswer: { code: "a" },
          }),
        "AUTHORING_APPROVED_IMMUTABLE",
      );
      assert.equal(await prisma.questionDefinition.count({ where: { assessmentVersionId: version.id } }), 1);
    });

    /* ================================================ 6 missing revision */

    await check("6 a mutation with NO expectedRevision is refused by the schema", async () => {
      const { localization } = await makeContent();
      await refusedWith(
        () =>
          content.updateContentLocalization({
            actorId: adminA.id,
            contentLocalizationId: localization.id,
            patch: { title: "БЕЗ РЕВИЗИИ" },
          } as never),
        "CONTENT_INPUT_INVALID",
      );
      const after = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });
      assert.equal(after!.title, "Исходный заголовок", "a revisionless write changes nothing");
    });

    await check("6b a non-integer or out-of-range expectedRevision is refused", async () => {
      const { localization } = await makeContent();
      for (const bad of [0, -1, 1.5, 2_147_483_647, Number.NaN]) {
        await refusedWith(
          () =>
            content.updateContentLocalization({
              actorId: adminA.id,
              contentLocalizationId: localization.id,
              expectedRevision: bad,
              patch: { title: `плохо ${bad}` },
            } as never),
          "CONTENT_INPUT_INVALID",
        );
      }
    });

    /* ================================================== 7 stale revision */

    await check("7 a STALE expectedRevision is a structured conflict, and writes nothing", async () => {
      const { version, localization } = await makeContent();
      const start = await lifecycle.readAggregate("content", version.id);

      await content.updateContentLocalization({
        actorId: adminB.id,
        contentLocalizationId: localization.id,
        expectedRevision: start.revision,
        patch: { title: "ПОБЕДИТЕЛЬ" },
      });

      const conflict = (await refusedWith(
        () =>
          content.updateContentLocalization({
            actorId: adminA.id,
            contentLocalizationId: localization.id,
            expectedRevision: start.revision,
            patch: { title: "ПРОИГРАВШИЙ" },
          }),
        "AUTHORING_REVISION_CONFLICT",
      )) as { actualRevision: number | null };

      assert.equal(conflict.actualRevision, start.revision + 1, "the conflict names the winning revision");
      const after = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });
      assert.equal(after!.title, "ПОБЕДИТЕЛЬ", "the winner's write survives, the loser's does not");
      const aggregate = await lifecycle.readAggregate("content", version.id);
      assert.equal(aggregate.revision, start.revision + 1, "the losing write moved nothing");
    });

    /* ============================================ 8-9 the happy path works */

    await check("8 a DRAFT mutation succeeds and INCREMENTS the aggregate revision", async () => {
      const { version, localization } = await makeContent();
      const start = await lifecycle.readAggregate("content", version.id);
      assert.equal(start.revision, 1);

      await content.updateContentLocalization({
        actorId: adminA.id,
        contentLocalizationId: localization.id,
        expectedRevision: 1,
        patch: { title: "Отредактировано" },
      });
      assert.equal((await lifecycle.readAggregate("content", version.id)).revision, 2);

      await content.updateContentLocalization({
        actorId: adminA.id,
        contentLocalizationId: localization.id,
        expectedRevision: 2,
        patch: { title: "Отредактировано снова" },
      });
      assert.equal((await lifecycle.readAggregate("content", version.id)).revision, 3);

      const after = await prisma.contentLocalization.findUnique({ where: { id: localization.id } });
      assert.equal(after!.title, "Отредактировано снова");
    });

    await check("9 the SERVER actor is recorded as lastAuthoredById, not the caller's claim", async () => {
      const { version, localization } = await makeContent();
      await content.updateContentLocalization({
        actorId: adminA.id,
        contentLocalizationId: localization.id,
        expectedRevision: 1,
        patch: { title: "Написано A" },
      });
      const row = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(row!.lastAuthoredById, adminA.id, "the legacy path now establishes author evidence");
      assert.ok(row!.lastAuthoredAt, "and the time it was established");

      // A different actor authoring next takes over the attribution.
      await content.updateContentLocalization({
        actorId: adminB.id,
        contentLocalizationId: localization.id,
        expectedRevision: 2,
        patch: { title: "Написано B" },
      });
      const row2 = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(row2!.lastAuthoredById, adminB.id, "the LATEST substantive author is the one recorded");
    });

    /* ============================================ 10 four-eyes over legacy */

    await check("10 FOUR-EYES survives the legacy path: the legacy author cannot approve", async () => {
      const { version, localization } = await makeContent();

      // A authors THROUGH THE LEGACY ROUTE — the exact step that used to leave
      // no author evidence at all.
      await content.updateContentLocalization({
        actorId: adminA.id,
        contentLocalizationId: localization.id,
        expectedRevision: 1,
        patch: { title: "НАПИСАНО АДМИНОМ A" },
      });
      const authored = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(authored!.lastAuthoredById, adminA.id);

      // B submits.
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 2,
        actorId: adminB.id,
      });

      // A — a full UserRole=admin — may NOT approve their own text.
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "content",
            id: version.id,
            expectedRevision: 2,
            actorId: adminA.id,
            validationPassed: true,
          }),
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
      );
      // Nor may B, who vouched for it.
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "content",
            id: version.id,
            expectedRevision: 2,
            actorId: adminB.id,
            validationPassed: true,
          }),
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
      );

      // An independent third actor can.
      const result = await lifecycle.approveVersion({
        kind: "content",
        id: version.id,
        expectedRevision: 2,
        actorId: approverC.id,
        validationPassed: true,
      });
      assert.equal(result.editorialState, "approved");
    });

    await check("10b the same holds for an assessment authored through the legacy path", async () => {
      const { version, question } = await makeAssessment();
      await assessment.updateAssessmentQuestion({
        actorId: adminA.id,
        questionDefinitionId: question.id,
        expectedRevision: 1,
        patch: { correctAnswer: { code: "b" } },
      });
      const row = await prisma.assessmentVersion.findUnique({ where: { id: version.id } });
      assert.equal(row!.lastAuthoredById, adminA.id);
      assert.equal(row!.revision, 2, "an answer-key change is substantive and bumps the bank");

      await lifecycle.submitForReview({
        kind: "assessment",
        id: version.id,
        expectedRevision: 2,
        actorId: adminB.id,
      });
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "assessment",
            id: version.id,
            expectedRevision: 2,
            actorId: adminA.id,
            validationPassed: true,
          }),
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
      );
    });

    /* =========================================== 11 refusal observability */

    await check("11 a self-approval refusal leaves a bounded audit record and no draft content", async () => {
      const { version, localization } = await makeContent();
      await content.updateContentLocalization({
        actorId: adminA.id,
        contentLocalizationId: localization.id,
        expectedRevision: 1,
        patch: { title: "СЕКРЕТНЫЙ ЧЕРНОВИК" },
      });
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 2,
        actorId: adminB.id,
      });

      const before = await prisma.auditLog.count({
        where: { action: constants.CURRICULUM_AUDIT_ACTIONS.authoringSelfApprovalRefused },
      });
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "content",
            id: version.id,
            expectedRevision: 2,
            actorId: adminA.id,
            validationPassed: true,
          }),
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
      );
      const rows = await prisma.auditLog.findMany({
        where: {
          action: constants.CURRICULUM_AUDIT_ACTIONS.authoringSelfApprovalRefused,
          entityId: String(version.id),
        },
      });
      assert.equal(rows.length, before === 0 ? 1 : rows.length, "the refusal is recorded");
      assert.ok(rows.length >= 1);
      const record = rows[rows.length - 1];
      assert.equal(record.userId, adminA.id, "actor");
      assert.equal(record.entityType, "ContentVersion", "target");
      assert.ok(record.createdAt, "time");
      const metadata = record.metadata as Record<string, unknown>;
      assert.equal(metadata.reason, "AUTHORING_SELF_APPROVAL_FORBIDDEN");
      assert.equal(metadata.authoredBy, adminA.id);
      assert.ok(
        !JSON.stringify(metadata).includes("СЕКРЕТНЫЙ"),
        "a refusal record must carry identities, never draft content",
      );

      // The refusal itself is still final: the version did NOT become approved.
      const row = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(row!.editorialState, "submitted_for_review");
      assert.equal(row!.approvedById, null);
    });

    /* ================================================ 12 the whole surface */

    await check("12 EVERY substantive legacy writer refuses an approved aggregate", async () => {
      const refusals: string[] = [];

      const c = await makeContent();
      const cRevision = await approve("content", c.version.id);
      const asset = await prisma.contentAsset.create({
        data: {
          contentVersionId: c.version.id,
          kind: "image",
          assetCode: "existing",
          locale: "ru",
          url: "https://cdn.example.com/a.png",
          mimeType: "image/png",
          sizeBytes: 10,
          durationSeconds: null,
          checksum: null,
          sortOrder: 0,
        },
      });

      const contentCases: Array<[string, () => Promise<unknown>]> = [
        ["updateContentVersion", () => content.updateContentVersion({ actorId: adminA.id, contentVersionId: c.version.id, expectedRevision: cRevision, patch: { changeNotes: "x" } })],
        ["deleteContentVersion", () => content.deleteContentVersion({ actorId: adminA.id, contentVersionId: c.version.id, expectedRevision: cRevision })],
        ["createContentLocalization", () => content.createContentLocalization({ actorId: adminA.id, contentVersionId: c.version.id, expectedRevision: cRevision, locale: "en", title: "T", subtitle: "", learningObjectiveExtension: "", summary: "", transcript: null, body: lessonBody("x") as never })],
        ["updateContentLocalization", () => content.updateContentLocalization({ actorId: adminA.id, contentLocalizationId: c.localization.id, expectedRevision: cRevision, patch: { title: "x" } })],
        ["deleteContentLocalization", () => content.deleteContentLocalization({ actorId: adminA.id, contentLocalizationId: c.localization.id, expectedRevision: cRevision })],
        ["createContentAsset", () => content.createContentAsset({ actorId: adminA.id, contentVersionId: c.version.id, expectedRevision: cRevision, kind: "image", assetCode: "new", locale: "ru", url: "https://cdn.example.com/b.png", mimeType: "image/png", sizeBytes: 10, durationSeconds: null, checksum: null, sortOrder: 1 })],
        ["updateContentAsset", () => content.updateContentAsset({ actorId: adminA.id, contentAssetId: asset.id, expectedRevision: cRevision, patch: { sortOrder: 5 } })],
        ["deleteContentAsset", () => content.deleteContentAsset({ actorId: adminA.id, contentAssetId: asset.id, expectedRevision: cRevision })],
      ];

      const a = await makeAssessment();
      const aRevision = await approve("assessment", a.version.id);
      const qloc = await prisma.questionLocalization.create({
        data: {
          questionId: a.question.id,
          locale: "ru",
          prompt: "Существующий вопрос",
          optionLabels: { a: "А", b: "Б" } as never,
          explanation: null,
        },
      });

      const assessmentCases: Array<[string, () => Promise<unknown>]> = [
        ["updateAssessmentVersion", () => assessment.updateAssessmentVersion({ actorId: adminA.id, assessmentVersionId: a.version.id, expectedRevision: aRevision, patch: { passPercent: 80 } })],
        ["deleteAssessmentVersion", () => assessment.deleteAssessmentVersion({ actorId: adminA.id, assessmentVersionId: a.version.id, expectedRevision: aRevision })],
        ["createAssessmentQuestion", () => assessment.createAssessmentQuestion({ actorId: adminA.id, assessmentVersionId: a.version.id, expectedRevision: aRevision, questionNumber: 9, stableKey: "new-q", type: "single_choice", skillTag: null, options: [{ code: "a" }, { code: "b" }], correctAnswer: { code: "a" } })],
        ["updateAssessmentQuestion", () => assessment.updateAssessmentQuestion({ actorId: adminA.id, questionDefinitionId: a.question.id, expectedRevision: aRevision, patch: { stableKey: "renamed" } })],
        ["deleteAssessmentQuestion", () => assessment.deleteAssessmentQuestion({ actorId: adminA.id, questionDefinitionId: a.question.id, expectedRevision: aRevision })],
        ["createQuestionLocalization", () => assessment.createQuestionLocalization({ actorId: adminA.id, questionDefinitionId: a.question.id, expectedRevision: aRevision, locale: "en", prompt: "Q", optionLabels: { a: "A", b: "B" }, explanation: null })],
        ["updateQuestionLocalization", () => assessment.updateQuestionLocalization({ actorId: adminA.id, questionLocalizationId: qloc.id, expectedRevision: aRevision, patch: { prompt: "Изменено" } })],
        ["deleteQuestionLocalization", () => assessment.deleteQuestionLocalization({ actorId: adminA.id, questionLocalizationId: qloc.id, expectedRevision: aRevision })],
      ];

      for (const [name, run] of [...contentCases, ...assessmentCases]) {
        await refusedWith(run, "AUTHORING_APPROVED_IMMUTABLE");
        refusals.push(name);
      }

      assert.equal(refusals.length, 16, `expected 16 guarded writers, refused ${refusals.length}`);
      console.log(`     refused on an approved aggregate: ${refusals.join(", ")}`);

      // And nothing actually changed.
      assert.equal(await prisma.contentLocalization.count({ where: { contentVersionId: c.version.id } }), 1);
      assert.equal(await prisma.contentAsset.count({ where: { contentVersionId: c.version.id } }), 1);
      assert.equal(await prisma.questionDefinition.count({ where: { assessmentVersionId: a.version.id } }), 1);
      assert.equal(await prisma.questionLocalization.count({ where: { questionId: a.question.id } }), 1);
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  console.log(`\nPHASE-G0 CORRECTION authoring mutation boundary: ${passed} passed, ${failed} failed`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
