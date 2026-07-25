import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

// Real HTTP regression for the Phase 5B.6 feature-gated report API. Runs an
// isolated next dev server against a throwaway /tmp SQLite database. Storage
// and antivirus use ONLY the guarded regression in-memory backend
// (REPORT_ATTACHMENT_TEST_BACKEND); no real S3/ClamAV endpoint is contacted.

const dbPath = `/tmp/ata-curriculum-report-api-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3930 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "ReportApi123!";
const INFECTED_MARKER = "ATA-TEST-INFECTED-MARKER";
const UNAVAILABLE_MARKER = "ATA-TEST-SCANNER-UNAVAILABLE-MARKER";
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (error) {
    failed += 1; console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    if (logs) console.error(`--- server log tail ---\n${logs.slice(-1500)}\n--- end server log tail ---`);
  }
}

function cleanup() { for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true }); }

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env, DATABASE_URL: dbUrl, SESSION_SECRET: "report-api-session-secret",
  POSTBACK_SECRET: "report-api-postback-secret", APP_URL: baseUrl, STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref", EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
  REPORT_ATTACHMENT_TEST_BACKEND: "unsafe-in-memory-regression-only",
};
for (const key of [
  "CURRICULUM_V2_ADMIN_ENABLED", "CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED", "CURRICULUM_V2_CONTENT_ENABLED", "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "CURRICULUM_V2_REPORT_ENABLED", "CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED",
  "REPORT_ATTACHMENT_S3_BUCKET", "REPORT_ATTACHMENT_S3_ENDPOINT", "REPORT_ATTACHMENT_CLAMAV_HOST",
  "NODE_ENV",
]) delete baseEnv[key];

let logs = "";
type Profile = "off" | "noxp" | "full";
async function start(profile: Profile) {
  const env = { ...baseEnv };
  if (profile !== "off") {
    Object.assign(env, {
      CURRICULUM_V2_ADMIN_ENABLED: "true", CURRICULUM_V2_READ_ENABLED: "true",
      CURRICULUM_V2_ENROLLMENT_ENABLED: "true", CURRICULUM_V2_REPORT_ENABLED: "true",
      CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED: "true",
    });
  }
  if (profile === "full") Object.assign(env, { CURRICULUM_V2_XP_ENABLED: "true" });
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], { cwd: process.cwd(), env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (value) => { logs += String(value); });
  child.stderr?.on("data", (value) => { logs += String(value); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) { try { if ((await fetch(`${baseUrl}/api/health`)).ok) return child; } catch { /* boot */ } await new Promise((resolve) => setTimeout(resolve, 1000)); }
  throw new Error(`next dev failed to start\n${logs.slice(-4000)}`);
}
async function stop(child: ChildProcess | null) {
  if (!child?.pid) return; try { process.kill(-child.pid, "SIGTERM"); } catch { /* gone */ }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; } await new Promise((resolve) => setTimeout(resolve, 500)); }
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
}

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };
class Client {
  cookies = new Map<string, string>();
  async raw(method: string, url: string, body: Buffer | string | undefined, headers: Record<string, string> = {}): Promise<Reply> {
    const payload: BodyInit | undefined = typeof body === "string" ? body : body ? new Uint8Array(body) : undefined;
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...headers },
      body: payload,
    });
    for (const rawCookie of response.headers.getSetCookie()) { const pair = rawCookie.split(";")[0]; const index = pair.indexOf("="); if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1)); }
    const text = await response.text();
    let value: unknown = {}; try { value = JSON.parse(text); } catch { /* binary/plain */ }
    return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
  }
  request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.raw(method, url, body !== undefined ? JSON.stringify(body) : undefined, { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers });
  }
  async download(url: string): Promise<{ status: number; headers: Headers; bytes: Buffer; text: string }> {
    const response = await fetch(`${baseUrl}${url}`, { headers: this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {} });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes, text: bytes.toString("latin1") };
  }
  login(email: string) { return this.request("POST", "/api/auth/login", { email, password, captchaToken: "dev-captcha-ok" }); }
  async csrf() { const reply = await this.request("GET", "/api/csrf"); return String(reply.body.csrfToken); }
}
function noStore(reply: { headers: Headers }) {
  const value = reply.headers.get("cache-control") ?? "";
  assert.ok(value.includes("no-store"), `expected no-store, got: ${value}`);
}
function data(reply: Reply) { return reply.body.data as Record<string, unknown>; }
function png(payload: string) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(payload, "utf8")]);
}

async function main() {
  cleanup();
  let server: ChildProcess | null = null;
  try {
    const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], { env: baseEnv, encoding: "utf8" });
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const hash = await bcrypt.hash(password, 10);
    const admin = await prisma.user.create({ data: { email: "report-admin@example.com", name: "Report Admin", role: "admin", passwordHash: hash } });
    const mentor1 = await prisma.user.create({ data: { email: "report-mentor1@example.com", name: "Mentor One", role: "mentor", passwordHash: hash } });
    const mentor2 = await prisma.user.create({ data: { email: "report-mentor2@example.com", name: "Mentor Two", role: "mentor", passwordHash: hash } });
    const owner = await prisma.user.create({ data: { email: "report-owner@example.com", name: "Owner User", passwordHash: hash } });
    await prisma.user.create({ data: { email: "report-support@example.com", name: "Support User", role: "support", passwordHash: hash } });
    await prisma.user.create({ data: { email: "report-user2@example.com", name: "Second User", passwordHash: hash } });
    const curriculum = await prisma.curriculumVersion.create({ data: { code: "ata-v2", name: "Report API", versionNumber: 1 } });
    const curriculumModule = await prisma.moduleDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "module-1", title: "Module", firstLevel: 1, lastLevel: 1, learningObjective: "Learn" } });
    const level = await prisma.levelDefinition.create({ data: { curriculumVersionId: curriculum.id, moduleId: curriculumModule.id, levelNumber: 1, stableCode: "v2.l001.report-api", type: "report", title: "Report Level", learningObjective: "Report", completionMethod: "report_approval", xpReward: 25 } });
    const adminRoot = `/api/admin/curriculum/versions/${curriculum.id}/levels/${level.id}`;
    const selfRoot = `/api/curriculum/v2/levels/${level.stableCode}/report`;
    const v1TaskCount = await prisma.task.count();
    const v1TaskReportCount = await prisma.taskReport.count();

    // ---- profile: every flag off -------------------------------------------
    server = await start("off");
    await check("1. admin report routes are 404 before auth while flags are off", async () => {
      const reply = await new Client().request("GET", `${adminRoot}/report-assignments`);
      assert.equal(reply.status, 404); assert.equal(reply.body.error, "NOT_FOUND"); noStore(reply);
    });
    await check("2. self report routes are 404 before auth while flags are off", async () => {
      const reply = await new Client().request("GET", `${selfRoot}?locale=en`);
      assert.equal(reply.status, 404); noStore(reply);
    });
    await check("3. reviewer routes are 404 before auth while flags are off", async () => {
      const queue = await new Client().request("GET", "/api/curriculum/v2/report-reviews/queue?locale=en");
      const command = await new Client().request("POST", "/api/curriculum/v2/report-submissions/AAAAAAAA/claim", {});
      assert.equal(queue.status, 404); assert.equal(command.status, 404); noStore(queue); noStore(command);
    });
    await check("4. attachment download is 404 before auth while flags are off", async () => {
      const reply = await new Client().request("GET", "/api/curriculum/v2/report-attachments/1");
      assert.equal(reply.status, 404); noStore(reply);
    });
    await stop(server); server = await start("noxp");

    // ---- admin authoring over HTTP (draft curriculum) ----------------------
    await check("5. anonymous admin read is 401; support role is 403", async () => {
      const anonymous = await new Client().request("GET", `${adminRoot}/report-assignments`);
      assert.equal(anonymous.status, 401); noStore(anonymous);
      const support = new Client(); await support.login("report-support@example.com");
      const forbidden = await support.request("GET", `${adminRoot}/report-assignments`);
      assert.equal(forbidden.status, 403); noStore(forbidden);
    });
    const a = new Client(); assert.equal((await a.login(admin.email)).status, 200);
    const adminCsrf = await a.csrf(); const ah = { "x-csrf-token": adminCsrf };
    await check("6. admin query is strict and mutations require CSRF", async () => {
      const query = await a.request("GET", `${adminRoot}/report-assignments?extra=1`);
      assert.equal(query.status, 400); noStore(query);
      const csrf = await a.request("POST", `${adminRoot}/report-assignments`, {});
      assert.equal(csrf.status, 403); noStore(csrf);
    });
    const createdAssignment = await a.request("POST", `${adminRoot}/report-assignments`, { changeNotes: "draft" }, ah);
    const assignmentId = Number(data(createdAssignment).id);
    await check("7. assignment draft is created without identity leakage", () => {
      assert.equal(createdAssignment.status, 201); assert.ok(assignmentId > 0); noStore(createdAssignment);
      assert.equal(/createdById|actorId|fingerprint/i.test(createdAssignment.text), false);
    });
    await check("8. unknown body keys and body actor identities are rejected", async () => {
      const unknown = await a.request("POST", `${adminRoot}/report-assignments`, { changeNotes: "x", surprise: true }, ah);
      assert.equal(unknown.status, 400);
      const actor = await a.request("POST", `${adminRoot}/report-assignments`, { actorId: 1 }, ah);
      assert.equal(actor.status, 400);
    });
    const assignmentRoot = `${adminRoot}/report-assignments/${assignmentId}`;
    await check("9. localization and structured fields are created over HTTP", async () => {
      const localization = await a.request("POST", `${assignmentRoot}/localizations`, { locale: "en", title: "Trade Report", instructions: "Describe the trade process.", successCriteriaSummary: "Process quality.", submitLabel: "Submit report" }, ah);
      assert.equal(localization.status, 201, localization.text);
      const summary = await a.request("POST", `${assignmentRoot}/fields`, { stableKey: "summary", type: "long_text", required: true, sortOrder: 1, validationRules: null, choiceCodes: null }, ah);
      assert.equal(summary.status, 201, summary.text);
      const notes = await a.request("POST", `${assignmentRoot}/fields`, { stableKey: "notes", type: "short_text", required: false, sortOrder: 2, validationRules: null, choiceCodes: null }, ah);
      assert.equal(notes.status, 201, notes.text);
      const fieldId = Number(data(summary).id);
      const fieldLocalization = await a.request("POST", `${assignmentRoot}/fields/${fieldId}/localizations`, { locale: "en", label: "Trade summary", helpText: "What happened and why.", placeholder: "", choiceLabels: null }, ah);
      assert.equal(fieldLocalization.status, 201, fieldLocalization.text);
      const notesLocalization = await a.request("POST", `${assignmentRoot}/fields/${Number(data(notes).id)}/localizations`, { locale: "en", label: "Notes", helpText: "", placeholder: "", choiceLabels: null }, ah);
      assert.equal(notesLocalization.status, 201, notesLocalization.text);
    });
    const createdRubric = await a.request("POST", `${assignmentRoot}/rubrics`, { changeNotes: "rubric" }, ah);
    const rubricId = Number(data(createdRubric).id);
    const rubricRoot = `${assignmentRoot}/rubrics/${rubricId}`;
    await check("10. rubric graph is created over HTTP", async () => {
      assert.equal(createdRubric.status, 201, createdRubric.text);
      for (const [index, key] of ["process-quality", "risk-discipline"].entries()) {
        const criterion = await a.request("POST", `${rubricRoot}/criteria`, { stableKey: key, categoryCode: "process", sortOrder: index + 1, commentRequired: false }, ah);
        assert.equal(criterion.status, 201, criterion.text);
        const localization = await a.request("POST", `${rubricRoot}/criteria/${Number(data(criterion).id)}/localizations`, { locale: "en", title: `Criterion ${key}`, description: "Judged on process, not outcome." }, ah);
        assert.equal(localization.status, 201, localization.text);
      }
      for (const [index, key] of ["below", "meets", "exceeds"].entries()) {
        const option = await a.request("POST", `${rubricRoot}/scale-options`, { stableKey: key, ordinal: index + 1 }, ah);
        assert.equal(option.status, 201, option.text);
        const localization = await a.request("POST", `${rubricRoot}/scale-options/${Number(data(option).id)}/localizations`, { locale: "en", label: `Scale ${key}`, description: "" }, ah);
        assert.equal(localization.status, 201, localization.text);
      }
      const reason = await a.request("POST", `${rubricRoot}/rejection-reasons`, { stableKey: "insufficient-detail", sortOrder: 1, active: true }, ah);
      assert.equal(reason.status, 201, reason.text);
      const reasonLocalization = await a.request("POST", `${rubricRoot}/rejection-reasons/${Number(data(reason).id)}/localizations`, { locale: "en", title: "Insufficient detail", guidance: "Add the missing process steps." }, ah);
      assert.equal(reasonLocalization.status, 201, reasonLocalization.text);
    });
    await check("11. rubric and assignment publish with exact CAS and binding", async () => {
      const publishedRubric = await a.request("POST", `${rubricRoot}/publish`, { expectedPublishedReportRubricVersionId: null }, ah);
      assert.equal(publishedRubric.status, 200, publishedRubric.text);
      assert.equal((data(publishedRubric).published as Record<string, unknown>).status, "published");
      const publishedAssignment = await a.request("POST", `${assignmentRoot}/publish`, { reportRubricVersionId: rubricId, expectedPublishedReportAssignmentVersionId: null }, ah);
      assert.equal(publishedAssignment.status, 200, publishedAssignment.text);
      const bound = await a.request("PUT", `${adminRoot}/report-binding`, { reportAssignmentVersionId: assignmentId, reportRubricVersionId: rubricId }, ah);
      assert.equal(bound.status, 200, bound.text);
      assert.equal(data(bound).reportRubricVersionId, rubricId);
    });
    await check("12. admin list/detail reads are safe, deterministic and no-store", async () => {
      const list = await a.request("GET", `${adminRoot}/report-assignments`);
      const detail = await a.request("GET", assignmentRoot);
      const rubricDetail = await a.request("GET", rubricRoot);
      assert.equal(list.status, 200); assert.equal(detail.status, 200); assert.equal(rubricDetail.status, 200);
      noStore(list); noStore(detail); noStore(rubricDetail);
      assert.equal(Array.isArray(data(list) as unknown), true);
      assert.equal((data(detail).binding as Record<string, unknown>).reportRubricVersionId, rubricId);
      assert.ok((data(detail).fields as unknown[]).length === 2);
      assert.ok((data(rubricDetail).criteria as unknown[]).length === 2);
      assert.equal(/createdById|passwordHash|fingerprint|receipt/i.test(`${list.text}${detail.text}${rubricDetail.text}`), false);
    });
    await check("13. foreign path identity is hidden as 404", async () => {
      const otherVersion = await prisma.curriculumVersion.create({ data: { code: "ata-v2-other", name: "Other", versionNumber: 2 } });
      const reply = await a.request("GET", `/api/admin/curriculum/versions/${otherVersion.id}/levels/${level.id}/report-assignments/${assignmentId}`);
      assert.equal(reply.status, 404); noStore(reply);
    });

    // ---- publish curriculum and enroll users -------------------------------
    await stop(server); server = null;
    const now = new Date();
    await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "published", publishedAt: now, effectiveFrom: new Date(now.getTime() - 60_000) } });
    for (const user of [owner, mentor2]) {
      const enrollment = await prisma.userCurriculumEnrollment.create({ data: { userId: user.id, curriculumVersionId: curriculum.id, curriculumCode: curriculum.code, currentLevel: 1 } });
      await prisma.userLevelProgress.create({ data: { enrollmentId: enrollment.id, curriculumVersionId: curriculum.id, levelDefinitionId: level.id, status: "in_progress", completionMethod: "report_approval" } });
    }
    server = await start("noxp");

    const u = new Client(); assert.equal((await u.login(owner.email)).status, 200);
    const userCsrf = await u.csrf(); const uh = { "x-csrf-token": userCsrf };
    const m1 = new Client(); await m1.login(mentor1.email); const m1Csrf = await m1.csrf(); const m1h = { "x-csrf-token": m1Csrf };
    const m2 = new Client(); await m2.login(mentor2.email); const m2Csrf = await m2.csrf(); const m2h = { "x-csrf-token": m2Csrf };
    const u2 = new Client(); await u2.login("report-user2@example.com"); const u2Csrf = await u2.csrf(); const u2h = { "x-csrf-token": u2Csrf };
    const aOn = new Client(); await aOn.login(admin.email); const aOnCsrf = await aOn.csrf(); const aOnH = { "x-csrf-token": aOnCsrf };

    await check("14. owner report read is localized, pinned and strict", async () => {
      const reply = await u.request("GET", `${selfRoot}?locale=en`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).kind, "available"); noStore(reply);
      const missingLocale = await u.request("GET", selfRoot);
      assert.equal(missingLocale.status, 400);
      const extra = await u.request("GET", `${selfRoot}?locale=en&asOf=now`);
      assert.equal(extra.status, 400);
    });
    await check("15. draft mutation demands CSRF and a valid Idempotency-Key", async () => {
      const noCsrf = await u.request("PUT", `${selfRoot}/draft`, { expectedRevision: 0, fieldValues: {} });
      assert.equal(noCsrf.status, 403);
      const noKey = await u.request("PUT", `${selfRoot}/draft`, { expectedRevision: 0, fieldValues: {} }, uh);
      assert.equal(noKey.status, 400);
      assert.equal(noKey.body.error, "REPORT_IDEMPOTENCY_KEY_INVALID");
    });
    await check("16. body-level actor or request identities are rejected", async () => {
      const withRequestId = await u.request("PUT", `${selfRoot}/draft`, { expectedRevision: 0, fieldValues: {}, requestId: "sneaky-request" }, { ...uh, "Idempotency-Key": "draft-api-0001" });
      assert.equal(withRequestId.status, 400);
      const withUserId = await u.request("PUT", `${selfRoot}/draft`, { expectedRevision: 0, fieldValues: {}, userId: 999 }, { ...uh, "Idempotency-Key": "draft-api-0001" });
      assert.equal(withUserId.status, 400);
    });
    const draftBody = { expectedRevision: 0, fieldValues: { summary: "Trade plan followed the checklist and risk was capped." } };
    const savedDraft = await u.request("PUT", `${selfRoot}/draft`, draftBody, { ...uh, "Idempotency-Key": "draft-api-0001" });
    await check("17. draft save, exact retry and key conflict behave durably", async () => {
      assert.equal(savedDraft.status, 200, savedDraft.text);
      assert.equal(data(savedDraft).kind, "saved");
      assert.equal(data(savedDraft).acceptedRevision, 1);
      const retry = await u.request("PUT", `${selfRoot}/draft`, draftBody, { ...uh, "Idempotency-Key": "draft-api-0001" });
      assert.equal(retry.status, 200); assert.equal(data(retry).retry, true);
      const conflict = await u.request("PUT", `${selfRoot}/draft`, { ...draftBody, fieldValues: { summary: "Changed." } }, { ...uh, "Idempotency-Key": "draft-api-0001" });
      assert.equal(conflict.status, 409);
    });

    // ---- attachment runtime over HTTP (mutable working set) ----------------
    const goodBytes = png("clean attachment payload for the report");
    const initiateGood = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "evidence.png", mimeType: "image/png", sizeBytes: goodBytes.byteLength }, { ...uh, "Idempotency-Key": "att-init-good" });
    const goodId = Number((data(initiateGood).attachment as Record<string, unknown>).attachmentId);
    await check("18. attachment initiate returns a private descriptor only", () => {
      assert.equal(initiateGood.status, 201, initiateGood.text);
      assert.ok(goodId > 0); noStore(initiateGood);
      assert.equal(/storageKey|bucket|ata-v2\/|checksum/i.test(initiateGood.text), false);
    });
    await check("19. finalize is a bounded raw backend-proxied upload", async () => {
      const finalize = await u.raw("POST", `${selfRoot}/attachments/${goodId}/finalize`, goodBytes, { ...uh, "Idempotency-Key": "att-fin-good" });
      assert.equal(finalize.status, 200, finalize.text);
      assert.equal((data(finalize).attachment as Record<string, unknown>).status, "available");
      const retry = await u.raw("POST", `${selfRoot}/attachments/${goodId}/finalize`, goodBytes, { ...uh, "Idempotency-Key": "att-fin-good" });
      assert.equal(retry.status, 200); assert.equal(data(retry).retry, true);
    });
    await check("20. infected upload is rejected and never becomes available", async () => {
      const bytes = png(`payload ${INFECTED_MARKER}`);
      const initiate = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "infected.png", mimeType: "image/png", sizeBytes: bytes.byteLength }, { ...uh, "Idempotency-Key": "att-init-bad" });
      assert.equal(initiate.status, 201, initiate.text);
      const id = Number((data(initiate).attachment as Record<string, unknown>).attachmentId);
      const finalize = await u.raw("POST", `${selfRoot}/attachments/${id}/finalize`, bytes, { ...uh, "Idempotency-Key": "att-fin-bad" });
      assert.equal(finalize.status, 422, finalize.text);
      assert.equal(finalize.body.error, "REPORT_ATTACHMENT_SCAN_REJECTED");
      const row = await prisma.reportAttachment.findUnique({ where: { id } });
      assert.equal(row?.status, "rejected");
      const download = await u.download(`/api/curriculum/v2/report-attachments/${id}`);
      assert.equal(download.status, 422);
    });
    let mismatchId = 0;
    await check("21. declared MIME must match magic bytes", async () => {
      const bytes = png("actually a png");
      const initiate = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "evidence.pdf", mimeType: "application/pdf", sizeBytes: bytes.byteLength }, { ...uh, "Idempotency-Key": "att-init-mime" });
      assert.equal(initiate.status, 201, initiate.text);
      mismatchId = Number((data(initiate).attachment as Record<string, unknown>).attachmentId);
      const finalize = await u.raw("POST", `${selfRoot}/attachments/${mismatchId}/finalize`, bytes, { ...uh, "Idempotency-Key": "att-fin-mime" });
      assert.equal(finalize.status, 415, finalize.text);
      assert.equal(finalize.body.error, "REPORT_ATTACHMENT_TYPE_INVALID");
    });
    let oversizedRowId = 0;
    await check("22. size limits fail closed at declaration and at the raw stream", async () => {
      const declared = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "big.png", mimeType: "image/png", sizeBytes: 11 * 1024 * 1024 }, { ...uh, "Idempotency-Key": "att-init-large" });
      assert.equal(declared.status, 413, declared.text);
      const initiate = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "stream.png", mimeType: "image/png", sizeBytes: 1_000 }, { ...uh, "Idempotency-Key": "att-init-stream" });
      assert.equal(initiate.status, 201, initiate.text);
      oversizedRowId = Number((data(initiate).attachment as Record<string, unknown>).attachmentId);
      const huge = Buffer.concat([png("start"), Buffer.alloc(11 * 1024 * 1024, 0x61)]);
      const finalize = await u.raw("POST", `${selfRoot}/attachments/${oversizedRowId}/finalize`, huge, { ...uh, "Idempotency-Key": "att-fin-stream" });
      assert.equal(finalize.status, 413, finalize.text);
      assert.equal(finalize.body.error, "REPORT_ATTACHMENT_TOO_LARGE");
    });
    await check("23. unsafe names are rejected before any row exists", async () => {
      const reply = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "../escape.png", mimeType: "image/png", sizeBytes: 100 }, { ...uh, "Idempotency-Key": "att-init-name" });
      assert.equal(reply.status, 422, reply.text);
      assert.equal(reply.body.error, "REPORT_ATTACHMENT_NAME_INVALID");
    });
    await check("24. scanner outage quarantines the upload with a retryable 503", async () => {
      const bytes = png(`payload ${UNAVAILABLE_MARKER}`);
      const initiate = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "pending.png", mimeType: "image/png", sizeBytes: bytes.byteLength }, { ...uh, "Idempotency-Key": "att-init-scan" });
      assert.equal(initiate.status, 201, initiate.text);
      const id = Number((data(initiate).attachment as Record<string, unknown>).attachmentId);
      const finalize = await u.raw("POST", `${selfRoot}/attachments/${id}/finalize`, bytes, { ...uh, "Idempotency-Key": "att-fin-scan" });
      assert.equal(finalize.status, 503, finalize.text);
      assert.equal(finalize.body.error, "REPORT_ATTACHMENT_SCANNER_UNAVAILABLE");
      const row = await prisma.reportAttachment.findUnique({ where: { id } });
      assert.equal(row?.status, "quarantined");
    });
    await check("25. per-revision count limit is enforced in the write path", async () => {
      // Terminal rejected rows no longer occupy the working set, so a fifth
      // live attachment is still allowed; the sixth must fail closed.
      const fifth = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "fifth.png", mimeType: "image/png", sizeBytes: 100 }, { ...uh, "Idempotency-Key": "att-init-fifth" });
      assert.equal(fifth.status, 201, fifth.text);
      const fifthId = Number((data(fifth).attachment as Record<string, unknown>).attachmentId);
      const sixth = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "sixth.png", mimeType: "image/png", sizeBytes: 100 }, { ...uh, "Idempotency-Key": "att-init-sixth" });
      assert.equal(sixth.status, 422, sixth.text);
      assert.equal(sixth.body.error, "REPORT_ATTACHMENT_COUNT_EXCEEDED");
      const removed = await u.request("DELETE", `${selfRoot}/attachments/${fifthId}`, {}, { ...uh, "Idempotency-Key": "att-del-fifth" });
      assert.equal(removed.status, 200, removed.text);
    });
    await check("26. attachment delete is durable and idempotent", async () => {
      const first = await u.request("DELETE", `${selfRoot}/attachments/${oversizedRowId}`, {}, { ...uh, "Idempotency-Key": "att-del-stream" });
      assert.equal(first.status, 200, first.text);
      assert.equal(data(first).created, true);
      const second = await u.request("DELETE", `${selfRoot}/attachments/${oversizedRowId}`, {}, { ...uh, "Idempotency-Key": "att-del-stream-2" });
      assert.equal(second.status, 200, second.text);
      assert.equal(data(second).created, false);
    });
    await check("27. owner download streams verified private bytes with safe headers", async () => {
      const reply = await u.download(`/api/curriculum/v2/report-attachments/${goodId}`);
      assert.equal(reply.status, 200);
      assert.equal(Buffer.compare(reply.bytes, goodBytes), 0);
      assert.equal(reply.headers.get("content-type"), "image/png");
      assert.equal(reply.headers.get("x-content-type-options"), "nosniff");
      assert.ok((reply.headers.get("content-disposition") ?? "").startsWith("attachment;"));
      const cache = reply.headers.get("cache-control") ?? "";
      assert.ok(cache.includes("private") && cache.includes("no-store"), cache);
      assert.equal(/ata-v2\/|storageKey|sha256:/i.test(reply.headers.get("content-disposition") ?? ""), false);
    });
    await check("28. foreign users cannot even observe the attachment", async () => {
      const foreign = await u2.download(`/api/curriculum/v2/report-attachments/${goodId}`);
      assert.equal(foreign.status, 404);
      const unclaimedReviewer = await m1.download(`/api/curriculum/v2/report-attachments/${goodId}`);
      assert.equal(unclaimedReviewer.status, 404);
    });

    // ---- submit and reviewer flow ------------------------------------------
    const submitted = await u.request("POST", `${selfRoot}/submit`, { expectedRevision: Number(data(savedDraft).resultingWorkflowVersion) }, { ...uh, "Idempotency-Key": "submit-api-0001" });
    await check("29. submit freezes the attachment set and the submission", async () => {
      assert.equal(submitted.status, 200, submitted.text);
      assert.equal(data(submitted).kind, "submitted");
      const frozenInitiate = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "late.png", mimeType: "image/png", sizeBytes: 100 }, { ...uh, "Idempotency-Key": "att-init-late" });
      assert.equal(frozenInitiate.status, 409, frozenInitiate.text);
      const frozenDelete = await u.request("DELETE", `${selfRoot}/attachments/${goodId}`, {}, { ...uh, "Idempotency-Key": "att-del-late" });
      assert.equal(frozenDelete.status, 409, frozenDelete.text);
    });
    // A second pending submission proves self-review masking and pagination.
    const mentor2SelfRoot = selfRoot;
    const m2Draft = await m2.request("PUT", `${mentor2SelfRoot}/draft`, { expectedRevision: 0, fieldValues: { summary: "Mentor two own trade report for self-review checks." } }, { ...m2h, "Idempotency-Key": "m2-draft-0001" });
    assert.equal(m2Draft.status, 200, m2Draft.text);
    const m2Submitted = await m2.request("POST", `${mentor2SelfRoot}/submit`, { expectedRevision: Number(data(m2Draft).resultingWorkflowVersion) }, { ...m2h, "Idempotency-Key": "m2-submit-0001" });
    assert.equal(m2Submitted.status, 200, m2Submitted.text);

    let ownerRef = "";
    await check("30. reviewer queue is role-gated, strict, localized and read-only", async () => {
      const support = new Client(); await support.login("report-support@example.com");
      assert.equal((await support.request("GET", "/api/curriculum/v2/report-reviews/queue?locale=en")).status, 403);
      assert.equal((await m1.request("GET", "/api/curriculum/v2/report-reviews/queue?locale=en&surprise=1")).status, 400);
      assert.equal((await m1.request("GET", "/api/curriculum/v2/report-reviews/queue")).status, 400);
      const submissionBefore = await prisma.reportSubmission.findFirst({ where: { userId: owner.id }, select: { id: true, updatedAt: true } });
      const auditCountBefore = await prisma.auditLog.count();
      const page = await m1.request("GET", "/api/curriculum/v2/report-reviews/queue?locale=en&limit=1");
      assert.equal(page.status, 200, page.text); noStore(page);
      assert.equal((data(page).items as unknown[]).length, 1);
      assert.ok(data(page).nextCursor);
      const full = await m1.request("GET", "/api/curriculum/v2/report-reviews/queue?locale=en");
      const items = data(full).items as Array<Record<string, unknown>>;
      const ownerItem = items.find((item) => (item.owner as Record<string, unknown>).displayName === "Owner User");
      assert.ok(ownerItem, full.text);
      ownerRef = String(ownerItem!.submissionRef);
      assert.equal(/storageKey|fingerprint|payloadFingerprint|checksum|passwordHash/i.test(full.text), false);
      const after = await prisma.reportSubmission.findFirst({ where: { userId: owner.id }, select: { updatedAt: true } });
      assert.equal(after?.updatedAt.toISOString(), submissionBefore?.updatedAt.toISOString());
      assert.equal(await prisma.auditLog.count(), auditCountBefore);
    });
    const detailUrl = `/api/curriculum/v2/report-submissions/${ownerRef}`;
    let versions = { expectedWorkflowVersion: 0, expectedClaimVersion: 0, expectedSubmittedRevision: 0 };
    await check("31. detail summary tier reveals CAS state but no payload before claim", async () => {
      const reply = await m1.request("GET", `${detailUrl}?locale=en`);
      assert.equal(reply.status, 200, reply.text); noStore(reply);
      const detail = data(reply);
      assert.equal(detail.access, "summary");
      assert.equal(detail.payload, null);
      versions = {
        expectedWorkflowVersion: Number(detail.workflowVersion),
        expectedClaimVersion: Number(detail.claimVersion),
        expectedSubmittedRevision: Number(detail.submittedRevision),
      };
      assert.equal(/Trade plan followed/i.test(reply.text), false);
    });
    await check("32. self-review is masked for the author-reviewer through HTTP", async () => {
      const queue = await m2.request("GET", "/api/curriculum/v2/report-reviews/queue?locale=en");
      const items = data(queue).items as Array<Record<string, unknown>>;
      assert.equal(items.some((item) => (item.owner as Record<string, unknown>).displayName === "Mentor Two"), false);
      const m2Ref = String((await prisma.reportSubmission.findFirst({ where: { userId: mentor2.id }, select: { id: true } }))!.id);
      const encoded = Buffer.from(`report-submission:v1:${m2Ref}`, "utf8").toString("base64url");
      const detail = await m2.request("GET", `/api/curriculum/v2/report-submissions/${encoded}?locale=en`);
      assert.equal(detail.status, 404);
      const claim = await m2.request("POST", `/api/curriculum/v2/report-submissions/${encoded}/claim`, { expectedWorkflowVersion: 2, expectedClaimVersion: 0, expectedSubmittedRevision: 2 }, { ...m2h, "Idempotency-Key": "m2-self-claim" });
      assert.equal(claim.status, 403);
      assert.equal(claim.body.error, "REPORT_SELF_REVIEW_FORBIDDEN");
    });
    await check("33. claim takes an exact 60-minute lease and races have one winner", async () => {
      const claimed = await m1.request("POST", `${detailUrl}/claim`, versions, { ...m1h, "Idempotency-Key": "m1-claim-0001" });
      assert.equal(claimed.status, 200, claimed.text);
      assert.equal((data(claimed).claim as Record<string, unknown>).state, "active");
      const competing = await m2.request("POST", `${detailUrl}/claim`, versions, { ...m2h, "Idempotency-Key": "m2-claim-0001" });
      assert.equal(competing.status, 409);
      versions = { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 };
    });
    await check("34. full detail is exclusive to the active claim owner", async () => {
      const full = await m1.request("GET", `${detailUrl}?locale=en`);
      assert.equal(full.status, 200, full.text);
      const detail = data(full);
      assert.equal(detail.access, "full");
      const payload = detail.payload as Record<string, unknown>;
      assert.equal((payload.revision as Record<string, unknown>).revisionNumber, versions.expectedSubmittedRevision);
      assert.ok(/Trade plan followed/.test(full.text));
      const attachments = payload.attachments as Array<Record<string, unknown>>;
      assert.equal(attachments.length, 1);
      assert.equal(attachments[0].attachmentId, goodId);
      assert.ok((payload.rejectionReasons as unknown[]).length >= 1);
      assert.equal(/storageKey|sha256:|checksum|scanReference/i.test(full.text), false);
      const other = await m2.request("GET", `${detailUrl}?locale=en`);
      assert.equal(data(other).access, "summary");
      assert.equal(data(other).payload, null);
    });
    await check("35. claim-gated reviewer attachment download works only for the owner of the claim", async () => {
      const allowed = await m1.download(`/api/curriculum/v2/report-attachments/${goodId}`);
      assert.equal(allowed.status, 200);
      assert.equal(Buffer.compare(allowed.bytes, goodBytes), 0);
      const denied = await m2.download(`/api/curriculum/v2/report-attachments/${goodId}`);
      assert.equal(denied.status, 404);
    });
    await check("36. start-review stamps once, retries exactly and conflicts on repeat", async () => {
      const started = await m1.request("POST", `${detailUrl}/start-review`, versions, { ...m1h, "Idempotency-Key": "m1-start-0001" });
      assert.equal(started.status, 200, started.text);
      assert.equal(data(started).operation, "start_review");
      const retry = await m1.request("POST", `${detailUrl}/start-review`, versions, { ...m1h, "Idempotency-Key": "m1-start-0001" });
      assert.equal(retry.status, 200); assert.equal(data(retry).retry, true);
      assert.equal(data(retry).appliedAt, data(started).appliedAt);
      const repeat = await m1.request("POST", `${detailUrl}/start-review`, { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 }, { ...m1h, "Idempotency-Key": "m1-start-0002" });
      assert.equal(repeat.status, 409);
      assert.equal(repeat.body.error, "REPORT_NO_CHANGES");
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_REVIEW_STARTED" } }), 1);
      versions = { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 };
    });
    await check("37. renew preserves reviewStartedAt; release clears it atomically", async () => {
      const renewed = await m1.request("POST", `${detailUrl}/renew`, versions, { ...m1h, "Idempotency-Key": "m1-renew-0001" });
      assert.equal(renewed.status, 200, renewed.text);
      versions = { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 };
      const afterRenew = await m1.request("GET", `${detailUrl}?locale=en`);
      assert.ok(data(afterRenew).reviewStartedAt, afterRenew.text);
      const released = await m1.request("POST", `${detailUrl}/release`, versions, { ...m1h, "Idempotency-Key": "m1-release-0001" });
      assert.equal(released.status, 200, released.text);
      versions = { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 };
      const row = await prisma.reportSubmission.findFirst({ where: { userId: owner.id }, select: { claimedById: true, reviewStartedAt: true } });
      assert.equal(row?.claimedById, null);
      assert.equal(row?.reviewStartedAt, null);
    });
    await check("38. reassignment is admin-only, reasoned and lease-resetting", async () => {
      const claimed = await m2.request("POST", `${detailUrl}/claim`, versions, { ...m2h, "Idempotency-Key": "m2-claim-0002" });
      assert.equal(claimed.status, 200, claimed.text);
      versions = { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 };
      const mentorReassign = await m1.request("POST", `${detailUrl}/reassign`, { ...versions, targetReviewerId: mentor1.id, reasonCode: "workload_rebalance" }, { ...m1h, "Idempotency-Key": "m1-reassign-0001" });
      assert.equal(mentorReassign.status, 403);
      const badReason = await aOn.request("POST", `${detailUrl}/reassign`, { ...versions, targetReviewerId: mentor1.id, reasonCode: "because" }, { ...aOnH, "Idempotency-Key": "a-reassign-0000" });
      assert.equal(badReason.status, 400);
      const reassigned = await aOn.request("POST", `${detailUrl}/reassign`, { ...versions, targetReviewerId: mentor1.id, reasonCode: "workload_rebalance" }, { ...aOnH, "Idempotency-Key": "a-reassign-0001" });
      assert.equal(reassigned.status, 200, reassigned.text);
      versions = { ...versions, expectedWorkflowVersion: versions.expectedWorkflowVersion + 1, expectedClaimVersion: versions.expectedClaimVersion + 1 };
      const row = await prisma.reportSubmission.findFirst({ where: { userId: owner.id }, select: { claimedById: true, reviewStartedAt: true } });
      assert.equal(row?.claimedById, mentor1.id);
      assert.equal(row?.reviewStartedAt, null);
    });
    await check("39. approve of a positive-reward level while XP is off fails closed like a missing route", async () => {
      // The XP flag is no longer a blanket reviewer-gate precondition (RR-1):
      // a zero-reward level approves without it. This level carries a positive
      // reward (xpReward 25), so the completion primitive still requires the XP
      // flag and the approval fails closed. With valid pinned evidence the domain
      // reaches completion, maps COMPLETION_DISABLED to REPORT_DISABLED (404) and
      // rolls the whole transaction back, leaving nothing durable.
      const validScores = [
        { criterionCode: "process-quality", scaleCode: "meets" },
        { criterionCode: "risk-discipline", scaleCode: "below" },
      ];
      const reply = await m1.request("POST", `${detailUrl}/approve`, { ...versions, scores: validScores }, { ...m1h, "Idempotency-Key": "m1-approve-early" });
      assert.equal(reply.status, 404); noStore(reply);
      const row = await prisma.reportSubmission.findFirst({ where: { userId: owner.id }, select: { status: true } });
      assert.equal(row?.status, "pending_review");
      assert.equal(await prisma.reportReview.count(), 0);
    });
    await check("40. rejection demands complete pinned evidence and reason", async () => {
      const scores = [
        { criterionCode: "process-quality", scaleCode: "meets" },
        { criterionCode: "risk-discipline", scaleCode: "below" },
      ];
      const missingReason = await m1.request("POST", `${detailUrl}/reject`, { ...versions, scores, reasonCode: "unknown-reason", humanComment: "Missing detail.", correctiveAction: "Add steps." }, { ...m1h, "Idempotency-Key": "m1-reject-0000" });
      assert.equal([404, 422].includes(missingReason.status), true, missingReason.text);
      const incomplete = await m1.request("POST", `${detailUrl}/reject`, { ...versions, scores: scores.slice(0, 1), reasonCode: "insufficient-detail", humanComment: "Missing detail.", correctiveAction: "Add steps." }, { ...m1h, "Idempotency-Key": "m1-reject-0001" });
      assert.equal(incomplete.status, 422, incomplete.text);
      const rejected = await m1.request("POST", `${detailUrl}/reject`, { ...versions, scores, reasonCode: "insufficient-detail", humanComment: "Add the exit reasoning.", correctiveAction: "Describe the exit decision process." }, { ...m1h, "Idempotency-Key": "m1-reject-0002" });
      assert.equal(rejected.status, 200, rejected.text);
      assert.equal(data(rejected).operation, "reject");
    });
    await check("41. owner sees only the approved user-facing rejection feedback", async () => {
      const reply = await u.request("GET", `${selfRoot}?locale=en`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).kind, "rejected");
      const submission = data(reply).submission as Record<string, unknown>;
      const rejection = submission.rejection as Record<string, unknown>;
      assert.equal(rejection.reasonCode, "insufficient-detail");
      assert.equal(rejection.reasonTitle, "Insufficient detail");
      assert.ok(String(rejection.correctiveAction).length > 0);
      assert.equal(/Mentor One|reviewerId|claimedById|scaleCode/i.test(reply.text), false);
    });
    await check("42. owner revision history is bounded, immutable and private", async () => {
      const list = await u.request("GET", `${selfRoot}/revisions?locale=en&limit=1`);
      assert.equal(list.status, 200, list.text); noStore(list);
      assert.equal((data(list).revisions as unknown[]).length, 1);
      assert.equal(data(list).nextCursor, 1);
      const rest = await u.request("GET", `${selfRoot}/revisions?locale=en&cursor=1`);
      const kinds = (data(rest).revisions as Array<Record<string, unknown>>).map((item) => item.kind);
      assert.deepEqual(kinds, ["initial_submission"]);
      const badQuery = await u.request("GET", `${selfRoot}/revisions?locale=en&limit=51`);
      assert.equal(badQuery.status, 400);
      const detail = await u.request("GET", `${selfRoot}/revisions/2?locale=en`);
      assert.equal(detail.status, 200, detail.text);
      const revision = data(detail).revision as Record<string, unknown>;
      assert.equal(revision.kind, "initial_submission");
      assert.ok(/Trade plan followed/.test(detail.text));
      assert.equal((revision.feedback as Record<string, unknown>).reasonCode, "insufficient-detail");
      assert.equal((revision.attachments as Array<Record<string, unknown>>)[0].attachmentId, goodId);
      assert.equal(/storageKey|sha256:|payloadFingerprint|claimedById|Mentor One/i.test(detail.text), false);
      const missing = await u.request("GET", `${selfRoot}/revisions/99?locale=en`);
      assert.equal(missing.status, 404);
      const foreign = await u2.request("GET", `${selfRoot}/revisions?locale=en`);
      assert.equal(foreign.status, 409);
      assert.equal(foreign.body.error, "REPORT_NOT_ENROLLED");
    });
    let correctionWorkflow = 0;
    await check("43. correction, new attachment and resubmit reopen the workflow", async () => {
      const ownRead = await u.request("GET", `${selfRoot}?locale=en`);
      const workflowVersion = Number((data(ownRead).submission as Record<string, unknown>).workflowVersion);
      const corrected = await u.request("PUT", `${selfRoot}/draft`, { expectedRevision: workflowVersion, fieldValues: { summary: "Trade plan followed the checklist; exit reasoning is now documented." } }, { ...uh, "Idempotency-Key": "draft-api-0002" });
      assert.equal(corrected.status, 200, corrected.text);
      const bytes = png("second round attachment");
      const initiate = await u.request("POST", `${selfRoot}/attachments/initiate`, { fileName: "exit-chart.png", mimeType: "image/png", sizeBytes: bytes.byteLength }, { ...uh, "Idempotency-Key": "att-init-round2" });
      assert.equal(initiate.status, 201, initiate.text);
      const roundTwoId = Number((data(initiate).attachment as Record<string, unknown>).attachmentId);
      const finalize = await u.raw("POST", `${selfRoot}/attachments/${roundTwoId}/finalize`, bytes, { ...uh, "Idempotency-Key": "att-fin-round2" });
      assert.equal(finalize.status, 200, finalize.text);
      const resubmitted = await u.request("POST", `${selfRoot}/resubmit`, { expectedRevision: Number(data(corrected).resultingWorkflowVersion) }, { ...uh, "Idempotency-Key": "resubmit-api-0001" });
      assert.equal(resubmitted.status, 200, resubmitted.text);
      assert.equal(data(resubmitted).kind, "resubmitted");
      correctionWorkflow = Number(data(resubmitted).resultingWorkflowVersion);
      assert.ok(correctionWorkflow > 0);
    });
    await check("44. actor rate limit shields report mutations behind one shared bucket", async () => {
      let limited = 0;
      for (let index = 0; index < 101; index += 1) {
        const reply = await u2.request("PUT", `${selfRoot}/draft`, undefined, {});
        if (reply.status === 429) { limited = index + 1; break; }
        assert.equal(reply.status, 403);
      }
      assert.ok(limited > 0 && limited <= 101, `rate limit never engaged (${limited})`);
    });
    await check("45. unexpected internal failures stay sanitized", async () => {
      // An exclusive lock held by another connection makes the server-side
      // write transaction exhaust its bounded retries; the response must stay
      // a generic sanitized 500 with no driver, path or SQL detail.
      const Database = (await import("better-sqlite3")).default;
      const lock = new Database(dbPath);
      try {
        // IMMEDIATE takes the write lock while leaving reads (sessions)
        // functional, so only the report mutation path fails.
        lock.exec("BEGIN IMMEDIATE;");
        const reply = await u.request("PUT", `${selfRoot}/draft`, { expectedRevision: correctionWorkflow, fieldValues: { summary: "Locked database write attempt." } }, { ...uh, "Idempotency-Key": "draft-api-oops" });
        assert.equal(reply.status, 500, reply.text);
        assert.equal(reply.body.error, "REPORT_INTERNAL_ERROR");
        assert.equal(/prisma|sqlite|locked|busy|\/tmp\//i.test(reply.text), false, reply.text);
        noStore(reply);
      } finally {
        try { lock.exec("ROLLBACK;"); } catch { /* not open */ }
        lock.close();
      }
    });
    await check("46. no V1, notification or CRM side effects and no payload in audits", async () => {
      assert.equal(await prisma.task.count(), v1TaskCount);
      assert.equal(await prisma.taskReport.count(), v1TaskReportCount);
      assert.equal(await prisma.xPTransaction.count(), 0);
      const audits = await prisma.auditLog.findMany({ select: { metadata: true } });
      const text = JSON.stringify(audits);
      assert.equal(/Trade plan followed|evidence\.png|ata-v2\/report-attachments|sha256:[a-f0-9]{64}/.test(text), false);
    });
    await check("47. report routes contain no inline Prisma access", () => {
      const roots = [
        path.join("src", "app", "api", "admin", "curriculum", "versions", "[id]", "levels", "[levelId]", "report-assignments"),
        path.join("src", "app", "api", "admin", "curriculum", "versions", "[id]", "levels", "[levelId]", "report-binding"),
        path.join("src", "app", "api", "curriculum", "v2", "levels", "[stableCode]", "report"),
        path.join("src", "app", "api", "curriculum", "v2", "report-reviews"),
        path.join("src", "app", "api", "curriculum", "v2", "report-submissions"),
        path.join("src", "app", "api", "curriculum", "v2", "report-attachments"),
      ];
      let files = 0;
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name === "route.ts") {
            files += 1;
            const content = fs.readFileSync(full, "utf8");
            assert.equal(/@\/lib\/prisma|prisma\.|PrismaClient/.test(content), false, full);
            assert.ok(content.includes("@/lib/curriculum/report-routes"), full);
          }
        }
      };
      for (const root of roots) walk(root);
      assert.equal(files, 46);
    });

    // ---- profile: full flags (XP on) ---------------------------------------
    await stop(server); server = await start("full");
    const uF = new Client(); await uF.login(owner.email);
    const m1F = new Client(); await m1F.login(mentor1.email); const m1FCsrf = await m1F.csrf(); const m1Fh = { "x-csrf-token": m1FCsrf };
    let approveResult: Reply | null = null;
    let approveVersions = { expectedWorkflowVersion: 0, expectedClaimVersion: 0, expectedSubmittedRevision: 0 };
    await check("48. atomic approve pays exact XP and completes the level", async () => {
      const summary = await m1F.request("GET", `${detailUrl}?locale=en`);
      assert.equal(summary.status, 200, summary.text);
      approveVersions = {
        expectedWorkflowVersion: Number(data(summary).workflowVersion),
        expectedClaimVersion: Number(data(summary).claimVersion),
        expectedSubmittedRevision: Number(data(summary).submittedRevision),
      };
      const claimed = await m1F.request("POST", `${detailUrl}/claim`, approveVersions, { ...m1Fh, "Idempotency-Key": "m1-claim-final" });
      assert.equal(claimed.status, 200, claimed.text);
      approveVersions = { ...approveVersions, expectedWorkflowVersion: approveVersions.expectedWorkflowVersion + 1, expectedClaimVersion: approveVersions.expectedClaimVersion + 1 };
      const scores = [
        { criterionCode: "process-quality", scaleCode: "meets" },
        { criterionCode: "risk-discipline", scaleCode: "exceeds" },
      ];
      approveResult = await m1F.request("POST", `${detailUrl}/approve`, { ...approveVersions, scores }, { ...m1Fh, "Idempotency-Key": "m1-approve-final" });
      assert.equal(approveResult.status, 200, approveResult.text);
      const completion = (data(approveResult).completion as Record<string, unknown>);
      assert.equal(completion.xpAwarded, 25);
      assert.equal(await prisma.xPTransaction.count(), 1);
      const progress = await prisma.userLevelProgress.findFirst({ where: { enrollmentId: (await prisma.userCurriculumEnrollment.findFirst({ where: { userId: owner.id } }))!.id } });
      assert.equal(progress?.status, "completed");
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_APPROVED" } }), 1);
    });
    await check("49. approve exact retry returns the durable result without new XP", async () => {
      const scores = [
        { criterionCode: "process-quality", scaleCode: "meets" },
        { criterionCode: "risk-discipline", scaleCode: "exceeds" },
      ];
      const retry = await m1F.request("POST", `${detailUrl}/approve`, { ...approveVersions, scores }, { ...m1Fh, "Idempotency-Key": "m1-approve-final" });
      assert.equal(retry.status, 200, retry.text);
      assert.equal(data(retry).retry, true);
      assert.equal(data(retry).created, false);
      assert.equal(await prisma.xPTransaction.count(), 1);
      assert.equal(await prisma.auditLog.count({ where: { action: "REPORT_APPROVED" } }), 1);
    });
    await check("50. approved report stays readable to its owner; reviewer access ends", async () => {
      const reply = await uF.request("GET", `${selfRoot}?locale=en`);
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).kind, "approved");
      const history = await uF.request("GET", `${selfRoot}/revisions?locale=en`);
      assert.equal(history.status, 200, history.text);
      // The claim was consumed by approval: reviewer detail and the
      // claim-gated attachment read collapse into not-found.
      const detailAfter = await m1F.request("GET", `${detailUrl}?locale=en`);
      assert.equal(detailAfter.status, 404);
      const reviewerDownload = await m1F.download(`/api/curriculum/v2/report-attachments/${goodId}`);
      assert.equal(reviewerDownload.status, 404);
    });
  } finally {
    await stop(server);
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
    cleanup();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); cleanup(); process.exit(1); });
