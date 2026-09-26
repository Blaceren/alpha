/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CI-4 isolated Backend fixture & reviewer actor (runs under tsx in the RR-1
 * Backend worktree context — copied to `<backend>/tmp/` by run-report-e2e.sh).
 *
 * It NEVER runs against live DEV: DATABASE_URL is a fresh synthetic sqlite file
 * chosen by the harness. It authors the real approved rev3 L3 report definition
 * (43 fields, 5 requiredWhen), an R1–R7 review rubric + binding, publishes and
 * activates the pinned curriculum, and creates a login-capable synthetic learner
 * (L1/L2 completed, L3 available, no report, no XP) plus a mentor reviewer.
 *
 * Subcommands (the learner authors the report through the Academy UI; the mentor
 * actions run here as the "protected Backend fixture actor"):
 *   seed
 *   request-revision <learnerEmail>
 *   approve <learnerEmail>
 *   state <learnerEmail>            → JSON {l3Status, currentLevel, xpTransactions, reportStatus, submittedRevisions}
 *
 * All backend modules are loaded by ABSOLUTE dynamic import from CI4_BACKEND_REPO
 * so this file carries no static backend dependency (it typechecks in the Academy
 * repo but only executes inside the Backend).
 */
import fs from "node:fs";

const BE = process.env.CI4_BACKEND_REPO;
if (!BE) throw new Error("CI4_BACKEND_REPO is required");
const L3_CODE = "v2.l003.pervye-pyat-demo-sdelok";
const EXPECTED_FP = "860751bff541439ac76858c917ed2572e2b3e92b41109cfbea74122eb46625ad";
const PACKAGE = `${BE}/curriculum/packages/ata-v2-first-slice.rev3.approved.json`;
const PAST = new Date("2026-06-01T00:00:00.000Z");

const CRITERIA = ["r1-process", "r2-risk", "r3-discipline", "r4-evidence", "r5-reflection", "r6-accuracy", "r7-completeness"];

async function backend() {
  const prismaMod: any = await import(`${BE}/src/lib/prisma`);
  return prismaMod.prisma;
}

async function loadBcrypt(): Promise<any> {
  // Non-literal specifier so the Academy typechecker does not resolve it; tsx
  // resolves it from the Backend node_modules at runtime.
  const name = "bcryptjs";
  const mod: any = await import(name);
  return mod.default ?? mod;
}

function requireArg(arg: string | undefined): string {
  if (!arg) throw new Error("this subcommand requires an argument (learner email)");
  return arg;
}

function out(value: unknown): void {
  process.stdout.write(`CI4_JSON ${JSON.stringify(value)}\n`);
}

