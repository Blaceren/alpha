/**
 * PHASE-G0 PUBLISH GATE — editorial approval is required to ENTER `published`.
 *
 * THE DECISION THIS ENCODES. Runtime publication and editorial approval remain
 * two independent lifecycles, and the dependency between them is deliberately
 * one-way and asymmetric:
 *
 *   • approval does NOT publish — approving decides that content is correct,
 *     not that learners should receive it, and those are different decisions
 *     often made by different people;
 *   • publication now REQUIRES approval — a lesson nobody reviewed must not be
 *     the thing a learner reads, and a bank nobody reviewed must not be the
 *     thing a learner is graded against.
 *
 * IT GUARDS THE TRANSITION, NOT THE HISTORY. Every row that predates the G0
 * migration is `published` with `editorialState = draft`. That combination stays
 * legal, readable and untouched: asserting the rule over stored rows rather than
 * over the transition would have meant unpublishing live lessons or backfilling
 * approvals nobody granted.
 *
 * DISPOSABLE DATABASE ONLY.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-publish-gate-${process.pid}.db`);
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

async function refusedWith(fn: () => Promise<unknown>, code: string): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual}: ${String(error)}`);
    return error;
  }
  return assert.fail(`expected a refusal with ${code}, but the publish SUCCEEDED`);
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
  process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_ASSESSMENT_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const content = await import("../../src/lib/curriculum/content");
  const assessment = await import("../../src/lib/curriculum/assessment");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");

  /* ------------------------------------------------------------------ seed */
  const authorA = await prisma.user.create({
    data: { email: "pg-author@example.com", name: "Author A", role: "admin" },
  });
  const submitterB = await prisma.user.create({
    data: { email: "pg-submitter@example.com", name: "Submitter B", role: "admin" },
  });
  const approverC = await prisma.user.create({
    data: { email: "pg-approver@example.com", name: "Approver C", role: "admin" },
  });
  const publisherD = await prisma.user.create({
    data: { email: "pg-publisher@example.com", name: "Publisher D", role: "admin" },
  });

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "PGATE-100", name: "Publish Gate", status: "draft", versionNumber: 1 },
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
        stableCode: `pgate-l${levelSeq}`,
        type: "lesson",
        title: `Level ${levelSeq}`,
        completionMethod: "content",
      },
    });
  };

  /** A publishable-in-every-other-respect draft ContentVersion. */
  async function makeContent() {
    const level = await makeLevel();
    const version = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        createdById: authorA.id,
      },
    });
    await prisma.contentLocalization.create({
      data: {
        contentVersionId: version.id,
        locale: "ru",
        title: "Дисциплина и план",
        subtitle: "",
        learningObjectiveExtension: "",
        summary: "",
        transcript: null,
        body: lessonBody("seed") as never,
      },
    });
    return { level, version };
  }

  /** A publishable-in-every-other-respect draft AssessmentVersion. */
  async function makeAssessment() {
    const level = await makeLevel();
    const version = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        passPercent: 70,
        createdById: authorA.id,
      },
    });
    for (let n = 1; n <= 4; n += 1) {
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: version.id,
          questionNumber: n,
          stableKey: `pg-q${level.id}-${n}`,
          type: "single_choice",
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }] as never,
          correctAnswer: { code: "a" } as never,
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id,
          locale: "ru",
          prompt: `Вопрос номер ${n} про управление риском`,
          optionLabels: { a: "Верно", b: "Неверно", c: "Почти", d: "Нет" } as never,
          explanation: null,
        },
      });
    }
    return { level, version };
  }

  /** Drive an aggregate to a named editorial state through the accepted lifecycle. */
  async function driveTo(
    kind: "content" | "assessment",
    id: number,
    target: "draft" | "submitted_for_review" | "changes_requested" | "approved",
  ) {
    if (target === "draft") return;
    const start = await lifecycle.readAggregate(kind, id);
    const revision = await lifecycle.bumpAggregate(prisma as never, {
      kind,
      id,
      expectedRevision: start.revision,
      actorId: authorA.id,
    });
    await lifecycle.submitForReview({ kind, id, expectedRevision: revision, actorId: submitterB.id });
    if (target === "submitted_for_review") return;
    if (target === "changes_requested") {
      await lifecycle.requestChanges({ kind, id, expectedRevision: revision, actorId: approverC.id });
      return;
    }
    await lifecycle.approveVersion({
      kind,
      id,
      expectedRevision: revision,
      actorId: approverC.id,
      validationPassed: true,
    });
  }

  try {
    /* ============================================== 1 CONTENT PUBLISH GATE */

    for (const state of ["draft", "submitted_for_review", "changes_requested"] as const) {
      await check(`1 CONTENT ${state} -> publish REFUSED`, async () => {
        const { version } = await makeContent();
        await driveTo("content", version.id, state);
        const before = await prisma.contentVersion.findUnique({ where: { id: version.id } });
        assert.equal(before!.editorialState, state);
        assert.equal(before!.status, "draft");

        await refusedWith(
          () => content.publishContentVersion({ actorId: publisherD.id, contentVersionId: version.id }),
          "AUTHORING_APPROVAL_REQUIRED",
        );

        const after = await prisma.contentVersion.findUnique({ where: { id: version.id } });
        assert.equal(after!.status, "draft", "a refused publish activates nothing");
        assert.equal(after!.publishedAt, null);
        assert.equal(after!.editorialState, state, "and fabricates no approval");
        assert.equal(after!.approvedById, null);
      });
    }

    await check("1 CONTENT approved -> publish SUCCEEDS under all existing rules", async () => {
      const { version } = await makeContent();
      await driveTo("content", version.id, "approved");
      const result = await content.publishContentVersion({
        actorId: publisherD.id,
        contentVersionId: version.id,
      });
      assert.equal(result.published.status, "published");
      assert.ok(result.published.publishedAt, "publishedAt is set by the server");
      const after = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(after!.editorialState, "approved", "publishing does not move the editorial axis");
      assert.equal(after!.approvedById, approverC.id, "the approver is still the approver");
    });

    await check("1 CONTENT the gate cannot be satisfied from the wire", async () => {
      const { version } = await makeContent();
      // The publish command is a strictObject with no editorial field at all, so
      // an attempt to hand the server an approval is a schema rejection rather
      // than a bypass.
      for (const smuggled of [
        { editorialState: "approved" },
        { approvedById: approverC.id },
        { approvedAt: new Date() },
        { lastAuthoredById: approverC.id },
      ]) {
        await refusedWith(
          () =>
            content.publishContentVersion({
              actorId: publisherD.id,
              contentVersionId: version.id,
              ...smuggled,
            } as never),
          "CONTENT_INPUT_INVALID",
        );
      }
      const after = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(after!.status, "draft");
      assert.equal(after!.editorialState, "draft");
    });

    /* ============================================ 2 ASSESSMENT PUBLISH GATE */

    for (const state of ["draft", "submitted_for_review", "changes_requested"] as const) {
      await check(`2 ASSESSMENT ${state} -> publish REFUSED`, async () => {
        const { version } = await makeAssessment();
        await driveTo("assessment", version.id, state);
        await refusedWith(
          () =>
            assessment.publishAssessmentVersion({
              actorId: publisherD.id,
              assessmentVersionId: version.id,
            }),
          "AUTHORING_APPROVAL_REQUIRED",
        );
        const after = await prisma.assessmentVersion.findUnique({ where: { id: version.id } });
        assert.equal(after!.status, "draft");
        assert.equal(after!.publishedAt, null);
        assert.equal(after!.editorialState, state);
        assert.equal(after!.approvedById, null);
      });
    }

    await check("2 ASSESSMENT approved -> publish SUCCEEDS under all existing rules", async () => {
      const { version } = await makeAssessment();
      await driveTo("assessment", version.id, "approved");
      const result = await assessment.publishAssessmentVersion({
        actorId: publisherD.id,
        assessmentVersionId: version.id,
      });
      assert.equal(result.published.status, "published");
      const after = await prisma.assessmentVersion.findUnique({ where: { id: version.id } });
      assert.equal(after!.editorialState, "approved");
      assert.equal(after!.approvedById, approverC.id);
    });

    await check("2 ASSESSMENT the gate cannot be satisfied from the wire", async () => {
      const { version } = await makeAssessment();
      await refusedWith(
        () =>
          assessment.publishAssessmentVersion({
            actorId: publisherD.id,
            assessmentVersionId: version.id,
            editorialState: "approved",
          } as never),
        "ASSESSMENT_INPUT_INVALID",
      );
      const after = await prisma.assessmentVersion.findUnique({ where: { id: version.id } });
      assert.equal(after!.status, "draft");
    });

    await check("2 ASSESSMENT existing publish validation is NOT weakened", async () => {
      // An approved bank that fails the accepted publication validation must
      // still be refused on THAT rule — the gate is an addition, not a swap.
      const level = await makeLevel();
      const empty = await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: curriculum.id,
          versionNumber: 1,
          status: "draft",
          passPercent: 70,
          createdById: authorA.id,
        },
      });
      await driveTo("assessment", empty.id, "approved");
      const error = (await refusedWith(
        () =>
          assessment.publishAssessmentVersion({
            actorId: publisherD.id,
            assessmentVersionId: empty.id,
          }),
        "ASSESSMENT_PUBLICATION_INVALID",
      )) as { issues?: unknown[] };
      assert.ok((error.issues ?? []).length > 0, "the accepted validation still reports its issues");
    });

    /* ================================ 3 APPROVAL REMAINS NON-PUBLISHING */

    await check("3 CONTENT approval does NOT publish, bind, or activate anything", async () => {
      const { level, version } = await makeContent();
      const bindingsBefore = await prisma.levelResourceBinding.count();
      await driveTo("content", version.id, "approved");
      const after = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(after!.editorialState, "approved");
      assert.equal(after!.status, "draft", "runtime status untouched by approval");
      assert.equal(after!.publishedAt, null);
      assert.equal(after!.archivedAt, null);
      assert.equal(await prisma.levelResourceBinding.count(), bindingsBefore, "no binding created");
      assert.equal(
        await prisma.levelResourceBinding.count({ where: { levelDefinitionId: level.id } }),
        0,
        "the level is not bound to it",
      );
      assert.equal(await prisma.userLessonProgress.count(), 0, "no learner runtime activation");
    });

    await check("3 ASSESSMENT approval does NOT publish or bind", async () => {
      const { level, version } = await makeAssessment();
      await driveTo("assessment", version.id, "approved");
      const after = await prisma.assessmentVersion.findUnique({ where: { id: version.id } });
      assert.equal(after!.editorialState, "approved");
      assert.equal(after!.status, "draft");
      assert.equal(after!.publishedAt, null);
      assert.equal(
        await prisma.levelResourceBinding.count({ where: { levelDefinitionId: level.id } }),
        0,
      );
    });

    /* ================================== 4 HISTORICAL COMPATIBILITY */

    await check("4 a historical published-but-unapproved row is untouched and readable", async () => {
      // Exactly what the G0 migration produces for every pre-existing row.
      const level = await makeLevel();
      const historical = await prisma.contentVersion.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: curriculum.id,
          versionNumber: 1,
          status: "published",
          publishedAt: new Date("2026-01-01T00:00:00Z"),
          editorialState: "draft",
          createdById: authorA.id,
        },
      });
      await prisma.contentLocalization.create({
        data: {
          contentVersionId: historical.id,
          locale: "ru",
          title: "Исторический урок",
          body: lessonBody("historical") as never,
        },
      });
      const snapshot = await prisma.contentVersion.findUnique({ where: { id: historical.id } });

      // It still reads, and it still says exactly what it said.
      assert.equal(snapshot!.status, "published");
      assert.equal(snapshot!.editorialState, "draft");
      assert.equal(snapshot!.approvedById, null, "no approval was fabricated for it");
      assert.equal(snapshot!.approvedAt, null);

      const readable = await prisma.contentVersion.findMany({
        where: { levelDefinitionId: level.id, status: "published" },
        include: { localizations: true },
      });
      assert.equal(readable.length, 1);
      assert.equal(readable[0].localizations[0].title, "Исторический урок");

      // Archive — a runtime REMOVAL, not an activation — remains available, so
      // the estate stays operable without anyone having to invent an approval.
      const archived = await content.archiveContentVersion({
        actorId: publisherD.id,
        contentVersionId: historical.id,
      });
      assert.equal(archived.status, "archived");
      assert.equal(archived.editorialState, "draft", "archiving fabricates no approval either");

      const after = await prisma.contentVersion.findUnique({ where: { id: historical.id } });
      assert.equal(after!.editorialState, "draft");
      assert.equal(after!.approvedById, null);
    });

    await check("4 the same holds for a historical published AssessmentVersion", async () => {
      const level = await makeLevel();
      const historical = await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: curriculum.id,
          versionNumber: 1,
          status: "published",
          publishedAt: new Date("2026-01-01T00:00:00Z"),
          editorialState: "draft",
          passPercent: 70,
          createdById: authorA.id,
        },
      });
      const row = await prisma.assessmentVersion.findUnique({ where: { id: historical.id } });
      assert.equal(row!.status, "published");
      assert.equal(row!.editorialState, "draft");
      assert.equal(row!.approvedById, null);
      const archived = await assessment.archiveAssessmentVersion({
        actorId: publisherD.id,
        assessmentVersionId: historical.id,
      });
      assert.equal(archived.status, "archived");
      assert.equal(archived.editorialState, "draft");
    });

    await check("4 the gate guards the TRANSITION, and asserts nothing about stored rows", async () => {
      // Published-and-unapproved rows exist in this database right now, and the
      // system is entirely happy. Nothing scans or "repairs" them.
      const legacy = await prisma.contentVersion.count({
        where: { status: { in: ["published", "archived"] }, editorialState: "draft" },
      });
      assert.ok(legacy > 0, "the fixture really does contain historical rows");
      const approvedRows = await prisma.contentVersion.count({ where: { approvedById: { not: null } } });
      const explicitlyApproved = await prisma.contentVersion.count({ where: { editorialState: "approved" } });
      assert.equal(approvedRows, explicitlyApproved, "approvals exist only where the lifecycle wrote them");
      console.log(`     ${legacy} historical published/archived-and-unapproved rows survive untouched`);
    });

    /* ================================== 5 LEGACY / DIRECT BYPASS */

    await check("5 a UserRole=admin publishing directly is refused just the same", async () => {
      const { version } = await makeContent();
      const admin = await prisma.user.findUnique({ where: { id: publisherD.id } });
      assert.equal(admin!.role, "admin", "the caller holds the strongest legacy authority");
      await refusedWith(
        () => content.publishContentVersion({ actorId: publisherD.id, contentVersionId: version.id }),
        "AUTHORING_APPROVAL_REQUIRED",
      );
    });

    await check("5 there is exactly ONE publication invariant, not a per-caller check", () => {
      const lifecycleSource = fs.readFileSync(
        path.join(ROOT, "src/lib/curriculum/authoring-lifecycle.ts"),
        "utf8",
      );
      assert.ok(
        lifecycleSource.includes("export function assertEditoriallyApproved"),
        "the invariant lives in the shared lifecycle module",
      );
      for (const file of ["src/lib/curriculum/content.ts", "src/lib/curriculum/assessment.ts"]) {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        const calls = (source.match(/assertEditoriallyApproved\(/g) ?? []).length;
        assert.equal(calls, 1, `${file} must call the shared invariant exactly once`);
      }
      // And nobody re-implements the rule locally.
      const offenders: string[] = [];
      for (const file of ["src/lib/curriculum/content.ts", "src/lib/curriculum/assessment.ts"]) {
        const source = fs.readFileSync(path.join(ROOT, file), "utf8");
        if (/editorialState\s*[!=]==\s*"approved"/.test(source)) offenders.push(file);
      }
      assert.deepEqual(offenders, [], "no local re-implementation of the approval rule");
    });

    /* ================================== 6 FOUR-EYES -> APPROVAL -> PUBLISH */

    await check("6 author cannot approve, so cannot make their own work publishable", async () => {
      const { version } = await makeContent();
      const start = await lifecycle.readAggregate("content", version.id);
      const revision = await lifecycle.bumpAggregate(prisma as never, {
        kind: "content",
        id: version.id,
        expectedRevision: start.revision,
        actorId: authorA.id,
      });
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: revision,
        actorId: submitterB.id,
      });

      // A authored it — A may not approve it.
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "content",
            id: version.id,
            expectedRevision: revision,
            actorId: authorA.id,
            validationPassed: true,
          }),
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
      );
      // B vouched for it — B may not either.
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "content",
            id: version.id,
            expectedRevision: revision,
            actorId: submitterB.id,
            validationPassed: true,
          }),
        "AUTHORING_SELF_APPROVAL_FORBIDDEN",
      );

      // And while it sits SUBMITTED, nobody can publish it — not even A, who
      // holds full admin publish authority. Four-eyes is therefore not merely an
      // editorial nicety: it now gates runtime activation too.
      for (const actor of [authorA, submitterB, publisherD]) {
        await refusedWith(
          () => content.publishContentVersion({ actorId: actor.id, contentVersionId: version.id }),
          "AUTHORING_APPROVAL_REQUIRED",
        );
      }

      // An INDEPENDENT actor approves...
      const approved = await lifecycle.approveVersion({
        kind: "content",
        id: version.id,
        expectedRevision: revision,
        actorId: approverC.id,
        validationPassed: true,
      });
      assert.equal(approved.editorialState, "approved");

      // ...and only now can publication proceed — performed by D, who is NOT
      // the approver. Approval authority and publication authority stay distinct.
      const result = await content.publishContentVersion({
        actorId: publisherD.id,
        contentVersionId: version.id,
      });
      assert.equal(result.published.status, "published");
      const final = await prisma.contentVersion.findUnique({ where: { id: version.id } });
      assert.equal(final!.approvedById, approverC.id, "approved by C");
      assert.notEqual(final!.approvedById, publisherD.id, "published by D — different actors, by design");
    });

    /* ================================== 7 CONTENT / ASSESSMENT PAIR SAFETY */

    await check("7 each resource satisfies its OWN gate — approval does not travel", async () => {
      const level = await makeLevel();
      const contentVersion = await prisma.contentVersion.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: curriculum.id,
          versionNumber: 1,
          status: "draft",
          createdById: authorA.id,
        },
      });
      await prisma.contentLocalization.create({
        data: {
          contentVersionId: contentVersion.id,
          locale: "ru",
          title: "Урок пары",
          body: lessonBody("pair") as never,
        },
      });
      const assessmentVersion = await prisma.assessmentVersion.create({
        data: {
          levelDefinitionId: level.id,
          curriculumVersionId: curriculum.id,
          versionNumber: 1,
          status: "draft",
          passPercent: 70,
          createdById: authorA.id,
        },
      });
      for (let n = 1; n <= 4; n += 1) {
        const question = await prisma.questionDefinition.create({
          data: {
            assessmentVersionId: assessmentVersion.id,
            questionNumber: n,
            stableKey: `pair-q${n}`,
            type: "single_choice",
            options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }] as never,
            correctAnswer: { code: "a" } as never,
          },
        });
        await prisma.questionLocalization.create({
          data: {
            questionId: question.id,
            locale: "ru",
            prompt: `Парный вопрос ${n} про риск`,
            optionLabels: { a: "Верно", b: "Неверно", c: "Почти", d: "Нет" } as never,
            explanation: null,
          },
        });
      }

      // Approve ONLY the content half.
      await driveTo("content", contentVersion.id, "approved");

      // The content publishes.
      const published = await content.publishContentVersion({
        actorId: publisherD.id,
        contentVersionId: contentVersion.id,
      });
      assert.equal(published.published.status, "published");

      // Its unapproved assessment counterpart does NOT come with it.
      await refusedWith(
        () =>
          assessment.publishAssessmentVersion({
            actorId: publisherD.id,
            assessmentVersionId: assessmentVersion.id,
          }),
        "AUTHORING_APPROVAL_REQUIRED",
      );
      const bank = await prisma.assessmentVersion.findUnique({ where: { id: assessmentVersion.id } });
      assert.equal(bank!.status, "draft", "an unapproved bank stays out of the runtime");
      assert.equal(bank!.editorialState, "draft");

      // And the mirror image: approving the bank does not retroactively license
      // an unapproved lesson elsewhere.
      await driveTo("assessment", assessmentVersion.id, "approved");
      await assessment.publishAssessmentVersion({
        actorId: publisherD.id,
        assessmentVersionId: assessmentVersion.id,
      });
      const other = await makeContent();
      await refusedWith(
        () =>
          content.publishContentVersion({
            actorId: publisherD.id,
            contentVersionId: other.version.id,
          }),
        "AUTHORING_APPROVAL_REQUIRED",
      );
      console.log("     content and assessment gate independently, in both directions");
    });

    await check("7 publication remains INDEPENDENT — no atomic pairing was invented", async () => {
      // The product allows a level to carry a published lesson and no published
      // bank. Nothing in this change couples them, and asserting otherwise would
      // have been a new product rule nobody asked for.
      const levels = await prisma.levelDefinition.findMany({
        include: { contentVersions: true, assessmentVersions: true },
      });
      const asymmetric = levels.filter(
        (level) =>
          level.contentVersions.some((v) => v.status === "published") &&
          !level.assessmentVersions.some((v) => v.status === "published"),
      );
      assert.ok(asymmetric.length > 0, "a published lesson without a published bank is still reachable");
    });
  } finally {
    await prisma.$disconnect();
    cleanupDb();
  }

  console.log(`\nPHASE-G0 publish gate: ${passed} passed, ${failed} failed`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
