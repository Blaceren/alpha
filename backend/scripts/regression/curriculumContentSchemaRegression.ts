import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-content-schema-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const migrationName = "20260715000000_content_assessment_foundation";
const migrationPath = path.join(process.cwd(), "prisma", "migrations", migrationName, "migration.sql");
const phase4Tables = [
  "ContentVersion", "ContentLocalization", "ContentAsset", "LevelResourceBinding",
  "AssessmentVersion", "QuestionDefinition", "QuestionLocalization",
  "AssessmentAttempt", "UserLessonProgress",
] as const;
const now = "2026-07-15T10:00:00.000Z";
const later = "2026-07-15T10:05:00.000Z";
const fingerprint = `sha256:${"a".repeat(64)}`;

let prisma: PrismaClient | null = null;
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
    console.error(error instanceof Error ? error.message : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function runMigrations() {
  return spawnSync("npx", ["tsx", path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
}

function isConstraintError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2002", "P2003", "P2010"].includes(error.code);
  }
  return error instanceof Error && /constraint|foreign key|not null|unique|check/i.test(error.message);
}

async function expectConstraint(fn: () => Promise<unknown>, label: string) {
  try { await fn(); } catch (error) {
    assert.equal(isConstraintError(error), true, `${label}: expected constraint error, got ${error}`);
    return;
  }
  assert.fail(`${label}: expected constraint violation`);
}

async function rawInsert(table: string, columns: string[], values: unknown[]) {
  assert.ok(prisma);
  const names = columns.map((name) => `"${name}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    `INSERT INTO "${table}" (${names}) VALUES (${placeholders}) RETURNING "id"`, ...values,
  );
  return Number(rows[0].id);
}

async function insertContent(input: {
  levelId: number; curriculumVersionId: number; versionNumber: number;
  status?: string; createdById?: number | null;
}) {
  const status = input.status ?? "draft";
  return rawInsert("ContentVersion", [
    "levelDefinitionId", "curriculumVersionId", "versionNumber", "status", "createdById",
    "updatedAt", "publishedAt", "archivedAt",
  ], [
    input.levelId, input.curriculumVersionId, input.versionNumber, status, input.createdById ?? null,
    now, status === "draft" ? null : now, status === "archived" ? later : null,
  ]);
}

async function insertAssessment(input: {
  levelId: number; curriculumVersionId: number; versionNumber: number;
  passPercent?: number; maxAttempts?: number | null; status?: string; createdById?: number | null;
}) {
  const status = input.status ?? "draft";
  return rawInsert("AssessmentVersion", [
    "levelDefinitionId", "curriculumVersionId", "versionNumber", "status", "passPercent",
    "maxAttempts", "showExplanation", "createdById", "updatedAt", "publishedAt", "archivedAt",
  ], [
    input.levelId, input.curriculumVersionId, input.versionNumber, status, input.passPercent ?? 80,
    input.maxAttempts ?? null, 0, input.createdById ?? null, now,
    status === "draft" ? null : now, status === "archived" ? later : null,
  ]);
}

async function insertAttempt(input: {
  userId: number; enrollmentId: number; curriculumVersionId: number; levelId: number;
  assessmentId: number; attemptNumber: number; startRequestId: string; status?: string;
  submittedAt?: string | null; totalQuestions?: number | null; correctCount?: number | null;
  scoreBasisPoints?: number | null;
}) {
  const status = input.status ?? "in_progress";
  const submitted = status !== "in_progress";
  return rawInsert("AssessmentAttempt", [
    "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId", "assessmentVersionId",
    "attemptNumber", "status", "startedAt", "submittedAt", "durationSeconds", "totalQuestions",
    "correctCount", "scoreBasisPoints", "submittedAnswers", "answersFingerprint", "startRequestId",
    "submitRequestId", "updatedAt",
  ], [
    input.userId, input.enrollmentId, input.curriculumVersionId, input.levelId, input.assessmentId,
    input.attemptNumber, status, now, submitted ? (input.submittedAt ?? later) : null,
    submitted ? 300 : null, submitted ? (input.totalQuestions ?? 7) : null,
    submitted ? (input.correctCount ?? 6) : null, submitted ? (input.scoreBasisPoints ?? 8571) : null,
    submitted ? JSON.stringify({ q1: { code: "a" } }) : null, submitted ? fingerprint : null,
    input.startRequestId, submitted ? `submit-${input.startRequestId}` : null, now,
  ]);
}

async function insertLesson(input: {
  userId: number; enrollmentId: number; curriculumVersionId: number; levelId: number;
  contentId: number; playback?: number; requestId?: string;
}) {
  return rawInsert("UserLessonProgress", [
    "userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId", "contentVersionId",
    "status", "startedAt", "lastProgressAt", "playbackPositionSeconds", "completedSections",
    "progressData", "lastRequestId", "updatedAt",
  ], [
    input.userId, input.enrollmentId, input.curriculumVersionId, input.levelId, input.contentId,
    "in_progress", now, later, input.playback ?? 0, JSON.stringify(["intro"]),
    JSON.stringify({ tab: "lesson" }), input.requestId ?? `lesson-${input.enrollmentId}-${input.contentId}`, now,
  ]);
}

async function main() {
  cleanupDb();
  const firstRunner = runMigrations();
  if (firstRunner.status !== 0) throw new Error(`${firstRunner.stdout}\n${firstRunner.stderr}`);
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    await check("1. complete migration chain applies", () => {
      assert.match(firstRunner.stdout, new RegExp(`Migration ${migrationName} applied`));
    });

    const tables = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )).map((row) => row.name);
    await check("2. all nine Phase 4 tables exist", () => {
      for (const table of phase4Tables) assert.equal(tables.includes(table), true, `missing ${table}`);
    });

    await check("3. approved enums and columns match schema", async () => {
      const contentColumns = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>(
        'PRAGMA table_info("ContentVersion")',
      )).map((column) => column.name);
      // The TWELVE Phase-4 columns, in their exact accepted order and
      // positions. PHASE-G0's authoring foundation is purely ADDITIVE, so what
      // this check must keep proving is that none of them moved, was renamed or
      // was dropped — a prefix comparison says that more precisely than an
      // equality that has to be rewritten for every future additive phase.
      const phase4ContentColumns = [
        "id", "levelDefinitionId", "curriculumVersionId", "versionNumber", "status",
        "videoDurationSeconds", "createdById", "createdAt", "updatedAt", "publishedAt",
        "archivedAt", "changeNotes",
      ];
      assert.deepEqual(contentColumns.slice(0, phase4ContentColumns.length), phase4ContentColumns);
      // PHASE-G0 — the editorial axis, appended after them. `status` above is
      // the RUNTIME axis and is deliberately untouched by any of these.
      assert.deepEqual(contentColumns.slice(phase4ContentColumns.length), [
        "revision", "editorialState", "lastAuthoredById", "lastAuthoredAt",
        "submittedById", "submittedAt", "changesRequestedById", "changesRequestedAt",
        "approvedById", "approvedAt",
      ]);
      const schema = fs.readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
      for (const value of ["single_choice", "multiple_choice", "true_false", "ordered_steps", "scenario_choice", "numeric", "chart_choice"]) {
        assert.match(schema, new RegExp(`\\b${value}\\b`));
      }
    });

    const migrationSql = fs.readFileSync(migrationPath, "utf8");
    await check("4. migration has zero ALTER DROP RENAME or data DML", () => {
      const withoutComments = migrationSql.replace(/^--.*$/gm, "");
      assert.doesNotMatch(
        withoutComments,
        /\b(?:ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX)|RENAME\s+TO)\b|^\s*(?:INSERT|UPDATE|DELETE)\b/im,
      );
      const statements = withoutComments.split(";").map((part) => part.trim()).filter(Boolean);
      assert.equal(statements.every((statement) => /^CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)\b/i.test(statement)), true);
    });

    const initialCounts = new Map<string, number>();
    for (const table of phase4Tables) {
      const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM "${table}"`);
      initialCounts.set(table, Number(rows[0].count));
    }
    const secondRunner = runMigrations();
    await check("5. custom migration runner is idempotent", async () => {
      assert.equal(secondRunner.status, 0, `${secondRunner.stdout}\n${secondRunner.stderr}`);
      assert.match(secondRunner.stdout, new RegExp(`Migration ${migrationName} already applied`));
      for (const table of phase4Tables) {
        const rows = await prisma!.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) count FROM "${table}"`);
        assert.equal(Number(rows[0].count), initialCounts.get(table));
      }
    });

    const userA = await prisma.user.create({ data: { email: "content-a@example.com", name: "Content A" } });
    const userB = await prisma.user.create({ data: { email: "content-b@example.com", name: "Content B" } });
    const actor = await prisma.user.create({ data: { email: "content-actor@example.com", name: "Actor", role: "admin" } });
    const versionA = await prisma.curriculumVersion.create({ data: { code: "content-a", name: "A", versionNumber: 1, status: "published", publishedAt: new Date(now) } });
    const versionB = await prisma.curriculumVersion.create({ data: { code: "content-b", name: "B", versionNumber: 1, status: "published", publishedAt: new Date(now) } });
    const moduleA = await prisma.moduleDefinition.create({ data: { curriculumVersionId: versionA.id, moduleNumber: 1, code: "m-a", title: "A", firstLevel: 1, lastLevel: 2 } });
    const moduleB = await prisma.moduleDefinition.create({ data: { curriculumVersionId: versionB.id, moduleNumber: 1, code: "m-b", title: "B", firstLevel: 1, lastLevel: 1 } });
    const levelA = await prisma.levelDefinition.create({ data: { curriculumVersionId: versionA.id, moduleId: moduleA.id, levelNumber: 1, stableCode: "v2.l001.content-a", type: "lesson", title: "A", completionMethod: "assessment_pass" } });
    const levelA2 = await prisma.levelDefinition.create({ data: { curriculumVersionId: versionA.id, moduleId: moduleA.id, levelNumber: 2, stableCode: "v2.l002.content-a", type: "lesson", title: "A2", completionMethod: "assessment_pass" } });
    const levelB = await prisma.levelDefinition.create({ data: { curriculumVersionId: versionB.id, moduleId: moduleB.id, levelNumber: 1, stableCode: "v2.l001.content-b", type: "lesson", title: "B", completionMethod: "assessment_pass" } });
    const enrollmentA = await prisma.userCurriculumEnrollment.create({ data: { userId: userA.id, curriculumVersionId: versionA.id, curriculumCode: versionA.code } });
    const enrollmentB = await prisma.userCurriculumEnrollment.create({ data: { userId: userB.id, curriculumVersionId: versionA.id, curriculumCode: versionA.code } });
    const progressA = await prisma.userLevelProgress.create({ data: { enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelDefinitionId: levelA.id } });
    const oldSnapshot = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: userA.id } }),
      version: await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionA.id } }),
      enrollment: await prisma.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollmentA.id } }),
      progress: await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progressA.id } }),
    };

    const contentA = await insertContent({ levelId: levelA.id, curriculumVersionId: versionA.id, versionNumber: 1, status: "published" });
    await check("6. valid ContentVersion is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ status: string }>>('SELECT status FROM "ContentVersion" WHERE id=?', contentA))[0];
      assert.equal(row.status, "published");
    });
    await check("7. duplicate content versionNumber is rejected", () => expectConstraint(
      () => insertContent({ levelId: levelA.id, curriculumVersionId: versionA.id, versionNumber: 1 }), "duplicate content version",
    ));
    await check("8. ContentVersion with cross-version level is rejected", () => expectConstraint(
      () => insertContent({ levelId: levelA.id, curriculumVersionId: versionB.id, versionNumber: 9 }), "cross-version content",
    ));
    await check("9. non-positive content version is rejected", () => expectConstraint(
      () => insertContent({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 0 }), "zero content version",
    ));
    const actorContent = await insertContent({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 2, createdById: actor.id });
    await check("10. content actor delete sets createdById to null", async () => {
      await prisma!.user.delete({ where: { id: actor.id } });
      const row = (await prisma!.$queryRawUnsafe<Array<{ createdById: number | null }>>('SELECT "createdById" FROM "ContentVersion" WHERE id=?', actorContent))[0];
      assert.equal(row.createdById, null);
    });
    await check("11. content owner delete is Restrict", () => expectConstraint(
      () => prisma!.levelDefinition.delete({ where: { id: levelA.id } }), "content owner delete",
    ));
    const localizationA = await rawInsert("ContentLocalization", ["contentVersionId", "locale", "title", "body", "updatedAt"], [contentA, "ru", "Урок", JSON.stringify({ sections: [] }), now]);
    await check("12. valid content localization is accepted", () => assert.equal(localizationA > 0, true));
    await check("13. duplicate content locale is rejected", () => expectConstraint(
      () => rawInsert("ContentLocalization", ["contentVersionId", "locale", "title", "body", "updatedAt"], [contentA, "ru", "Дубль", "{}", now]), "duplicate locale",
    ));
    await check("14. empty and malformed locale values are rejected", async () => {
      await expectConstraint(() => rawInsert("ContentLocalization", ["contentVersionId", "locale", "title", "body", "updatedAt"], [contentA, "", "Bad", "{}", now]), "empty locale");
      await expectConstraint(() => rawInsert("ContentLocalization", ["contentVersionId", "locale", "title", "body", "updatedAt"], [contentA, "ru!", "Bad", "{}", now]), "malformed locale");
    });
    await check("15. structured content JSON is stored as valid JSON", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ valid: number }>>('SELECT json_valid("body") valid FROM "ContentLocalization" WHERE id=?', localizationA))[0];
      assert.equal(Number(row.valid), 1);
    });
    const assetA = await rawInsert("ContentAsset", ["contentVersionId", "kind", "assetCode", "url", "mimeType", "sortOrder"], [contentA, "video", "main-video", "https://example.com/video.mp4", "video/mp4", 0]);
    await check("16. valid versioned content asset is accepted", () => assert.equal(assetA > 0, true));
    await check("17. asset for a foreign content identity is rejected", () => expectConstraint(
      () => rawInsert("ContentAsset", ["contentVersionId", "kind", "assetCode", "url", "mimeType", "sortOrder"], [999999, "image", "foreign", "https://example.com/x.png", "image/png", 0]), "foreign asset owner",
    ));
    await check("18. duplicate asset code and order are rejected", async () => {
      await expectConstraint(() => rawInsert("ContentAsset", ["contentVersionId", "kind", "assetCode", "url", "mimeType", "sortOrder"], [contentA, "image", "main-video", "https://example.com/x.png", "image/png", 1]), "duplicate asset code");
      await expectConstraint(() => rawInsert("ContentAsset", ["contentVersionId", "kind", "assetCode", "url", "mimeType", "sortOrder"], [contentA, "image", "other", "https://example.com/x.png", "image/png", 0]), "duplicate asset order");
    });

    const contentB = await insertContent({ levelId: levelB.id, curriculumVersionId: versionB.id, versionNumber: 1, status: "published" });
    const assessmentA = await insertAssessment({ levelId: levelA.id, curriculumVersionId: versionA.id, versionNumber: 1, status: "published" });
    const assessmentB = await insertAssessment({ levelId: levelB.id, curriculumVersionId: versionB.id, versionNumber: 1, status: "published" });
    const bindingA = await rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "contentVersionId", "assessmentVersionId", "updatedAt"], [levelA.id, versionA.id, contentA, assessmentA, now]);
    await check("19. valid exact content binding is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ contentVersionId: number }>>('SELECT "contentVersionId" FROM "LevelResourceBinding" WHERE id=?', bindingA))[0];
      assert.equal(row.contentVersionId, contentA);
    });
    await check("20. valid exact assessment binding is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ assessmentVersionId: number }>>('SELECT "assessmentVersionId" FROM "LevelResourceBinding" WHERE id=?', bindingA))[0];
      assert.equal(row.assessmentVersionId, assessmentA);
    });
    await check("21. empty draft binding is rejected by approved Phase 4A contract", () => expectConstraint(
      () => rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "updatedAt"], [levelA2.id, versionA.id, now]), "empty binding",
    ));
    await check("22. duplicate level binding is rejected", () => expectConstraint(
      () => rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "contentVersionId", "updatedAt"], [levelA.id, versionA.id, contentA, now]), "duplicate binding",
    ));
    await check("23. content from another level is rejected", () => expectConstraint(
      () => rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "contentVersionId", "updatedAt"], [levelA2.id, versionA.id, contentA, now]), "cross-level content binding",
    ));
    await check("24. content from another curriculum version is rejected", () => expectConstraint(
      () => rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "contentVersionId", "updatedAt"], [levelB.id, versionA.id, contentB, now]), "cross-version content binding",
    ));
    await check("25. assessment from another level is rejected", () => expectConstraint(
      () => rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "assessmentVersionId", "updatedAt"], [levelA2.id, versionA.id, assessmentA, now]), "cross-level assessment binding",
    ));
    await check("26. assessment from another curriculum version is rejected", () => expectConstraint(
      () => rawInsert("LevelResourceBinding", ["levelDefinitionId", "curriculumVersionId", "assessmentVersionId", "updatedAt"], [levelB.id, versionA.id, assessmentB, now]), "cross-version assessment binding",
    ));
    await check("27. pinned content deletion is Restrict", () => expectConstraint(
      () => prisma!.$executeRawUnsafe('DELETE FROM "ContentVersion" WHERE id=?', contentA), "pinned content delete",
    ));
    await check("28. pinned assessment deletion is Restrict", () => expectConstraint(
      () => prisma!.$executeRawUnsafe('DELETE FROM "AssessmentVersion" WHERE id=?', assessmentA), "pinned assessment delete",
    ));

    await check("29. valid AssessmentVersion is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ passPercent: number }>>('SELECT "passPercent" FROM "AssessmentVersion" WHERE id=?', assessmentA))[0];
      assert.equal(row.passPercent, 80);
    });
    const passOne = await insertAssessment({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 2, passPercent: 1 });
    const passHundred = await insertAssessment({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 3, passPercent: 100, maxAttempts: 2 });
    await check("30. passPercent boundaries 1 and 100 are accepted", () => assert.equal(passOne > 0 && passHundred > 0, true));
    await check("31. passPercent 0 and 101 are rejected", async () => {
      await expectConstraint(() => insertAssessment({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 4, passPercent: 0 }), "zero pass percent");
      await expectConstraint(() => insertAssessment({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 4, passPercent: 101 }), "high pass percent");
    });
    await check("32. nullable maxAttempts is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ maxAttempts: number | null }>>('SELECT "maxAttempts" FROM "AssessmentVersion" WHERE id=?', passOne))[0];
      assert.equal(row.maxAttempts, null);
    });
    await check("33. positive maxAttempts is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ maxAttempts: number | null }>>('SELECT "maxAttempts" FROM "AssessmentVersion" WHERE id=?', passHundred))[0];
      assert.equal(row.maxAttempts, 2);
    });
    await check("34. zero maxAttempts is rejected", () => expectConstraint(
      () => insertAssessment({ levelId: levelA2.id, curriculumVersionId: versionA.id, versionNumber: 4, maxAttempts: 0 }), "zero max attempts",
    ));
    await check("35. duplicate assessment version is rejected", () => expectConstraint(
      () => insertAssessment({ levelId: levelA.id, curriculumVersionId: versionA.id, versionNumber: 1 }), "duplicate assessment version",
    ));

    const questionTypes = ["single_choice", "multiple_choice", "true_false", "ordered_steps", "scenario_choice", "numeric", "chart_choice"];
    const questionIds: number[] = [];
    for (const [index, type] of questionTypes.entries()) {
      questionIds.push(await rawInsert("QuestionDefinition", ["assessmentVersionId", "questionNumber", "stableKey", "type", "options", "correctAnswer", "updatedAt"], [assessmentA, index + 1, `q-${index + 1}`, type, type === "numeric" ? null : JSON.stringify([{ code: "a" }, { code: "b" }]), JSON.stringify(type === "multiple_choice" ? { codes: ["a"] } : type === "numeric" ? { value: "1" } : { code: "a" }), now]));
    }
    await check("36. all seven approved question types are accepted", () => assert.equal(questionIds.length, 7));
    await check("37. duplicate stable question key is rejected", () => expectConstraint(
      () => rawInsert("QuestionDefinition", ["assessmentVersionId", "questionNumber", "stableKey", "type", "correctAnswer", "updatedAt"], [assessmentA, 8, "q-1", "single_choice", '{"code":"a"}', now]), "duplicate stable key",
    ));
    await check("38. duplicate question order is rejected", () => expectConstraint(
      () => rawInsert("QuestionDefinition", ["assessmentVersionId", "questionNumber", "stableKey", "type", "correctAnswer", "updatedAt"], [assessmentA, 1, "q-8", "single_choice", '{"code":"a"}', now]), "duplicate question order",
    ));
    await check("39. non-positive question order is rejected", () => expectConstraint(
      () => rawInsert("QuestionDefinition", ["assessmentVersionId", "questionNumber", "stableKey", "type", "correctAnswer", "updatedAt"], [assessmentA, 0, "q-zero", "single_choice", '{"code":"a"}', now]), "zero question order",
    ));
    await check("40. question for a foreign assessment identity is rejected", () => expectConstraint(
      () => rawInsert("QuestionDefinition", ["assessmentVersionId", "questionNumber", "stableKey", "type", "correctAnswer", "updatedAt"], [999999, 1, "q-foreign", "single_choice", '{"code":"a"}', now]), "foreign assessment question",
    ));
    const questionLocalization = await rawInsert("QuestionLocalization", ["questionId", "locale", "prompt", "optionLabels", "updatedAt"], [questionIds[0], "ru", "Вопрос?", JSON.stringify({ a: "A", b: "B" }), now]);
    await check("41. question localization is unique per locale", async () => {
      assert.equal(questionLocalization > 0, true);
      await expectConstraint(() => rawInsert("QuestionLocalization", ["questionId", "locale", "prompt", "updatedAt"], [questionIds[0], "ru", "Дубль", now]), "duplicate question locale");
    });
    await check("42. correctAnswer exists only on QuestionDefinition", async () => {
      const definition = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("QuestionDefinition")')).map((c) => c.name);
      const localization = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("QuestionLocalization")')).map((c) => c.name);
      assert.equal(definition.includes("correctAnswer"), true);
      assert.equal(localization.includes("correctAnswer"), false);
    });
    await check("43. localized labels are not grading authority", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ labels: string; answer: string }>>(`SELECT ql."optionLabels" labels, q."correctAnswer" answer FROM "QuestionLocalization" ql JOIN "QuestionDefinition" q ON q.id=ql."questionId" WHERE ql.id=?`, questionLocalization))[0];
      assert.notEqual(row.labels, row.answer);
    });

    const attemptA = await insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 1, startRequestId: "start-valid-0001" });
    await check("44. valid in_progress attempt is accepted", () => assert.equal(attemptA > 0, true));
    await check("45. duplicate attemptNumber is rejected", () => expectConstraint(
      () => insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 1, startRequestId: "start-duplicate-number" }), "duplicate attempt number",
    ));
    await check("46. at most one in_progress attempt is allowed", () => expectConstraint(
      () => insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 2, startRequestId: "start-second-active" }), "second active attempt",
    ));
    const failedAttempt = await insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 2, startRequestId: "start-history-failed", status: "failed", correctCount: 3, scoreBasisPoints: 4285 });
    const passedAttempt = await insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 3, startRequestId: "start-history-passed", status: "passed" });
    await check("47. multiple passed and failed history rows are allowed", () => assert.equal(failedAttempt > 0 && passedAttempt > 0, true));
    await check("48. cross-user enrollment attempt is rejected", () => expectConstraint(
      () => insertAttempt({ userId: userB.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 4, startRequestId: "start-cross-user" }), "cross-user attempt",
    ));
    await check("49. cross-version enrollment attempt is rejected", () => expectConstraint(
      () => insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionB.id, levelId: levelB.id, assessmentId: assessmentB, attemptNumber: 4, startRequestId: "start-cross-version" }), "cross-version attempt",
    ));
    await check("50. cross-level attempt is rejected", () => expectConstraint(
      () => insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA2.id, assessmentId: assessmentA, attemptNumber: 4, startRequestId: "start-cross-level" }), "cross-level attempt",
    ));
    await check("51. foreign AssessmentVersion is rejected", () => expectConstraint(
      () => insertAttempt({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentB, attemptNumber: 4, startRequestId: "start-foreign-assessment" }), "foreign assessment attempt",
    ));
    await check("52. foreign UserLevelProgress cannot be stored as a second authority", async () => {
      const columns = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("AssessmentAttempt")')).map((c) => c.name);
      assert.equal(columns.includes("userLevelProgressId"), false);
      const inferred = await prisma!.userLevelProgress.findUnique({ where: { enrollmentId_levelDefinitionId: { enrollmentId: enrollmentB.id, levelDefinitionId: levelA.id } } });
      assert.equal(inferred, null);
    });
    await check("53. submitted status and timestamp consistency is enforced", async () => {
      await expectConstraint(() => rawInsert("AssessmentAttempt", ["userId", "enrollmentId", "curriculumVersionId", "levelDefinitionId", "assessmentVersionId", "attemptNumber", "status", "startRequestId", "updatedAt"], [userA.id, enrollmentA.id, versionA.id, levelA.id, assessmentA, 4, "passed", "start-bad-submitted", now]), "submitted without result");
      await expectConstraint(() => insertAttempt({ userId: userB.id, enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 1, startRequestId: "start-time-order", status: "failed", submittedAt: "2026-07-15T09:00:00.000Z" }), "submitted before started");
    });
    await check("54. attempt score and count bounds are enforced", async () => {
      await expectConstraint(() => insertAttempt({ userId: userB.id, enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 1, startRequestId: "start-score-high", status: "failed", scoreBasisPoints: 10001 }), "score too high");
      await expectConstraint(() => insertAttempt({ userId: userB.id, enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelId: levelA.id, assessmentId: assessmentA, attemptNumber: 1, startRequestId: "start-count-high", status: "failed", totalQuestions: 7, correctCount: 8 }), "count too high");
    });
    await check("55. attempt owner deletion is Restrict", () => expectConstraint(
      () => prisma!.user.delete({ where: { id: userA.id } }), "attempt owner delete",
    ));

    const xpBefore = await prisma.xPTransaction.count();
    const progressBefore = await prisma.userLevelProgress.findUniqueOrThrow({ where: { id: progressA.id } });
    const lessonA = await insertLesson({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, contentId: contentA });
    await check("56. valid durable lesson progress is accepted", () => assert.equal(lessonA > 0, true));
    await check("57. cross-user lesson progress is rejected", () => expectConstraint(
      () => insertLesson({ userId: userB.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, contentId: contentA, requestId: "lesson-cross-user" }), "cross-user lesson",
    ));
    await check("58. cross-version lesson progress is rejected", () => expectConstraint(
      () => insertLesson({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionB.id, levelId: levelB.id, contentId: contentB, requestId: "lesson-cross-version" }), "cross-version lesson",
    ));
    await check("59. cross-level lesson progress is rejected", () => expectConstraint(
      () => insertLesson({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA2.id, contentId: contentA, requestId: "lesson-cross-level" }), "cross-level lesson",
    ));
    await check("60. foreign ContentVersion lesson progress is rejected", () => expectConstraint(
      () => insertLesson({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, contentId: contentB, requestId: "lesson-foreign-content" }), "foreign content lesson",
    ));
    await check("61. negative playback position is rejected", () => expectConstraint(
      () => insertLesson({ userId: userB.id, enrollmentId: enrollmentB.id, curriculumVersionId: versionA.id, levelId: levelA.id, contentId: contentA, playback: -1, requestId: "lesson-negative" }), "negative playback",
    ));
    await check("62. lesson progress identity is unique", () => expectConstraint(
      () => insertLesson({ userId: userA.id, enrollmentId: enrollmentA.id, curriculumVersionId: versionA.id, levelId: levelA.id, contentId: contentA, requestId: "lesson-duplicate" }), "duplicate lesson progress",
    ));
    await check("63. structured lesson progress JSON is accepted", async () => {
      const row = (await prisma!.$queryRawUnsafe<Array<{ sections: number; data: number }>>('SELECT json_valid("completedSections") sections, json_valid("progressData") data FROM "UserLessonProgress" WHERE id=?', lessonA))[0];
      assert.deepEqual({ sections: Number(row.sections), data: Number(row.data) }, { sections: 1, data: 1 });
    });
    await check("64. lesson progress causes no XP or level-progression side effects", async () => {
      assert.equal(await prisma!.xPTransaction.count(), xpBefore);
      assert.deepEqual(await prisma!.userLevelProgress.findUniqueOrThrow({ where: { id: progressA.id } }), progressBefore);
    });

    await check("65. V1 tables and representative columns remain unchanged", async () => {
      for (const table of ["Task", "UserTaskProgress", "XpEvent", "TaskReport"]) assert.equal(tables.includes(table), true);
      const taskColumns = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("Task")')).map((c) => c.name);
      assert.equal(taskColumns.includes("completionMethod"), true);
      assert.equal(taskColumns.includes("assessmentVersionId"), false);
    });
    await check("66. V1 hardcoded lesson content remains untouched", () => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", "lib", "lessonContent.ts"), "utf8");
      assert.match(source, /correctAnswer/);
      assert.doesNotMatch(source, /ContentVersion|AssessmentVersion/);
    });
    await check("67. Phase 1 to 3 fixture rows and relations remain unchanged", async () => {
      assert.deepEqual(await prisma!.user.findUniqueOrThrow({ where: { id: userA.id } }), oldSnapshot.user);
      assert.deepEqual(await prisma!.curriculumVersion.findUniqueOrThrow({ where: { id: versionA.id } }), oldSnapshot.version);
      assert.deepEqual(await prisma!.userCurriculumEnrollment.findUniqueOrThrow({ where: { id: enrollmentA.id } }), oldSnapshot.enrollment);
      assert.deepEqual(await prisma!.userLevelProgress.findUniqueOrThrow({ where: { id: progressA.id } }), oldSnapshot.progress);
    });
    await check("68. all nine tables were empty immediately after populated-safe migration", () => {
      assert.equal([...initialCounts.values()].every((count) => count === 0), true);
    });
    await check("69. LevelDefinition has no content or assessment pin columns", async () => {
      const columns = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("LevelDefinition")')).map((c) => c.name);
      assert.equal(columns.includes("contentVersionId"), false);
      assert.equal(columns.includes("assessmentVersionId"), false);
    });
    await check("70. User SQL columns have no Phase 4 additions", async () => {
      const columns = (await prisma!.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("User")')).map((c) => c.name);
      for (const forbidden of ["contentVersionId", "assessmentVersionId", "attemptId", "lessonProgressId", "currentXp"]) assert.equal(columns.includes(forbidden), false);
    });
  } finally {
    await prisma.$disconnect();
    prisma = null;
    cleanupDb();
  }

  await check("cleanup invariant", () => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) assert.equal(fs.existsSync(`${dbPath}${suffix}`), false);
  });
  assert.equal(passed + failed, 71, "curriculum content schema scenario count drifted");
}

main().then(() => {
  console.log(`\ncurriculum content schema regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch((error) => {
  cleanupDb();
  console.error(error);
  console.log(`\ncurriculum content schema regression: ${passed} passed, ${failed + 1} failed`);
  process.exit(1);
});