async function seed(): Promise<void> {
  const prisma = await backend();
  const importMod: any = await import(`${BE}/src/lib/curriculum/package/import`);
  const fpMod: any = await import(`${BE}/src/lib/curriculum/package/fingerprint`);
  const pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));

  const computed = fpMod.calculateFingerprint({ ...pkg, contentFingerprint: "0".repeat(64) });
  if (computed !== EXPECTED_FP) throw new Error(`fingerprint mismatch: ${computed}`);
  const result = await importMod.importCurriculumPackage(pkg, { db: prisma });
  if (!result.ok) throw new Error(`import failed: ${JSON.stringify(result)}`);

  const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2" } });
  const l3 = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: version.id, stableCode: L3_CODE } });
  if (l3.type !== "report" || l3.completionMethod !== "report_approval" || l3.xpReward !== 0) {
    throw new Error(`unexpected L3 shape: type=${l3.type} method=${l3.completionMethod} xp=${l3.xpReward}`);
  }
  const assignment = await prisma.reportAssignmentVersion.findFirstOrThrow({ where: { levelDefinitionId: l3.id } });
  const fieldCount = await prisma.reportFieldDefinition.count({ where: { reportAssignmentVersionId: assignment.id } });
  const conditional = await prisma.reportFieldDefinition.count({ where: { reportAssignmentVersionId: assignment.id, stableKey: { endsWith: "deviation-note" } } });
  if (fieldCount !== 43 || conditional !== 5) throw new Error(`unexpected definition: fields=${fieldCount} conditional=${conditional}`);

  // publish the imported assignment + author R1–R7 rubric/scale/reason + binding
  await prisma.reportAssignmentVersion.update({ where: { id: assignment.id }, data: { status: "published", publishedAt: new Date("2026-06-02T00:00:00.000Z") } });
  const rubric = await prisma.reportRubricVersion.create({ data: { reportAssignmentVersionId: assignment.id, versionNumber: 1, status: "published", publishedAt: new Date("2026-06-02T00:00:00.000Z") } });
  for (let i = 0; i < CRITERIA.length; i += 1) {
    const criterion = await prisma.reportRubricCriterion.create({ data: { reportRubricVersionId: rubric.id, stableKey: CRITERIA[i], categoryCode: `${CRITERIA[i]}-cat`, sortOrder: i, commentRequired: i === 0 } });
    await prisma.reportRubricCriterionLocalization.create({ data: { reportRubricCriterionId: criterion.id, locale: "ru", title: CRITERIA[i], description: `${CRITERIA[i]} d` } });
  }
  for (let i = 0; i < 2; i += 1) {
    const code = i === 0 ? "meets" : "revise";
    const scale = await prisma.reportRubricScaleOption.create({ data: { reportRubricVersionId: rubric.id, stableKey: code, ordinal: i } });
    await prisma.reportRubricScaleOptionLocalization.create({ data: { reportRubricScaleOptionId: scale.id, locale: "ru", label: code, description: `${code} d` } });
  }
  const reason = await prisma.reportRejectionReason.create({ data: { reportRubricVersionId: rubric.id, stableKey: "missing-evidence", sortOrder: 0, active: true } });
  await prisma.reportRejectionReasonLocalization.create({ data: { reportRejectionReasonId: reason.id, locale: "ru", title: "Недостаточно доказательств", guidance: "Добавьте детали" } });
  await prisma.levelReportBinding.create({ data: { levelDefinitionId: l3.id, curriculumVersionId: version.id, reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: 0 } });
  await prisma.curriculumVersion.update({ where: { id: version.id }, data: { status: "published", publishedAt: PAST, effectiveFrom: PAST } });

  out({ ok: true, l3: L3_CODE, fields: fieldCount, conditional });
  await prisma.$disconnect();
}

async function createLearner(email: string): Promise<void> {
  const prisma = await backend();
  const bcrypt: any = await loadBcrypt();
  const passwordHash = await bcrypt.hash(process.env.CI4_PASSWORD ?? "Test-Passw0rd", 10);
  const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2" } });
  const user = await prisma.user.upsert({ where: { email }, update: { passwordHash, status: "active" }, create: { email, name: email, passwordHash, role: "user", status: "active" } });
  const enrollment = await prisma.userCurriculumEnrollment.create({ data: { userId: user.id, curriculumVersionId: version.id, curriculumCode: "ata-v2", status: "active", enrolledAt: PAST, currentLevel: 3, highestCompletedLevel: 2, lastMeaningfulActionAt: PAST } });
  const levels = await prisma.levelDefinition.findMany({ where: { curriculumVersionId: version.id }, orderBy: { levelNumber: "asc" } });
  for (const lvl of levels.filter((l: any) => l.levelNumber < 3)) {
    await prisma.userLevelProgress.create({ data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: lvl.id, status: "completed", startedAt: PAST, lastProgressAt: PAST, completedAt: PAST, attemptCount: 1 } });
  }
  const l3 = levels.find((l: any) => l.stableCode === L3_CODE);
  await prisma.userLevelProgress.create({ data: { enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: l3.id, status: "in_progress", startedAt: PAST } });
  out({ ok: true, learner: email });
  await prisma.$disconnect();
}

