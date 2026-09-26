/**
 * REVIEW-SURFACE CORRECTION — the staff candidate read and the review queue.
 *
 * WHAT THIS PROVES. A submitted successor is reachable and visible through the
 * ordinary staff workflow: a reviewer can list the work, read the exact version
 * id off the queue entry, open that version over HTTP, note against it and
 * approve it — without ever consulting an out-of-band artifact, and without any
 * of it moving what a learner receives.
 *
 * THE TWO DEFECTS IT CLOSES, both found by a real authoring session and both
 * reproduced here against the accepted parent before being fixed:
 *
 *   A. QUERY GATE   `gateAuthoringRead` closed the query string against
 *                   `{curriculumVersionId, levelNumbers}` while PHASE-G2
 *                   SUCCESSOR taught the routes to read three candidate axes and
 *                   documented them as accepted. The gate runs first, so every
 *                   documented candidate-aware GET answered 400 INVALID_QUERY
 *                   and the reachable HTTP surface could only open the runtime
 *                   version.
 *
 *   B. QUEUE BLINDNESS  the overview, the work queue and readiness answered a
 *                   RUNTIME question — `pickRuntimeVersion` — and presented the
 *                   answer as the editorial state. A level serving a published
 *                   v1 with a submitted successor v2 reported no content work at
 *                   all, and no queue entry carried a version id for a reviewer
 *                   to navigate by.
 *
 * DISPOSABLE DATABASE ONLY. No live database is opened, no sealed or cumulative
 * editorial database is touched, and no real product row is mutated anywhere.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = path.join(os.tmpdir(), `ata-review-surface-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const port = 3941;
const baseUrl = `http://127.0.0.1:${port}`;

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

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

const PASSWORD = "review-surface-local-only";

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "review-surface-correction-session-secret",
  POSTBACK_SECRET: "review-surface-correction-postback-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
  CURRICULUM_V2_ADMIN_ENABLED: "true",
  CURRICULUM_V2_READ_ENABLED: "true",
  CURRICULUM_V2_CONTENT_ENABLED: "true",
  CURRICULUM_V2_ASSESSMENT_ENABLED: "true",
  NEXT_TELEMETRY_DISABLED: "1",
};

let logs = "";
async function start(): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: ROOT,
    env: baseEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (value) => {
    logs += String(value);
  });
  child.stderr?.on("data", (value) => {
    logs += String(value);
  });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-4000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

type Reply = { status: number; body: Record<string, unknown>; text: string };

class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;

  async request(method: string, url: string, body?: unknown): Promise<Reply> {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.csrf ? { "x-csrf-token": this.csrf } : {}),
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not json */
    }
    return { status: response.status, body: parsed, text };
  }

  async login(email: string) {
    const reply = await this.request("POST", "/api/auth/login", {
      email,
      password: PASSWORD,
      captchaToken: "dev-captcha-ok",
    });
    assert.equal(reply.status, 200, `login failed for ${email}: ${reply.text}`);
    const csrf = await this.request("GET", "/api/csrf");
    this.csrf = String((csrf.body as { csrfToken?: string }).csrfToken ?? "");
    assert.ok(this.csrf, "no csrf token issued");
  }

  get(url: string) {
    return this.request("GET", url);
  }
}

const data = (reply: Reply) => (reply.body as { data?: Record<string, unknown> }).data ?? {};

const LEVEL_NUMBER = 2;
const LEVEL_CODE = "v2.l002.kak-ustroen-alfa-trade-academy";

