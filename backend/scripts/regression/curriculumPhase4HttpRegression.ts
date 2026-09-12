import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

const dbPath = `/tmp/ata-curriculum-phase4-http-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3970 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "Phase4Http123!";
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error instanceof Error ? error.message : error); }
}

function cleanup() { for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true }); }
const baseEnv: NodeJS.ProcessEnv = {
  ...process.env, DATABASE_URL: dbUrl, SESSION_SECRET: "phase4-http-session-secret",
  POSTBACK_SECRET: "phase4-http-postback-secret", APP_URL: baseUrl, STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref", EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of ["CURRICULUM_V2_ADMIN_ENABLED", "CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED", "CURRICULUM_V2_XP_ENABLED", "CURRICULUM_V2_CONTENT_ENABLED", "CURRICULUM_V2_ASSESSMENT_ENABLED", "NODE_ENV"]) delete baseEnv[key];

let logs = "";
async function start(flags: boolean) {
  const env = { ...baseEnv };
  if (flags) Object.assign(env, { CURRICULUM_V2_ADMIN_ENABLED: "true", CURRICULUM_V2_READ_ENABLED: "true", CURRICULUM_V2_ENROLLMENT_ENABLED: "true", CURRICULUM_V2_CONTENT_ENABLED: "true", CURRICULUM_V2_ASSESSMENT_ENABLED: "true" });
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], { cwd: process.cwd(), env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (value) => { logs += String(value); }); child.stderr?.on("data", (value) => { logs += String(value); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) { try { if ((await fetch(`${baseUrl}/api/health`)).ok) return child; } catch {} await new Promise((resolve) => setTimeout(resolve, 1000)); }
  throw new Error(`next dev failed to start\n${logs.slice(-4000)}`);
}
async function stop(child: ChildProcess | null) {
  if (!child?.pid) return; try { process.kill(-child.pid, "SIGTERM"); } catch {}
  const deadline = Date.now() + 15_000; while (Date.now() < deadline) { try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; } await new Promise((resolve) => setTimeout(resolve, 500)); }
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
}

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };
class Client {
  cookies = new Map<string, string>();
  async request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const response = await fetch(`${baseUrl}${url}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const raw of response.headers.getSetCookie()) { const pair = raw.split(";")[0]; const index = pair.indexOf("="); if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    const text = await response.text(); let value: unknown = {}; try { value = JSON.parse(text); } catch {}
    return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
  }
  login(email: string) { return this.request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" }); }
  async csrf() { const reply = await this.request("GET", "/api/csrf"); return String(reply.body.csrfToken); }
}
function noStore(reply: Reply) { assert.equal(reply.headers.get("cache-control"), "no-store"); }
function data(reply: Reply) { return reply.body.data as Record<string, unknown>; }
function contentBody() { return { sections: [{ code: "intro", title: "Intro", body: "Body" }], examples: [{ title: "Example", body: "Example body" }], commonMistakes: [{ mistake: "Mistake", correction: "Correction" }], glossary: [{ term: "Term", definition: "Definition" }], nextAction: { label: "Continue", body: "Continue body" }, riskDisclaimer: "Risk disclaimer" }; }

