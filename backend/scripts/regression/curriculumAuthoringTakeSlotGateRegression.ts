/**
 * PHASE-G1 TAKE-SLOT CORRECTION — the Take-slot gate, proved EXECUTABLY.
 *
 * ========================== THE GAP THIS CLOSES ==========================
 * The independent closeout mutated `levelHandoffStatus` so that an incomplete
 * ATA take mapping no longer produced `ASSESSMENT_TAKE_MAPPING_INCOMPLETE`, and
 * the whole accepted suite stayed green: 23 passed, 0 failed. The blocker that
 * the entire G1 take-mapping correction exists to serve had no test, because
 * after the fix every fixture is a COMPLETE canonical permutation and nothing
 * ever exercised the closed door.
 *
 * A rule with no failing case is a comment.
 *
 * THE PRODUCT DECISION MOVED UNDER THIS SUITE. `T{level}.1..4` are now four
 * FIXED SLOTS: question N is the content of slot N, exactly as the accepted
 * assessment projection has always derived it. So the accepted command can no
 * longer produce an incomplete or permuted mapping at all — and the first half
 * of this suite proves that REFUSAL, which is a stronger statement than the
 * blocker it used to prove.
 *
 * The second half keeps the gate honest for durable state the product cannot
 * write: a missing take, a generic key, a PERMUTATION, a foreign take and a
 * duplicate must each close validation, approval, readiness and the handoff.
 *
 * IT ALSO PROVES FAIL-CLOSED FOR DURABLE STATE THE UI CANNOT PRODUCE. An
 * imported, legacy or corrupted bank is not a product path, but it is a real
 * database, and a level that is otherwise entirely ready must still be refused
 * when its stored mapping is not the canonical permutation.
 *
 * DISPOSABLE DATABASE ONLY. Built from the accepted migration chain and deleted
 * on the way out. No live database, no live env, no flag anywhere real.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-take-slot-gate-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** An ordinary non-L2 ATA video lesson. L2 carries the unresolved conflict. */
const LEVEL = 5;

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
    return error as { code: string; issues?: Array<{ code: string; path?: string; message?: string }> };
  }
  return assert.fail(`expected a refusal with ${code}`);
}