function richBody(marker: string) {
  const paragraph = `${marker}. `.padEnd(
    900,
    "Маршрут академии проходится по порядку, и каждый шаг закрывается своим условием. ",
  );
  return {
    format: "ata.lesson.blocks",
    version: 2,
    sections: [
      { code: "intro", title: "Введение", blocks: [{ type: "rich_text", text: paragraph }] },
      { code: "practice", title: "Практика", blocks: [{ type: "rich_text", text: paragraph }] },
    ],
  };
}

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
      script: "SCRIPT_READY",
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
  cleanup();
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

  const bcrypt = (await import("bcryptjs")).default;
  const { prisma } = await import("../../src/lib/prisma");
  const read = await import("../../src/lib/curriculum/authoring-read");
  const readiness = await import("../../src/lib/curriculum/authoring-readiness");
  const validation = await import("../../src/lib/curriculum/authoring-validation-service");
  const clone = await import("../../src/lib/curriculum/authoring-version-clone");
  const lifecycle = await import("../../src/lib/curriculum/authoring-lifecycle");
  const contentDomain = await import("../../src/lib/curriculum/content");
  const notes = await import("../../src/lib/curriculum/authoring-review-notes");
  const previewDomain = await import("../../src/lib/curriculum/authoring-preview");
  const editorial = await import("../../src/lib/curriculum/authoring-editorial-candidate");
  const sourceAuthority = await import("../../src/lib/curriculum/source-authority");

  /* ========================================================================
   * §11 — CANDIDATE PRECEDENCE, as a pure unit matrix.
   *
   * No database: the rule is a function of lifecycle states, and proving it that
   * way covers shapes the fixture below cannot cheaply build.
   * ===================================================================== */
  const V = (
    id: number,
    versionNumber: number,
    editorialState: string,
    runtimeStatus: string | null = "draft",
  ) => ({ id, versionNumber, editorialState: editorialState as never, runtimeStatus });

  await check("§11.A only runtime v1 — the runtime version IS the candidate", () => {
    const r = editorial.pickEditorialCandidate([V(1, 1, "draft", "published")], 1);
    assert.equal(r.candidate?.id, 1);
    assert.equal(r.isRuntimeVersion, true);
    assert.equal(r.ambiguous, false);
  });

  await check("§11.B runtime v1 + draft v2 — the newer draft wins", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "draft")],
      1,
    );
    assert.equal(r.candidate?.id, 2);
    assert.equal(r.isRuntimeVersion, false);
  });

  await check("§11.C runtime v1 + submitted v2 — submitted wins", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "submitted_for_review")],
      1,
    );
    assert.equal(r.candidate?.id, 2);
    assert.equal(r.waitingOn, "reviewer");
  });

  await check("§11.D runtime v1 + changes_requested v2 — the returned draft wins", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "changes_requested")],
      1,
    );
    assert.equal(r.candidate?.id, 2);
    assert.equal(r.waitingOn, "author");
  });

  await check("§11.E runtime v1 + approved unpublished v2 — waiting on the publisher", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "approved")],
      1,
    );
    assert.equal(r.candidate?.id, 2);
    assert.equal(r.waitingOn, "publisher");
    assert.equal(r.isRuntimeVersion, false);
  });

  await check("§11.F submitted v2 beats an abandoned newer draft v3", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "submitted_for_review"), V(3, 3, "draft")],
      1,
    );
    assert.equal(r.candidate?.id, 2, "an abandoned newer draft must not outrank a submitted version");
  });

  await check("§11.G multiple generations — the most urgent desk wins, not the newest id", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "approved"), V(3, 3, "draft")],
      1,
    );
    assert.equal(r.candidate?.id, 2);
    assert.equal(r.waitingOn, "publisher");
  });

  await check("§11 candidate discovery never depends on insertion order", () => {
    const versions = [V(1, 1, "draft", "published"), V(2, 2, "submitted_for_review"), V(3, 3, "draft")];
    const forward = editorial.pickEditorialCandidate(versions, 1);
    const reversed = editorial.pickEditorialCandidate([...versions].reverse(), 1);
    assert.deepEqual(
      { id: forward.candidate?.id, waitingOn: forward.waitingOn },
      { id: reversed.candidate?.id, waitingOn: reversed.waitingOn },
    );
  });

  await check("§11 an archived version is never the editorial candidate", () => {
    const r = editorial.pickEditorialCandidate(
      [V(1, 1, "draft", "published"), V(2, 2, "submitted_for_review", "archived")],
      1,
    );
    assert.equal(r.candidate?.id, 1);
  });

  await check("L. two submitted versions are AMBIGUOUS and fail closed", () => {
    const r = editorial.pickEditorialCandidate(
      [
        V(1, 1, "draft", "published"),
        V(2, 2, "submitted_for_review"),
        V(3, 3, "submitted_for_review"),
      ],
      1,
    );
    assert.equal(r.candidate, null, "no candidate may be offered when two are equally active");
    assert.equal(r.ambiguous, true);
    assert.deepEqual(r.ambiguousVersionIds, [2, 3], "the competing ids are reported, ascending");
  });

  await check("L. ambiguity is reported for every active desk, not just review", () => {
    for (const state of ["changes_requested", "approved"]) {
      const r = editorial.pickEditorialCandidate([V(2, 2, state), V(3, 3, state)], null);
      assert.equal(r.ambiguous, true, `${state} tie must be ambiguous`);
      assert.equal(r.candidate, null);
    }
  });

  await check("L. a DRAFT tie is resolved, not reported — nobody is waiting on either", () => {
    const r = editorial.pickEditorialCandidate([V(2, 2, "draft"), V(3, 3, "draft")], null);
    assert.equal(r.ambiguous, false);
    assert.equal(r.candidate?.id, 3, "the newer draft supersedes the older one");
  });

  /* ========================================================================
   * The fixture: exactly the shape the real L2 checkpoint is in.
   * ===================================================================== */
  const hash = await bcrypt.hash(PASSWORD, 4);
  async function staffActor(email: string, staffRole: string) {
    const user = await prisma.user.create({
      data: { email, name: staffRole, role: "support", passwordHash: hash, status: "active" },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, staffRole: staffRole as never, displayName: staffRole },
    });
    return user;
  }
  const authorA = await staffActor("rs-author-a@example.com", "content_manager");
  const reviewerR = await staffActor("rs-reviewer-r@example.com", "crm_admin");

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "Review surface", status: "draft", versionNumber: 1 },
  });
  const moduleRow = await prisma.moduleDefinition.create({
    data: {
      curriculumVersionId: curriculum.id, moduleNumber: 1, code: "module.01",
      title: "Первое знакомство", description: "", firstLevel: 1, lastLevel: 40,
      checkpointLevel: 4, learningObjective: "",
    },
  });
  const level = await prisma.levelDefinition.create({
    data: {
      curriculumVersionId: curriculum.id, moduleId: moduleRow.id, levelNumber: LEVEL_NUMBER,
      stableCode: LEVEL_CODE, type: "lesson", title: "Как устроен Alfa Trade Academy",
      learningObjective: "Цель уровня.", completionMethod: "assessment_pass", xpReward: 100,
    },
  });
  // A SECOND level, so a "foreign candidate" in the tests below is a real id
  // belonging to a real other level rather than a number nothing owns.
  const otherLevel = await prisma.levelDefinition.create({
    data: {
      curriculumVersionId: curriculum.id, moduleId: moduleRow.id, levelNumber: 5,
      stableCode: "v2.l005.drugoy-uroven", type: "lesson", title: "Другой уровень",
      learningObjective: "Цель.", completionMethod: "assessment_pass", xpReward: 100,
    },
  });
  const foreignContent = await prisma.contentVersion.create({
    data: {
      levelDefinitionId: otherLevel.id, curriculumVersionId: curriculum.id, versionNumber: 1,
      status: "draft", editorialState: "draft", updatedAt: new Date(),
      localizations: {
        create: {
          locale: "ru", title: "Другой", subtitle: "", learningObjectiveExtension: "Цель.",
          summary: "Резюме.", body: richBody("Другой уровень"), updatedAt: new Date(),
        },
      },
    },
  });

  const contentV1 = await prisma.contentVersion.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
      status: "published", publishedAt: new Date(), editorialState: "draft", updatedAt: new Date(),
      localizations: {
        create: {
          locale: "ru", title: "Как устроен Alfa Trade Academy", subtitle: "",
          learningObjectiveExtension: "Расширенная цель.", summary: "Резюме урока.",
          body: richBody("Предшественник"), updatedAt: new Date(),
        },
      },
    },
  });
  const assessmentV1 = await prisma.assessmentVersion.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id, versionNumber: 1,
      status: "published", publishedAt: new Date(), editorialState: "draft",
      passPercent: 100, updatedAt: new Date(),
      questions: {
        create: [1, 2, 3, 4].map((ordinal) => ({
          questionNumber: ordinal, stableKey: `T${LEVEL_NUMBER}.${ordinal}`,
          type: "single_choice", status: "active", updatedAt: new Date(),
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }],
          correctAnswer: { code: "a" },
          localizations: {
            create: {
              locale: "ru", prompt: `Общий вопрос ${ordinal}?`,
              optionLabels: {
                a: `Общий верный ответ ${ordinal}.`, b: `Не то B${ordinal}.`,
                c: `Не то C${ordinal}.`, d: `Не то D${ordinal}.`,
              },
              explanation: "Пояснение.", updatedAt: new Date(),
            },
          },
        })),
      },
    },
  });
  await prisma.levelResourceBinding.create({
    data: {
      levelDefinitionId: level.id, curriculumVersionId: curriculum.id,
      contentVersionId: contentV1.id, assessmentVersionId: null, updatedAt: new Date(),
    },
  });

  const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
  const videoV1 = await videoAuthoring.createVideoProductionVersion({
    levelDefinitionId: level.id,
    curriculumVersionId: curriculum.id,
    payload: contractFor(LEVEL_NUMBER, LEVEL_CODE, "Общий"),
    actorId: authorA.id,
  });
  await prisma.videoProductionAssessmentLink.create({
    data: {
      videoProductionVersionId: videoV1.id, assessmentVersionId: assessmentV1.id,
      assessmentRevision: 1,
      assessmentBankFingerprint: await (
        await import("../../src/lib/curriculum/authoring-assessment-projection")
      ).calculateBankFingerprint(prisma, assessmentV1.id),
      linkedById: authorA.id, updatedAt: new Date(),
    },
  });

  /* ---- the successors, exactly as the real session made them ---- */
  const contentSuccessor = await clone.cloneContentVersion({
    contentVersionId: contentV1.id, actorId: authorA.id, changeNotes: "successor",
  });
  const assessmentSuccessor = await clone.cloneAssessmentVersion({
    assessmentVersionId: assessmentV1.id, actorId: authorA.id, changeNotes: "successor",
  });
  const successorLocalization = (await prisma.contentLocalization.findFirst({
    where: { contentVersionId: contentSuccessor.id, locale: "ru" },
    select: { id: true },
  }))!;
  await contentDomain.updateContentLocalization({
    actorId: authorA.id,
    contentLocalizationId: successorLocalization.id,
    expectedRevision: contentSuccessor.revision,
    patch: { body: richBody("Наследник") },
  });
  for (const kind of ["content", "assessment", "video_production"] as const) {
    const id =
      kind === "content"
        ? contentSuccessor.id
        : kind === "assessment"
          ? assessmentSuccessor.id
          : videoV1.id;
    const row =
      kind === "content"
        ? await prisma.contentVersion.findUnique({ where: { id }, select: { revision: true } })
        : kind === "assessment"
          ? await prisma.assessmentVersion.findUnique({ where: { id }, select: { revision: true } })
          : await prisma.videoProductionVersion.findUnique({ where: { id }, select: { revision: true } });
    await lifecycle.submitForReview({ kind, id, expectedRevision: row!.revision, actorId: authorA.id });
  }

  const CANDIDATE = `?contentVersionId=${contentSuccessor.id}&assessmentVersionId=${assessmentSuccessor.id}&videoProductionVersionId=${videoV1.id}`;

  /* ======================= HTTP ======================= */
  let server: ChildProcess | null = null;
  try {
    server = await start();
    const author = new Client();
    await author.login("rs-author-a@example.com");
    const reviewer = new Client();
    await reviewer.login("rs-reviewer-r@example.com");

    await check("A. candidate HTTP GET accepts valid candidate ids", async () => {
      const validate = await author.get(
        `/api/admin/curriculum/authoring/levels/${level.id}/validate${CANDIDATE}`,
      );
      assert.equal(validate.status, 200, validate.text);
      const report = data(validate);
      assert.equal(report.contentVersionId, contentSuccessor.id);
      assert.equal(report.assessmentVersionId, assessmentSuccessor.id);
      assert.equal(report.videoProductionVersionId, videoV1.id);

      const workspace = await author.get(
        `/api/admin/curriculum/authoring/levels/${level.id}${CANDIDATE}`,
      );
      assert.equal(workspace.status, 200, workspace.text);
      assert.deepEqual((data(workspace) as { opened: unknown }).opened, {
        contentVersionId: contentSuccessor.id,
        assessmentVersionId: assessmentSuccessor.id,
        videoProductionVersionId: videoV1.id,
      });
    });

    await check("B. candidate HTTP GET refuses every malformed id, and never falls back", async () => {
      const malformed = [
        "0", "-1", "1.5", "7e1", "0x4f", "%2B1", "%201%20", "", "NaN", "abc", "1%00",
      ];
      for (const raw of malformed) {
        const reply = await author.get(
          `/api/admin/curriculum/authoring/levels/${level.id}/validate?contentVersionId=${raw}`,
        );
        assert.equal(reply.status, 400, `"${raw}" should be 400, got ${reply.status} ${reply.text}`);
        assert.equal((reply.body as { error?: string }).error, "AUTHORING_INPUT_INVALID");
      }
      // An AMBIGUOUS selection is refused rather than resolved by position.
      const duplicate = await author.get(
        `/api/admin/curriculum/authoring/levels/${level.id}/validate?contentVersionId=${contentSuccessor.id}&contentVersionId=${contentV1.id}`,
      );
      assert.equal(duplicate.status, 400, duplicate.text);
      assert.equal((duplicate.body as { error?: string }).error, "AUTHORING_INPUT_INVALID");
      // The allowlist is still CLOSED.
      const unknown = await author.get(
        `/api/admin/curriculum/authoring/levels/${level.id}/validate?somethingElse=1`,
      );
      assert.equal(unknown.status, 400, unknown.text);
      assert.equal((unknown.body as { error?: string }).error, "INVALID_QUERY");
    });

    await check("C. candidate HTTP GET refuses a foreign and a nonexistent candidate", async () => {
      for (const [label, id] of [
        ["another level's content version", foreignContent.id],
        ["a version nothing owns", 999_999],
      ] as const) {
        const reply = await author.get(
          `/api/admin/curriculum/authoring/levels/${level.id}/validate?contentVersionId=${id}`,
        );
        assert.equal(reply.status, 422, `${label}: ${reply.text}`);
        assert.equal((reply.body as { error?: string }).error, "AUTHORING_CANDIDATE_INVALID");
        assert.ok(
          !("contentVersionId" in data(reply)),
          `${label} must not be silently answered about the runtime version`,
        );
      }
    });

    await check("D. HTTP and domain candidate reads agree exactly", async () => {
      const httpReport = data(
        await author.get(`/api/admin/curriculum/authoring/levels/${level.id}/validate${CANDIDATE}`),
      );
      const domainReport = await validation.validateLevelAuthoring({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
        candidate: {
          contentVersionId: contentSuccessor.id,
          assessmentVersionId: assessmentSuccessor.id,
          videoProductionVersionId: videoV1.id,
        },
      });
      assert.deepEqual(httpReport, JSON.parse(JSON.stringify(domainReport)));

      const httpWorkspace = data(
        await author.get(`/api/admin/curriculum/authoring/levels/${level.id}${CANDIDATE}`),
      );
      const domainWorkspace = await read.readLevelAuthoringWorkspace({
        curriculumVersionId: curriculum.id,
        levelDefinitionId: level.id,
        candidate: {
          contentVersionId: contentSuccessor.id,
          assessmentVersionId: assessmentSuccessor.id,
          videoProductionVersionId: videoV1.id,
        },
      });
      assert.deepEqual(
        (httpWorkspace as { opened: unknown }).opened,
        JSON.parse(JSON.stringify(domainWorkspace!.opened)),
      );
    });

    await check("G. the queue entry a reviewer receives links the exact candidate id", async () => {
      const queue = data(await reviewer.get("/api/admin/curriculum/authoring/work-queue"));
      const entries = (queue.entries as Array<Record<string, unknown>>).filter(
        (entry) => entry.levelNumber === LEVEL_NUMBER,
      );
      const contentEntry = entries.find((entry) => entry.bucket === "READY_FOR_CONTENT_REVIEW");
      assert.ok(contentEntry, `no content review entry: ${JSON.stringify(entries)}`);
      const candidate = contentEntry.candidate as Record<string, unknown>;
      assert.equal(candidate.versionId, contentSuccessor.id);
      assert.equal(candidate.editorialState, "submitted_for_review");
      assert.equal(candidate.isRuntimeVersion, false);
      assert.equal(contentEntry.levelDefinitionId, level.id);

      // And that id, fed straight back into the read route, opens that version.
      const opened = await reviewer.get(
        `/api/admin/curriculum/authoring/levels/${contentEntry.levelDefinitionId}?contentVersionId=${candidate.versionId}`,
      );
      assert.equal(opened.status, 200, opened.text);
      assert.equal(
        (data(opened) as { opened: { contentVersionId: number } }).opened.contentVersionId,
        contentSuccessor.id,
        "a reviewer must reach the successor from the queue alone",
      );
    });

    await check("H. a review note targets the version the reviewer opened, not the runtime one", async () => {
      const reply = await reviewer.request(
        "POST",
        `/api/admin/curriculum/authoring/aggregates/content/${contentSuccessor.id}/notes`,
        { body: "Проверить формулировку во втором разделе.", path: "sections[1]" },
      );
      assert.equal(reply.status, 201, reply.text);
      const onSuccessor = await prisma.editorialReviewNote.count({
        where: { contentVersionId: contentSuccessor.id },
      });
      const onRuntime = await prisma.editorialReviewNote.count({
        where: { contentVersionId: contentV1.id },
      });
      assert.equal(onSuccessor, 1, "the note belongs to the successor");
      assert.equal(onRuntime, 0, "no note may land on the published predecessor");
    });

    await check("§19 the staff source-authority read names WHERE the source came from", async () => {
      const successor = data(
        await reviewer.get(
          `/api/admin/curriculum/authoring/assessments/${assessmentSuccessor.id}/source-authority`,
        ),
      );
      assert.equal(successor.linkOrigin, "lineage", "a cloned bank inherits its ancestor's link");
      assert.equal(successor.linkLineageDepth, 1);
      const ancestor = data(
        await reviewer.get(
          `/api/admin/curriculum/authoring/assessments/${assessmentV1.id}/source-authority`,
        ),
      );
      assert.equal(ancestor.linkOrigin, "own");
      assert.equal(ancestor.linkLineageDepth, 0);
    });

    await check("§21 a read-only actor still cannot approve through the corrected surface", async () => {
      const reader = await staffActor("rs-reader-c@example.com", "read_only");
      const client = new Client();
      await client.login(reader.email);
      const openable = await client.get(
        `/api/admin/curriculum/authoring/levels/${level.id}${CANDIDATE}`,
      );
      assert.equal(openable.status, 200, "curriculum_read may READ the candidate");
      const approve = await client.request(
        "POST",
        `/api/admin/curriculum/authoring/aggregates/content/${contentSuccessor.id}/approve`,
        { expectedRevision: 2 },
      );
      assert.equal(approve.status, 403, "curriculum_read may not approve");
    });
  } finally {
    await stop(server);
  }

  /* ======================= DOMAIN ======================= */
  const levels = await read.readAuthoringOverview(curriculum.id);
  const l2 = levels.find((row) => row.levelNumber === LEVEL_NUMBER)!;
  const queue = readiness.classifyWorkQueue(levels);
  const summary = readiness.summarizeReadiness(levels);
  const l2Entries = queue.filter((entry) => entry.levelNumber === LEVEL_NUMBER);

  await check("E. the submitted successor appears in the editorial queue", () => {
    const content = l2Entries.find((entry) => entry.bucket === "READY_FOR_CONTENT_REVIEW");
    assert.ok(content, `content review entry missing: ${JSON.stringify(l2Entries)}`);
    assert.equal(content.candidate?.versionId, contentSuccessor.id);
    const assessment = l2Entries.find((entry) => entry.bucket === "READY_FOR_ASSESSMENT_REVIEW");
    assert.ok(assessment, "assessment review entry missing");
    assert.equal(assessment.candidate?.versionId, assessmentSuccessor.id);
    const video = l2Entries.find((entry) => entry.bucket === "READY_FOR_VIDEO_REVIEW");
    assert.ok(video, "video review entry missing");
    assert.equal(video.candidate?.versionId, videoV1.id);
    assert.equal(summary.editorial.awaitingReviewerAggregates, 3);
    assert.equal(summary.editorial.levelsWithSuccessorCandidate, 1);
  });

  await check("F. the runtime predecessor is still separately and correctly reported", () => {
    assert.equal(l2.content?.id, contentV1.id, "the level SUMMARY still describes the runtime version");
    assert.equal(l2.content?.runtimeStatus, "published");
    assert.equal(
      l2.editorial.content.versionId,
      contentSuccessor.id,
      "the editorial axis describes the successor",
    );
    assert.equal(l2.editorial.content.isRuntimeVersion, false);
    // The two truths are reported side by side and neither overwrote the other.
    assert.notEqual(l2.content?.id, l2.editorial.content.versionId);
    // Runtime-oriented readiness is unchanged in meaning: it counts the SERVED
    // version, which is not submitted and must not be counted as though it were.
    assert.equal(summary.contentSubmittedLevels, 0);
    assert.equal(summary.editorial.contentCandidateSubmittedLevels, 1);
  });

  await check("§12 every non-structural queue entry names the version it is about", () => {
    for (const entry of queue) {
      if (entry.aggregate === "structure" || entry.bucket === "NEEDS_PRODUCT_DECISION") continue;
      assert.ok(entry.candidate, `entry without a candidate: ${JSON.stringify(entry)}`);
      assert.ok(Number.isInteger(entry.candidate.versionId));
      assert.ok(Number.isInteger(entry.candidate.revision));
    }
  });

  await check("§12 the queue exposes no source-authority evidence", () => {
    const serialized = JSON.stringify(queue);
    for (const forbidden of [
      "evidenceRef", "evidenceSha256", "decidedById", "resolutionFingerprint",
      "authorityLineageFingerprint", "currentValueHash", "blueprintValueHash", "rationale",
    ]) {
      assert.ok(!serialized.includes(forbidden), `${forbidden} leaked into the work queue`);
    }
  });

  await check("I. the learner runtime is untouched — the binding still names v1", async () => {
    const binding = await prisma.levelResourceBinding.findFirst({
      where: { levelDefinitionId: level.id },
    });
    assert.equal(binding?.contentVersionId, contentV1.id);
    assert.equal(binding?.assessmentVersionId, null);
    const runtime = await prisma.contentVersion.findUnique({ where: { id: contentV1.id } });
    assert.equal(runtime?.status, "published");
    const successor = await prisma.contentVersion.findUnique({ where: { id: contentSuccessor.id } });
    assert.equal(successor?.status, "draft", "a submitted successor is not published by being visible");
    assert.equal(successor?.publishedAt, null);
  });

  await check("J. inherited source authority is unchanged by the corrected surfaces", async () => {
    const source = await sourceAuthority.resolveAuthoritySource(prisma, assessmentSuccessor.id);
    const projection = await sourceAuthority.readSourceAuthority(prisma, {
      assessmentVersionId: assessmentSuccessor.id,
      videoProductionVersionId: source.videoProductionVersionId,
      contract: source.contract,
      sourceUnavailableReason: source.unavailableReason,
      sourceLinked: source.link !== null,
    });
    assert.equal(source.linkOrigin, "lineage");
    assert.equal(source.linkLineageDepth, 1);
    assert.equal(projection.inheritedDecisionCount, projection.decisions.length);
    assert.ok(projection.decisions.every((row) => row.inherited || projection.decisions.length === 0));
    const localRows = await prisma.sourceAuthorityResolution.count({
      where: { assessmentVersionId: assessmentSuccessor.id },
    });
    assert.equal(localRows, 0, "nothing may materialise an inherited decision");
  });

  await check("K. no candidate or reviewer field reaches a learner payload", async () => {
    const snapshot = await previewDomain.createLevelPreviewSnapshot({
      levelDefinitionId: level.id,
      contentVersionId: contentSuccessor.id,
      assessmentVersionId: assessmentSuccessor.id,
      videoProductionVersionId: videoV1.id,
      actorId: authorA.id,
    });
    const learner = await previewDomain.readLearnerPreview(snapshot.snapshotCode);
    const serialized = JSON.stringify((learner as { payload: unknown }).payload);
    for (const forbidden of [
      "predecessorVersionId", "linkOrigin", "linkLineageDepth", "authorityLineageFingerprint",
      "resolutionFingerprint", "editorialState", "isRuntimeVersion", "isRuntimeBound",
      "waitingOn", "ambiguous", "candidate", "bucket", "correctAnswer", "evidenceRef",
    ]) {
      assert.ok(!serialized.includes(forbidden), `${forbidden} leaked into the learner preview`);
    }
  });

  await check("§17 approve validates the version being approved, and four-eyes holds", async () => {
    const contentRow = await prisma.contentVersion.findUnique({
      where: { id: contentSuccessor.id },
      select: { revision: true },
    });
    // The AUTHOR may not approve their own work, through any surface.
    await assert.rejects(
      () =>
        lifecycle.approveVersion({
          kind: "content",
          id: contentSuccessor.id,
          expectedRevision: contentRow!.revision,
          actorId: authorA.id,
          validationPassed: true,
        }),
      (error: { code?: string }) => error.code === "AUTHORING_SELF_APPROVAL_FORBIDDEN",
    );
    // The reviewer's approval validates the SUCCESSOR, not the bound predecessor.
    const report = await validation.validateLevelAuthoring({
      curriculumVersionId: curriculum.id,
      levelDefinitionId: level.id,
      candidate: { contentVersionId: contentSuccessor.id },
    });
    assert.equal(report!.contentVersionId, contentSuccessor.id);
    const approved = await lifecycle.approveVersion({
      kind: "content",
      id: contentSuccessor.id,
      expectedRevision: contentRow!.revision,
      actorId: reviewerR.id,
      validationPassed: report!.ok,
    });
    assert.equal(approved.editorialState, "approved");
    // Approval is not publication.
    const after = await prisma.contentVersion.findUnique({ where: { id: contentSuccessor.id } });
    assert.equal(after?.status, "draft");
    const binding = await prisma.levelResourceBinding.findFirst({
      where: { levelDefinitionId: level.id },
    });
    assert.equal(binding?.contentVersionId, contentV1.id, "approval never moves the binding");
  });

  await check("§10 an approved unpublished successor stays the editorial candidate", async () => {
    const after = await read.readAuthoringOverview(curriculum.id);
    const row = after.find((entry) => entry.levelNumber === LEVEL_NUMBER)!;
    assert.equal(row.editorial.content.versionId, contentSuccessor.id);
    assert.equal(row.editorial.content.editorialState, "approved");
    assert.equal(row.editorial.content.waitingOn, "publisher");
    assert.equal(row.content?.id, contentV1.id, "the runtime axis still names the served version");
    const summaryAfter = readiness.summarizeReadiness(after);
    assert.equal(summaryAfter.editorial.awaitingPublisherAggregates, 1);
  });

  await check("L. an ambiguous axis withholds the id and raises it for a human", async () => {
    // A second submitted successor makes the level genuinely ambiguous.
    const second = await clone.cloneContentVersion({
      contentVersionId: contentV1.id, actorId: authorA.id, changeNotes: "rival successor",
    });
    const secondLoc = (await prisma.contentLocalization.findFirst({
      where: { contentVersionId: second.id, locale: "ru" }, select: { id: true },
    }))!;
    await contentDomain.updateContentLocalization({
      actorId: authorA.id, contentLocalizationId: secondLoc.id,
      expectedRevision: second.revision, patch: { body: richBody("Соперник") },
    });
    const secondRow = await prisma.contentVersion.findUnique({
      where: { id: second.id }, select: { revision: true },
    });
    await lifecycle.submitForReview({
      kind: "content", id: second.id, expectedRevision: secondRow!.revision, actorId: authorA.id,
    });
    // Put the first successor back into review too, so two are equally active.
    await prisma.contentVersion.update({
      where: { id: contentSuccessor.id },
      data: { editorialState: "submitted_for_review", approvedById: null, approvedAt: null },
    });

    const after = await read.readAuthoringOverview(curriculum.id);
    const row = after.find((entry) => entry.levelNumber === LEVEL_NUMBER)!;
    assert.equal(row.editorial.content.ambiguous, true);
    assert.equal(row.editorial.content.versionId, null, "no id may be offered");
    assert.deepEqual(
      row.editorial.content.ambiguousVersionIds,
      [contentSuccessor.id, second.id].sort((a, b) => a - b),
    );

    const afterQueue = readiness.classifyWorkQueue(after);
    const raised = afterQueue.filter(
      (entry) => entry.levelNumber === LEVEL_NUMBER && entry.bucket === "NEEDS_PRODUCT_DECISION",
    );
    assert.equal(raised.length, 1, "the ambiguity is raised exactly once");
    assert.equal(raised[0].candidate, null, "an ambiguous entry offers no candidate");
    assert.ok(raised[0].reason.includes(String(second.id)));
    assert.equal(
      afterQueue.filter(
        (entry) => entry.levelNumber === LEVEL_NUMBER && entry.bucket === "READY_FOR_CONTENT_REVIEW",
      ).length,
      0,
      "an ambiguous axis must not also emit a review entry naming one of the rivals",
    );
    // Deterministic across repeated reads.
    const again = readiness.classifyWorkQueue(await read.readAuthoringOverview(curriculum.id));
    assert.deepEqual(
      again.filter((entry) => entry.levelNumber === LEVEL_NUMBER),
      afterQueue.filter((entry) => entry.levelNumber === LEVEL_NUMBER),
    );
  });

  await check("notes routes still target an exact aggregate after the correction", async () => {
    const list = await notes.listReviewNotes({
      kind: "content",
      contentVersionId: contentSuccessor.id,
    });
    assert.equal(list.length, 1);
  });

  await prisma.$disconnect();
}

main()
  .then(() => {
    const summary = { suite: "review-surface-correction", passed, failed, results };
    if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\n${passed} passed, ${failed} failed`);
    cleanup();
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    cleanup();
    process.exit(1);
  });
