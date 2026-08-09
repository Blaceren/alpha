/**
 * PHASE-G1 LIFECYCLE-UI CORRECTION — the Take-mapping gate, proved EXECUTABLY.
 *
 * ========================== THE GAP THIS CLOSES ==========================
 * The independent closeout mutated `levelHandoffStatus` so that an incomplete
 * ATA take mapping no longer produced `ASSESSMENT_TAKE_MAPPING_INCOMPLETE`, and
 * the whole accepted suite stayed green: 23 passed, 0 failed. The blocker that
 * the entire G1 take-mapping correction exists to serve had no test, because
 * after the fix every fixture is a COMPLETE canonical permutation and nothing
 * ever exercised the closed door.
 *
 * A rule with no failing case is a comment. This suite builds the incomplete
 * state through the ACCEPTED product command — `updateAssessmentQuestion` with
 * the generic `stableKey` vocabulary the write schema legitimately permits — and
 * proves that validation, approval, readiness and the handoff all refuse it.
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
const dbPath = path.join(os.tmpdir(), `ata-take-mapping-gate-${process.pid}.db`);
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

    await check("G1 an accepted product command CAN leave the mapping incomplete", async () => {
      // The write schema legitimately accepts the generic lowercase vocabulary —
      // it is the union the G1 correction introduced, and non-ATA banks rely on
      // it. Applying it to an ATA bank is exactly how a real editor can end up
      // one take short, so this is a REACHABLE mutable state, not a fabrication.
      await assessment.updateAssessmentQuestion({
        actorId: author.id,
        questionDefinitionId: questions[3]!.id,
        expectedRevision: await bankRevision(),
        patch: { stableKey: "voprosy-bez-dublya" },
      });
      const overview = await read.readAuthoringOverview(curriculum.id);
      const summary = overview.find((row) => row.levelNumber === LEVEL)!;
      assert.equal(summary.assessment!.mappedTakeCount, 3, "three of four takes remain mapped");
    });

    await check("G2 the ATA validator reports the mapping as broken", async () => {
      const issues = await takeIssues();
      const codes = new Set(issues.map((issue) => issue.code));
      assert.ok(codes.has("ASSESSMENT_TAKE_MAPPING_INVALID"), JSON.stringify([...codes]));
      assert.ok(codes.has("ASSESSMENT_TAKE_UNMAPPED"), JSON.stringify([...codes]));
      const unmapped = issues.find((issue) => issue.code === "ASSESSMENT_TAKE_UNMAPPED")!;
      assert.match(unmapped.message, new RegExp(`T${LEVEL}\\.4`));
      const invalid = issues.find((issue) => issue.code === "ASSESSMENT_TAKE_MAPPING_INVALID")!;
      assert.equal(invalid.section, "assessment", "a take fault belongs to the BANK, not the lesson");
    });

    await check("G3 the bank cannot be APPROVED while its mapping is broken", async () => {
      await lifecycle.submitForReview({
        kind: "assessment",
        id: bank.id,
        expectedRevision: await bankRevision(),
        actorId: author.id,
      });
      // The route computes `validationPassed` from the scoped validator; a
      // broken mapping makes the assessment section non-empty, so approval is
      // refused with the accepted code and the state does not move.
      const report = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
      });
      const scoped = report!.issues.filter((issue) => issue.section === "assessment");
      assert.ok(scoped.length > 0, "the bank must not validate");
      const bankCurrent = await bankRevision();
      await refusedWith(
        () =>
          lifecycle.approveVersion({
            kind: "assessment",
            id: bank.id,
            expectedRevision: bankCurrent,
            actorId: approver.id,
            validationPassed: scoped.length === 0,
          }),
        "AUTHORING_VALIDATION_FAILED",
      );
      const row = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: bank.id } });
      assert.equal(row.editorialState, "submitted_for_review", "an unapprovable bank stays where it was");
    });

    await check("G4 readiness reports ASSESSMENT_TAKE_MAPPING_INCOMPLETE", async () => {
      const status = await statusOf();
      assert.equal(status.ready, false);
      assert.ok(
        status.blockers.includes("ASSESSMENT_TAKE_MAPPING_INCOMPLETE"),
        `blockers were ${JSON.stringify(status.blockers)}`,
      );
    });

    await check("G5 a level-scoped handoff of that level is REFUSED, and names the take blocker", async () => {
      const error = await refusedWith(
        () =>
          handoff.buildHandoffBundle({
            curriculumVersionId: curriculum.id,
            levelNumbers: [LEVEL],
            actorId: null,
          }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      const codes = (error.issues ?? []).map((issue) => issue.code);
      assert.ok(
        codes.includes("ASSESSMENT_TAKE_MAPPING_INCOMPLETE"),
        `refusal named ${JSON.stringify(codes)}`,
      );
      const named = (error.issues ?? []).find((i) => i.code === "ASSESSMENT_TAKE_MAPPING_INCOMPLETE")!;
      assert.equal(named.path, `levels[${LEVEL}]`);
    });

    await check("G6 the whole-curriculum handoff also refuses, naming that level", async () => {
      const error = await refusedWith(
        () => handoff.buildHandoffBundle({ curriculumVersionId: curriculum.id, actorId: null }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      const mine = (error.issues ?? []).filter((issue) => issue.path === `levels[${LEVEL}]`);
      assert.ok(
        mine.some((issue) => issue.code === "ASSESSMENT_TAKE_MAPPING_INCOMPLETE"),
        `L${LEVEL} issues were ${JSON.stringify(mine)}`,
      );
    });

    /* ===== B. the door opens again when the mapping is repaired ===== */

    await check("G7 repairing the mapping through the accepted command clears the blocker", async () => {
      await lifecycle.requestChanges({
        kind: "assessment",
        id: bank.id,
        expectedRevision: await bankRevision(),
        actorId: approver.id,
      });
      await assessment.updateAssessmentQuestion({
        actorId: author.id,
        questionDefinitionId: questions[3]!.id,
        expectedRevision: await bankRevision(),
        patch: { stableKey: profile.expectedTakeIdFor(LEVEL, 4) },
      });
      assert.deepEqual(await takeIssues(), []);
      const status = await statusOf();
      assert.ok(
        !status.blockers.includes("ASSESSMENT_TAKE_MAPPING_INCOMPLETE"),
        `blockers were ${JSON.stringify(status.blockers)}`,
      );
    });

    await check("G8 with the mapping repaired and the bank approved, the level IS handoff-ready", async () => {
      await lifecycle.submitForReview({
        kind: "assessment",
        id: bank.id,
        expectedRevision: await bankRevision(),
        actorId: author.id,
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
      assert.equal(bundle.levels.length, 1);
      assert.deepEqual(
        bundle.levels[0]!.assessment!.questions.map((question) => question.stableKey),
        profile.canonicalTakeIdsForLevel(LEVEL),
      );
    });

    /* ===== C. FAIL CLOSED on durable state the product cannot produce ===== */

    await check("G9 an otherwise-ready level with LEGACY/corrupt durable mapping is still refused", async () => {
      // Not a product path and not claimed to be one: an imported, migrated or
      // hand-repaired database can carry a bank whose mapping is not the
      // canonical permutation, and the gate must hold for durable state it did
      // not create. The bank here is APPROVED and everything else about the
      // level is ready, so the take mapping is the ONLY thing left.
      const before = await statusOf();
      assert.equal(before.ready, true, "precondition: the level is otherwise ready");

      await prisma.questionDefinition.update({
        where: { id: questions[2]!.id },
        data: { stableKey: "legacy-import-key" },
      });

      const after = await statusOf();
      assert.equal(after.ready, false, "a corrupt mapping must close the door");
      assert.deepEqual(
        after.blockers,
        ["ASSESSMENT_TAKE_MAPPING_INCOMPLETE"],
        `the take mapping must be the ONLY blocker, got ${JSON.stringify(after.blockers)}`,
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
      assert.deepEqual(
        (error.issues ?? []).map((issue) => issue.code),
        ["ASSESSMENT_TAKE_MAPPING_INCOMPLETE"],
      );
    });

    await check("G10 a FOREIGN level's take is refused as a repair, on its own terms", async () => {
      // The level check fires BEFORE the aggregate revision guard, so the
      // editor is told what is actually wrong with the value rather than being
      // sent to reload a version that would not have accepted it anyway.
      const revision = await bankRevision();
      const error = await refusedWith(
        () =>
          assessment.updateAssessmentQuestion({
            actorId: author.id,
            questionDefinitionId: questions[2]!.id,
            expectedRevision: revision,
            patch: { stableKey: `T${LEVEL + 1}.3` },
          }),
        "ASSESSMENT_INPUT_INVALID",
      );
      assert.match(String((error as unknown as { message: string }).message), /another level/i);
      const row = await prisma.questionDefinition.findUniqueOrThrow({ where: { id: questions[2]!.id } });
      assert.equal(row.stableKey, "legacy-import-key", "a refused repair changes nothing");
      const status = await statusOf();
      assert.deepEqual(status.blockers, ["ASSESSMENT_TAKE_MAPPING_INCOMPLETE"], "still closed");
    });

    console.log(`\nPHASE-G1 take-mapping gate: ${passed} passed, ${failed} failed`);
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
