/**
 * PHASE-G2 CORRECTION-2 — the independent re-audit's surviving findings.
 *
 * Three defects, all of them about the same thing: a source-authority surface
 * describing a source it did not actually establish.
 *
 *   HIGH-1     the dedicated staff GET resolved its own contract through
 *              `videoProductionLinks[0]` — insertion order — and reported
 *              NO_CONFLICT for a bank that owed eight decisions.
 *   MEDIUM-1   an unparseable canonical contract produced 0 raw / 0 blocking /
 *              APPROVED_CURRENT / handoff-ready, and validation called it
 *              healthy.
 *   MUTANT Y   `resolveCanonicalAuthorityLink` picked the highest versionNumber
 *              without checking it belonged to the same level, so a foreign v99
 *              could become the canonical proposal.
 *
 * The common fix is ONE resolver, `resolveAuthoritySource`, and a vocabulary
 * that can say "the source is unknown" without saying "there is no conflict".
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
const dbPath = path.join(os.tmpdir(), `ata-source-authority-c2-${process.pid}.db`);
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
const EVIDENCE_SHA = sha("correction-2 fixture evidence");
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

/**
 * A production contract. `tag` decides whether it agrees with the bank the
 * fixture builds: "Общий" agrees, anything else disagrees on all eight fields.
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
  const readiness = await import("../../src/lib/curriculum/authoring-readiness");
  const conflictModule = await import("../../src/lib/curriculum/authoring-conflict");
  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
  const coherence = await import("../../src/lib/curriculum/video-production-coherence");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const handoffModule = await import("../../src/lib/curriculum/authoring-handoff");
  const validation = await import("../../src/lib/curriculum/authoring-validation-service");
  const preview = await import("../../src/lib/curriculum/authoring-preview");
  const constants = await import("../../src/lib/curriculum/constants");

  const admin = await prisma.user.create({
    data: { email: "c2-admin@example.com", name: "Admin", role: "admin" },
  });
  const reviewer = await prisma.user.create({
    data: { email: "c2-reviewer@example.com", name: "Reviewer", role: "admin" },
  });
  async function staffActor(email: string, staffRole: string, status: "active" | "blocked" = "active") {
    const user = await prisma.user.create({ data: { email, name: staffRole, role: "support", status } });
    await prisma.staffProfile.create({
      data: { userId: user.id, staffRole: staffRole as never, displayName: staffRole },
    });
    return user;
  }
  const crmAdmin = await staffActor("c2-crm-admin@example.com", "crm_admin");

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "Correction2", status: "draft", versionNumber: 1 },
  });
  const moduleRow = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id, moduleNumber: 1, code: "module.01",
      title: "Первое знакомство", description: "", firstLevel: 1, lastLevel: 40,
      checkpointLevel: 4, learningObjective: "",
    },
  });

  async function buildLesson(input: { levelNumber: number; variant: "matching" | "conflicting" }) {
    const levelCode = `v2.l${String(input.levelNumber).padStart(3, "0")}.uroven-${input.levelNumber}`;
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id, moduleId: moduleRow.id, levelNumber: input.levelNumber,
        stableCode: levelCode, type: "lesson", title: `Уровень ${input.levelNumber}`,
        learningObjective: "Цель уровня.", completionMethod: "assessment_pass", xpReward: 100,
      },
    });
    const content = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
        updatedAt: new Date(),
        localizations: {
          create: {
            locale: "ru", title: `Уровень ${input.levelNumber}`, subtitle: "",
            learningObjectiveExtension: "Расширенная цель.", summary: "Короткое резюме урока.",
            body: richBody(`Урок ${input.levelNumber}`), updatedAt: new Date(),
          },
        },
      },
    });
    const assessment = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
        passPercent: 100, showExplanation: true, updatedAt: new Date(),
      },
    });
    for (const ordinal of [1, 2, 3, 4]) {
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: assessment.id, questionNumber: ordinal,
          stableKey: `T${input.levelNumber}.${ordinal}`, type: "single_choice",
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }],
          correctAnswer: { code: "a" }, updatedAt: new Date(),
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id, locale: "ru",
          prompt: input.variant === "matching" ? `Общий вопрос ${ordinal}?` : `Текущая формулировка ${ordinal}?`,
          optionLabels: {
            a: input.variant === "matching" ? `Общий верный ответ ${ordinal}.` : `Текущий верный ответ ${ordinal}.`,
            b: `Неверный вариант B${ordinal}.`, c: `Неверный вариант C${ordinal}.`, d: `Неверный вариант D${ordinal}.`,
          },
          explanation: "Пояснение.", updatedAt: new Date(),
        },
      });
    }
    const video = await videoAuthoring.createVideoProductionVersion({
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id,
      payload: contractFor(input.levelNumber, levelCode, input.variant === "matching" ? "Общий" : "Blueprint"),
      actorId: admin.id,
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: video.id, assessmentVersionId: assessment.id, actorId: admin.id,
    });
    return { level, content, assessment, video, levelCode };
  }

  /** A second (or third) production version for a level, inserted in MY order. */
  async function extraVersion(input: {
    levelDefinitionId: number; levelNumber: number; levelCode: string;
    versionNumber: number; tag: string; curriculumVersionId?: number;
  }) {
    return prisma.videoProductionVersion.create({
      data: {
        levelDefinitionId: input.levelDefinitionId,
        curriculumVersionId: input.curriculumVersionId ?? curriculum.id,
        versionNumber: input.versionNumber, levelNumber: input.levelNumber, contractVersion: 1,
        sourceProvenance: "PROPOSED_CANON", scriptState: "SCRIPT_PENDING",
        videoState: "NOT_RECORDED", qaState: "QA_PENDING",
        contractPayload: contractFor(input.levelNumber, input.levelCode, input.tag) as never,
        contractFingerprint: sha(`cf${input.levelNumber}.${input.versionNumber}.${input.tag}`),
        assessmentFingerprint: sha(`af${input.levelNumber}.${input.versionNumber}`),
        createdById: admin.id, updatedAt: new Date(),
      },
    });
  }

  async function approveBoth(contentId: number, assessmentId: number) {
    for (const [kind, id] of [["content", contentId], ["assessment", assessmentId]] as const) {
      const load = async () =>
        kind === "content"
          ? prisma.contentVersion.findUniqueOrThrow({ where: { id } })
          : prisma.assessmentVersion.findUniqueOrThrow({ where: { id } });
      await lifecycle.submitForReview({ kind, id, expectedRevision: (await load()).revision, actorId: admin.id });
      await lifecycle.approveVersion({
        kind, id, expectedRevision: (await load()).revision, actorId: reviewer.id, validationPassed: true,
      });
    }
  }

  const summaryFor = async (levelNumber: number) => {
    const overview = await read.readAuthoringOverview(curriculum.id);
    const level = overview.find((entry) => entry.levelNumber === levelNumber)!;
    return { overview, level, status: readiness.levelHandoffStatus(level) };
  };

  /**
   * THE STAFF GET, exactly as the route computes it. Imported rather than
   * re-implemented would be better still, but the route body needs a Request and
   * a session; this mirrors it statement for statement and the source guard
   * below proves the route has no second implementation to drift into.
   */
  const staffAuthorityGet = async (assessmentVersionId: number) => {
    const source = await authority.resolveAuthoritySource(prisma, assessmentVersionId);
    const projection = await authority.readSourceAuthority(prisma, {
      assessmentVersionId,
      videoProductionVersionId: source.videoProductionVersionId,
      contract: source.contract,
      sourceUnavailableReason: source.unavailableReason,
      sourceLinked: source.link !== null,
    });
    return { ...projection, expectedVideoProductionRevision: source.videoProductionRevision, source };
  };

  const rawConflicts = async (assessmentVersionId: number, videoProductionVersionId: number) => {
    const row = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: videoProductionVersionId } });
    return conflictModule.compareBlueprintProposal(prisma, {
      contract: videoAuthoring.parseContractPayload(row.contractPayload),
      assessmentVersionId, videoProductionVersionId,
    });
  };

  const adjudicateAll = async (assessmentVersionId: number, actorId: number) => {
    const source = await authority.resolveAuthoritySource(prisma, assessmentVersionId);
    const comparison = await rawConflicts(assessmentVersionId, source.videoProductionVersionId!);
    const a = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: assessmentVersionId } });
    return authority.resolveSourceAuthority({
      assessmentVersionId,
      expectedAssessmentRevision: a.revision,
      expectedVideoProductionRevision: source.videoProductionRevision!,
      scope: { kind: "assessment" },
      decisions: comparison.conflicts.map((conflict) => ({
        questionIndex: conflict.questionIndex, field: conflict.field, decision: "CURRENT" as const,
        currentValueHash: sha(conflict.currentApprovedValue),
        blueprintValueHash: sha(conflict.blueprintProposalValue),
      })),
      rationale: "correction-2 fixture: CURRENT wins",
      evidenceRef: EVIDENCE_REF, evidenceSha256: EVIDENCE_SHA, actorId,
    });
  };

  /**
   * The COMMAND, reached directly, for the cases where the source cannot be read
   * at all. A caller in that situation cannot compute a real decision set, and
   * the point of the assertion is which refusal the domain itself produces.
   */
  const adjudicateBlind = async (assessmentVersionId: number, actorId: number) => {
    const a = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: assessmentVersionId } });
    return authority.resolveSourceAuthority({
      assessmentVersionId,
      expectedAssessmentRevision: a.revision,
      expectedVideoProductionRevision: 1,
      scope: { kind: "assessment" },
      decisions: [{
        questionIndex: 0, field: "prompt", decision: "CURRENT",
        currentValueHash: sha("whatever"), blueprintValueHash: sha("whatever else"),
      }],
      rationale: "correction-2 probe", evidenceRef: EVIDENCE_REF, evidenceSha256: EVIDENCE_SHA, actorId,
    });
  };

  /* ================================================================== *
   * §5 — ONE resolver. No residual order-dependent lookup anywhere.
   * ================================================================== */

  await check("D1 no Backend source path still selects an authority link by row order", async () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          const text = fs.readFileSync(full, "utf8");
          // The comparison surface, the staff GET, the handoff and the command
          // must reach their source through the shared resolver. A bare index
          // into the link relation is exactly the defect HIGH-1 recorded.
          for (const line of text.split("\n")) {
            if (/videoProductionLinks\s*(\[\s*0\s*\]|\.\s*at\s*\()/.test(line) && !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*")) {
              offenders.push(`${full}: ${line.trim()}`);
            }
            if (/videoProductionAssessmentLink\.findFirst/.test(line)) offenders.push(`${full}: ${line.trim()}`);
          }
        }
      }
    };
    walk(path.join(ROOT, "src"));
    assert.deepEqual(offenders, [], `order-dependent authority link lookup survives:\n${offenders.join("\n")}`);
  });

  /* ================================================================== *
   * HIGH-1 / MUTANT AA + AB — the staff GET and the multi-link matrix
   * ================================================================== */

  const single = await buildLesson({ levelNumber: 2, variant: "conflicting" });
  await approveBoth(single.content.id, single.assessment.id);

  await check("A. single link — every surface agrees, and the level blocks", async () => {
    const { level, status } = await summaryFor(2);
    const got = await staffAuthorityGet(single.assessment.id);
    assert.equal(level.assessment!.conflictCount, 8);
    assert.equal(level.assessment!.blockingConflictCount, 8);
    assert.equal(level.assessment!.provenance, "CONFLICTING");
    assert.equal(got.rawConflictCount, 8);
    assert.equal(got.blockingConflictCount, 8);
    assert.equal(got.state, "UNRESOLVED_CONFLICT");
    assert.equal(got.videoProductionVersionId, single.video.id);
    assert.equal(got.sourceLinked, true);
    assert.equal(status.ready, false);
  });

  /**
   * The re-audit's exact reproduction: a bank that AGREES with its first-linked
   * contract and DISAGREES with the canonical one. Under `links[0]` the staff GET
   * reported NO_CONFLICT while readiness reported eight blocking conflicts.
   */
  async function multiLinkFixture(levelNumber: number, order: Array<{ versionNumber: number; tag: string }>) {
    // The bank matches "Общий"; every version tagged otherwise disagrees.
    const lesson = await buildLesson({ levelNumber, variant: "matching" });
    await approveBoth(lesson.content.id, lesson.assessment.id);
    const made: Array<{ id: number; versionNumber: number; tag: string }> = [
      { id: lesson.video.id, versionNumber: 1, tag: "Общий" },
    ];
    for (const spec of order) {
      const row = await extraVersion({
        levelDefinitionId: lesson.level.id, levelNumber, levelCode: lesson.levelCode,
        versionNumber: spec.versionNumber, tag: spec.tag,
      });
      await coherence.linkVideoProductionAssessment(prisma, {
        videoProductionVersionId: row.id, assessmentVersionId: lesson.assessment.id, actorId: admin.id,
      });
      made.push({ id: row.id, versionNumber: spec.versionNumber, tag: spec.tag });
    }
    return { lesson, made };
  }

  const matrix: Array<{ name: string; levelNumber: number; order: Array<{ versionNumber: number; tag: string }>; winner: number }> = [
    { name: "B. versions 1 + 2", levelNumber: 3, order: [{ versionNumber: 2, tag: "Blueprint" }], winner: 2 },
    { name: "C. versions 2 + 5, newest linked FIRST", levelNumber: 4, order: [{ versionNumber: 5, tag: "Blueprint" }, { versionNumber: 2, tag: "Общий" }], winner: 5 },
    { name: "D. versions 2 + 5, oldest linked FIRST", levelNumber: 5, order: [{ versionNumber: 2, tag: "Общий" }, { versionNumber: 5, tag: "Blueprint" }], winner: 5 },
    { name: "E. three versions in arbitrary order", levelNumber: 6, order: [{ versionNumber: 4, tag: "Общий" }, { versionNumber: 9, tag: "Blueprint" }, { versionNumber: 3, tag: "Общий" }], winner: 9 },
  ];

  for (const entry of matrix) {
    await check(`${entry.name} — MUTANT AA/AB: GET, overview, readiness and handoff share one source`, async () => {
      const { lesson, made } = await multiLinkFixture(entry.levelNumber, entry.order);
      const expected = made.find((m) => m.versionNumber === entry.winner)!;

      const canonical = (await authority.resolveCanonicalAuthorityLink(prisma, lesson.assessment.id))!;
      assert.equal(canonical.videoProductionVersionId, expected.id, "canonical resolver picks the newest linked version");
      assert.equal(canonical.candidateCount, made.length);

      const got = await staffAuthorityGet(lesson.assessment.id);
      assert.equal(got.videoProductionVersionId, expected.id, "MUTANT AA: the GET must read the canonical source");

      const { level, status } = await summaryFor(entry.levelNumber);
      // The canonical proposal disagrees with the bank on all eight fields even
      // though an older LINKED one agrees with it exactly.
      assert.equal(level.assessment!.conflictCount, 8);
      assert.equal(level.assessment!.blockingConflictCount, 8);
      assert.equal(level.assessment!.provenance, "CONFLICTING");
      assert.equal(got.rawConflictCount, 8, "MUTANT AB: the GET must not report NO_CONFLICT");
      assert.notEqual(got.state, "NO_CONFLICT");
      assert.equal(got.state, "UNRESOLVED_CONFLICT");
      assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONFLICT"));
      assert.equal(status.ready, false);

      // §7 — the quoted revision belongs to the SAME version the projection is about.
      const canonicalRow = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: expected.id } });
      assert.equal(got.expectedVideoProductionRevision, canonicalRow.revision);

      // and the COMMAND binds its rows to that very version
      await adjudicateAll(lesson.assessment.id, crmAdmin.id);
      const stored = await prisma.sourceAuthorityResolution.findMany({
        where: { assessmentVersionId: lesson.assessment.id, supersededAt: null },
        select: { videoProductionVersionId: true },
      });
      assert.equal(stored.length, 8);
      for (const row of stored) assert.equal(row.videoProductionVersionId, expected.id, "MUTANT U");

      // ... and the HANDOFF reads the same lineage back as in force
      const after = await summaryFor(entry.levelNumber);
      assert.equal(after.level.assessment!.blockingConflictCount, 0);
      assert.equal(after.status.ready, true);
      const bundle = await handoffModule.buildHandoffBundle({
        actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [entry.levelNumber],
      });
      const bundled = bundle.levels[0] as unknown as {
        assessment: { sourceAuthority: { state: string; blockingConflictCount: number; decisions: unknown[] } | null };
      };
      assert.ok(bundled.assessment.sourceAuthority, "the bundle must carry the lineage");
      assert.equal(bundled.assessment.sourceAuthority!.state, "ADJUDICATED_CURRENT");
      assert.equal(bundled.assessment.sourceAuthority!.blockingConflictCount, 0);
      assert.equal(bundled.assessment.sourceAuthority!.decisions.length, 8);
    });
  }

  await check("F. MUTANT V — rewriting the physical link order changes nothing", async () => {
    const lesson = await prisma.levelDefinition.findFirstOrThrow({ where: { levelNumber: 6 } });
    const bank = await prisma.assessmentVersion.findFirstOrThrow({ where: { levelDefinitionId: lesson.id } });
    const before = (await authority.resolveCanonicalAuthorityLink(prisma, bank.id))!;
    await prisma.$executeRawUnsafe(
      `UPDATE "VideoProductionAssessmentLink" SET id = id + 5000 WHERE "assessmentVersionId" = ?`, bank.id,
    );
    const after = (await authority.resolveCanonicalAuthorityLink(prisma, bank.id))!;
    assert.equal(after.videoProductionVersionId, before.videoProductionVersionId);
    const got = await staffAuthorityGet(bank.id);
    assert.equal(got.videoProductionVersionId, before.videoProductionVersionId);
  });

  await check("G. MUTANT W — no link at all: the GET reports honestly and the command refuses", async () => {
    const lesson = await buildLesson({ levelNumber: 7, variant: "conflicting" });
    await approveBoth(lesson.content.id, lesson.assessment.id);
    await prisma.videoProductionAssessmentLink.deleteMany({ where: { assessmentVersionId: lesson.assessment.id } });

    assert.equal(await authority.resolveCanonicalAuthorityLink(prisma, lesson.assessment.id), null);
    const got = await staffAuthorityGet(lesson.assessment.id);
    // The reporting fallback keeps an unlinked-but-conflicting bank visible and
    // blocked — it does NOT make it adjudicable.
    assert.equal(got.sourceLinked, false, "an unlinked source is never presented as pinned");
    assert.equal(got.rawConflictCount, 8, "the disagreement is still reported");
    const { level, status } = await summaryFor(7);
    assert.equal(level.assessment!.blockingConflictCount, 8, "and it still blocks");
    assert.equal(status.ready, false);

    const a = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: lesson.assessment.id } });
    await refusedWith(() => authority.resolveSourceAuthority({
      assessmentVersionId: lesson.assessment.id, expectedAssessmentRevision: a.revision,
      expectedVideoProductionRevision: 1, scope: { kind: "assessment" },
      decisions: [{ questionIndex: 0, field: "prompt", decision: "CURRENT", currentValueHash: sha("x"), blueprintValueHash: sha("y") }],
      rationale: "must refuse", evidenceRef: EVIDENCE_REF, evidenceSha256: EVIDENCE_SHA, actorId: admin.id,
    }), "AUTHORING_ASSESSMENT_LINK_MISSING");
    assert.equal(await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: lesson.assessment.id } }), 0);
  });

  /* ================================================================== *
   * MUTANT Y / AF — a foreign-level link is refused, never stepped over
   * ================================================================== */

  await check("H. MUTANT Y — a foreign-level v99 never becomes the canonical source", async () => {
    const foreign = await buildLesson({ levelNumber: 11, variant: "conflicting" });
    const victim = await buildLesson({ levelNumber: 12, variant: "conflicting" });
    await approveBoth(victim.content.id, victim.assessment.id);
    const foreignHigh = await extraVersion({
      levelDefinitionId: foreign.level.id, levelNumber: 11, levelCode: foreign.levelCode,
      versionNumber: 99, tag: "Чужой",
    });
    await prisma.videoProductionAssessmentLink.create({
      data: {
        videoProductionVersionId: foreignHigh.id, assessmentVersionId: victim.assessment.id,
        assessmentRevision: 1, assessmentBankFingerprint: sha("foreign"), linkedById: admin.id,
      },
    });

    // The resolver refuses outright — it does not pick the compatible row and
    // hide the corruption, and it does not pick the foreign one either.
    const refusal = await refusedWith(
      () => authority.resolveCanonicalAuthorityLink(prisma, victim.assessment.id),
      "AUTHORING_ASSESSMENT_LINK_INVALID",
    );
    assert.match(refusal.message, /another level/);

    const source = await authority.resolveAuthoritySource(prisma, victim.assessment.id);
    assert.equal(source.unavailableReason, "SOURCE_LINK_INCOMPATIBLE");
    assert.equal(source.contract, null);
    assert.equal(source.videoProductionVersionId, null, "MUTANT AF: no lineage is derived from a corrupt link set");

    // Every surface fails closed and says the same thing.
    const { level, status } = await summaryFor(12);
    assert.equal(level.assessment!.sourceContractUnavailable, true);
    assert.equal(level.assessment!.sourceContractUnavailableReason, "SOURCE_LINK_INCOMPATIBLE");
    assert.equal(level.assessment!.provenance, "SOURCE_UNAVAILABLE");
    assert.notEqual(level.assessment!.provenance, "APPROVED_CURRENT");
    assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONTRACT_UNREADABLE"));
    assert.equal(status.ready, false);

    const got = await staffAuthorityGet(victim.assessment.id);
    assert.equal(got.state, "SOURCE_UNAVAILABLE");
    assert.notEqual(got.state, "NO_CONFLICT");
    assert.equal(got.unprojectableReason, "SOURCE_LINK_INCOMPATIBLE");
    assert.equal(got.expectedVideoProductionRevision, null);

    const blocked = await refusedWith(
      () => handoffModule.buildHandoffBundle({ actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [12] }),
      "AUTHORING_HANDOFF_BLOCKED",
    );
    assert.match(JSON.stringify(blocked), /ASSESSMENT_SOURCE_CONTRACT_UNREADABLE/);
    await refusedWith(() => adjudicateBlind(victim.assessment.id, admin.id), "AUTHORING_ASSESSMENT_LINK_INVALID");
    assert.equal(await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: victim.assessment.id } }), 0);
  });

  await check("I. a curriculum-version mismatch is refused on the same rule", async () => {
    const other = await prisma.curriculumVersion.create({
      data: { code: "ata-v3", name: "Other", status: "draft", versionNumber: 2 },
    });
    const otherModule = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: other.id, moduleNumber: 1, code: "module.01", title: "M",
        description: "", firstLevel: 1, lastLevel: 40, checkpointLevel: 4, learningObjective: "",
      },
    });
    const otherLevel = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: other.id, moduleId: otherModule.id, levelNumber: 13,
        stableCode: "v2.l013.uroven-13", type: "lesson", title: "Уровень 13",
        learningObjective: "Цель.", completionMethod: "assessment_pass", xpReward: 100,
      },
    });
    const otherVideo = await extraVersion({
      levelDefinitionId: otherLevel.id, levelNumber: 13, levelCode: "v2.l013.uroven-13",
      versionNumber: 7, tag: "Чужой", curriculumVersionId: other.id,
    });
    const victim = await buildLesson({ levelNumber: 14, variant: "conflicting" });
    await prisma.videoProductionAssessmentLink.create({
      data: {
        videoProductionVersionId: otherVideo.id, assessmentVersionId: victim.assessment.id,
        assessmentRevision: 1, assessmentBankFingerprint: sha("cross-curriculum"), linkedById: admin.id,
      },
    });
    await refusedWith(
      () => authority.resolveCanonicalAuthorityLink(prisma, victim.assessment.id),
      "AUTHORING_ASSESSMENT_LINK_INVALID",
    );
    const source = await authority.resolveAuthoritySource(prisma, victim.assessment.id);
    assert.equal(source.unavailableReason, "SOURCE_LINK_INCOMPATIBLE");
  });

  /* ================================================================== *
   * MEDIUM-1 / AC, AD, AE, AG — an unreadable source contract
   * ================================================================== */

  const broken = await buildLesson({ levelNumber: 20, variant: "conflicting" });
  await approveBoth(broken.content.id, broken.assessment.id);

  /** Replace the canonical contract payload, run `fn`, restore. */
  async function withBrokenContract<T>(videoId: number, payload: unknown, fn: () => Promise<T>): Promise<T> {
    const good = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: videoId } });
    await prisma.videoProductionVersion.update({
      where: { id: videoId }, data: { contractPayload: payload as never },
    });
    try {
      return await fn();
    } finally {
      await prisma.videoProductionVersion.update({
        where: { id: videoId }, data: { contractPayload: good.contractPayload as never },
      });
    }
  }

  const brokenPayloads: Array<{ name: string; payload: unknown }> = [
    { name: "A. not an object at all", payload: "totally not a contract" },
    { name: "B. valid JSON, schema-invalid", payload: { garbage: true } },
    { name: "C. missing required authority fields", payload: { ...contractFor(20, broken.levelCode, "Blueprint"), questions: undefined } },
    { name: "D. an incompatible future shape", payload: { ...contractFor(20, broken.levelCode, "Blueprint"), contractVersion: 99, questions: "not-an-array" } },
    { name: "E. a projectable-looking payload with no takes", payload: { ...contractFor(20, broken.levelCode, "Blueprint"), takes: null } },
  ];

  for (const entry of brokenPayloads) {
    await check(`J/${entry.name} — MUTANT AC/AD/AE: unreadable source never reads as agreement`, async () => {
      await withBrokenContract(broken.video.id, entry.payload, async () => {
        const { level, status } = await summaryFor(20);

        // AC — no fabricated zero, no approved-like provenance.
        assert.equal(level.assessment!.sourceContractUnavailable, true, "the failure is reported, not swallowed");
        assert.equal(level.assessment!.sourceContractUnavailableReason, "SOURCE_CONTRACT_UNPARSEABLE");
        assert.equal(level.assessment!.provenance, "SOURCE_UNAVAILABLE", "MUTANT AC");
        assert.notEqual(level.assessment!.provenance, "APPROVED_CURRENT", "MUTANT AC");

        // AD — never handoff-ready, and the bundle actually refuses.
        assert.ok(status.blockers.includes("ASSESSMENT_SOURCE_CONTRACT_UNREADABLE"), "MUTANT AD");
        assert.equal(status.ready, false, "MUTANT AD");
        const byNumber = await refusedWith(
          () => handoffModule.buildHandoffBundle({ actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [20] }),
          "AUTHORING_HANDOFF_BLOCKED",
        );
        assert.match(JSON.stringify(byNumber), /ASSESSMENT_SOURCE_CONTRACT_UNREADABLE/);
        // The whole-curriculum request is all-or-nothing (PHASE-G1 CORRECTION),
        // so it must refuse AND name this level's blocker rather than quietly
        // shipping a bundle without it.
        const whole = await refusedWith(
          () => handoffModule.buildHandoffBundle({ actorId: admin.id, curriculumVersionId: curriculum.id }),
          "AUTHORING_HANDOFF_BLOCKED",
        );
        const issues = (whole as unknown as { issues: Array<{ code: string; path: string }> }).issues;
        assert.ok(
          issues.some((i) => i.code === "ASSESSMENT_SOURCE_CONTRACT_UNREADABLE" && i.path === "levels[20]"),
          `the refusal must name level 20's unreadable source: ${JSON.stringify(issues)}`,
        );

        // AE — validation must not call it healthy.
        const report = await validation.validateLevelAuthoring({
          curriculumVersionId: curriculum.id, levelDefinitionId: broken.level.id,
        });
        assert.equal(report!.ok, false, "MUTANT AE: validation must not report a healthy level");
        assert.ok(
          report!.issues.some((issue) => issue.code === "VIDEO_CONTRACT_UNPARSEABLE"),
          `MUTANT AE: expected VIDEO_CONTRACT_UNPARSEABLE, got ${report!.issues.map((i) => i.code).join(",")}`,
        );

        // §9 — the staff GET says UNKNOWN, never NO_CONFLICT.
        const got = await staffAuthorityGet(broken.assessment.id);
        assert.equal(got.state, "SOURCE_UNAVAILABLE");
        assert.notEqual(got.state, "NO_CONFLICT");
        assert.equal(got.comparable, false);
        assert.equal(got.unprojectableReason, "SOURCE_CONTRACT_UNPARSEABLE");

        // the command refuses with the same fact
        await refusedWith(() => adjudicateBlind(broken.assessment.id, admin.id), "AUTHORING_SOURCE_CONTRACT_UNREADABLE");
        assert.equal(
          await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: broken.assessment.id } }), 0,
        );
      });
    });
  }

  await check("K. MUTANT AG — a broken canonical contract never falls back to an older linked one", async () => {
    // Two links: v1 (agrees with the bank) and v2 (canonical). Break v2.
    const lesson = await buildLesson({ levelNumber: 21, variant: "matching" });
    await approveBoth(lesson.content.id, lesson.assessment.id);
    const v2 = await extraVersion({
      levelDefinitionId: lesson.level.id, levelNumber: 21, levelCode: lesson.levelCode,
      versionNumber: 2, tag: "Blueprint",
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: v2.id, assessmentVersionId: lesson.assessment.id, actorId: admin.id,
    });
    await withBrokenContract(v2.id, { broken: true }, async () => {
      const source = await authority.resolveAuthoritySource(prisma, lesson.assessment.id);
      assert.equal(source.unavailableReason, "SOURCE_CONTRACT_UNPARSEABLE");
      assert.equal(source.videoProductionVersionId, v2.id, "it names the version it could not read");
      assert.notEqual(source.videoProductionVersionId, lesson.video.id, "MUTANT AG: no silent fallback to v1");
      assert.equal(source.contract, null);
      const { level, status } = await summaryFor(21);
      assert.equal(level.assessment!.provenance, "SOURCE_UNAVAILABLE");
      assert.equal(status.ready, false);
      const got = await staffAuthorityGet(lesson.assessment.id);
      assert.equal(got.state, "SOURCE_UNAVAILABLE");
    });
    // restored: the canonical v2 disagrees, so the level blocks on a real conflict
    const restored = await summaryFor(21);
    assert.equal(restored.level.assessment!.sourceContractUnavailable, false);
    assert.equal(restored.level.assessment!.conflictCount, 8);
    assert.equal(restored.status.ready, false);
  });

  await check("L. §19 compound: raw conflict + several links + a broken canonical source", async () => {
    const lesson = await buildLesson({ levelNumber: 22, variant: "conflicting" });
    await approveBoth(lesson.content.id, lesson.assessment.id);
    const older = await extraVersion({
      levelDefinitionId: lesson.level.id, levelNumber: 22, levelCode: lesson.levelCode,
      versionNumber: 2, tag: "Общий",
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: older.id, assessmentVersionId: lesson.assessment.id, actorId: admin.id,
    });
    const newest = await extraVersion({
      levelDefinitionId: lesson.level.id, levelNumber: 22, levelCode: lesson.levelCode,
      versionNumber: 3, tag: "Blueprint",
    });
    await coherence.linkVideoProductionAssessment(prisma, {
      videoProductionVersionId: newest.id, assessmentVersionId: lesson.assessment.id, actorId: admin.id,
    });
    await withBrokenContract(newest.id, "not json at all", async () => {
      const { level, status } = await summaryFor(22);
      const got = await staffAuthorityGet(lesson.assessment.id);
      assert.equal(level.assessment!.provenance, "SOURCE_UNAVAILABLE");
      assert.equal(got.state, "SOURCE_UNAVAILABLE");
      assert.equal(got.videoProductionVersionId, newest.id, "no arbitrary fallback to either older link");
      assert.equal(status.ready, false);
      await refusedWith(
        () => handoffModule.buildHandoffBundle({ actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [22] }),
        "AUTHORING_HANDOFF_BLOCKED",
      );
      await refusedWith(() => adjudicateBlind(lesson.assessment.id, admin.id), "AUTHORING_SOURCE_CONTRACT_UNREADABLE");
      assert.equal(
        await prisma.sourceAuthorityResolution.count({ where: { assessmentVersionId: lesson.assessment.id } }), 0,
        "no partial adjudication",
      );
    });
  });

  /* ================================================================== *
   * §14 — the healthy cases must stay exactly as they were
   * ================================================================== */

  await check("M. a legitimately agreeing bank is still NO_CONFLICT and still ready", async () => {
    const lesson = await buildLesson({ levelNumber: 25, variant: "matching" });
    await approveBoth(lesson.content.id, lesson.assessment.id);
    const { level, status } = await summaryFor(25);
    assert.equal(level.assessment!.conflictCount, 0);
    assert.equal(level.assessment!.blockingConflictCount, 0);
    assert.equal(level.assessment!.sourceContractUnavailable, false, "no fake unavailable state");
    assert.equal(level.assessment!.sourceContractUnavailableReason, null);
    assert.equal(level.assessment!.provenance, "APPROVED_CURRENT");
    assert.deepEqual(status.blockers, []);
    assert.equal(status.ready, true);
    const got = await staffAuthorityGet(lesson.assessment.id);
    assert.equal(got.state, "NO_CONFLICT");
    assert.equal(got.comparable, true);
    assert.equal(got.rawConflictCount, 0);
    assert.equal(got.sourceLinked, true);
    const report = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id, levelDefinitionId: lesson.level.id,
    });
    assert.equal(report!.ok, true, `a healthy level must still validate: ${report!.issues.map((i) => i.code).join(",")}`);
    const bundle = await handoffModule.buildHandoffBundle({
      actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [25],
    });
    assert.equal(bundle.levels.length, 1);
  });

  await check("N. a level with NO production version at all is untouched by the new state", async () => {
    const level = await prisma.levelDefinition.create({
      data: {
        curriculumVersionId: curriculum.id, moduleId: moduleRow.id, levelNumber: 26,
        stableCode: "v2.l026.uroven-26", type: "lesson", title: "Уровень 26",
        learningObjective: "Цель.", completionMethod: "assessment_pass", xpReward: 100,
      },
    });
    const bank = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
        passPercent: 100, showExplanation: true, updatedAt: new Date(),
      },
    });
    const { level: summary } = await summaryFor(26);
    assert.equal(summary.video, null);
    assert.equal(summary.assessment!.sourceContractUnavailable, false, "no video is not a broken source");
    assert.equal(summary.assessment!.conflictCount, 0);
    const source = await authority.resolveAuthoritySource(prisma, bank.id);
    assert.equal(source.unavailableReason, null);
    assert.equal(source.videoProductionVersionId, null);
    const got = await staffAuthorityGet(bank.id);
    assert.equal(got.state, "NO_CONFLICT");
    assert.equal(got.unprojectableReason, "NO_PRODUCTION_CONTRACT");
  });

  /* ================================================================== *
   * §20 — every surface, one truth. §21–§24 — nothing regressed.
   * ================================================================== */

  await check("O. §20 all five authority surfaces agree on one healthy adjudicated bank", async () => {
    const { level, status } = await summaryFor(2);
    assert.equal(level.assessment!.blockingConflictCount, 8, "still unadjudicated at this point");
    await adjudicateAll(single.assessment.id, crmAdmin.id);
    const after = await summaryFor(2);
    const got = await staffAuthorityGet(single.assessment.id);
    const projection = await authority.readSourceAuthority(prisma, {
      assessmentVersionId: single.assessment.id,
      videoProductionVersionId: single.video.id,
      contract: videoAuthoring.parseContractPayload(
        (await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: single.video.id } })).contractPayload),
      sourceLinked: true,
    });
    assert.equal(status.ready, false);
    for (const view of [got, projection, after.level.assessment!.authorityResolution!]) {
      assert.equal(view.rawConflictCount, 8, "raw history retained everywhere");
      assert.equal(view.blockingConflictCount, 0);
      assert.equal(view.state, "ADJUDICATED_CURRENT");
      assert.equal(view.videoProductionVersionId, single.video.id);
    }
    assert.equal(after.level.assessment!.provenance, "APPROVED_CURRENT");
    assert.equal(after.status.ready, true);
    const bundle = await handoffModule.buildHandoffBundle({ actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [2] });
    const bundled = bundle.levels[0] as unknown as {
      assessment: { sourceAuthority: { rawConflictCount: number; blockingConflictCount: number; state: string } | null };
    };
    assert.equal(bundled.assessment.sourceAuthority!.rawConflictCount, 8);
    assert.equal(bundled.assessment.sourceAuthority!.blockingConflictCount, 0);
    assert.equal(bundled.assessment.sourceAuthority!.state, "ADJUDICATED_CURRENT");
  });

  await check("P. §21 the domain actor matrix is unchanged", async () => {
    const target = await buildLesson({ levelNumber: 27, variant: "conflicting" });
    await approveBoth(target.content.id, target.assessment.id);
    const denied: Array<[string, number]> = [];
    for (const role of ["content_manager", "read_only", "crm_manager", "mentor", "support", "moderator", "analyst", "retention_manager"]) {
      denied.push([role, (await staffActor(`c2-${role}@example.com`, role)).id]);
    }
    denied.push(["blocked crm_admin", (await staffActor("c2-blocked@example.com", "crm_admin", "blocked")).id]);
    denied.push(["nonexistent", 987654]);
    denied.push(["zero", 0]);
    denied.push(["negative", -3]);
    for (const [label, actorId] of denied) {
      const rowsBefore = await prisma.sourceAuthorityResolution.count();
      const auditBefore = await prisma.auditLog.count({
        where: { action: constants.CURRICULUM_AUDIT_ACTIONS.authoringSourceAuthorityResolved },
      });
      const stateBefore = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: target.assessment.id } });
      await refusedWith(() => adjudicateAll(target.assessment.id, actorId), "AUTHORING_ACTOR_FORBIDDEN");
      assert.equal(await prisma.sourceAuthorityResolution.count(), rowsBefore, `${label} wrote a resolution`);
      assert.equal(
        await prisma.auditLog.count({ where: { action: constants.CURRICULUM_AUDIT_ACTIONS.authoringSourceAuthorityResolved } }),
        auditBefore, `${label} wrote an audit row`);
      const stateAfter = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: target.assessment.id } });
      assert.equal(stateAfter.revision, stateBefore.revision);
      assert.equal(stateAfter.editorialState, stateBefore.editorialState);
      assert.equal(stateAfter.approvedById, stateBefore.approvedById);
    }
    const ok = await adjudicateAll(target.assessment.id, crmAdmin.id);
    assert.equal(ok.created, 8);
  });

  await check("Q. §22 four-eyes is untouched by adjudication", async () => {
    const row = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: single.assessment.id } });
    assert.equal(row.editorialState, "approved");
    assert.equal(row.approvedById, reviewer.id, "still the original approver, never the adjudicator");
    assert.ok(row.approvedAt);
    const fresh = await buildLesson({ levelNumber: 28, variant: "matching" });
    const rev0 = (await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: fresh.assessment.id } })).revision;
    await lifecycle.submitForReview({ kind: "assessment", id: fresh.assessment.id, expectedRevision: rev0, actorId: admin.id });
    const rev1 = (await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: fresh.assessment.id } })).revision;
    await refusedWith(() => lifecycle.approveVersion({
      kind: "assessment", id: fresh.assessment.id, expectedRevision: rev1, actorId: admin.id, validationPassed: true,
    }), "AUTHORING_SELF_APPROVAL_FORBIDDEN");
  });

  await check("R. §23/§24 raw-vs-blocking and the fingerprints are unchanged", async () => {
    const rows = await prisma.sourceAuthorityResolution.findMany({
      where: { assessmentVersionId: single.assessment.id, supersededAt: null },
    });
    const first = authority.calculateAuthorityResolutionFingerprint(rows);
    assert.equal(authority.calculateAuthorityResolutionFingerprint([...rows].reverse()), first, "order independent");
    const video = await prisma.videoProductionVersion.findUniqueOrThrow({ where: { id: single.video.id } });
    assert.equal(video.sourceProvenance, "PROPOSED_CANON", "adjudication never rewrites provenance");
    // an unavailable source must not emit a lineage fingerprint tied to the wrong contract
    await withBrokenContract(single.video.id, { broken: true }, async () => {
      const got = await staffAuthorityGet(single.assessment.id);
      assert.equal(got.state, "SOURCE_UNAVAILABLE");
      assert.equal(got.videoProductionVersionId, single.video.id);
      assert.equal(got.comparable, false);
      assert.equal(got.blockingConflictCount, 0);
      assert.ok(got.decisions.every((d) => d.application === "STALE"),
        "no decision may be reported in force against a source we cannot read");
    });
  });

  await check("S. §26 the learner boundary exposes none of the new fields", async () => {
    const payload = await preview.buildLearnerPreviewPayload({
      levelDefinitionId: single.level.id,
      contentVersionId: single.content.id,
      assessmentVersionId: single.assessment.id,
    });
    preview.assertLearnerSafe(payload);
    const snapshot = await preview.createLevelPreviewSnapshot({
      levelDefinitionId: single.level.id, contentVersionId: single.content.id,
      assessmentVersionId: single.assessment.id, videoProductionVersionId: single.video.id, actorId: admin.id,
    });
    const learner = await preview.readLearnerPreview(snapshot.snapshotCode);
    assert.ok(learner);
    for (const text of [JSON.stringify(payload), JSON.stringify(learner)]) {
      for (const forbidden of [
        "sourceContractUnavailable", "sourceContractUnavailableReason", "SOURCE_UNAVAILABLE",
        "SOURCE_CONTRACT_UNPARSEABLE", "SOURCE_LINK_INCOMPATIBLE", "authorityReadUnavailable",
        "sourceLinked", "authorityResolution", "sourceAuthority", "canonicalLink",
        "resolutionFingerprint", "conflictPath", "evidenceSha256", "decidedById",
      ]) {
        assert.ok(!text.includes(forbidden), `learner payload leaked "${forbidden}"`);
      }
    }
    assert.equal(payload.assessment!.questions.length, 4, "the probe must exercise real content");
  });

  await check("T. §27 the new refusals map to structured staff errors, not stack traces", async () => {
    const http = await import("../../src/lib/curriculum/authoring-http");
    const errors = await import("../../src/lib/curriculum/authoring-errors");
    for (const code of ["AUTHORING_ASSESSMENT_LINK_INVALID", "AUTHORING_SOURCE_CONTRACT_UNREADABLE"] as const) {
      assert.equal(errors.authoringErrorStatus(code), 409, `${code} must be a 409 state refusal`);
      const response = http.authoringException(
        new errors.AuthoringDomainError(code, "message that must not leak internals"), "test",
      );
      assert.equal(response.status, 409);
      const body = (await response.json()) as { error: string; message?: string };
      assert.equal(body.error, code, "the code travels, and it is the only thing that does");
      assert.equal(body.message, undefined, "no internal message is serialised");
    }
  });

  await check("U. §12 there is no state where validation is healthy AND handoff succeeds on a broken source", async () => {
    await withBrokenContract(broken.video.id, { nope: 1 }, async () => {
      const report = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id, levelDefinitionId: broken.level.id,
      });
      const status = (await summaryFor(20)).status;
      let bundled = false;
      try {
        await handoffModule.buildHandoffBundle({ actorId: admin.id, curriculumVersionId: curriculum.id, levelNumbers: [20] });
        bundled = true;
      } catch {
        bundled = false;
      }
      assert.equal(bundled, false);
      assert.equal(report!.ok, false);
      assert.equal(status.ready, false);
    });
  });

  await check("V. the work queue files an unreadable source as its own job", async () => {
    await withBrokenContract(broken.video.id, { nope: 1 }, async () => {
      const overview = await read.readAuthoringOverview(curriculum.id);
      const entries = readiness.classifyWorkQueue(overview);
      const entry = entries.find((e) => e.levelNumber === 20);
      assert.ok(entry, "the broken level must appear in the queue");
      assert.equal(entry!.bucket, "SOURCE_UNAVAILABLE");
      assert.match(JSON.stringify(entry), /could not be parsed/i);
      assert.doesNotMatch(JSON.stringify(entry), /unadjudicated/i);
      const rollup = readiness.summarizeReadiness(overview);
      assert.ok(rollup.assessmentSourceUnavailableLevels >= 1);
      assert.ok(rollup.blockersByCode.ASSESSMENT_SOURCE_CONTRACT_UNREADABLE >= 1);
    });
  });

  console.log(`\nPHASE-G2 CORRECTION-2 source-authority: ${passed} passed, ${failed} failed`);
  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify({ suite: "source-authority-correction-2", passed, failed, results }, null, 2));
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
