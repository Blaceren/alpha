/**
 * PHASE-G1 — the Authoring Studio DOMAIN regression.
 *
 * Covers everything that can be proved without a running server: the read
 * projections, provenance, the Blueprint comparison, readiness arithmetic, the
 * G2 work queue, version cloning, the learner-safe preview payload and the
 * deterministic handoff bundle.
 *
 * The HTTP surface — authorization, CSRF, concurrency transport, the Academy
 * preview pin — is proved separately by
 * `curriculumAuthoringStudioHttpRegression`, against the real routes.
 *
 * DISPOSABLE DATABASE ONLY. Built from the accepted migration chain and deleted
 * on the way out. No live database is opened and no flag is set anywhere real.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-authoring-studio-${process.pid}.db`);
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
    return error as { code: string; issues?: Array<{ code: string }> };
  }
  return assert.fail(`expected a refusal with ${code}`);
}

/** A v2 body long enough to clear the accepted 1 200-character editorial floor. */
function richBody(marker: string) {
  const paragraph = `${marker}. `.padEnd(700, "Дисциплина в трейдинге начинается с плана и заканчивается его исполнением. ");
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      {
        code: "intro",
        title: "Введение",
        blocks: [
          { type: "heading", level: 3, text: "Что мы разберём" },
          { type: "rich_text", text: paragraph },
        ],
      },
      {
        code: "practice",
        title: "Практика",
        blocks: [
          { type: "rich_text", text: paragraph },
          { type: "callout", variant: "key_idea", title: "Главное", body: "План важнее прогноза." },
        ],
      },
    ],
  };
}

