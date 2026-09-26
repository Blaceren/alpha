/**
 * PHASE-G1 — the Authoring Studio HTTP regression.
 *
 * Drives the REAL routes against a real server and a disposable database:
 * authorization for every staff role, the CSRF boundary, the `expectedRevision`
 * transport, the editorial lifecycle including four-eyes, review notes,
 * validation, the exact preview, readiness and the package handoff.
 *
 * ============================ THE G0 LOW-1 GATE ============================
 * The final G0 closeout reported that a mutant making `readPreviewSnapshotByCode`
 * follow the latest video revision SURVIVED the correction suite. Check `PIN`
 * below closes it through the real preview route: a snapshot is pinned at
 * content 4 / assessment 7 / video 3, all three aggregates are then moved to
 * 5 / 8 / 4, and the route must still answer 4 / 7 / 3 AND still serve the
 * frozen body. A "follow latest" implementation fails it.
 *
 * DISPOSABLE DATABASE, LOOPBACK SERVER, TEMPORARY PORT. Everything is deleted on
 * the way out. No live database, no live env and no live flag is touched.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

const ROOT = process.cwd();
const OUT = process.env.REGRESSION_SUMMARY_PATH ?? null;
const dbPath = `/tmp/ata-authoring-studio-http-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const port = 3910 + (process.pid % 40);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "StudioHttp123!";

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

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "authoring-studio-http-session-secret",
  POSTBACK_SECRET: "authoring-studio-http-postback-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  POCKET_AFFILIATE_BASE_URL: "https://example.com/ref",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
};
for (const key of [
  "CURRICULUM_V2_ADMIN_ENABLED",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "CURRICULUM_V2_XP_ENABLED",
  "CURRICULUM_V2_CONTENT_ENABLED",
  "CURRICULUM_V2_ASSESSMENT_ENABLED",
  "NODE_ENV",
]) {
  delete baseEnv[key];
}

let logs = "";
async function start(flags: boolean): Promise<ChildProcess> {
  const env = { ...baseEnv };
  if (flags) {
    Object.assign(env, {
      CURRICULUM_V2_ADMIN_ENABLED: "true",
      CURRICULUM_V2_READ_ENABLED: "true",
      CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
      CURRICULUM_V2_CONTENT_ENABLED: "true",
      CURRICULUM_V2_ASSESSMENT_ENABLED: "true",
    });
  }
  const child = spawn("npx", ["next", "dev", "--turbopack", "-p", String(port)], {
    cwd: ROOT,
    env,
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

type Reply = { status: number; headers: Headers; body: Record<string, unknown>; text: string };

class Client {
  cookies = new Map<string, string>();
  token: string | null = null;

  async request(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    try {
      return await this.send(method, url, body, headers);
    } catch {
      // `next dev` recompiles between route groups and can reset an in-flight
      // socket. Retry ONCE so the suite measures the product, not the compiler.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return this.send(method, url, body, headers);
    }
  }

  private async send(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    let value: unknown = {};
    try {
      value = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: response.status, headers: response.headers, body: value as Record<string, unknown>, text };
  }

  async login(email: string) {
    const reply = await this.request("POST", "/api/auth/login", {
      email,
      password,
      captchaToken: "dev-captcha-ok",
    });
    const csrf = await this.request("GET", "/api/csrf");
    this.token = String((csrf.body as { csrfToken?: string }).csrfToken ?? "");
    return reply;
  }

  /** Every mutation goes through here, so no check can forget the CSRF header. */
  write(method: string, url: string, body?: unknown) {
    return this.request(method, url, body, { "x-csrf-token": this.token ?? "" });
  }
}

function noStore(reply: Reply) {
  assert.equal(reply.headers.get("cache-control"), "no-store", `expected no-store on ${reply.status}`);
}
function data(reply: Reply): Record<string, unknown> {
  return reply.body.data as Record<string, unknown>;
}

/** A v2 body comfortably above the accepted editorial floor. */
function richBody(marker: string) {
  const paragraph = `${marker}. `.padEnd(
    720,
    "Дисциплина в трейдинге начинается с плана и заканчивается его исполнением. ",
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
          { type: "divider" },
        ],
      },
    ],
  };
}