async function createMentor(email: string): Promise<void> {
  const prisma = await backend();
  const bcrypt: any = await loadBcrypt();
  const passwordHash = await bcrypt.hash(process.env.CI4_PASSWORD ?? "Test-Passw0rd", 10);
  await prisma.user.upsert({ where: { email }, update: { passwordHash, status: "active", role: "mentor" }, create: { email, name: email, passwordHash, role: "mentor", status: "active" } });
  out({ ok: true, mentor: email });
  await prisma.$disconnect();
}

function textOfLength(min: number, max: number): string {
  // no spaces so the runtime trim() never shortens the value below `min`
  const target = Math.min(Math.max(min, 12), max);
  const base = "DurableDemoTradeReviewNarrativeConcreteDetailEvidence";
  let s = "";
  while (s.length < target) s += base;
  return s.slice(0, target);
}

/** Derive a fully valid value set from the REAL L3 definition (plan followed → no notes). */
async function emitValues(): Promise<void> {
  const prisma = await backend();
  const assignment = await prisma.reportAssignmentVersion.findFirstOrThrow({
    where: { level: { stableCode: L3_CODE } },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  }).catch(async () => {
    const l3 = await prisma.levelDefinition.findFirstOrThrow({ where: { stableCode: L3_CODE } });
    return prisma.reportAssignmentVersion.findFirstOrThrow({ where: { levelDefinitionId: l3.id }, include: { fields: { orderBy: { sortOrder: "asc" } } } });
  });
  const values: Record<string, unknown> = {};
  const planKeys: string[] = [];
  const noteKeys: string[] = [];
  for (const f of assignment.fields as any[]) {
    if (f.stableKey.endsWith("plan-followed")) planKeys.push(f.stableKey);
    if (f.stableKey.endsWith("deviation-note")) { noteKeys.push(f.stableKey); continue; } // optional when plan followed
    const rules = (f.validationRules ?? {}) as any;
    const choices = Array.isArray(f.choiceCodes) ? (f.choiceCodes as string[]) : [];
    const min = typeof rules.minLength === "number" ? rules.minLength : 0;
    const max = typeof rules.maxLength === "number" ? rules.maxLength : 4000;
    switch (f.type) {
      case "boolean": values[f.stableKey] = true; break;
      case "short_text":
      case "long_text": values[f.stableKey] = textOfLength(min, max); break;
      case "single_choice": values[f.stableKey] = choices[0] ?? "up"; break;
      case "multi_choice": values[f.stableKey] = choices.length ? [choices[0]] : []; break;
      case "integer": {
        const lo = typeof rules.minValue === "number" ? rules.minValue : 1;
        values[f.stableKey] = lo; break;
      }
      case "url": values[f.stableKey] = "https://example.com/evidence"; break;
      default: values[f.stableKey] = textOfLength(min, max);
    }
  }
  out({ ok: true, values, planKeys, noteKeys, noteSample: textOfLength(20, 400) });
  await prisma.$disconnect();
}

async function submissionFor(prisma: any, email: string) {
  const user = await prisma.user.findFirstOrThrow({ where: { email } });
  const enrollment = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: user.id } });
  const l3 = await prisma.levelDefinition.findFirstOrThrow({ where: { stableCode: L3_CODE } });
  const submission = await prisma.reportSubmission.findFirstOrThrow({ where: { enrollmentId: enrollment.id, levelDefinitionId: l3.id }, include: { submittedRevision: true } });
  return { user, enrollment, l3, submission };
}

function command(row: any, requestId: string) {
  return {
    submissionRef: Buffer.from(`report-submission:v1:${row.id}`, "utf8").toString("base64url"),
    requestId,
    expectedWorkflowVersion: row.workflowVersion,
    expectedClaimVersion: row.claimVersion,
    expectedSubmittedRevision: row.submittedRevision.revisionNumber,
  };
}