function shortBody() {
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      { code: "intro", title: "Введение", blocks: [{ type: "heading", level: 3, text: "Скоро" }] },
    ],
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
  const read = await import("../../src/lib/curriculum/authoring-read");
  const readiness = await import("../../src/lib/curriculum/authoring-readiness");
  const conflict = await import("../../src/lib/curriculum/authoring-conflict");
  const clone = await import("../../src/lib/curriculum/authoring-version-clone");
  const preview = await import("../../src/lib/curriculum/authoring-preview");
  const handoff = await import("../../src/lib/curriculum/authoring-handoff");
  const validationService = await import("../../src/lib/curriculum/authoring-validation-service");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
  const videoContract = await import("../../src/lib/curriculum/video-production-contract");
  const coherenceModule = await import("../../src/lib/curriculum/video-production-coherence");
  const productAta = await import("../../src/lib/curriculum/product-ata-100");

  const author = await prisma.user.create({
    data: { email: "studio-author@example.com", name: "Author", role: "admin" },
  });
  const reviewer = await prisma.user.create({
    data: { email: "studio-reviewer@example.com", name: "Reviewer", role: "admin" },
  });
  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "Studio", status: "draft", versionNumber: 1 },
  });

  /**
   * Levels are created with their CANONICAL ATA identity, because the readiness
   * projection deliberately refuses to apply ATA expectations to a level whose
   * stableCode is not the canonical one — so a fixture that faked the code would
   * silently test the fallback path instead of the real one.
   */
  const moduleRow = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id,
      moduleNumber: 1,
      code: productAta.canonicalModuleCode(1),
      title: "Модуль 1",
      firstLevel: 1,
      lastLevel: 20,
      learningObjective: "Основы",
    },
  });

  const ataLevel = (levelNumber: number) =>
    productAta.ATA_LEVELS.find((level) => level.levelNumber === levelNumber)!;

  async function makeLevel(levelNumber: number, type: string, completionMethod: string) {
    const source = ataLevel(levelNumber);
    return prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id,
        moduleId: moduleRow.id,
        levelNumber,
        stableCode: productAta.canonicalLevelCode(source),
        type: type as never,
        title: source.title,
        learningObjective: "Цель",
        completionMethod,
        xpReward: 25,
      },
    });
  }

  async function makeContent(levelId: number, body: unknown, opts: { title?: string } = {}) {
    const version = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: levelId,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        createdById: author.id,
      },
    });
    await prisma.contentLocalization.create({
      data: {
        contentVersionId: version.id,
        locale: "ru",
        title: opts.title ?? "Урок",
        body: body as never,
      },
    });
    return version;
  }

  async function makeBank(levelId: number, levelNumber: number, prompts?: string[]) {
    const version = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: levelId,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        passPercent: 70,
        createdById: author.id,
      },
    });
    for (let n = 1; n <= 4; n += 1) {
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: version.id,
          questionNumber: n,
          stableKey: videoContract.takeIdFor(levelNumber, n),
          type: "single_choice",
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }] as never,
          correctAnswer: { code: "a" } as never,
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id,
          locale: "ru",
          prompt: prompts?.[n - 1] ?? `Вопрос ${n} про дисциплину и план`,
          optionLabels: {
            a: `Правильный ответ ${n} с достаточной длиной для проверки`,
            b: "Неверно",
            c: "Почти",
            d: "Нет",
          } as never,
          explanation: "Пояснение к вопросу",
        },
      });
    }
    return version;
  }


  /**
   * A bank whose prompts, options and answer key MIRROR the level's production
   * contract, so the Blueprint comparison finds nothing. Provenance can only be
   * observed in its non-conflicting form against a bank that actually agrees.
   */
  async function makeMatchingBank(levelId: number, videoProductionVersionId: number) {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({
      where: { id: videoProductionVersionId },
      select: { contractPayload: true },
    });
    const contract = videoAuthoring.parseContractPayload(row.contractPayload);
    const version = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: levelId,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        passPercent: 70,
        createdById: author.id,
      },
    });
    for (const [index, question] of contract.questions.entries()) {
      const created = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: version.id,
          questionNumber: index + 1,
          stableKey: videoContract.takeIdFor(contract.levelNumber, index + 1),
          type: "single_choice",
          options: question.options.map((option) => ({ code: option.optionCode })) as never,
          correctAnswer: { code: question.correctOptionCode } as never,
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: created.id,
          locale: "ru",
          prompt: question.prompt,
          optionLabels: Object.fromEntries(
            question.options.map((option) => [option.optionCode, option.text]),
          ) as never,
          explanation: null,
        },
      });
    }
    return version;
  }

  let approvedContentVersionId = 0;

  const contractsFile = videoContract.videoProductionContractsFileSchema.parse(
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"),
        "utf8",
      ),
    ),
  );

  async function makeVideo(levelId: number, levelNumber: number, overrides: Partial<Record<string, unknown>> = {}) {
    const source = [...contractsFile.contracts].sort((a, b) => a.levelNumber - b.levelNumber)[0];
    const payload = {
      ...source,
      levelNumber,
      levelCode: productAta.canonicalLevelCode(ataLevel(levelNumber)),
      takes: source.takes.map((take, index) => ({
        ...take,
        takeId: videoContract.takeIdFor(levelNumber, index + 1),
      })),
      questions: source.questions.map((question, index) => ({
        ...question,
        takeId: videoContract.takeIdFor(levelNumber, index + 1),
      })),
      ...overrides,
    };
    return videoAuthoring.createVideoProductionVersion({
      levelDefinitionId: levelId,
      curriculumVersionId: curriculum.id,
      payload,
      actorId: author.id,
    });
  }

  try {
    /* ============================================ §7 overview projection */

    const l5 = await makeLevel(5, "lesson", "assessment_pass");
    const content5 = await makeContent(l5.id, richBody("Урок пятого уровня"));
    const bank5 = await makeBank(l5.id, 5);
    const video5 = await makeVideo(l5.id, 5);

    await check("O1 the overview reports server-derived state for every level", async () => {
      const rows = await read.readAuthoringOverview(curriculum.id);
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.levelNumber, 5);
      assert.equal(row.stableCode, productAta.canonicalLevelCode(ataLevel(5)));
      assert.equal(row.moduleNumber, 1);
      assert.equal(row.xpReward, 25, "XP is reported READ-ONLY from the durable row");
      assert.equal(row.completionPair, "lesson:assessment_pass");
      assert.ok(row.content && row.assessment && row.video);
      assert.equal(row.content!.bodyFormat, "blocks_v2");
      assert.ok(row.content!.teachingCharacters > 1200);
      assert.equal(row.assessment!.questionCount, 4);
      assert.equal(row.assessment!.mappedTakeCount, 4);
      assert.equal(row.video!.levelNumber, 5);
    });

    await check("O2 the overview carries NO lesson body, question or answer key", async () => {
      const rows = await read.readAuthoringOverview(curriculum.id);
      const serialized = JSON.stringify(rows);
      assert.ok(!serialized.includes("correctAnswer"), "no answer key in a summary");
      assert.ok(!serialized.includes("ata.lesson.blocks"), "no body in a summary");
      assert.ok(!serialized.includes("Вопрос 1"), "no prompt in a summary");
    });

    /* ================================================ §16 L2 comparison */

    await check("C1 the comparison reports field-level differences and nothing else", async () => {
      const row = await prisma.videoProductionVersion.findUniqueOrThrow({
        where: { id: video5.id },
        select: { contractPayload: true },
      });
      const contract = videoAuthoring.parseContractPayload(row.contractPayload);
      const comparison = await conflict.compareBlueprintProposal(prisma as never, {
        contract,
        assessmentVersionId: bank5.id,
        videoProductionVersionId: video5.id,
      });
      assert.equal(comparison.comparable, true);
      // The fixture bank was authored with generic prompts, so every prompt AND
      // every correct answer differs from the Blueprint's: 4 questions x 2
      // compared fields = 8 records.
      assert.equal(comparison.conflicts.length, 8);
      assert.deepEqual(
        comparison.conflicts.map((entry) => entry.path).slice(0, 3),
        ["questions[0].correctAnswerText", "questions[0].prompt", "questions[1].correctAnswerText"],
      );
      for (const entry of comparison.conflicts) {
        assert.notEqual(entry.currentApprovedValue, entry.blueprintProposalValue);
        assert.ok(entry.currentApprovedValue.length > 0);
        assert.ok(entry.blueprintProposalValue.length > 0);
      }
    });

    await check("C2 a bank whose prompt MATCHES the proposal produces one fewer record", async () => {
      const row = await prisma.videoProductionVersion.findUniqueOrThrow({
        where: { id: video5.id },
        select: { contractPayload: true },
      });
      const contract = videoAuthoring.parseContractPayload(row.contractPayload);
      const before = await conflict.countBlueprintConflicts(prisma as never, {
        contract,
        assessmentVersionId: bank5.id,
      });
      const q3 = await prisma.questionDefinition.findFirstOrThrow({
        where: { assessmentVersionId: bank5.id, questionNumber: 3 },
      });
      await prisma.questionLocalization.updateMany({
        where: { questionId: q3.id, locale: "ru" },
        data: { prompt: contract.questions[2].prompt },
      });
      const after = await conflict.countBlueprintConflicts(prisma as never, {
        contract,
        assessmentVersionId: bank5.id,
      });
      assert.equal(after, before - 1, "agreement removes exactly one record — the L2 shape");
      assert.equal(after, 7, "the accepted L2 record count is reproduced by agreement on one prompt");
    });

    await check("C3 there is NO conflict-resolution command anywhere in the domain", () => {
      const files = fs
        .readdirSync(path.join(ROOT, "src/lib/curriculum"))
        .filter((name) => name.endsWith(".ts"));
      const source = files
        .map((name) => fs.readFileSync(path.join(ROOT, "src/lib/curriculum", name), "utf8"))
        .join("\n");
      for (const forbidden of ["resolveBlueprintConflict", "acceptBlueprintProposal", "applyAllBlueprint"]) {
        assert.ok(!source.includes(forbidden), `${forbidden} must not exist — resolution is G2 work`);
      }
    });

    /* ==================================== §32/§33 readiness arithmetic */

    await check("R1 readiness reports separate honest counts and no percentage", async () => {
      const rows = await read.readAuthoringOverview(curriculum.id);
      const summary = readiness.summarizeReadiness(rows);
      assert.equal(summary.totalLevels, 1);
      assert.equal(summary.structurallyValidLevels, 1);
      assert.equal(summary.contentRequiredLevels, 1, "the video_test level owes a lesson");
      assert.equal(summary.contentPresentLevels, 1);
      assert.equal(summary.contentNeedsAuthoringLevels, 0, "the fixture lesson clears the floor");
      assert.equal(summary.videoContractLevels, 1);
      assert.ok(!("completionPercent" in summary));
      assert.ok(!JSON.stringify(summary).includes("Percent"));
    });

    await check("R2 a short body is counted as NEEDING AUTHORING, not as authored", async () => {
      const l6 = await makeLevel(6, "lesson", "assessment_pass");
      await makeContent(l6.id, shortBody(), { title: "Черновик" });
      const rows = await read.readAuthoringOverview(curriculum.id);
      const summary = readiness.summarizeReadiness(rows);
      assert.equal(summary.contentRequiredLevels, 2);
      assert.equal(summary.contentNeedsAuthoringLevels, 1);
      assert.equal(summary.contentNotPublishedLevels, 2, "nothing in this fixture is published");
    });

    await check("R3 handoff blockers name the real reason, per level", async () => {
      const rows = await read.readAuthoringOverview(curriculum.id);
      const l5row = rows.find((row) => row.levelNumber === 5)!;
      const status = readiness.levelHandoffStatus(l5row);
      assert.equal(status.ready, false);
      assert.ok(status.blockers.includes("CONTENT_NOT_APPROVED"));
      assert.ok(status.blockers.includes("ASSESSMENT_NOT_APPROVED"));
      assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
    });

    await check("R4 the G2 work queue classifies every unresolved item", async () => {
      const rows = await read.readAuthoringOverview(curriculum.id);
      const queue = readiness.classifyWorkQueue(rows);
      const counts = readiness.countWorkQueue(queue);
      assert.ok(counts.NEEDS_FULL_CONTENT >= 1, "the short lesson is queued for authoring");
      assert.ok(counts.SOURCE_CONFLICT >= 1, "the conflicting bank is queued");
      assert.ok(counts.NEEDS_VIDEO_SCRIPT >= 1);
      assert.ok(counts.NEEDS_VIDEO_ASSET >= 1);
      assert.ok(counts.NEEDS_VIDEO_QA >= 1);
      // Deterministic: the same rows classify identically twice.
      assert.deepEqual(readiness.classifyWorkQueue(rows), queue);
      for (const entry of queue) {
        assert.ok(readiness.WORK_QUEUE_BUCKETS.includes(entry.bucket));
        assert.ok(entry.reason.length > 0);
      }
    });

    await check("R5 readiness hardcodes none of the ATA backlog numbers", () => {
      const source = fs.readFileSync(
        path.join(ROOT, "src/lib/curriculum/authoring-readiness.ts"),
        "utf8",
      );
      for (const literal of ["154", " 77", " 57", " 58", "232"]) {
        assert.ok(!source.includes(literal), `readiness must not hardcode ${literal.trim()}`);
      }
    });

    /* ============================================= §15 provenance states */

    await check("P1 a PROPOSED_CANON contract whose bank AGREES reads PROPOSED_CANON", async () => {
      const level = await makeLevel(13, "lesson", "assessment_pass");
      const production = await makeVideo(level.id, 13);
      await makeMatchingBank(level.id, production.id);
      const rows = await read.readAuthoringOverview(curriculum.id);
      const row = rows.find((entry) => entry.levelNumber === 13)!;
      assert.equal(row.video!.sourceProvenance, "PROPOSED_CANON");
      assert.equal(row.assessment!.conflictCount, 0, "the bank agrees with the proposal");
      assert.equal(row.assessment!.provenance, "PROPOSED_CANON");
      assert.equal(row.assessment!.sourceApproval, "AWAITING_APPROVAL");
    });

    await check("P2 SOURCE_BACKED and AWAITING_APPROVAL stay VISIBLY DISTINCT (the L18 shape)", async () => {
      const l4 = await makeLevel(4, "financial_checkpoint", "checkpoint_verified");
      const production = await makeVideo(l4.id, 4, {
        sourceProvenance: "SOURCE_BACKED",
        approval: "AWAITING_APPROVAL",
        sourceStatusLabel: "Источник: подтверждено, ожидает утверждения",
      });
      await makeMatchingBank(l4.id, production.id);
      const rows = await read.readAuthoringOverview(curriculum.id);
      const row = rows.find((entry) => entry.levelNumber === 4)!;
      assert.equal(row.assessment!.sourceProvenance, "SOURCE_BACKED");
      assert.equal(row.assessment!.sourceApproval, "AWAITING_APPROVAL");
      assert.equal(
        row.assessment!.provenance,
        "SOURCE_BACKED",
        "provenance must not collapse into approved just because the source is backed",
      );
      assert.notEqual(row.assessment!.editorialState, "approved");
    });

    await check("P3 the resolver prefers CONFLICTING over APPROVED_CURRENT", () => {
      assert.equal(
        read.resolveProvenance({
          editorialState: "approved",
          sourceProvenance: "PROPOSED_CANON",
          conflictCount: 3,
        }),
        "CONFLICTING",
        "an approved badge must never hide a Blueprint disagreement",
      );
      assert.equal(
        read.resolveProvenance({ editorialState: "approved", sourceProvenance: null, conflictCount: 0 }),
        "APPROVED_CURRENT",
      );
      assert.equal(
        read.resolveProvenance({ editorialState: "draft", sourceProvenance: null, conflictCount: 0 }),
        "LOCAL_DRAFT",
      );
    });

    /* ============================================ §22 validation service */

    await check("V1 validation runs the ACCEPTED validators over durable rows", async () => {
      const report = await validationService.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: l5.id,
      });
      assert.ok(report);
      assert.equal(report!.ok, true, JSON.stringify(report!.issues));
      assert.equal(report!.contentVersionId, content5.id);
      assert.equal(report!.assessmentVersionId, bank5.id);
      // The unlinked video contract is a WARNING, never a blocker on the lesson.
      assert.ok(report!.warnings.some((issue) => issue.section === "video"));
    });

    await check("V2 a placeholder in learner prose is a BLOCKER with a path", async () => {
      const level = await makeLevel(7, "lesson", "assessment_pass");
      const body = richBody("Урок седьмого уровня") as {
        sections: Array<{ blocks: Array<Record<string, unknown>> }>;
      };
      body.sections[0].blocks.push({ type: "rich_text", text: "Скоро будет доступно" });
      await makeContent(level.id, body);
      const report = await validationService.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
      });
      assert.equal(report!.ok, false);
      const placeholder = report!.issues.find((issue) => issue.code === "CONTENT_PLACEHOLDER");
      assert.ok(placeholder, JSON.stringify(report!.issues));
      assert.match(placeholder!.path, /^blocks\[\d+\]$/);
      assert.equal(placeholder!.section, "content");
      assert.equal(placeholder!.severity, "blocker");
    });

    await check("V3 an internal take id in learner prose is a BLOCKER", async () => {
      const level = await makeLevel(8, "lesson", "assessment_pass");
      const body = richBody("Урок восьмого уровня") as {
        sections: Array<{ blocks: Array<Record<string, unknown>> }>;
      };
      body.sections[0].blocks.push({ type: "rich_text", text: "Смотри дубль T8.3 в записи" });
      await makeContent(level.id, body);
      const report = await validationService.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
      });
      assert.ok(report!.issues.some((issue) => issue.code === "CONTENT_PRODUCTION_LEAK"));
    });

    await check("V4 a correct answer reproduced in the lesson is reported as a CROSS issue", async () => {
      const level = await makeLevel(11, "lesson", "assessment_pass");
      const answer = "Правильный ответ 1 с достаточной длиной для проверки";
      const body = richBody("Урок одиннадцатого уровня") as {
        sections: Array<{ blocks: Array<Record<string, unknown>> }>;
      };
      body.sections[0].blocks.push({ type: "rich_text", text: answer });
      await makeContent(level.id, body);
      await makeBank(level.id, 11);
      const report = await validationService.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
      });
      const leak = report!.issues.find((issue) => issue.code === "CONTENT_ANSWER_LEAK");
      assert.ok(leak, JSON.stringify(report!.issues));
      assert.equal(leak!.section, "cross");
    });

    /* ============================================== §36/§37 new version */

    await check("N1 an APPROVED content version cannot be edited in place", async () => {
      const level = await makeLevel(12, "lesson", "assessment_pass");
      const version = await makeContent(level.id, richBody("Урок двенадцатого уровня"));
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: author.id,
      });
      await lifecycle.approveVersion({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: reviewer.id,
        validationPassed: true,
      });
      const contentDomain = await import("../../src/lib/curriculum/content");
      await refusedWith(
        () =>
          contentDomain.updateContentVersion({
            actorId: author.id,
            contentVersionId: version.id,
            expectedRevision: 1,
            patch: { changeNotes: "nope" },
          }),
        "AUTHORING_APPROVED_IMMUTABLE",
      );
      approvedContentVersionId = version.id;
    });

    await check("N2 cloning an approved version produces revision 1 in DRAFT with the copy intact", async () => {
      const approvedId = approvedContentVersionId;
      const before = await prisma.contentVersion.findUniqueOrThrow({ where: { id: approvedId } });
      const beforeLocalizations = await prisma.contentLocalization.findMany({
        where: { contentVersionId: approvedId },
        orderBy: { id: "asc" },
      });

      const cloned = await clone.cloneContentVersion({
        contentVersionId: approvedId,
        actorId: author.id,
      });
      assert.equal(cloned.revision, 1);
      assert.equal(cloned.sourceEditorialState, "approved");
      assert.equal(cloned.copiedChildren, beforeLocalizations.length);

      const created = await prisma.contentVersion.findUniqueOrThrow({ where: { id: cloned.id } });
      assert.equal(created.editorialState, "draft");
      assert.equal(created.status, "draft");
      assert.equal(created.approvedById, null);
      assert.equal(created.submittedById, null);
      assert.equal(created.lastAuthoredById, author.id, "the cloner is the author, so cannot approve it");

      const copiedLocalizations = await prisma.contentLocalization.findMany({
        where: { contentVersionId: cloned.id },
        orderBy: { id: "asc" },
      });
      assert.equal(copiedLocalizations.length, beforeLocalizations.length);
      assert.deepEqual(
        copiedLocalizations.map((row) => JSON.stringify(row.body)),
        beforeLocalizations.map((row) => JSON.stringify(row.body)),
      );

      const after = await prisma.contentVersion.findUniqueOrThrow({ where: { id: approvedId } });
      assert.deepEqual(
        { ...after, updatedAt: null },
        { ...before, updatedAt: null },
        "the approved evidence is untouched by the clone",
      );
    });

    await check("N3 a cloned production version is UNLINKED, never inheriting reviewed evidence", async () => {
      await coherenceModule.linkVideoProductionAssessment(prisma as never, {
        videoProductionVersionId: video5.id,
        assessmentVersionId: bank5.id,
        actorId: author.id,
      });
      const original = await coherenceModule.readVideoProductionCoherence(video5.id, prisma as never);
      assert.equal(original.linked, true);

      const cloned = await clone.cloneVideoProductionVersion({
        videoProductionVersionId: video5.id,
        actorId: author.id,
      });
      const state = await coherenceModule.readVideoProductionCoherence(cloned.id, prisma as never);
      assert.equal(state.linked, false);
      assert.equal(state.reason, "UNLINKED");
      assert.equal(state.assessmentEvidenceStale, true, "absence of evidence never reads as fresh");
    });

    /* ================================================ §26 learner-safe */

    await check("S1 the learner preview payload carries NO answer key and NO explanation", async () => {
      const payload = await preview.buildLearnerPreviewPayload({
        levelDefinitionId: l5.id,
        contentVersionId: content5.id,
        assessmentVersionId: bank5.id,
      });
      const serialized = JSON.stringify(payload);
      assert.ok(!serialized.includes("correctAnswer"));
      assert.ok(!serialized.includes("explanation"));
      assert.ok(!serialized.includes("Пояснение к вопросу"));
      assert.equal(payload.assessment!.questions.length, 4);
      for (const question of payload.assessment!.questions) {
        assert.equal(question.options.length, 4);
        for (const option of question.options) {
          assert.deepEqual(Object.keys(option).sort(), ["code", "label"]);
        }
      }
      assert.ok(payload.content!.sections.length >= 2);
    });

    await check("S2 the safety assertion REFUSES a payload carrying an answer key", () => {
      assert.throws(
        () => preview.assertLearnerSafe({ a: { b: [{ correctAnswer: { code: "a" } }] } }),
        (error: unknown) => (error as { code?: string }).code === "AUTHORING_PREVIEW_UNSAFE",
      );
    });

    await check("S3 a snapshot PINS revisions read server-side and never follows the draft", async () => {
      const created = await preview.createLevelPreviewSnapshot({
        levelDefinitionId: l5.id,
        contentVersionId: content5.id,
        assessmentVersionId: bank5.id,
        videoProductionVersionId: video5.id,
        actorId: author.id,
      });
      const pinnedContent = created.contentRevision!;
      const frozenTitle = (await preview.readLearnerPreview(created.snapshotCode))!.payload.content!
        .title;

      // Move every aggregate underneath the snapshot.
      await prisma.contentVersion.update({
        where: { id: content5.id },
        data: { revision: { increment: 3 } },
      });
      await prisma.contentLocalization.updateMany({
        where: { contentVersionId: content5.id },
        data: { title: "СОВЕРШЕННО ДРУГОЙ ЗАГОЛОВОК" },
      });

      const after = await preview.readLearnerPreview(created.snapshotCode);
      assert.equal(after!.pinned.contentRevision, pinnedContent, "the pin does not move");
      assert.equal(after!.payload.content!.title, frozenTitle, "the frozen body does not move");
      assert.notEqual(after!.payload.content!.title, "СОВЕРШЕННО ДРУГОЙ ЗАГОЛОВОК");

      const internal = await preview.readInternalPreview(created.snapshotCode);
      assert.equal(internal!.outdated, true, "the STAFF view reports the drift, the learner frame does not");
      assert.equal(internal!.pinned.contentRevision, pinnedContent);
      assert.equal(internal!.current.contentRevision, pinnedContent + 3);
    });

    /* ================================================== §38 handoff */

    await check("H1 a bundle refuses a NAMED level that is not ready", async () => {
      const refusal = await refusedWith(
        () =>
          handoff.buildHandoffBundle({
            curriculumVersionId: curriculum.id,
            levelNumbers: [5],
            actorId: null,
          }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      assert.ok((refusal.issues ?? []).length > 0, "the refusal names the blockers");
    });

    /**
     * PHASE-G1 CORRECTION — a whole-curriculum request on an incomplete backlog
     * is REFUSED, not quietly trimmed.
     *
     * The previous expectation was that the bundle excluded blocked levels and
     * reported them. That produced an artefact named after the curriculum which
     * silently omitted most of it — the "ready-only skip" mode the corrections
     * phase forbids. The honest answer is a refusal that names every level and
     * every blocker, which is also what lets the Studio disable the control and
     * show the reasons instead of offering a button that throws.
     */
    await check("H2 a whole-version bundle is REFUSED while any level is blocked, naming every reason", async () => {
      const error = await handoff
        .buildHandoffBundle({ curriculumVersionId: curriculum.id, actorId: null })
        .then(() => null)
        .catch((thrown: unknown) => thrown);
      assert.ok(error, "an incomplete curriculum must not produce a whole-version bundle");
      const domain = error as { code?: string; issues?: Array<{ code: string; path: string }> };
      assert.equal(domain.code, "AUTHORING_HANDOFF_BLOCKED");
      assert.ok((domain.issues ?? []).length > 0, "the refusal names the blockers");
      for (const issue of domain.issues ?? []) {
        assert.match(issue.path, /^levels\[\d+\]$/);
        assert.ok(issue.code.length > 0);
      }
    });

    await check("H3 a fully approved level enters the bundle and the bundle is DETERMINISTIC", async () => {
      // A practical level: it needs an approved lesson and nothing else.
      const level = await makeLevel(9, "practice", "manual");
      const version = await makeContent(level.id, richBody("Практика девятого уровня"));
      await lifecycle.submitForReview({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: author.id,
      });
      await lifecycle.approveVersion({
        kind: "content",
        id: version.id,
        expectedRevision: 1,
        actorId: reviewer.id,
        validationPassed: true,
      });

      const first = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
        actorId: null,
      });
      assert.equal(first.counts.included, 1);
      assert.equal(first.levels[0].levelNumber, 9);
      assert.ok(first.levels[0].content);
      assert.match(first.fingerprint, /^[0-9a-f]{64}$/);

      const second = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
        actorId: null,
      });
      assert.equal(second.fingerprint, first.fingerprint, "same input, same fingerprint");
      assert.equal(JSON.stringify(second), JSON.stringify(first), "byte-identical output");
    });

    await check("H4 the bundle carries NO source-owned product structure", async () => {
      const bundle = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
        actorId: null,
      });
      const serialized = JSON.stringify(bundle);
      for (const forbidden of ["xpReward", "completionMethod", "requiredPreviousLevel", "featureUnlockCode", "moduleNumber"]) {
        assert.ok(!serialized.includes(forbidden), `${forbidden} is source-owned and must not be in a bundle`);
      }
    });

    await check("H5 an edit to approved content MOVES the fingerprint", async () => {
      const before = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
        actorId: null,
      });
      const level = await prisma.levelDefinition.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 9 },
      });
      const version = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: level.id, editorialState: "approved" },
      });
      await prisma.contentLocalization.updateMany({
        where: { contentVersionId: version.id },
        data: { subtitle: "Новый подзаголовок" },
      });
      const after = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
        actorId: null,
      });
      assert.notEqual(after.fingerprint, before.fingerprint);
    });

    await check("H6 producing a bundle writes NO curriculum row and NO publication", async () => {
      const beforeStatuses = await prisma.contentVersion.findMany({
        select: { id: true, status: true, publishedAt: true, editorialState: true },
        orderBy: { id: "asc" },
      });
      const beforeBindings = await prisma.levelResourceBinding.count();
      await handoff
        .buildHandoffBundle({ curriculumVersionId: curriculum.id, actorId: null })
        .catch(() => null);
      const afterStatuses = await prisma.contentVersion.findMany({
        select: { id: true, status: true, publishedAt: true, editorialState: true },
        orderBy: { id: "asc" },
      });
      assert.deepEqual(afterStatuses, beforeStatuses);
      assert.equal(await prisma.levelResourceBinding.count(), beforeBindings);
    });

    await check("H7 a CLI run records no audit row; an HTTP run records one that says 'no publication'", async () => {
      const before = await prisma.auditLog.count({
        where: { action: "AUTHORING_HANDOFF_BUNDLE_GENERATED" },
      });
      // Scoped to the one level that IS ready: a whole-curriculum request is now
      // refused while anything is blocked, and this check is about the AUDIT
      // TRAIL of a successful generation, not about scope.
      const readyScope = [9];
      await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: readyScope,
        actorId: null,
      });
      assert.equal(
        await prisma.auditLog.count({ where: { action: "AUTHORING_HANDOFF_BUNDLE_GENERATED" } }),
        before,
        "a shell run has no HTTP actor and writes nothing",
      );
      await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: readyScope,
        actorId: author.id,
      });
      const row = await prisma.auditLog.findFirstOrThrow({
        where: { action: "AUTHORING_HANDOFF_BUNDLE_GENERATED" },
        orderBy: { id: "desc" },
      });
      assert.equal((row.metadata as { publication?: string }).publication, "none");
    });
    await check("H8 TWO approved versions of one aggregate are AMBIGUOUS and refused", async () => {
      const level = await prisma.levelDefinition.findFirstOrThrow({
        where: { curriculumVersionId: curriculum.id, levelNumber: 9 },
      });
      const source = await prisma.contentVersion.findFirstOrThrow({
        where: { levelDefinitionId: level.id, editorialState: "approved" },
      });
      const cloned = await clone.cloneContentVersion({
        contentVersionId: source.id,
        actorId: author.id,
      });
      await lifecycle.submitForReview({
        kind: "content",
        id: cloned.id,
        expectedRevision: 1,
        actorId: author.id,
      });
      await lifecycle.approveVersion({
        kind: "content",
        id: cloned.id,
        expectedRevision: 1,
        actorId: reviewer.id,
        validationPassed: true,
      });
      await refusedWith(
        () =>
          handoff.buildHandoffBundle({
            curriculumVersionId: curriculum.id,
            levelNumbers: [9],
            actorId: null,
          }),
        "AUTHORING_HANDOFF_AMBIGUOUS",
      );
    });

  } finally {
    await prisma.$disconnect();
    rm(dbPath);
  }

  console.log(`\nPHASE-G1 authoring studio domain: ${passed} passed, ${failed} failed`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  rm(dbPath);
  process.exitCode = 1;
});
