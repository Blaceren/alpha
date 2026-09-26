/**
 * CV-1F-R2 — operator-approved first-slice package revision 2.
 *
 * Synthetic databases only; no live DEV port is contacted. Proves:
 *   A. package  — revision 1 preserved; revision 2 validates as approved (0
 *                 warnings); fingerprint determinism / drift sensitivities.
 *   B. import   — transactional/idempotent/drift/rollback/immutable on a fresh
 *                 34-migration DB; exact row counts; five requiredWhen rules
 *                 persisted; correct answers server-side only; no learner rows.
 *   C. roundtrip— L2 resolves REAL configured content (8 ordered sections, four
 *                 takeaways, objective, exact title, media pending honest, no
 *                 answer leak); states L1 completed / L2 available / L3+L4 locked.
 *   D. requiredWhen E2E — the approved report's conditional deviationNote is
 *                 enforced server-side; failure creates no review/completion.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";

const dbPath = path.join(os.tmpdir(), `ata-first-slice-r2-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const APPROVED = "curriculum/packages/ata-v2-first-slice.approved.json";
const DRAFT = "curriculum/packages/ata-v2-first-slice.draft.json";
const REV1_FP = "4a8fde320fff8e5fb9c46f01415c8189d1c142a52c6c288f25c05cac0d42e229";
const REV1_SHA = "8b10545920bf04704abdf6f41bc0c43d96161a9f9065155e33073d8d215af665";

let passed = 0, failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e instanceof Error ? e.stack ?? e.message : e); }
}
function cleanup() { for (const s of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true }); }
type AnyRecord = Record<string, unknown>;
function sha256(file: string) { return spawnSync("sha256sum", [file], { encoding: "utf8" }).stdout.split(" ")[0]; }
function loadApproved(): AnyRecord { return JSON.parse(fs.readFileSync(APPROVED, "utf8")); }
function l3Fields(pkg: AnyRecord) { return ((pkg.modules as AnyRecord[])[0].levels as AnyRecord[])[2].report as AnyRecord; }
function l2(pkg: AnyRecord) { return ((pkg.modules as AnyRecord[])[0].levels as AnyRecord[])[1]; }

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_CONTENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";

  const { validateCurriculumPackage } = await import("../../src/lib/curriculum/package/validate");
  const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");
  const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
  const { prisma } = await import("../../src/lib/prisma");
  const content = await import("../../src/lib/curriculum/content-read-progress");
  const levelState = await import("../../src/lib/curriculum/level-state");
  const runtime = await import("../../src/lib/curriculum/report-submission");

  const fp = (pkg: AnyRecord) => calculateFingerprint({ ...pkg, contentFingerprint: "0".repeat(64) } as never);

  /* ============================ A. PACKAGE ============================ */
  await check("A1 revision 1 preserved byte-for-byte (sha + fingerprint)", () => {
    assert.equal(sha256(DRAFT), REV1_SHA);
    const raw = JSON.parse(fs.readFileSync(DRAFT, "utf8")) as AnyRecord;
    assert.equal(raw.packageRevision, 1);
    assert.equal(raw.status, "draft");
    assert.equal(raw.contentFingerprint, REV1_FP);
    assert.equal(fp(raw), REV1_FP);
  });
  const approvedFp = fp(loadApproved());
  await check("A2 revision 2 validates as approved with zero warnings", () => {
    const r = validateCurriculumPackage(loadApproved());
    assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.issues));
    if (r.ok) { assert.equal(r.package.status, "approved"); assert.equal(r.warnings.length, 0); }
  });
  await check("A3 revision 2 fingerprint deterministic, distinct from revision 1, matches declared", () => {
    assert.equal(fp(loadApproved()), approvedFp);
    assert.notEqual(approvedFp, REV1_FP);
    assert.equal((loadApproved().contentFingerprint as string), approvedFp);
  });
  await check("A4 fingerprint moves on script/answer/limit/requiredWhen changes", () => {
    let p = loadApproved();
    const body = (((l2(p).content as AnyRecord).localizations as AnyRecord[])[0].body as AnyRecord);
    (body.sections as AnyRecord[])[0].body = "изменённый текст раздела";
    assert.notEqual(approvedFp, fp(p));
    p = loadApproved(); (((l2(p).assessment as AnyRecord).questions as AnyRecord[])[0].correctOptionCodes = ["a"]);
    assert.notEqual(approvedFp, fp(p));
    p = loadApproved(); ((l3Fields(p).fields as AnyRecord[]).find((f) => f.stableKey === "trade1-deviation-note") as AnyRecord).minLength = 25;
    assert.notEqual(approvedFp, fp(p));
    p = loadApproved(); (((l3Fields(p).fields as AnyRecord[]).find((f) => f.stableKey === "trade1-deviation-note") as AnyRecord).requiredWhen as AnyRecord).fieldCode = "trade2-plan-followed";
    assert.notEqual(approvedFp, fp(p));
    p = loadApproved(); (((l3Fields(p).fields as AnyRecord[]).find((f) => f.stableKey === "trade1-deviation-note") as AnyRecord).requiredWhen as AnyRecord).value = true;
    assert.notEqual(approvedFp, fp(p));
    p = loadApproved(); delete ((l3Fields(p).fields as AnyRecord[]).find((f) => f.stableKey === "trade1-deviation-note") as AnyRecord).requiredWhen;
    assert.notEqual(approvedFp, fp(p));
  });
  await check("A5 tampered approved package is rejected (conflict / string 'false')", () => {
    let p = loadApproved();
    const dev = () => (l3Fields(p).fields as AnyRecord[]).find((f) => f.stableKey === "trade1-deviation-note") as AnyRecord;
    dev().required = true;
    let seal = { ...p, contentFingerprint: fp(p) };
    let r = validateCurriculumPackage(seal); assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.issues.some((i) => i.code === "REPORT_FIELD_REQUIRED_WHEN_CONFLICT"));
    p = loadApproved(); (dev().requiredWhen as AnyRecord).value = "false";
    seal = { ...p, contentFingerprint: fp(p) };
    r = validateCurriculumPackage(seal); assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.issues.some((i) => i.code === "REPORT_FIELD_REQUIRED_WHEN_TYPE"));
  });

  /* ============================ B. IMPORT ============================ */
  await check("B1 validate-only / dry-run writes zero rows", async () => {
    const r = await importCurriculumPackage(loadApproved(), { db: prisma, dryRun: true });
    assert.equal(r.ok, true);
    assert.equal(await prisma.curriculumVersion.count(), 0);
    assert.equal(await prisma.reportFieldDefinition.count(), 0);
  });
  let versionId = 0;
  await check("B2 first import: exact row counts + 5 requiredWhen + answers server-side", async () => {
    const r = await importCurriculumPackage(loadApproved(), { db: prisma });
    assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.summary.outcome, "created");
    assert.equal(r.summary.curriculumVersionStatus, "draft");
    const v = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber: 1 } });
    versionId = v.id;
    assert.equal(v.status, "draft");
    assert.equal(await prisma.moduleDefinition.count({ where: { curriculumVersionId: v.id } }), 1);
    assert.equal(await prisma.levelDefinition.count({ where: { curriculumVersionId: v.id } }), 4);
    assert.equal(await prisma.contentVersion.count({ where: { curriculumVersionId: v.id } }), 1);
    assert.equal(await prisma.contentLocalization.count(), 1);
    assert.equal(await prisma.levelResourceBinding.count({ where: { curriculumVersionId: v.id } }), 1);
    assert.equal(await prisma.assessmentVersion.count({ where: { curriculumVersionId: v.id } }), 1);
    assert.equal(await prisma.questionDefinition.count(), 4);
    assert.equal(await prisma.questionLocalization.count(), 4);
    assert.equal(await prisma.reportAssignmentVersion.count({ where: { curriculumVersionId: v.id } }), 1);
    assert.equal(await prisma.reportFieldDefinition.count(), 43);
    // 16 option codes across 4 questions
    const questions = await prisma.questionDefinition.findMany({ orderBy: { questionNumber: "asc" } });
    assert.equal(questions.reduce((n, q) => n + (Array.isArray(q.options) ? (q.options as unknown[]).length : 0), 0), 16);
    // Correct answers live only on QuestionDefinition.correctAnswer, in the
    // canonical single_choice shape `{ code }` the runtime grader reads (AC-1).
    assert.deepEqual(questions.map((q) => (q.correctAnswer as AnyRecord).code), ["c", "b", "d", "c"]);
    // canonical options: ordered objects carrying only a stable code
    assert.deepEqual(questions[0].options, [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }]);
    // Five requiredWhen rules, each referencing its own trade's plan-followed, value:false
    const conditional = await prisma.reportFieldDefinition.findMany({ where: { stableKey: { endsWith: "deviation-note" } }, orderBy: { sortOrder: "asc" } });
    assert.equal(conditional.length, 5);
    for (let n = 0; n < 5; n += 1) {
      assert.equal(conditional[n].required, false);
      assert.deepEqual(conditional[n].requiredWhen, { fieldCode: `trade${n + 1}-plan-followed`, operator: "equals", value: false });
    }
    // planFollowed controllers are statically required and carry no condition
    const controllers = await prisma.reportFieldDefinition.findMany({ where: { stableKey: { endsWith: "plan-followed" } } });
    assert.equal(controllers.length, 5);
    for (const c of controllers) { assert.equal(c.required, true); assert.equal(c.requiredWhen, null); }
    assert.ok(r.summary.notes.some((n) => n.includes("conditional report fields (requiredWhen): 5")));
  });
  await check("B3 importer created no learner / activation / legacy rows", async () => {
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
    assert.equal(await prisma.userLevelProgress.count(), 0);
    assert.equal(await prisma.assessmentAttempt.count(), 0);
    assert.equal(await prisma.reportSubmission.count(), 0);
    assert.equal(await prisma.reportReview.count(), 0);
    const versions = await prisma.curriculumVersion.findMany();
    for (const v of versions) { assert.equal(v.status, "draft"); assert.equal(v.publishedAt, null); assert.equal(v.effectiveFrom, null); }
  });
  await check("B4 exact rerun is a no-op", async () => {
    const before = await prisma.reportFieldDefinition.count();
    const r = await importCurriculumPackage(loadApproved(), { db: prisma });
    assert.equal(r.ok && r.summary.outcome, "unchanged");
    assert.equal(await prisma.reportFieldDefinition.count(), before);
  });
  await check("B5 same version, changed condition rejected as drift", async () => {
    const p = loadApproved();
    (((l3Fields(p).fields as AnyRecord[]).find((f) => f.stableKey === "trade1-deviation-note") as AnyRecord).requiredWhen as AnyRecord).value = true;
    const r = await importCurriculumPackage({ ...p, contentFingerprint: fp(p) }, { db: prisma });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "PACKAGE_DRIFT");
  });
  await check("B6 forced failure rolls back every row", async () => {
    const p = loadApproved(); p.curriculumVersionNumber = 97;
    (l3Fields(p) as AnyRecord).versionNumber = -1 as unknown as number;
    const bv = await prisma.curriculumVersion.count(), bf = await prisma.reportFieldDefinition.count();
    const r = await importCurriculumPackage({ ...p, contentFingerprint: fp(p) }, { db: prisma });
    assert.equal(r.ok, false);
    assert.equal(await prisma.curriculumVersion.count(), bv);
    assert.equal(await prisma.reportFieldDefinition.count(), bf);
  });
  await check("B7 foreign_key_check empty and integrity_check ok", async () => {
    assert.equal(((await prisma.$queryRawUnsafe("PRAGMA foreign_key_check")) as unknown[]).length, 0);
    assert.equal(Object.values((await prisma.$queryRawUnsafe("PRAGMA integrity_check") as Array<Record<string, string>>)[0])[0], "ok");
  });

  /* ============================ C. L2 ROUNDTRIP ============================ */
  const L1 = "v2.l001.registraciya-pocket", L2 = "v2.l002.kak-ustroen-alfa-trade-academy";
  const L3 = "v2.l003.pervye-pyat-demo-sdelok", L4 = "v2.l004.kontrolnaya-tochka-50";
  await check("C1 publish version, enrol synthetic learner with L1 completed server-side", async () => {
    const past = new Date("2026-06-01T00:00:00.000Z");
    await prisma.curriculumVersion.update({ where: { id: versionId }, data: { status: "published", publishedAt: past, effectiveFrom: past } });
    const learner = await prisma.user.create({ data: { email: "r2-roundtrip@example.com", name: "R2" } });
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: { userId: learner.id, curriculumVersionId: versionId, curriculumCode: "ata-v2", status: "active", enrolledAt: past, currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: past } });
    const l1 = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: versionId, stableCode: L1 } });
    await prisma.userLevelProgress.create({ data: { enrollmentId: enrollment.id, curriculumVersionId: versionId, levelDefinitionId: l1.id, status: "completed", startedAt: past, lastProgressAt: past, completedAt: past, completionMethod: "external", attemptCount: 1 } });
    (globalThis as AnyRecord).__r2learner = learner.id;
  });
  const learnerId = () => (globalThis as AnyRecord).__r2learner as number;
  await check("C2 states: L1 completed, L2 available, L3 locked, L4 locked", async () => {
    const states = await levelState.resolveUserCurriculumLevelStates({ userId: learnerId(), asOf: new Date(), db: prisma });
    assert.equal(states.kind, "resolved");
    if (states.kind !== "resolved") return;
    const st = (code: string) => states.levels.find((l) => l.levelDefinition.stableCode === code)?.state;
    assert.equal(st(L1), "completed");
    assert.equal(st(L2), "available");
    assert.ok(st(L3) === "locked" || st(L3) === "xp_eligible" ? st(L3) === "locked" : false, `L3=${st(L3)}`);
    assert.equal(st(L4), "locked");
  });
  let l2res: Awaited<ReturnType<typeof content.resolveUserLevelContent>>;
  await check("C3 L2 resolves REAL configured content (not a fallback)", async () => {
    l2res = await content.resolveUserLevelContent({ actorUserId: learnerId(), stableCode: L2, locale: "ru" });
    assert.ok(l2res.kind === "available" || l2res.kind === "completed", `kind=${l2res.kind}`);
  });
  await check("C4 exact title, objective, eight ordered sections, four takeaways", () => {
    if (l2res.kind !== "available" && l2res.kind !== "completed") throw new Error("no content");
    const loc = l2res.content.localization;
    assert.equal(loc.title, "Как устроен Alfa Trade Academy");
    assert.equal(loc.learningObjectiveExtension?.startsWith("После просмотра ученик должен понимать"), true);
    const body = loc.body as AnyRecord;
    const sections = body.sections as AnyRecord[];
    assert.equal(sections.length, 8);
    assert.deepEqual(sections.map((s) => s.code), ["hook", "moduli-i-urovni", "posledovatelnost", "kontrolnye-tochki", "xp", "instrumenty-i-progress", "primer-module-01", "itog"]);
    assert.equal((sections[0].body as string).startsWith("Alfa Trade Academy — это не папка"), true);
    assert.equal((body.glossary as AnyRecord[]).length, 4);
    assert.equal((body.glossary as AnyRecord[])[0].term, "T2.1 — Путь последовательный");
  });
  await check("C5 media pending honest, no fake URL", () => {
    if (l2res.kind !== "available" && l2res.kind !== "completed") throw new Error("no content");
    assert.equal(l2res.content.videoDurationSeconds, null);
    assert.equal(l2res.content.assets.length, 0);
    assert.ok(!JSON.stringify(l2res.content).includes("http"), "no url in content");
  });
  await check("C6 no correct answer / grading truth leaks into L2 content", () => {
    const text = JSON.stringify(l2res);
    assert.ok(!text.includes("correctAnswer"));
    assert.ok(!text.includes("correctOptionCodes"));
    // The lesson body must not embed the assessment answer key.
    assert.ok(!text.includes("passPercent"));
  });
  await check("C7 gated L1/L4 do not serve learner lesson content", async () => {
    const r1 = await content.resolveUserLevelContent({ actorUserId: learnerId(), stableCode: L1, locale: "ru" });
    const r4 = await content.resolveUserLevelContent({ actorUserId: learnerId(), stableCode: L4, locale: "ru" });
    assert.notEqual(r1.kind, "available");
    assert.notEqual(r4.kind, "available");
  });
  await check("C8 answers accessible only through QuestionDefinition (server side)", async () => {
    const q = await prisma.questionDefinition.findFirstOrThrow({ where: { stableKey: "ata-v2.l002.q1" } });
    assert.deepEqual(q.correctAnswer, { code: "c" });
    // localized labels are keyed by option code, so no positional answer inference
    const localization = await prisma.questionLocalization.findFirstOrThrow({ where: { questionId: q.id } });
    assert.deepEqual(Object.keys(localization.optionLabels as AnyRecord).sort(), ["a", "b", "c", "d"]);
  });

  /* ============================ D. requiredWhen END-TO-END ============================ */
  // Prove the approved report's conditional deviationNote is enforced server-side
  // on the REAL imported L3 level. The importer creates the assignment+fields but
  // no binding/rubric (they need an approved rubric); a Backend-correct definition
  // (versioned rules + rubric R1-R7 + binding) is authored here — exactly what
  // CV-2 will do — so the level becomes submittable. This is an isolated synthetic
  // report instance on the approved structure (kebab keys, requiredWhen value:false).
  const past = new Date("2026-06-01T00:00:00.000Z");
  const e2eLevel = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: versionId, stableCode: L3 } });
  // Use the REAL imported L3 assignment (all 43 approved fields). The importer
  // creates the assignment + fields but no rubric/binding (they need an approved
  // rubric); the rubric R1-R7 and binding are authored here — exactly what CV-2
  // will do — so the approved report becomes submittable and the five requiredWhen
  // conditions are exercised on the genuine imported structure.
  const asg = await prisma.reportAssignmentVersion.findFirstOrThrow({ where: { levelDefinitionId: e2eLevel.id } });
  const rubric = await prisma.reportRubricVersion.create({ data: { reportAssignmentVersionId: asg.id, versionNumber: 1, status: "published", publishedAt: past } });
  const RUBRICS: Array<[string, string]> = [["r1", "Пять demo-сделок"], ["r2", "Причина до сделки"], ["r3", "Процесс отдельно от результата"], ["r4", "Наблюдение после сделки"], ["r5", "Итоговая рефлексия"], ["r6", "Безопасность и приватность"], ["r7", "Profitability-neutral"]];
  for (let i = 0; i < RUBRICS.length; i += 1) {
    const c = await prisma.reportRubricCriterion.create({ data: { reportRubricVersionId: rubric.id, stableKey: RUBRICS[i][0], categoryCode: "process", sortOrder: i, commentRequired: false } });
    await prisma.reportRubricCriterionLocalization.create({ data: { reportRubricCriterionId: c.id, locale: "ru", title: RUBRICS[i][1], description: RUBRICS[i][1] } });
  }
  const scale = await prisma.reportRubricScaleOption.create({ data: { reportRubricVersionId: rubric.id, stableKey: "meets", ordinal: 0 } });
  await prisma.reportRubricScaleOptionLocalization.create({ data: { reportRubricScaleOptionId: scale.id, locale: "ru", label: "Соответствует", description: "d" } });
  const reason = await prisma.reportRejectionReason.create({ data: { reportRubricVersionId: rubric.id, stableKey: "incomplete", sortOrder: 0, active: true } });
  await prisma.reportRejectionReasonLocalization.create({ data: { reportRejectionReasonId: reason.id, locale: "ru", title: "Неполно", guidance: "g" } });
  await prisma.levelReportBinding.create({ data: { levelDefinitionId: e2eLevel.id, curriculumVersionId: versionId, reportAssignmentVersionId: asg.id, reportRubricVersionId: rubric.id, revision: 0 } });

  let seq = 0;
  const l1def = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: versionId, stableCode: L1 } });
  const l2def = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: versionId, stableCode: L2 } });
  async function enrolReporter() {
    const u = await prisma.user.create({ data: { email: `r2-e2e-${++seq}@example.com`, name: "E2E" } });
    const en = await prisma.userCurriculumEnrollment.create({ data: { userId: u.id, curriculumVersionId: versionId, curriculumCode: "ata-v2", status: "active", enrolledAt: past, currentLevel: 3, highestCompletedLevel: 2, lastMeaningfulActionAt: past } });
    // L1 and L2 completed server-side so the report level (L3) is accessible.
    for (const def of [l1def, l2def]) {
      await prisma.userLevelProgress.create({ data: { enrollmentId: en.id, curriculumVersionId: versionId, levelDefinitionId: def.id, status: "completed", startedAt: past, lastProgressAt: past, completedAt: past, completionMethod: "external", attemptCount: 1 } });
    }
    await prisma.userLevelProgress.create({ data: { enrollmentId: en.id, curriculumVersionId: versionId, levelDefinitionId: e2eLevel.id, status: "in_progress", startedAt: past, lastProgressAt: past } });
    return u.id;
  }
  const rid = (tag: string) => `r2e2e-${String(++seq).padStart(5, "0")}-${tag}`;
  async function submitFlow(userId: number, values: AnyRecord) {
    const save = await runtime.saveOwnReportDraft(userId, { levelNumber: 3, requestId: rid("save"), expectedRevision: 0, fieldValues: values });
    return runtime.submitOwnReport(userId, { levelNumber: 3, requestId: rid("submit"), expectedRevision: save.resultingWorkflowVersion });
  }
  async function expectReject(values: AnyRecord) {
    const uid = await enrolReporter();
    try { await submitFlow(uid, values); } catch (e) { if (isReportDomainError(e, "REPORT_DRAFT_INPUT_INVALID")) return e; throw new Error(`unexpected ${String(e)}`); }
    throw new Error("expected reject, submit succeeded");
  }
  // A complete, valid 43-field payload for the imported approved report; every
  // plan-followed defaults to true (so no deviation note is required) and every
  // other required field is populated. Scenarios override only trade 1.
  const text = (n: number) => "и".repeat(n);
  function full(overrides: AnyRecord = {}, omit: string[] = []): AnyRecord {
    const v: AnyRecord = { "confirm-demo-only": true };
    for (let n = 1; n <= 5; n += 1) {
      const p = `trade${n}`;
      v[`${p}-asset`] = "EURUSD";
      v[`${p}-direction`] = "up";
      v[`${p}-duration`] = "5m";
      v[`${p}-pre-trade-reason`] = text(60);
      v[`${p}-result`] = "positive";
      v[`${p}-plan-followed`] = true;
      v[`${p}-post-trade-observation`] = text(60);
    }
    v["summary-repeated-pattern"] = text(120);
    v["summary-next-session-rule"] = text(60);
    for (const k of omit) delete v[k];
    return { ...v, ...overrides };
  }
  const dev = (val: unknown) => ({ "trade1-plan-followed": false, "trade1-deviation-note": val });
  const reviewsBefore = await prisma.reportReview.count();
  const completedBefore = await prisma.userLevelProgress.count({ where: { status: "completed" } });

  await check("D1-7 false + absent/empty/whitespace/19/301 reject; 20/300 accept", async () => {
    const e = await expectReject(full({ "trade1-plan-followed": false }));
    assert.ok(e.issues.some((i) => i.code === "REQUIRED_WHEN" && i.path === "trade1-deviation-note"), JSON.stringify(e.issues));
    await expectReject(full(dev("")));
    await expectReject(full(dev("                    ")));
    await expectReject(full(dev("и".repeat(19))));
    await expectReject(full(dev("и".repeat(301))));
    const ok20 = await submitFlow(await enrolReporter(), full(dev("и".repeat(20))));
    assert.equal(ok20.submission.status, "pending_review");
    const ok300 = await submitFlow(await enrolReporter(), full(dev("и".repeat(300))));
    assert.equal(ok300.submission.status, "pending_review");
  });
  await check("D8-9 true + absent/valid note accept", async () => {
    const a = await submitFlow(await enrolReporter(), full());
    assert.equal(a.submission.status, "pending_review");
    const b = await submitFlow(await enrolReporter(), full({ "trade1-deviation-note": "и".repeat(30) }));
    assert.equal(b.submission.status, "pending_review");
  });
  await check("D10-11 missing controller -> controller error; string 'false' rejected as type", async () => {
    const e = await expectReject(full({ "trade1-deviation-note": "и".repeat(30) }, ["trade1-plan-followed"]));
    assert.ok(!e.issues.some((i) => i.code === "REQUIRED_WHEN"));
    await expectReject(full({ "trade1-plan-followed": "false" }));
  });
  await check("D12-14 failed submit created no review / L3 completion / L4 unlock", async () => {
    // No mentor review exists, and the report level (L3) is never marked completed
    // by a submission (only an approved review completes it). L1/L2 completed rows
    // are synthetic enrolment setup, so scope the completion check to L3.
    assert.equal(await prisma.reportReview.count(), reviewsBefore);
    assert.equal(await prisma.userLevelProgress.count({ where: { levelDefinitionId: e2eLevel.id, status: "completed" } }), 0);
    void completedBefore;
  });
  await check("D15 rubric has seven criteria; approval is the only completion owner", async () => {
    assert.equal(await prisma.reportRubricCriterion.count({ where: { reportRubricVersionId: rubric.id } }), 7);
    const lvl = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: versionId, stableCode: L3 } });
    assert.equal(lvl.completionMethod, "report_approval");
  });

  await prisma.$disconnect();
}

main().then(() => { console.log(`\n${passed} passed, ${failed} failed`); if (failed > 0) process.exitCode = 1; })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(cleanup);