async function scoresFor(prisma: any): Promise<any[]> {
  const rubric = await prisma.reportRubricVersion.findFirstOrThrow({ where: { status: "published" }, include: { criteria: true } });
  return rubric.criteria.map((c: any) => ({ criterionCode: c.stableKey, scaleCode: "meets", ...(c.commentRequired ? { comment: "Достаточно доказательств." } : {}) }));
}

async function requestRevision(email: string): Promise<void> {
  const prisma = await backend();
  const review: any = await import(`${BE}/src/lib/curriculum/report-review`);
  const mentorEmail = process.env.CI4_MENTOR ?? "ci4-mentor@e2e.test";
  const mentor = await prisma.user.findFirstOrThrow({ where: { email: mentorEmail } });
  const { submission } = await submissionFor(prisma, email);
  await review.claimReportForReview(mentor.id, command(submission, `ci4-claim-rev-${Date.now()}`), { evaluationTime: new Date() });
  const claimed = (await submissionFor(prisma, email)).submission;
  await review.rejectReportSubmission(mentor.id, {
    ...command(claimed, `ci4-reject-${Date.now()}`),
    scores: await scoresFor(prisma),
    reasonCode: "missing-evidence",
    humanComment: "Добавьте разбор точки входа.",
    correctiveAction: "Опишите точку входа во второй сделке.",
  }, { evaluationTime: new Date() });
  out({ ok: true, action: "request-revision" });
  await prisma.$disconnect();
}

async function approve(email: string): Promise<void> {
  const prisma = await backend();
  const review: any = await import(`${BE}/src/lib/curriculum/report-review`);
  const mentorEmail = process.env.CI4_MENTOR ?? "ci4-mentor@e2e.test";
  const mentor = await prisma.user.findFirstOrThrow({ where: { email: mentorEmail } });
  const { submission } = await submissionFor(prisma, email);
  await review.claimReportForReview(mentor.id, command(submission, `ci4-claim-app-${Date.now()}`), { evaluationTime: new Date() });
  const claimed = (await submissionFor(prisma, email)).submission;
  const result = await review.approveReportSubmission(mentor.id, {
    ...command(claimed, `ci4-approve-${Date.now()}`),
    scores: await scoresFor(prisma),
  }, { evaluationTime: new Date() });
  out({ ok: true, action: "approve", xpAwarded: result.completion.xpAwarded, xpTransactionId: result.completion.xpTransactionId, nextLevelNumber: result.completion.nextLevelNumber });
  await prisma.$disconnect();
}

async function state(email: string): Promise<void> {
  const prisma = await backend();
  const { enrollment, l3 } = await submissionFor(prisma, email).catch(async () => {
    // no submission yet
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    const en = await prisma.userCurriculumEnrollment.findFirstOrThrow({ where: { userId: user.id } });
    const lvl = await prisma.levelDefinition.findFirstOrThrow({ where: { stableCode: L3_CODE } });
    return { enrollment: en, l3: lvl, submission: null as any };
  });
  const progress = await prisma.userLevelProgress.findFirstOrThrow({ where: { enrollmentId: enrollment.id, levelDefinitionId: l3.id } });
  const xp = await prisma.xPTransaction.count({ where: { enrollmentId: enrollment.id } });
  const submission = await prisma.reportSubmission.findFirst({ where: { enrollmentId: enrollment.id, levelDefinitionId: l3.id }, include: { revisions: true } });
  const submittedRevisions = submission ? submission.revisions.filter((r: any) => r.kind !== "draft_autosave").length : 0;
  out({ ok: true, l3Status: progress.status, currentLevel: enrollment.currentLevel, xpTransactions: xp, reportStatus: submission?.status ?? null, submittedRevisions });
  await prisma.$disconnect();
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "seed": return seed();
    case "emit-values": return emitValues();
    case "create-learner": return createLearner(requireArg(arg));
    case "create-mentor": return createMentor(requireArg(arg));
    case "request-revision": return requestRevision(requireArg(arg));
    case "approve": return approve(requireArg(arg));
    case "state": return state(requireArg(arg));
    default: throw new Error(`unknown subcommand: ${cmd}`);
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