/** A body comfortably above the accepted ATA editorial floor. */
function richBody(marker: string) {
  const paragraph = `${marker}. `.padEnd(
    1400,
    "Дисциплина в трейдинге начинается с плана и заканчивается его исполнением. Риск фиксируется заранее. ",
  );
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
        code: "core",
        title: "Основная часть",
        blocks: [
          { type: "rich_text", text: paragraph },
          { type: "callout", variant: "key_idea", title: "Главное", body: "План важнее прогноза." },
        ],
      },
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
  process.env.CURRICULUM_V2_READ_ENABLED = "true";

  const { prisma } = await import("../../src/lib/prisma");
  const importer = await import("../../src/lib/curriculum/package/import");
  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
  const videoContract = await import("../../src/lib/curriculum/video-production-contract");
  const assessment = await import("../../src/lib/curriculum/assessment");
  const content = await import("../../src/lib/curriculum/content");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const validation = await import("../../src/lib/curriculum/authoring-validation-service");
  const readiness = await import("../../src/lib/curriculum/authoring-readiness");
  const read = await import("../../src/lib/curriculum/authoring-read");
  const handoff = await import("../../src/lib/curriculum/authoring-handoff");
  const profile = await import("../../src/lib/curriculum/authoring-level-profile");
  const projection = await import("../../src/lib/curriculum/authoring-assessment-projection");

  try {
    /* ============================ fixture ============================ */
    const raw = JSON.parse(
      fs.readFileSync(path.join(ROOT, "curriculum/packages/ata-v2-canonical-100.draft.json"), "utf8"),
    );
    const imported = await importer.importCurriculumPackage(raw, { db: prisma as never, dryRun: false });
    assert.equal(imported.ok, true, JSON.stringify(imported).slice(0, 300));
    const curriculum = (await prisma.curriculumVersion.findFirst({ orderBy: { id: "desc" } }))!;

    async function staff(email: string, name: string, staffRole: string) {
      const user = await prisma.user.create({ data: { email, name, passwordHash: "x" } });
      await prisma.staffProfile.create({
        data: { userId: user.id, displayName: name, staffRole: staffRole as never },
      });
      return user;
    }
    const author = await staff("gate-a@example.com", "Автор", "content_manager");
    const approver = await staff("gate-c@example.com", "Админ", "crm_admin");

    const contractsFile = videoContract.videoProductionContractsFileSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"), "utf8"),
      ),
    );
    await videoAuthoring.bootstrapVideoProductionVersions({
      file: contractsFile,
      curriculumVersionId: curriculum.id,
      actorId: author.id,
    });

    const level = (await prisma.levelDefinition.findFirstOrThrow({
      where: { curriculumVersionId: curriculum.id, levelNumber: LEVEL },
    }));
    const bank = (await prisma.assessmentVersion.findFirstOrThrow({
      where: { levelDefinitionId: level.id },
    }));
    const contentVersion = (await prisma.contentVersion.findFirstOrThrow({
      where: { levelDefinitionId: level.id },
    }));
    const localization = (await prisma.contentLocalization.findFirstOrThrow({
      where: { contentVersionId: contentVersion.id, locale: "ru" },
    }));
    const questions = await prisma.questionDefinition.findMany({
      where: { assessmentVersionId: bank.id },
      orderBy: { questionNumber: "asc" },
    });

    const bankRevision = async () =>
      (await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: bank.id }, select: { revision: true } }))
        .revision;
    const contentRevision = async () =>
      (await prisma.contentVersion.findUniqueOrThrow({ where: { id: contentVersion.id }, select: { revision: true } }))
        .revision;
    const statusOf = async () => {
      const overview = await read.readAuthoringOverview(curriculum.id);
      return readiness.levelHandoffStatus(overview.find((row) => row.levelNumber === LEVEL)!);
    };
    const takeIssues = async () => {
      const report = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
      });
      return report!.issues.filter((issue) => issue.code.startsWith("ASSESSMENT_TAKE"));
    };

    /* ---- make the level otherwise fully ready, through accepted commands ---- */
    await content.updateContentLocalization({
      actorId: author.id,
      contentLocalizationId: localization.id,
      expectedRevision: await contentRevision(),
      patch: { body: richBody("Пятый уровень"), title: "Жизненный цикл сделки" },
    });
    await lifecycle.submitForReview({
      kind: "content",
      id: contentVersion.id,
      expectedRevision: await contentRevision(),
      actorId: author.id,
    });
    await lifecycle.approveVersion({
      kind: "content",
      id: contentVersion.id,
      expectedRevision: await contentRevision(),
      actorId: approver.id,
      validationPassed: true,
    });

    await check("F0 the canonical import leaves L5 with a COMPLETE take mapping", async () => {
      const rows = await prisma.questionDefinition.findMany({
        where: { assessmentVersionId: bank.id },
        orderBy: { questionNumber: "asc" },
        select: { stableKey: true },
      });
      assert.deepEqual(
        rows.map((row) => row.stableKey),
        profile.canonicalTakeIdsForLevel(LEVEL),
      );
      assert.deepEqual(await takeIssues(), []);
    });

    /* ===== A. an INCOMPLETE mapping reached through the ACCEPTED command ===== */

    await check("G1 §17 — the accepted command REFUSES to break the slot mapping", async () => {
      const before = await bankRevision();
      for (const [value, pattern] of [
        ["voprosy-bez-dublya", /not an ATA take identifier/],
        [`T${LEVEL}.2`, /cannot be reassigned/],
        [`T${LEVEL + 1}.4`, /belongs to level/],
        ["t5.4", /lowercase stable key or an ATA take identifier/],
      ] as const) {
        let refused = false;
        try {
          await assessment.updateAssessmentQuestion({
            actorId: author.id,
            questionDefinitionId: questions[3]!.id,
            expectedRevision: before,
            patch: { stableKey: value },
          });
        } catch (error) {
          refused = true;
          assert.match(
            `${(error as Error).message} ${JSON.stringify((error as { issues?: unknown }).issues ?? [])}`,
            pattern,
            `"${value}" refused for the wrong reason`,
          );
        }
        assert.ok(refused, `"${value}" must be refused`);
      }
      assert.equal(await bankRevision(), before, "no refused write moved the revision");
      const rows = await prisma.questionDefinition.findMany({
        where: { assessmentVersionId: bank.id },
        orderBy: { questionNumber: "asc" },
        select: { stableKey: true },
      });
      assert.deepEqual(rows.map((r) => r.stableKey), profile.canonicalTakeIdsForLevel(LEVEL));
    });

    await check("G1b §5 — an ATA question cannot be RENUMBERED into another slot", async () => {
      const before = await bankRevision();
      await refusedWith(
        () =>
          assessment.updateAssessmentQuestion({
            actorId: author.id,
            questionDefinitionId: questions[0]!.id,
            expectedRevision: before,
            patch: { questionNumber: 2 },
          }),
        "ASSESSMENT_INPUT_INVALID",
      );
      assert.equal(await bankRevision(), before, "a refused renumber moves nothing");
      const row = await prisma.questionDefinition.findUniqueOrThrow({ where: { id: questions[0]!.id } });
      assert.equal(row.questionNumber, 1);
      assert.equal(row.stableKey, profile.expectedTakeIdFor(LEVEL, 1));
    });

    /** The Blueprint-agreeing answer, so the conflict count can be restored later. */
    let canonicalAnswer: string | null = null;

    await check("G1c §17 — editing the CONTENT of a slot succeeds and bumps the revision once", async () => {
      const before = await bankRevision();
      canonicalAnswer =
        ((await prisma.questionDefinition.findUniqueOrThrow({ where: { id: questions[0]!.id } }))
          .correctAnswer as { code: string }).code;
      await assessment.updateAssessmentQuestion({
        actorId: author.id,
        questionDefinitionId: questions[0]!.id,
        expectedRevision: before,
        patch: { correctAnswer: { code: "c" } },
      });
      assert.equal(await bankRevision(), before + 1, "exactly one revision bump");
      const row = await prisma.questionDefinition.findUniqueOrThrow({ where: { id: questions[0]!.id } });
      assert.equal(row.stableKey, profile.expectedTakeIdFor(LEVEL, 1), "the slot is untouched");
      assert.equal((row.correctAnswer as { code: string }).code, "c");
      assert.deepEqual(await takeIssues(), [], "the bank still validates");
    });

    /* ===== B. adversarial DURABLE state — §18. Forced, never a product write. ===== */

    /** Put one question out of slot without going through the domain. */
    async function forceKey(questionIndex: number, stableKey: string) {
      await prisma.questionDefinition.update({
        where: { id: questions[questionIndex]!.id },
        data: { stableKey },
      });
    }
    /**
     * Force a PERMUTATION into the database.
     *
     * Three writes rather than two, because `@@unique([assessmentVersionId,
     * stableKey])` forbids the transient duplicate — which is itself worth
     * noticing: even an attacker with raw table access cannot make two questions
     * claim one take. Only a permutation is reachable, and this builds it.
     */
    async function forcePermutation() {
      await forceKey(0, "forced-parking-slot");
      await forceKey(1, profile.expectedTakeIdFor(LEVEL, 1));
      await forceKey(0, profile.expectedTakeIdFor(LEVEL, 2));
      // Q1 now holds T{n}.2 and Q2 holds T{n}.1 — a complete PERMUTATION.
    }
    /** Park every key first: the unique constraint forbids any transient clash. */
    async function restoreCanonical() {
      for (const [index, question] of questions.entries()) {
        await prisma.questionDefinition.update({
          where: { id: question.id },
          data: { stableKey: `restore-park-${index}` },
        });
      }
      for (const [index, question] of questions.entries()) {
        await prisma.questionDefinition.update({
          where: { id: question.id },
          data: { stableKey: profile.expectedTakeIdFor(LEVEL, index + 1) },
        });
      }
    }

    await check("G2 §18 — a PERMUTED but complete bank fails the ATA validator", async () => {
      await forcePermutation();
      const issues = await takeIssues();
      const codes = new Set(issues.map((issue) => issue.code));
      assert.ok(
        codes.has("ASSESSMENT_TAKE_SLOT_MISMATCH"),
        `a permutation must be reported, got ${JSON.stringify([...codes])}`,
      );
      const mismatch = issues.filter((issue) => issue.code === "ASSESSMENT_TAKE_SLOT_MISMATCH");
      assert.equal(mismatch.length, 2, "both displaced questions are named");
      assert.equal(mismatch[0]!.section, "assessment", "a slot fault belongs to the BANK");
      assert.match(mismatch[0]!.message, /cannot be reassigned/);
    });

    await check("G3 §18 — a permuted bank is readiness-blocked and handoff-refused", async () => {
      const status = await statusOf();
      assert.equal(status.ready, false);
      void 0;
      assert.ok(
        status.blockers.includes("ASSESSMENT_TAKE_MAPPING_INCOMPLETE"),
        `blockers were ${JSON.stringify(status.blockers)}`,
      );
      const error = await refusedWith(
        () =>
          handoff.buildHandoffBundle({
            curriculumVersionId: curriculum.id,
            levelNumbers: [LEVEL],
            actorId: null,
          }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      assert.ok(
        (error.issues ?? []).some((issue) => issue.code === "ASSESSMENT_TAKE_MAPPING_INCOMPLETE"),
        JSON.stringify(error.issues),
      );
      await restoreCanonical();
    });

    await check("G4 §18 — a MISSING take (generic key) closes validation, readiness and handoff", async () => {
      await forceKey(3, "legacy-generic-key");
      const codes = new Set((await takeIssues()).map((issue) => issue.code));
      assert.ok(codes.has("ASSESSMENT_TAKE_MAPPING_INVALID"), JSON.stringify([...codes]));
      assert.ok(codes.has("ASSESSMENT_TAKE_UNMAPPED"), JSON.stringify([...codes]));
      const status = await statusOf();
      assert.equal(status.ready, false);
      assert.ok(status.blockers.includes("ASSESSMENT_TAKE_MAPPING_INCOMPLETE"));
      await refusedWith(
        () =>
          handoff.buildHandoffBundle({
            curriculumVersionId: curriculum.id,
            levelNumbers: [LEVEL],
            actorId: null,
          }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      await restoreCanonical();
    });

    await check("G5 §18 — a FOREIGN-level take closes the same three gates", async () => {
      await forceKey(2, `T${LEVEL + 1}.3`);
      const codes = new Set((await takeIssues()).map((issue) => issue.code));
      assert.ok(codes.has("ASSESSMENT_TAKE_LEVEL_MISMATCH"), JSON.stringify([...codes]));
      assert.ok(codes.has("ASSESSMENT_TAKE_UNMAPPED"), JSON.stringify([...codes]));
      const status = await statusOf();
      assert.equal(status.ready, false);
      await refusedWith(
        () =>
          handoff.buildHandoffBundle({
            curriculumVersionId: curriculum.id,
            levelNumbers: [LEVEL],
            actorId: null,
          }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      await restoreCanonical();
    });

    await check("G6 §18 — a DUPLICATE take is impossible even with raw table access", async () => {
      // `@@unique([assessmentVersionId, stableKey])` is a DATABASE constraint,
      // so the duplicate half of the old set-membership rule cannot be reached
      // at all — not by the product, and not by a direct write either. The gate
      // is the schema, and the validator's ASSESSMENT_TAKE_DUPLICATE remains as
      // defence for any future store that does not enforce it.
      let refused = false;
      try {
        await prisma.questionDefinition.update({
          where: { id: questions[3]!.id },
          data: { stableKey: profile.expectedTakeIdFor(LEVEL, 3) },
        });
      } catch (error) {
        refused = true;
        assert.match(String((error as Error).message), /[Uu]nique constraint/);
      }
      assert.ok(refused, "the database must refuse two questions claiming one take");
      const rows = await prisma.questionDefinition.findMany({
        where: { assessmentVersionId: bank.id },
        orderBy: { questionNumber: "asc" },
        select: { stableKey: true },
      });
      assert.deepEqual(rows.map((r) => r.stableKey), profile.canonicalTakeIdsForLevel(LEVEL));
    });

    await check("G7 §18 — a permuted bank cannot be APPROVED where validation is required", async () => {
      await forcePermutation();
      await lifecycle.submitForReview({
        kind: "assessment",
        id: bank.id,
        expectedRevision: await bankRevision(),
        actorId: author.id,
      });
      const report = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
      });
      const scoped = report!.issues.filter((issue) => issue.section === "assessment");
      assert.ok(scoped.length > 0, "the bank must not validate");
      const current = await bankRevision();
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "assessment",
            id: bank.id,
            expectedRevision: current,
            actorId: approver.id,
            validationPassed: scoped.length === 0,
          }),
        "AUTHORING_VALIDATION_FAILED",
      );
      const row = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: bank.id } });
      assert.equal(row.editorialState, "submitted_for_review", "an unapprovable bank stays where it was");
      await restoreCanonical();
    });

    await check("G8 with the canonical mapping restored, the level IS handoff-ready", async () => {
      assert.deepEqual(await takeIssues(), []);
      // G1c deliberately changed a correct answer, which is a real Blueprint
      // disagreement. Put it back so this check measures the TAKE gate rather
      // than an unrelated (and correct) source conflict.
      await prisma.questionDefinition.update({
        where: { id: questions[0]!.id },
        data: { correctAnswer: { code: canonicalAnswer! } },
      });
      await lifecycle.approveVersion({
        kind: "assessment",
        id: bank.id,
        expectedRevision: await bankRevision(),
        actorId: approver.id,
        validationPassed: true,
      });
      const status = await statusOf();
      assert.equal(status.ready, true, `blockers were ${JSON.stringify(status.blockers)}`);
      const bundle = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [LEVEL],
        actorId: null,
      });
      assert.deepEqual(
        bundle.levels[0]!.assessment!.questions.map((question) => question.stableKey),
        profile.canonicalTakeIdsForLevel(LEVEL),
      );
    });

    /* ===== C. §8 — ONE take identity, agreed by every reader ===== */

    await check("G9 §8 — durable key = takeIdFor = projection takeId = handoff identity, for ALL 58", async () => {
      const banks = await prisma.assessmentVersion.findMany({
        select: {
          id: true,
          levelDefinition: { select: { levelNumber: true } },
          questions: {
            select: { questionNumber: true, stableKey: true },
            orderBy: { questionNumber: "asc" },
          },
        },
        orderBy: { id: "asc" },
      });
      assert.equal(banks.length, 58, "the canonical import still yields 58 banks");
      let checked = 0;
      for (const row of banks) {
        const levelNumber = row.levelDefinition.levelNumber;
        const projected = await projection.projectAssessmentBank(prisma as never, row.id);
        assert.equal(row.questions.length, 4);
        for (const [index, question] of row.questions.entries()) {
          const canonical = profile.expectedTakeIdFor(levelNumber, question.questionNumber);
          // 1. what the database durably stores
          assert.equal(question.stableKey, canonical, `L${levelNumber} q${question.questionNumber} durable key`);
          // 2. what the accepted fingerprint projection binds
          assert.equal(projected.questions[index]!.takeId, canonical, `L${levelNumber} q${question.questionNumber} projection`);
          // 3. and they are the same string, which is the whole point
          assert.equal(projected.questions[index]!.questionId, canonical, `L${levelNumber} q${question.questionNumber} questionId`);
          checked += 1;
        }
      }
      assert.equal(checked, 232, "every one of the 232 questions agreed");
    });

    await check("G10 §8 — the handoff bundle ships exactly that identity", async () => {
      const bundle = await handoff.buildHandoffBundle({
        curriculumVersionId: curriculum.id,
        levelNumbers: [LEVEL],
        actorId: null,
      });
      const shipped = bundle.levels[0]!.assessment!.questions;
      const projected = await projection.projectAssessmentBank(prisma as never, bank.id);
      for (const [index, question] of shipped.entries()) {
        assert.equal(question.stableKey, projected.questions[index]!.takeId);
        assert.equal(question.stableKey, profile.expectedTakeIdFor(LEVEL, index + 1));
      }
    });

    console.log(`\nPHASE-G1 take-slot gate: ${passed} passed, ${failed} failed`);
    if (OUT) {
      fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
    }
  } finally {
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect().catch(() => {});
  }
}

main()
  .then(() => {
    rm(dbPath);
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    rm(dbPath);
    process.exit(1);
  });