async function main() {
  cleanup();
  let server: ChildProcess | null = null;

  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: ROOT, env: baseEnv, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");
  const productAta = await import("../../src/lib/curriculum/product-ata-100");
  const videoContract = await import("../../src/lib/curriculum/video-production-contract");

  try {
    const hash = await bcrypt.hash(password, 10);

    /* ------------------------------------------------------------ actors */
    const learner = await prisma.user.create({
      data: { email: "studio-learner@example.com", name: "Learner", passwordHash: hash },
    });
    const noProfile = await prisma.user.create({
      data: { email: "studio-noprofile@example.com", name: "NoProfile", passwordHash: hash },
    });
    const legacyAdmin = await prisma.user.create({
      data: { email: "studio-admin@example.com", name: "Admin", role: "admin", passwordHash: hash },
    });

    async function staff(email: string, name: string, staffRole: string) {
      const user = await prisma.user.create({ data: { email, name, passwordHash: hash } });
      await prisma.staffProfile.create({
        data: { userId: user.id, displayName: name, staffRole: staffRole as never },
      });
      return user;
    }
    const authorA = await staff("studio-a@example.com", "Content A", "content_manager");
    const reviewerB = await staff("studio-b@example.com", "Admin B", "crm_admin");
    const readerC = await staff("studio-c@example.com", "Reader C", "read_only");
    const mentorD = await staff("studio-d@example.com", "Mentor D", "mentor");

    /* -------------------------------------------------------- curriculum */
    const curriculum = await prisma.curriculumVersion.create({
      data: { code: "ata-v2", name: "Studio HTTP", status: "draft", versionNumber: 1 },
    });
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
    const ataLevel = (n: number) => productAta.ATA_LEVELS.find((l) => l.levelNumber === n)!;
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

    // L9 — a practical. It needs an approved lesson and NOTHING else, so the
    // full author → submit → review → approve → handoff walk can be driven
    // without touching L2's unresolved conflict (§45).
    const practical = await makeLevel(9, "practice", "manual");
    const contentVersion = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: practical.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        createdById: authorA.id,
      },
    });
    const localization = await prisma.contentLocalization.create({
      data: {
        contentVersionId: contentVersion.id,
        locale: "ru",
        title: "Чек-лист перед входом",
        body: richBody("Практика девятого уровня") as never,
      },
    });

    // L5 — a video+assessment lesson, for the preview pin and the 4x4 rules.
    const lesson = await makeLevel(5, "lesson", "assessment_pass");
    const lessonContent = await prisma.contentVersion.create({
      data: {
        levelDefinitionId: lesson.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        createdById: authorA.id,
      },
    });
    await prisma.contentLocalization.create({
      data: {
        contentVersionId: lessonContent.id,
        locale: "ru",
        title: "ЗАМОРОЖЕННЫЙ ЗАГОЛОВОК",
        body: richBody("Урок пятого уровня") as never,
      },
    });
    const lessonBank = await prisma.assessmentVersion.create({
      data: {
        levelDefinitionId: lesson.id,
        curriculumVersionId: curriculum.id,
        versionNumber: 1,
        status: "draft",
        passPercent: 70,
        createdById: authorA.id,
      },
    });
    for (let n = 1; n <= 4; n += 1) {
      const question = await prisma.questionDefinition.create({
        data: {
          assessmentVersionId: lessonBank.id,
          questionNumber: n,
          stableKey: videoContract.takeIdFor(5, n),
          type: "single_choice",
          options: [{ code: "a" }, { code: "b" }, { code: "c" }, { code: "d" }] as never,
          correctAnswer: { code: "a" } as never,
        },
      });
      await prisma.questionLocalization.create({
        data: {
          questionId: question.id,
          locale: "ru",
          prompt: `Вопрос ${n}: что проверяет трейдер перед входом?`,
          optionLabels: {
            a: `Вариант A для вопроса ${n}`,
            b: "Неверно",
            c: "Почти",
            d: "Нет",
          } as never,
          explanation: `ВНУТРЕННЕЕ ПОЯСНЕНИЕ ${n}`,
        },
      });
    }

    const contractsFile = videoContract.videoProductionContractsFileSchema.parse(
      JSON.parse(
        fs.readFileSync(
          path.join(ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json"),
          "utf8",
        ),
      ),
    );
    const sourceContract = [...contractsFile.contracts].sort((a, b) => a.levelNumber - b.levelNumber)[0];
    const lessonContractPayload = {
      ...sourceContract,
      levelNumber: 5,
      levelCode: productAta.canonicalLevelCode(ataLevel(5)),
      takes: sourceContract.takes.map((take, index) => ({
        ...take,
        takeId: videoContract.takeIdFor(5, index + 1),
      })),
      questions: sourceContract.questions.map((question, index) => ({
        ...question,
        takeId: videoContract.takeIdFor(5, index + 1),
      })),
    };
    process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
    const videoAuthoring = await import("../../src/lib/curriculum/video-production-authoring");
    const lessonVideo = await videoAuthoring.createVideoProductionVersion({
      levelDefinitionId: lesson.id,
      curriculumVersionId: curriculum.id,
      payload: lessonContractPayload,
      actorId: legacyAdmin.id,
    });

    const A = `/api/admin/curriculum/authoring`;
    const legacyRoot = `/api/admin/curriculum/versions/${curriculum.id}/levels`;

    /* ================================================== flags fail closed */
    server = await start(false);
    await check("F1 with the studio flag OFF every authoring route answers 404", async () => {
      const anon = new Client();
      for (const url of [`${A}/overview`, `${A}/readiness`, `${A}/handoff`]) {
        const reply = await anon.request("GET", url);
        assert.equal(reply.status, 404, url);
        noStore(reply);
      }
    });
    await stop(server);
    server = await start(true);

    /* ============================================================ §3 auth */
    await check("A1 anonymous is refused with 401 and no-store", async () => {
      const reply = await new Client().request("GET", `${A}/overview`);
      assert.equal(reply.status, 401);
      noStore(reply);
    });

    await check("A2 a LEARNER is refused", async () => {
      const client = new Client();
      await client.login(learner.email);
      const reply = await client.request("GET", `${A}/overview`);
      assert.equal(reply.status, 403);
      noStore(reply);
    });

    await check("A3 an authenticated user with NO StaffProfile is refused", async () => {
      const client = new Client();
      await client.login(noProfile.email);
      assert.equal((await client.request("GET", `${A}/overview`)).status, 403);
    });

    await check("A4 a staff role with no curriculum grant (mentor) is refused", async () => {
      const client = new Client();
      await client.login(mentorD.email);
      assert.equal((await client.request("GET", `${A}/overview`)).status, 403);
    });

    const c = new Client();
    await c.login(readerC.email);
    const a = new Client();
    await a.login(authorA.email);
    const b = new Client();
    await b.login(reviewerB.email);
    const admin = new Client();
    await admin.login(legacyAdmin.email);

    await check("A5 read_only READS the overview", async () => {
      const reply = await c.request("GET", `${A}/overview`);
      assert.equal(reply.status, 200);
      noStore(reply);
      const levels = data(reply).levels as unknown[];
      assert.equal(levels.length, 2);
    });

    await check("A6 read_only cannot AUTHOR — the legacy child route refuses it", async () => {
      const reply = await c.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        expectedRevision: 1,
        patch: { subtitle: "read_only should not get here" },
      });
      assert.equal(reply.status, 403);
      noStore(reply);
    });

    await check("A7 content_manager AUTHORS through the accepted child route", async () => {
      const reply = await a.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        expectedRevision: 1,
        patch: { subtitle: "Отредактировано контент-менеджером" },
      });
      assert.equal(reply.status, 200, reply.text);
      const row = await prisma.contentVersion.findUniqueOrThrow({ where: { id: contentVersion.id } });
      assert.equal(row.revision, 2, "a substantive child write bumps the aggregate");
      assert.equal(row.lastAuthoredById, authorA.id, "the actor is server-derived from the session");
    });

    await check("A8 content_manager may NOT publish — publication stays admin-only", async () => {
      const reply = await a.write(
        `POST`,
        `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/publish`,
        {},
      );
      assert.equal(reply.status, 403, reply.text);
    });

    await check("A9 content_manager may NOT rebind a level — structure stays admin-only", async () => {
      const reply = await a.write("PUT", `${legacyRoot}/${practical.id}/content-binding`, {
        contentVersionId: contentVersion.id,
      });
      assert.equal(reply.status, 403, reply.text);
    });

    await check("A10 the legacy UserRole=admin path is unchanged and still works", async () => {
      const reply = await admin.request("GET", `${legacyRoot}/${practical.id}/content-versions`);
      assert.equal(reply.status, 200, reply.text);
    });

    await check("A11 a mutation without the CSRF header is refused", async () => {
      const reply = await a.request("POST", `${A}/aggregates/content/${contentVersion.id}/submit`, {
        expectedRevision: 2,
      });
      assert.equal(reply.status, 403);
      noStore(reply);
    });

    /* ================================================= §19 concurrency */
    await check("K1 a substantive mutation REQUIRES expectedRevision", async () => {
      const reply = await a.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        patch: { subtitle: "no revision" },
      });
      assert.equal(reply.status, 400, reply.text);
    });

    await check("K2 a STALE expectedRevision is 409 and carries actualRevision", async () => {
      const reply = await a.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        expectedRevision: 1,
        patch: { subtitle: "stale write" },
      });
      assert.equal(reply.status, 409, reply.text);
      assert.equal(reply.body.error, "AUTHORING_REVISION_CONFLICT");
      assert.equal(reply.body.actualRevision, 2);
      const row = await prisma.contentLocalization.findUniqueOrThrow({ where: { id: localization.id } });
      assert.equal(row.subtitle, "Отредактировано контент-менеджером", "the loser changed nothing");
    });

    await check("K3 the caller may not name the NEW revision or any authority field", async () => {
      for (const body of [
        { expectedRevision: 2, revision: 99, patch: { subtitle: "x" } },
        { expectedRevision: 2, actorId: 1, patch: { subtitle: "x" } },
        { expectedRevision: 2, lastAuthoredById: 1, patch: { subtitle: "x" } },
        { expectedRevision: 2, editorialState: "approved", patch: { subtitle: "x" } },
      ]) {
        const reply = await a.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, body);
        assert.equal(reply.status, 400, `${JSON.stringify(body)} -> ${reply.text}`);
      }
    });

    /* ================================================== §22/§23 validation */
    let practicalRevision = 2;
    await check("V1 validation reports a structured, sectioned result", async () => {
      const reply = await a.request("GET", `${A}/levels/${practical.id}/validate`);
      assert.equal(reply.status, 200, reply.text);
      noStore(reply);
      const report = data(reply);
      assert.equal(report.ok, true, JSON.stringify(report.issues));
      assert.ok(report.summary);
      assert.ok(Array.isArray(report.issues));
    });

    await check("V2 an invalid draft reports blockers with code, path and section", async () => {
      const broken = await a.write("PATCH", `${legacyRoot}/${lesson.id}/content-versions/${lessonContent.id}/localizations/${
        (await prisma.contentLocalization.findFirstOrThrow({ where: { contentVersionId: lessonContent.id } })).id
      }`, {
        expectedRevision: 1,
        patch: { subtitle: "Скоро будет доступно" },
      });
      assert.equal(broken.status, 200, broken.text);
      // A placeholder in a BLOCK is what the validator inspects; put one there.
      const loc = await prisma.contentLocalization.findFirstOrThrow({
        where: { contentVersionId: lessonContent.id },
      });
      const body = loc.body as { sections: Array<{ blocks: Array<Record<string, unknown>> }> };
      body.sections[0].blocks.push({ type: "rich_text", text: "Скоро будет доступно" });
      await prisma.contentLocalization.update({
        where: { id: loc.id },
        data: { body: body as never },
      });
      const reply = await a.request("GET", `${A}/levels/${lesson.id}/validate`);
      const report = data(reply);
      assert.equal(report.ok, false);
      const issues = report.issues as Array<{ code: string; path: string; section: string; severity: string }>;
      const placeholder = issues.find((issue) => issue.code === "CONTENT_PLACEHOLDER");
      assert.ok(placeholder, JSON.stringify(issues));
      assert.equal(placeholder!.section, "content");
      assert.equal(placeholder!.severity, "blocker");
      assert.ok(placeholder!.path.length > 0);
      // Put it back so later checks are not fighting this one.
      body.sections[0].blocks.pop();
      await prisma.contentLocalization.update({
        where: { id: loc.id },
        data: { body: body as never },
      });
    });

    await check("V3 SUBMIT is refused while server validation fails", async () => {
      const loc = await prisma.contentLocalization.findFirstOrThrow({
        where: { contentVersionId: lessonContent.id },
      });
      const body = loc.body as { sections: Array<{ blocks: Array<Record<string, unknown>> }> };
      body.sections[0].blocks.push({ type: "rich_text", text: "Скоро будет доступно" });
      await prisma.contentLocalization.update({ where: { id: loc.id }, data: { body: body as never } });
      const current = await prisma.contentVersion.findUniqueOrThrow({ where: { id: lessonContent.id } });
      const reply = await a.write("POST", `${A}/aggregates/content/${lessonContent.id}/submit`, {
        expectedRevision: current.revision,
      });
      assert.equal(reply.status, 422, reply.text);
      assert.equal(reply.body.error, "AUTHORING_VALIDATION_FAILED");
      assert.ok(Array.isArray(reply.body.issues) && (reply.body.issues as unknown[]).length > 0);
      body.sections[0].blocks.pop();
      await prisma.contentLocalization.update({ where: { id: loc.id }, data: { body: body as never } });
    });

    /* ================================================== §20/§21 lifecycle */
    await check("L1 the author SUBMITS", async () => {
      const reply = await a.write("POST", `${A}/aggregates/content/${contentVersion.id}/submit`, {
        expectedRevision: practicalRevision,
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).editorialState, "submitted_for_review");
    });

    await check("L2 read_only may NOT approve and may NOT request changes", async () => {
      assert.equal(
        (await c.write("POST", `${A}/aggregates/content/${contentVersion.id}/approve`, { expectedRevision: practicalRevision })).status,
        403,
      );
      assert.equal(
        (await c.write("POST", `${A}/aggregates/content/${contentVersion.id}/request-changes`, { expectedRevision: practicalRevision })).status,
        403,
      );
    });

    await check("L3 the AUTHOR may not approve — content_manager holds no approve grant", async () => {
      const reply = await a.write("POST", `${A}/aggregates/content/${contentVersion.id}/approve`, {
        expectedRevision: practicalRevision,
      });
      assert.equal(reply.status, 403, reply.text);
    });

    await check("L4 the reviewer REQUESTS CHANGES with a bounded note", async () => {
      const reply = await b.write("POST", `${A}/aggregates/content/${contentVersion.id}/request-changes`, {
        expectedRevision: practicalRevision,
        body: "Добавьте пример из практики во втором разделе.",
        path: "sections[1].blocks[0]",
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).editorialState, "changes_requested");
      assert.ok(data(reply).note, "the reason is recorded as a real review note");
    });

    await check("L5 the author revises and RESUBMITS", async () => {
      const edited = await a.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        expectedRevision: practicalRevision,
        patch: { summary: "Учтены замечания рецензента." },
      });
      assert.equal(edited.status, 200, edited.text);
      practicalRevision = 3;
      const reply = await a.write("POST", `${A}/aggregates/content/${contentVersion.id}/submit`, {
        expectedRevision: practicalRevision,
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).editorialState, "submitted_for_review");
    });

    await check("L6 SELF-APPROVAL is refused at the HTTP edge, by identity", async () => {
      // The legacy admin authored nothing here, so approval by an actor who DID
      // author must be the thing that is refused — drive it as the author would
      // if they held the grant, by making the admin author a revision first.
      const admin2 = await prisma.user.findUniqueOrThrow({ where: { id: legacyAdmin.id } });
      assert.equal(admin2.role, "admin");
      const forced = await admin.write("POST", `${A}/aggregates/content/${contentVersion.id}/request-changes`, {
        expectedRevision: practicalRevision,
      });
      assert.equal(forced.status, 200, forced.text);
      const edit = await admin.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        expectedRevision: practicalRevision,
        patch: { summary: "Правка администратора." },
      });
      assert.equal(edit.status, 200, edit.text);
      practicalRevision = 4;
      assert.equal(
        (await admin.write("POST", `${A}/aggregates/content/${contentVersion.id}/submit`, { expectedRevision: practicalRevision })).status,
        200,
      );
      const refusal = await admin.write("POST", `${A}/aggregates/content/${contentVersion.id}/approve`, {
        expectedRevision: practicalRevision,
      });
      assert.equal(refusal.status, 403, refusal.text);
      assert.equal(refusal.body.error, "AUTHORING_SELF_APPROVAL_FORBIDDEN");
      const trail = await prisma.auditLog.findFirst({
        where: { action: "AUTHORING_SELF_APPROVAL_REFUSED" },
        orderBy: { id: "desc" },
      });
      assert.ok(trail, "the refusal leaves a trace");
    });

    await check("L7 an INDEPENDENT reviewer approves, and approval does NOT publish", async () => {
      const reply = await b.write("POST", `${A}/aggregates/content/${contentVersion.id}/approve`, {
        expectedRevision: practicalRevision,
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).editorialState, "approved");
      assert.equal(data(reply).published, false);
      const row = await prisma.contentVersion.findUniqueOrThrow({ where: { id: contentVersion.id } });
      assert.equal(row.editorialState, "approved");
      assert.equal(row.status, "draft", "approval touches no runtime column");
      assert.equal(row.publishedAt, null);
      assert.equal(row.approvedById, reviewerB.id);
      const binding = await prisma.levelResourceBinding.findUnique({
        where: { levelDefinitionId: practical.id },
      });
      assert.equal(binding, null, "approval creates no binding");
    });

    await check("L8 an APPROVED version is immutable in place", async () => {
      const reply = await a.write("PATCH", `${legacyRoot}/${practical.id}/content-versions/${contentVersion.id}/localizations/${localization.id}`, {
        expectedRevision: practicalRevision,
        patch: { summary: "после утверждения" },
      });
      assert.equal(reply.status, 409, reply.text);
      assert.equal(reply.body.error, "AUTHORING_APPROVED_IMMUTABLE");
    });

    await check("L9 CLONE gives the author a way forward without touching the approval", async () => {
      const reply = await a.write("POST", `${A}/aggregates/content/${contentVersion.id}/clone`, {});
      assert.equal(reply.status, 201, reply.text);
      const cloned = data(reply);
      assert.equal(cloned.revision, 1);
      assert.equal(cloned.sourceEditorialState, "approved");
      const source = await prisma.contentVersion.findUniqueOrThrow({ where: { id: contentVersion.id } });
      assert.equal(source.editorialState, "approved", "the source keeps its approval");
      assert.equal(source.approvedById, reviewerB.id);
      // Remove the clone again so the handoff checks see one approved version.
      await prisma.contentLocalization.deleteMany({ where: { contentVersionId: Number(cloned.id) } });
      await prisma.contentVersion.delete({ where: { id: Number(cloned.id) } });
    });

    /* ==================================================== §25 review notes */
    await check("N1 notes are readable, appendable and scoped; there is no delete", async () => {
      const list = await c.request("GET", `${A}/aggregates/content/${contentVersion.id}/notes`);
      assert.equal(list.status, 200, list.text);
      const notes = (data(list).notes as Array<Record<string, unknown>>) ?? [];
      assert.ok(notes.length >= 1);
      assert.ok(notes.every((note) => typeof note.targetRevision === "number"));

      assert.equal(
        (await c.write("POST", `${A}/aggregates/content/${contentVersion.id}/notes`, { body: "read_only" })).status,
        403,
        "read_only may look, not touch",
      );
      const added = await b.write("POST", `${A}/aggregates/content/${contentVersion.id}/notes`, {
        body: "Согласовано.",
        path: "sections[0].title",
      });
      assert.equal(added.status, 201, added.text);
      assert.equal(
        (await b.request("DELETE", `${A}/aggregates/content/${contentVersion.id}/notes`)).status,
        405,
        "there is no delete method on the notes route",
      );
    });

    await check("N2 resolving a note on the WRONG target FAILS CLOSED", async () => {
      const notes = await prisma.editorialReviewNote.findMany({
        where: { contentVersionId: contentVersion.id, resolvedAt: null },
        orderBy: { id: "asc" },
      });
      assert.ok(notes.length > 0);
      const wrong = await b.write(
        "POST",
        `${A}/aggregates/assessment/${lessonBank.id}/notes/${notes[0].id}/resolve`,
        {},
      );
      assert.equal(wrong.status, 404, wrong.text);
      assert.equal(wrong.body.error, "AUTHORING_NOTE_NOT_FOUND");
      const right = await b.write(
        "POST",
        `${A}/aggregates/content/${contentVersion.id}/notes/${notes[0].id}/resolve`,
        {},
      );
      assert.equal(right.status, 200, right.text);
      const again = await b.write(
        "POST",
        `${A}/aggregates/content/${contentVersion.id}/notes/${notes[0].id}/resolve`,
        {},
      );
      assert.equal(again.status, 409, "resolving twice is an error, not a silent no-op");
    });

    /* ====================================================== §17 video panel */
    await check("W1 the production contract is readable with SERVER-owned coherence", async () => {
      const reply = await a.request("GET", `${A}/video-productions/${lessonVideo.id}`);
      assert.equal(reply.status, 200, reply.text);
      const row = data(reply);
      assert.equal(row.scriptState, "SCRIPT_PENDING");
      assert.ok(row.contractFingerprint);
      const coherence = row.coherence as { reason: string; assessmentEvidenceStale: boolean };
      assert.equal(coherence.reason, "UNLINKED");
      assert.equal(coherence.assessmentEvidenceStale, true, "unlinked never reads fresh");
    });

    await check("W2 the contract is editable under the aggregate guard", async () => {
      const current = await prisma.videoProductionVersion.findUniqueOrThrow({
        where: { id: lessonVideo.id },
      });
      const payload = { ...(current.contractPayload as Record<string, unknown>) };
      (payload.production as Record<string, unknown>).script = "SCRIPT_READY";
      const reply = await a.write("PUT", `${A}/video-productions/${lessonVideo.id}`, {
        expectedRevision: current.revision,
        payload,
      });
      assert.equal(reply.status, 200, reply.text);
      assert.equal(data(reply).scriptState, "SCRIPT_READY");
      const stale = await a.write("PUT", `${A}/video-productions/${lessonVideo.id}`, {
        expectedRevision: current.revision,
        payload,
      });
      assert.equal(stale.status, 409, "the second write with the same revision loses");
    });

    await check("W3 a caller may NOT supply a fingerprint — the strict contract rejects it", async () => {
      const current = await prisma.videoProductionVersion.findUniqueOrThrow({
        where: { id: lessonVideo.id },
      });
      const payload = {
        ...(current.contractPayload as Record<string, unknown>),
        contractFingerprint: "f".repeat(64),
      };
      const reply = await a.write("PUT", `${A}/video-productions/${lessonVideo.id}`, {
        expectedRevision: current.revision,
        payload,
      });
      assert.equal(reply.status, 422, reply.text);
      assert.equal(reply.body.error, "AUTHORING_INPUT_INVALID");
    });

    await check("W4 editing the REAL bank makes video evidence STALE on read", async () => {
      const coherenceModule = await import("../../src/lib/curriculum/video-production-coherence");
      await coherenceModule.linkVideoProductionAssessment(prisma as never, {
        videoProductionVersionId: lessonVideo.id,
        assessmentVersionId: lessonBank.id,
        actorId: legacyAdmin.id,
      });
      const fresh = data(await a.request("GET", `${A}/video-productions/${lessonVideo.id}`));
      assert.equal((fresh.coherence as { reason: string }).reason, "COHERENT");

      const question = await prisma.questionDefinition.findFirstOrThrow({
        where: { assessmentVersionId: lessonBank.id, questionNumber: 1 },
      });
      const qloc = await prisma.questionLocalization.findFirstOrThrow({
        where: { questionId: question.id, locale: "ru" },
      });
      const bank = await prisma.assessmentVersion.findUniqueOrThrow({ where: { id: lessonBank.id } });
      const edit = await a.write(
        "PATCH",
        `${legacyRoot}/${lesson.id}/assessment-versions/${lessonBank.id}/questions/${question.id}/localizations/${qloc.id}`,
        {
          expectedRevision: bank.revision,
          patch: { prompt: "Изменённый вопрос про дисциплину" },
        },
      );
      assert.equal(edit.status, 200, edit.text);

      const after = data(await a.request("GET", `${A}/video-productions/${lessonVideo.id}`));
      const coherence = after.coherence as { reason: string; assessmentEvidenceStale: boolean };
      assert.equal(coherence.assessmentEvidenceStale, true);
      assert.equal(coherence.reason, "ASSESSMENT_BANK_CHANGED");
    });

    /* ================================================ §16 conflict surface */
    await check("X1 the conflict surface compares fields and now offers adjudication", async () => {
      const reply = await c.request("GET", `${A}/levels/${lesson.id}/conflicts`);
      assert.equal(reply.status, 200, reply.text);
      const body = data(reply);
      // PHASE-G2 — G1 asserted `false` here because no resolution domain
      // existed and a UI must not render a control with nothing behind it. One
      // now exists, and it records a DECISION rather than rewriting either side,
      // so the conflicts below are still served in full.
      assert.equal(body.resolutionAvailable, true);
      const authority = body.sourceAuthority as { state: string; rawConflictCount: number };
      assert.equal(authority.state, "UNRESOLVED_CONFLICT");
      assert.ok(authority.rawConflictCount > 0);
      const conflicts = body.conflicts as Array<Record<string, string>>;
      assert.ok(conflicts.length > 0);
      for (const conflict of conflicts) {
        assert.ok(conflict.currentApprovedValue);
        assert.ok(conflict.blueprintProposalValue);
        assert.match(conflict.path, /^questions\[\d+\]\.(prompt|correctAnswerText)$/);
      }
    });

    /* ==================================== §26 / §29 THE PREVIEW PIN GATE */
    await check("PIN a preview pinned at 4/7/3 still renders 4/7/3 after the drafts move to 5/8/4", async () => {
      // Drive the three aggregates to exactly 4 / 7 / 3.
      await prisma.contentVersion.update({ where: { id: lessonContent.id }, data: { revision: 4 } });
      await prisma.assessmentVersion.update({ where: { id: lessonBank.id }, data: { revision: 7 } });
      await prisma.videoProductionVersion.update({ where: { id: lessonVideo.id }, data: { revision: 3 } });

      const created = await c.write("POST", `${A}/preview-snapshots`, {
        levelDefinitionId: lesson.id,
        contentVersionId: lessonContent.id,
        assessmentVersionId: lessonBank.id,
        videoProductionVersionId: lessonVideo.id,
      });
      assert.equal(created.status, 201, created.text);
      const snapshot = data(created);
      assert.equal(snapshot.contentRevision, 4, "revisions are READ server-side");
      assert.equal(snapshot.assessmentRevision, 7);
      assert.equal(snapshot.videoProductionRevision, 3);
      const code = String(snapshot.snapshotCode);

      const before = data(await c.request("GET", `${A}/preview-snapshots/${code}`));
      const frozenTitle = ((before.payload as Record<string, unknown>).content as Record<string, unknown>)
        .title as string;
      assert.equal(frozenTitle, "ЗАМОРОЖЕННЫЙ ЗАГОЛОВОК");

      // Now move every aggregate to 5 / 8 / 4 AND change the visible text.
      await prisma.contentVersion.update({ where: { id: lessonContent.id }, data: { revision: 5 } });
      await prisma.assessmentVersion.update({ where: { id: lessonBank.id }, data: { revision: 8 } });
      await prisma.videoProductionVersion.update({ where: { id: lessonVideo.id }, data: { revision: 4 } });
      await prisma.contentLocalization.updateMany({
        where: { contentVersionId: lessonContent.id },
        data: { title: "ЗАГОЛОВОК ПОСЛЕ СНИМКА" },
      });

      const after = data(await c.request("GET", `${A}/preview-snapshots/${code}`));
      const pinned = after.pinned as Record<string, number>;
      assert.equal(pinned.contentRevision, 4, "a FOLLOW-LATEST implementation fails here");
      assert.equal(pinned.assessmentRevision, 7);
      assert.equal(pinned.videoProductionRevision, 3);
      const payload = after.payload as Record<string, unknown>;
      assert.equal((payload.content as Record<string, unknown>).title, "ЗАМОРОЖЕННЫЙ ЗАГОЛОВОК");
      assert.notEqual((payload.content as Record<string, unknown>).title, "ЗАГОЛОВОК ПОСЛЕ СНИМКА");

      (globalThis as Record<string, unknown>).__previewCode = code;
    });

    await check("PR1 the learner frame carries NO answer key, explanation or production data", async () => {
      const code = String((globalThis as Record<string, unknown>).__previewCode);
      const reply = await c.request("GET", `${A}/preview-snapshots/${code}`);
      assert.equal(reply.status, 200);
      noStore(reply);
      // Every option label IS present — a learner sees all four. What must be
      // absent is any indication of WHICH one is right.
      assert.ok(reply.text.includes("Вариант A для вопроса 1"), "the options are the learner frame");
      for (const forbidden of [
        "ВНУТРЕННЕЕ ПОЯСНЕНИЕ",
        "correctAnswer",
        "correctOptionCode",
        "explanation",
        "isCorrect",
        "scriptState",
        "contractFingerprint",
        "sourceProvenance",
        "qaState",
      ]) {
        assert.ok(!reply.text.includes(forbidden), `${forbidden} must not reach a learner frame`);
      }
      const payload = data(reply).payload as Record<string, unknown>;
      const assessment = payload.assessment as {
        questions: Array<{ options: Array<Record<string, unknown>> }>;
      };
      assert.equal(assessment.questions.length, 4);
      for (const question of assessment.questions) {
        assert.equal(question.options.length, 4);
        for (const option of question.options) {
          assert.deepEqual(Object.keys(option).sort(), ["code", "label"]);
        }
      }
    });

    await check("PR2 the snapshot code alone grants NOTHING", async () => {
      const code = String((globalThis as Record<string, unknown>).__previewCode);
      const anon = await new Client().request("GET", `${A}/preview-snapshots/${code}`);
      assert.equal(anon.status, 401);
      const asLearner = new Client();
      await asLearner.login(learner.email);
      assert.equal((await asLearner.request("GET", `${A}/preview-snapshots/${code}`)).status, 403);
    });

    await check("PR3 the STAFF-side inspection reports the drift the learner frame hides", async () => {
      const code = String((globalThis as Record<string, unknown>).__previewCode);
      const reply = await a.request("GET", `${A}/preview-snapshots/${code}/internal`);
      assert.equal(reply.status, 200, reply.text);
      const body = data(reply);
      assert.equal(body.outdated, true);
      assert.deepEqual(body.pinned, {
        contentVersionId: lessonContent.id,
        contentRevision: 4,
        assessmentVersionId: lessonBank.id,
        assessmentRevision: 7,
        videoProductionVersionId: lessonVideo.id,
        videoProductionRevision: 3,
      });
      assert.deepEqual(body.current, {
        contentRevision: 5,
        assessmentRevision: 8,
        videoProductionRevision: 4,
      });
    });

    await check("PR4 reading a preview mutates NO learner state", async () => {
      const code = String((globalThis as Record<string, unknown>).__previewCode);
      const before = {
        lessonProgress: await prisma.userLessonProgress.count(),
        levelProgress: await prisma.userLevelProgress.count(),
        attempts: await prisma.assessmentAttempt.count(),
        xp: await prisma.xPTransaction.count(),
        enrollments: await prisma.userCurriculumEnrollment.count(),
      };
      for (let i = 0; i < 3; i += 1) await c.request("GET", `${A}/preview-snapshots/${code}`);
      assert.deepEqual(
        {
          lessonProgress: await prisma.userLessonProgress.count(),
          levelProgress: await prisma.userLevelProgress.count(),
          attempts: await prisma.assessmentAttempt.count(),
          xp: await prisma.xPTransaction.count(),
          enrollments: await prisma.userCurriculumEnrollment.count(),
        },
        before,
      );
    });

    /* ======================================================== §32 readiness */
    await check("RD1 readiness is served from server truth with separate counts", async () => {
      const reply = await c.request("GET", `${A}/readiness`);
      assert.equal(reply.status, 200, reply.text);
      const readiness = data(reply).readiness as Record<string, number>;
      assert.equal(readiness.totalLevels, 2);
      assert.equal(readiness.contentApprovedLevels, 1);
      assert.ok(!("completionPercent" in readiness));
      const counts = data(reply).workQueueCounts as Record<string, number>;
      assert.ok(counts.APPROVED_READY_FOR_HANDOFF >= 1);
    });

    await check("RD2 the work queue names every unresolved item with a reason", async () => {
      const reply = await c.request("GET", `${A}/work-queue`);
      const entries = data(reply).entries as Array<Record<string, string>>;
      assert.ok(entries.length > 0);
      for (const entry of entries) {
        assert.ok(entry.bucket && entry.reason && entry.stableCode);
      }
    });

    /* ========================================================= §38 handoff */
    await check("HO1 handoff status separates READY from BLOCKED and says what it is not", async () => {
      const reply = await c.request("GET", `${A}/handoff`);
      assert.equal(reply.status, 200, reply.text);
      const body = data(reply);
      assert.match(String(body.meaning), /not runtime publication/i);
      assert.deepEqual(body.readyLevels, [9]);
      assert.ok((body.blocked as unknown[]).length >= 1);
    });

    await check("HO2 read_only may NOT generate a bundle; the author may", async () => {
      assert.equal(
        (await c.write("POST", `${A}/handoff/bundle`, { curriculumVersionId: curriculum.id, levelNumbers: [9] })).status,
        403,
      );
      const reply = await a.write("POST", `${A}/handoff/bundle`, {
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
      });
      assert.equal(reply.status, 200, reply.text);
      const bundle = data(reply);
      assert.match(String(bundle.fingerprint), /^[0-9a-f]{64}$/);
      assert.equal((bundle.counts as Record<string, number>).included, 1);
      (globalThis as Record<string, unknown>).__fingerprint = bundle.fingerprint;
    });

    await check("HO3 a blocked level is refused by name, and the bundle publishes nothing", async () => {
      const reply = await a.write("POST", `${A}/handoff/bundle`, {
        curriculumVersionId: curriculum.id,
        levelNumbers: [5],
      });
      assert.equal(reply.status, 409, reply.text);
      assert.equal(reply.body.error, "AUTHORING_HANDOFF_BLOCKED");
      const published = await prisma.contentVersion.count({ where: { status: "published" } });
      assert.equal(published, 0, "no bundle request ever published anything");
    });

    await check("HO4 the same input produces the same fingerprint through HTTP", async () => {
      const reply = await a.write("POST", `${A}/handoff/bundle`, {
        curriculumVersionId: curriculum.id,
        levelNumbers: [9],
      });
      assert.equal(data(reply).fingerprint, (globalThis as Record<string, unknown>).__fingerprint);
    });

    /* ===================================================== §35 no escape hatch */
    await check("Z1 there is no arbitrary-update route under the authoring namespace", async () => {
      const routes = fs
        .readdirSync(path.join(ROOT, "src/app/api/admin/curriculum/authoring"), { recursive: true })
        .map(String)
        .filter((entry) => entry.endsWith("route.ts"));
      assert.ok(routes.length > 0);
      for (const route of routes) {
        const source = fs.readFileSync(
          path.join(ROOT, "src/app/api/admin/curriculum/authoring", route),
          "utf8",
        );
        assert.ok(source.split("\n").filter((line) => line.trim()).length <= 3, `${route} must be a thin export`);
      }
      const handlers = fs.readFileSync(path.join(ROOT, "src/lib/curriculum/authoring-routes.ts"), "utf8");
      for (const forbidden of ["$executeRaw", "$queryRaw", "updateMany({ where: { id: body"]) {
        assert.ok(!handlers.includes(forbidden), `${forbidden} must not appear in the authoring handlers`);
      }
    });

    await check("Z2 no authoring HTTP schema accepts a server-owned authority field", () => {
      const source = fs.readFileSync(path.join(ROOT, "src/lib/curriculum/authoring-http.ts"), "utf8");
      const schemas = source.slice(source.indexOf("/* ---------------------------- shared schemas"));
      for (const field of [
        "actorId:",
        "lastAuthoredById:",
        "submittedById:",
        "approvedById:",
        "approvedAt:",
        "publishedAt:",
        "editorialState:",
        "revision:",
        "contractFingerprint:",
        "assessmentFingerprint:",
        "targetRevision:",
        "snapshotCode:",
      ]) {
        assert.ok(!schemas.includes(field), `${field} must never be caller-supplied`);
      }
      assert.ok(schemas.includes("expectedRevision"), "the one revision a client MAY name");
    });
  } finally {
    await stop(server);
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect().catch(() => {});
    cleanup();
  }

  console.log(`\nPHASE-G1 authoring studio HTTP: ${passed} passed, ${failed} failed`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ passed, failed, results }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