async function main() {
  cleanup(); let server: ChildProcess | null = null;
  try {
    const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);
    const admin = await prisma.user.create({ data: { email: "phase4-admin@example.com", name: "Admin", role: "admin", passwordHash: hash } });
    const user = await prisma.user.create({ data: { email: "phase4-user@example.com", name: "User", passwordHash: hash } });
    await prisma.user.create({ data: { email: "phase4-regular@example.com", name: "Regular", passwordHash: hash } });
    const curriculum = await prisma.curriculumVersion.create({ data: { code: "ata-v2", name: "Phase 4 HTTP", versionNumber: 1 } });
    const curriculumModule = await prisma.moduleDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "module-1", title: "Module", firstLevel: 1, lastLevel: 1, learningObjective: "Learn" } });
    const level = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: curriculumModule.id, levelNumber: 1, stableCode: "v2.l001.phase4-http", type: "lesson", title: "Level", learningObjective: "Learn", completionMethod: "assessment_pass", xpReward: 10 } });
    const root = `/api/admin/curriculum/versions/${curriculum.id}/levels/${level.id}`;

    server = await start(false);
    await check("1. profile flags fail closed before auth", async () => { const reply = await new Client().request("GET", `${root}/content-versions`); assert.equal(reply.status, 404); noStore(reply); });
    await check("2. self flags fail closed before auth", async () => { const reply = await new Client().request("GET", `/api/curriculum/v2/levels/${level.stableCode}/content?locale=en`); assert.equal(reply.status, 404); noStore(reply); });
    await stop(server); server = await start(true);

    await check("3. anonymous admin read is unauthorized and no-store", async () => { const reply = await new Client().request("GET", `${root}/content-versions`); assert.equal(reply.status, 401); noStore(reply); });
    const regular = new Client(); await regular.login("phase4-regular@example.com");
    await check("4. regular user cannot read admin content", async () => { const reply = await regular.request("GET", `${root}/content-versions`); assert.equal(reply.status, 403); noStore(reply); });
    const a = new Client(); assert.equal((await a.login(admin.email)).status, 200); const csrf = await a.csrf(); const h = { "x-csrf-token": csrf };
    await check("5. admin query is strict", async () => { const reply = await a.request("GET", `${root}/content-versions?extra=1`); assert.equal(reply.status, 400); noStore(reply); });
    await check("6. admin mutation requires CSRF", async () => { const reply = await a.request("POST", `${root}/content-versions`, {}); assert.equal(reply.status, 403); noStore(reply); });
    await check("7. nested content create is rejected", async () => { const reply = await a.request("POST", `${root}/content-versions`, { localizations: [] }, h); assert.equal(reply.status, 400); noStore(reply); });
    const createdContent = await a.request("POST", `${root}/content-versions`, { videoDurationSeconds: null, changeNotes: "draft" }, h); const contentId = Number(data(createdContent).id);
    await check("8. content draft is created through HTTP", () => { assert.equal(createdContent.status, 201); assert.ok(contentId > 0); noStore(createdContent); assert.equal("createdById" in data(createdContent), false); });
    await check("9. content list/detail are safe", async () => { const list = await a.request("GET", `${root}/content-versions`); const detail = await a.request("GET", `${root}/content-versions/${contentId}`); assert.equal(list.status, 200); assert.equal(detail.status, 200); assert.equal(/createdById|private storage/i.test(`${list.text}${detail.text}`), false); noStore(list); noStore(detail); });
    await check("10. content draft patch is strict", async () => { const reply = await a.request("PATCH", `${root}/content-versions/${contentId}`, { changeNotes: "updated" }, h); assert.equal(reply.status, 200); assert.equal(data(reply).changeNotes, "updated"); });
    const localization = await a.request("POST", `${root}/content-versions/${contentId}/localizations`, { locale: "en", title: "Lesson", subtitle: "", learningObjectiveExtension: "", summary: "Summary", transcript: null, body: contentBody() }, h);
    await check("11. localization child transaction is exposed", () => { assert.equal(localization.status, 201); assert.ok(Number(data(localization).id) > 0); });
    const asset = await a.request("POST", `${root}/content-versions/${contentId}/assets`, { kind: "attachment", assetCode: "guide", locale: "en", url: "https://example.com/guide.pdf", mimeType: "application/pdf", sizeBytes: 100, durationSeconds: null, checksum: null, sortOrder: 0 }, h);
    await check("12. asset child transaction is exposed", () => { assert.equal(asset.status, 201); assert.ok(Number(data(asset).id) > 0); });
    const publishedContent = await a.request("POST", `${root}/content-versions/${contentId}/publish`, { expectedPublishedContentVersionId: null }, h);
    await check("14. content publish CAS body succeeds", () => { assert.equal(publishedContent.status, 200); assert.equal((data(publishedContent).published as Record<string, unknown>).status, "published"); });
    const boundContent = await a.request("PUT", `${root}/content-binding`, { contentVersionId: contentId }, h);
    await check("13. exact content binding succeeds", () => { assert.equal(boundContent.status, 200); assert.equal(data(boundContent).contentVersionId, contentId); });

    const assessmentCreate = await a.request("POST", `${root}/assessment-versions`, { passPercent: 80, maxAttempts: 3, showExplanation: false, changeNotes: "draft" }, h); const assessmentId = Number(data(assessmentCreate).id);
    await check("15. assessment draft is created without nested questions", () => { assert.equal(assessmentCreate.status, 201); assert.ok(assessmentId > 0); });
    for (let index = 1; index <= 5; index += 1) {
      const q = await a.request("POST", `${root}/assessment-versions/${assessmentId}/questions`, { questionNumber: index, stableKey: `q-${index}`, type: "single_choice", skillTag: null, options: [{ code: "alpha" }, { code: "beta" }], correctAnswer: { code: "alpha" } }, h);
      assert.equal(q.status, 201); const questionId = Number(data(q).id);
      assert.equal(/"correctAnswer"\s*:/.test(q.text), false);
      const l = await a.request("POST", `${root}/assessment-versions/${assessmentId}/questions/${questionId}/localizations`, { locale: "en", prompt: `Question ${index}`, optionLabels: { alpha: "Alpha", beta: "Beta" }, explanation: "Private explanation" }, h);
      assert.equal(l.status, 201);
    }
    await check("16. assessment GET never exposes grading secrets", async () => { const reply = await a.request("GET", `${root}/assessment-versions/${assessmentId}`); assert.equal(reply.status, 200); assert.equal(/"correctAnswer"\s*:/.test(reply.text), false); assert.match(reply.text, /correctAnswerConfigured/); noStore(reply); });
    const publishedAssessment = await a.request("POST", `${root}/assessment-versions/${assessmentId}/publish`, { expectedPublishedAssessmentVersionId: null }, h);
    await check("18. assessment publish CAS succeeds", () => { assert.equal(publishedAssessment.status, 200); assert.equal((data(publishedAssessment).published as Record<string, unknown>).status, "published"); });
    const boundAssessment = await a.request("PUT", `${root}/assessment-binding`, { assessmentVersionId: assessmentId }, h);
    await check("17. assessment binding preserves content side", () => { assert.equal(boundAssessment.status, 200); assert.equal(data(boundAssessment).contentVersionId, contentId); });
    await check("19. archive rejects unknown keys", async () => { const reply = await a.request("POST", `${root}/assessment-versions/${assessmentId}/archive`, { unexpected: true }, h); assert.equal(reply.status, 400); });
    await check("20. content unbind preserves assessment side", async () => { const reply = await a.request("DELETE", `${root}/content-binding`, {}, h); assert.equal(reply.status, 200); const binding = (data(reply).binding as Record<string, unknown>); assert.equal(binding.assessmentVersionId, assessmentId); });
    await a.request("PUT", `${root}/content-binding`, { contentVersionId: contentId }, h);

    await stop(server); server = null;
    const now = new Date();
    await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "published", publishedAt: now, effectiveFrom: new Date(now.getTime() - 60_000) } });
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: { userId: user.id, curriculumVersionId: curriculum.id, curriculumCode: curriculum.code, currentLevel: 1 } });
    await prisma.userLevelProgress.create({ data: { enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: level.id, status: "in_progress", completionMethod: "assessment_pass" } });
    server = await start(true);
    const u = new Client(); await u.login(user.email); const userCsrf = await u.csrf(); const uh = { "x-csrf-token": userCsrf };
    await check("21. self content read uses pinned resolver", async () => { const reply = await u.request("GET", `/api/curriculum/v2/levels/${level.stableCode}/content?locale=en`); assert.equal(reply.status, 200, reply.text); assert.equal(data(reply).kind, "available"); noStore(reply); });
    await check("22. self content query rejects asOf and extras", async () => { const reply = await u.request("GET", `/api/curriculum/v2/levels/${level.stableCode}/content?locale=en&asOf=now`); assert.equal(reply.status, 400); });
    const progressBody = { expectedRevision: 0, playbackPositionSeconds: 10, completedSections: ["intro"], progressData: { activeSectionCode: "intro" } };
    const save = await u.request("PATCH", `/api/curriculum/v2/levels/${level.stableCode}/lesson-progress`, progressBody, { ...uh, "Idempotency-Key": "progress-http-0001" });
    await check("23. autosave accepts header idempotency and expectedRevision", () => { assert.equal(save.status, 200, save.text); assert.equal(data(save).applied, true); assert.equal(data(save).acceptedRevision, 1); });
    await check("24. autosave exact retry is distinguished", async () => { const reply = await u.request("PATCH", `/api/curriculum/v2/levels/${level.stableCode}/lesson-progress`, progressBody, { ...uh, "Idempotency-Key": "progress-http-0001" }); assert.equal(reply.status, 200, reply.text); assert.equal(data(reply).exactRetry, true); });
    await check("25. requestId in autosave body is rejected", async () => { const reply = await u.request("PATCH", `/api/curriculum/v2/levels/${level.stableCode}/lesson-progress`, { ...progressBody, requestId: "forbidden" }, { ...uh, "Idempotency-Key": "progress-http-0002" }); assert.equal(reply.status, 400); });
    const started = await u.request("POST", `/api/curriculum/v2/levels/${level.stableCode}/assessment/attempts`, { locale: "en" }, uh); assert.equal(started.status, 201, started.text); const attemptId = Number(((data(started).attempt as Record<string, unknown>).attemptId));
    await check("26. assessment start works without XP route gate", () => { assert.equal(started.status, 201); assert.ok(attemptId > 0); assert.equal(/correctAnswer|explanation|fingerprint/.test(started.text), false); });
    const answers = Array.from({ length: 5 }, (_, index) => ({ questionKey: `q-${index + 1}`, answer: { code: "beta" } }));
    const submitted = await u.request("POST", `/api/curriculum/v2/assessment/attempts/${attemptId}/submit`, { answers }, { ...uh, "Idempotency-Key": "submit-http-0001" });
    await check("27. failed grading completes while XP is off", () => { assert.equal(submitted.status, 200); assert.equal(data(submitted).status, "failed"); assert.equal(data(submitted).passed, false); assert.equal(/correctAnswer|explanation|submittedAnswers|fingerprint/.test(submitted.text), false); });
    await check("28. submit exact retry is safe", async () => { const reply = await u.request("POST", `/api/curriculum/v2/assessment/attempts/${attemptId}/submit`, { answers }, { ...uh, "Idempotency-Key": "submit-http-0001" }); assert.equal(reply.status, 200); assert.equal(data(reply).created, false); });
    await check("29. submit key conflict is rejected", async () => { const changed = answers.map((answer, index) => index === 0 ? { ...answer, answer: { code: "alpha" } } : answer); const reply = await u.request("POST", `/api/curriculum/v2/assessment/attempts/${attemptId}/submit`, { answers: changed }, { ...uh, "Idempotency-Key": "submit-http-0001" }); assert.equal(reply.status, 409); });
    await check("30. history is aggregate-only and no-store", async () => { const reply = await u.request("GET", "/api/curriculum/v2/assessment/attempts?limit=1"); assert.equal(reply.status, 200); assert.equal(/submittedAnswers|correctAnswer|explanation|fingerprint|XPTransaction/.test(reply.text), false); noStore(reply); });
    await check("31. history query is strict", async () => { const reply = await u.request("GET", "/api/curriculum/v2/assessment/attempts?limit=51"); assert.equal(reply.status, 400); });
    await check("32. no grading secret entered audit metadata", async () => { const rows = await prisma.auditLog.findMany({ where: { createdAt: { gte: new Date(now.getTime() - 60_000) } }, select: { metadata: true } }); assert.equal(/correctAnswer|Private explanation/.test(JSON.stringify(rows)), false); });
  } finally { await stop(server); const { prisma } = await import("../../src/lib/prisma"); await prisma.$disconnect(); cleanup(); }
  console.log(`\n${passed} passed, ${failed} failed`); if (failed) process.exit(1);
}
main().catch((error) => { console.error(error); cleanup(); process.exit(1); });
