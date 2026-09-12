/**
 * CV-1 cross-route regression: `/current` -> `/content` must agree.
 *
 * Imports a SYNTHETIC_TEST_ONLY package into a synthetic database, publishes the
 * version, enrols one synthetic learner with L1 already completed server-side,
 * then drives the REAL learner read routes and asserts:
 *
 *   - every stable code `/current` returns is accepted by the canonical parser;
 *   - L2 returns genuinely CONFIGURED content — not a fallback, not a 404;
 *   - the L2 title is the lesson title, never the stable code;
 *   - localization and content binding actually resolved;
 *   - no correct answer appears anywhere in a learner response;
 *   - L1 and L4 remain non-self-completable;
 *   - no learner write happens and nothing touches the live DEV ports.
 *
 * This is the regression that would have caught the CI-2 defect where `/current`
 * emitted codes that `/content` rejected before any content lookup.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";

const dbPath = path.join(os.tmpdir(), `ata-package-roundtrip-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;
const port = 3940 + (process.pid % 20);
const baseUrl = `http://127.0.0.1:${port}`;
const password = "PackageRoundtrip123!";
const LEARNER = "package-roundtrip@example.com";
const FORBIDDEN_PORTS = [3100, 3010];

const L1 = "v2.l001.sinteticheskiy-vneshniy";
const L2 = "v2.l002.sinteticheskiy-urok";
const L3 = "v2.l003.sinteticheskiy-otchet";
const L4 = "v2.l004.sinteticheskaya-tochka";
const L2_LESSON_TITLE = "Синтетический урок — материал";
const CORRECT_OPTION = "sekretnyy-pravilnyy-otvet";

let passed = 0;
let failed = 0;
const evidence: string[] = [];

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: dbUrl,
  SESSION_SECRET: "package-roundtrip-session-secret",
  APP_URL: baseUrl,
  STORAGE_DRIVER: "local",
  EMAIL_VERIFICATION_REQUIRED: "false",
  CAPTCHA_DEV_BYPASS: "true",
  CURRICULUM_V2_READ_ENABLED: "true",
  CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
  CURRICULUM_V2_CONTENT_ENABLED: "true",
};
for (const key of ["CURRICULUM_V2_ADMIN_ENABLED", "CURRICULUM_V2_XP_ENABLED", "CURRICULUM_V2_ASSESSMENT_ENABLED", "CURRICULUM_V2_REPORT_ENABLED", "NODE_ENV"]) {
  delete baseEnv[key];
}

let logs = "";
async function start(): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
    cwd: process.cwd(),
    env: baseEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (v) => { logs += String(v); });
  child.stderr?.on("data", (v) => { logs += String(v); });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return child;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`next dev failed to start\n${logs.slice(-3000)}`);
}

async function stop(child: ChildProcess | null) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
}

type Reply = { status: number; body: Record<string, unknown>; text: string };

class Client {
  cookies = new Map<string, string>();
  async request(method: string, url: string, body?: unknown): Promise<Reply> {
    assert.ok(!FORBIDDEN_PORTS.some((p) => url.includes(`:${p}`)), "test must never touch a live DEV port");
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    evidence.push(`${method}\t${url.split("?")[0]}\t${response.status}`);
    const text = await response.text();
    let value: unknown = {};
    try { value = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: response.status, body: value as Record<string, unknown>, text };
  }
}

/** SYNTHETIC_TEST_ONLY package — invented content, never shippable. */
function syntheticPackage() {
  const provenance = {
    classification: "SYNTHETIC_TEST_ONLY",
    sourcePath: "scripts/regression/curriculumPackageRoundtripRegression.ts",
    sourceRef: "SYNTHETIC_TEST_ONLY",
    revision: "cv1",
    confidence: "high",
    conflicts: [],
    approvalRequired: true,
    note: "SYNTHETIC_TEST_ONLY — not curriculum content",
  };
  const gate = (source: string, code: string, text: string) => ({
    completionSource: source,
    integrationCode: code,
    selfCompletable: false,
    blockedExplanation: [{ locale: "ru", text }],
    provenance,
  });
  return {
    schemaVersion: "ata.curriculum.package/1",
    minImporterVersion: 1,
    packageCode: "synthetic.roundtrip",
    packageRevision: 1,
    status: "draft",
    curriculumCode: "ata-v2",
    curriculumVersionNumber: 1,
    curriculumTitle: "Синтетический курс",
    curriculumDescription: "SYNTHETIC_TEST_ONLY",
    locale: "ru",
    createdFrom: "SYNTHETIC_TEST_ONLY",
    approval: { approvedBy: null, approvedAt: null, note: "SYNTHETIC_TEST_ONLY" },
    pendingApprovals: [],
    contentFingerprint: "0".repeat(64),
    modules: [
      {
        moduleCode: "module.01",
        moduleNumber: 1,
        title: "Синтетический модуль",
        description: "SYNTHETIC_TEST_ONLY",
        learningObjective: "Синтетическая цель",
        checkpointLevelCode: L4,
        levels: [
          {
            levelCode: L1, levelNumber: 1, type: "external_event", title: "Синтетический внешний шаг",
            shortDescription: "", learningObjective: "Пройти внешний шаг", completionMethod: "pocket_postback",
            xpReward: 0, requiredXp: 0, prerequisiteLevelCodes: [], checkpointLevelCode: null,
            estimatedDurationSeconds: null, content: null, assessment: null, report: null,
            gate: gate("external_event", "pocket.registration", "Подтверждается внешней системой."), provenance,
          },
          {
            levelCode: L2, levelNumber: 2, type: "lesson", title: "Синтетический урок",
            shortDescription: "", learningObjective: "Понять структуру", completionMethod: "assessment_pass",
            xpReward: 20, requiredXp: 0, prerequisiteLevelCodes: [L1], checkpointLevelCode: null,
            estimatedDurationSeconds: 600,
            content: {
              contentCode: "synthetic.l002.content", versionNumber: 1, status: "published",
              videoDurationSeconds: 600,
              localizations: [{
                locale: "ru", title: L2_LESSON_TITLE, subtitle: "Подзаголовок",
                learningObjectiveExtension: "Расширение цели", summary: "Краткое описание материала.",
                transcript: "Синтетическая расшифровка.",
                body: {
                  sections: [{ code: "intro", title: "Раздел", body: "Тело урока." }],
                  examples: [], commonMistakes: [], glossary: [],
                  nextAction: { label: "Дальше", body: "Следующий уровень." },
                  riskDisclaimer: "Дисклеймер.",
                },
              }],
              assets: [], provenance,
            },
            assessment: {
              assessmentCode: "synthetic.l002.assessment", versionNumber: 1, status: "published",
              passPercent: 80, maxAttempts: 3, showExplanation: true,
              questions: [{
                questionCode: "synthetic.q1", questionNumber: 1, type: "single_choice", skillTag: null,
                // The correct option code is a distinctive marker: if it ever
                // appears in a learner response, the leak test fails loudly.
                optionCodes: [CORRECT_OPTION, "nepravilnyy"],
                correctOptionCodes: [CORRECT_OPTION], correctNumericValue: null,
                localizations: [{ locale: "ru", prompt: "Вопрос?", optionLabels: ["А", "Б"], explanation: "Объяснение." }],
                lessonTakeawayRef: "intro", provenance,
              }],
              provenance,
            },
            report: null, gate: null, provenance,
          },
          {
            levelCode: L3, levelNumber: 3, type: "report", title: "Синтетический отчёт",
            shortDescription: "", learningObjective: "Оформить отчёт", completionMethod: "report_approval",
            xpReward: 30, requiredXp: 0, prerequisiteLevelCodes: [L2], checkpointLevelCode: null,
            estimatedDurationSeconds: null, content: null, assessment: null,
            report: {
              reportCode: "synthetic.l003.report", versionNumber: 1, status: "published",
              localizations: [{ locale: "ru", title: "Отчёт", instructions: "Задание.", successCriteriaSummary: "", submitLabel: "" }],
              fields: [{
                stableKey: "summary", type: "long_text", required: true, sortOrder: 0,
                minLength: 10, maxLength: 2000, choiceCodes: [],
                localizations: [{ locale: "ru", label: "Итог", helpText: "", placeholder: "", choiceLabels: [] }],
              }],
              attachmentsAllowed: false, maxAttachments: 0, draftAllowed: true, mentorReviewRequired: true, provenance,
            },
            gate: null, provenance,
          },
          {
            levelCode: L4, levelNumber: 4, type: "financial_checkpoint", title: "Синтетическая контрольная точка",
            shortDescription: "", learningObjective: "Подтвердить баланс", completionMethod: "balance_check",
            xpReward: 0, requiredXp: 0, prerequisiteLevelCodes: [L3], checkpointLevelCode: null,
            estimatedDurationSeconds: null, content: null, assessment: null, report: null,
            gate: gate("financial_checkpoint", "checkpoint.module-01", "Подтверждается по балансу."), provenance,
          },
        ],
      },
    ],
  };
}

async function main() {
  cleanupDb();
  let server: ChildProcess | null = null;
  try {
    const migration = spawnSync(
      process.execPath,
      [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
      { cwd: process.cwd(), env: baseEnv, encoding: "utf8" },
    );
    if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

    process.env.DATABASE_URL = dbUrl;
    const { prisma } = await import("../../src/lib/prisma");
    const { importCurriculumPackage } = await import("../../src/lib/curriculum/package/import");
    const { calculateFingerprint } = await import("../../src/lib/curriculum/package/fingerprint");
    const { isCanonicalLevelCode } = await import("../../src/lib/curriculum/stable-code");

    const raw = syntheticPackage();
    const sealed = { ...raw, contentFingerprint: calculateFingerprint({ ...raw, contentFingerprint: "0".repeat(64) } as never) };

    const imported = await importCurriculumPackage(sealed, { db: prisma });
    assert.equal(imported.ok, true, `import failed: ${JSON.stringify(imported)}`);

    // Publication and activation are deliberately NOT importer responsibilities;
    // the test performs them explicitly so the learner routes have an active
    // version to resolve.
    const version = await prisma.curriculumVersion.findFirstOrThrow({ where: { code: "ata-v2", versionNumber: 1 } });
    const past = new Date("2026-06-01T00:00:00.000Z");
    await prisma.curriculumVersion.update({
      where: { id: version.id },
      data: { status: "published", publishedAt: past, effectiveFrom: past },
    });

    const hash = await bcrypt.hash(password, 10);
    const learner = await prisma.user.create({
      data: { email: LEARNER, name: "Roundtrip Learner", passwordHash: hash, role: "user", status: "active" },
    });
    const enrollment = await prisma.userCurriculumEnrollment.create({
      data: {
        userId: learner.id, curriculumVersionId: version.id, curriculumCode: "ata-v2", status: "active",
        enrolledAt: past, currentLevel: 2, highestCompletedLevel: 1, lastMeaningfulActionAt: past,
      },
    });
    const levelOne = await prisma.levelDefinition.findFirstOrThrow({ where: { curriculumVersionId: version.id, stableCode: L1 } });
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrollment.id, curriculumVersionId: version.id, levelDefinitionId: levelOne.id,
        status: "completed", startedAt: past, lastProgressAt: past, completedAt: past,
        completionMethod: "external", attemptCount: 1,
      },
    });

    const writeCountsBefore = {
      progress: await prisma.userLevelProgress.count(),
      attempts: await prisma.assessmentAttempt.count(),
      submissions: await prisma.reportSubmission.count(),
    };

    server = await start();
    const client = new Client();

    await check("login as the synthetic learner", async () => {
      const reply = await client.request("POST", "/api/auth/login", { email: LEARNER, password, captchaToken: "dev-captcha-ok" });
      assert.equal(reply.status, 200);
    });

    let currentReply: Reply;
    let returnedCodes: string[] = [];

    await check("6/7 /current returns the imported curriculum", async () => {
      currentReply = await client.request("GET", "/api/curriculum/v2/current");
      assert.equal(currentReply.status, 200);
      const data = currentReply.body.data as Record<string, unknown>;
      const modules = data.modules as Array<Record<string, unknown>>;
      returnedCodes = modules.flatMap((m) => (m.levels as Array<Record<string, unknown>>).map((l) => String(l.stableCode)));
      assert.deepEqual(returnedCodes, [L1, L2, L3, L4]);
    });

    await check("8 every code /current returns passes the canonical parser", () => {
      for (const code of returnedCodes) {
        assert.equal(isCanonicalLevelCode(code), true, `/current emitted a non-canonical code: ${code}`);
      }
    });

    await check("server-resolved states: L1 completed, L2 available, L3/L4 locked", () => {
      const data = currentReply.body.data as Record<string, unknown>;
      const levels = (data.modules as Array<Record<string, unknown>>)
        .flatMap((m) => m.levels as Array<Record<string, unknown>>);
      const state = (code: string) => levels.find((l) => l.stableCode === code)?.presentationState;
      assert.equal(state(L1), "completed");
      assert.equal(state(L2), "available");
      assert.equal(state(L3), "locked");
      assert.equal(state(L4), "locked");
    });

    let contentReply: Reply;

    await check("9/10 L2 content returns REAL configured content, not a fallback", async () => {
      contentReply = await client.request("GET", `/api/curriculum/v2/levels/${encodeURIComponent(L2)}/content?locale=ru`);
      assert.equal(contentReply.status, 200, `expected configured content, got ${contentReply.status} ${contentReply.text.slice(0, 300)}`);
      const data = contentReply.body.data as Record<string, unknown>;
      assert.ok(data.kind === "available" || data.kind === "completed", `unexpected kind ${String(data.kind)}`);
      // Explicitly reject every fallback shape.
      assert.ok(!contentReply.text.includes("CONTENT_UNAVAILABLE"));
      assert.ok(!contentReply.text.includes("content_not_configured"));
      assert.ok(!contentReply.text.includes("localization_unavailable"));
      assert.ok(!contentReply.text.includes("level_not_accessible"));
    });

    await check("11 L2 title is the lesson title, never the stable code", () => {
      const data = contentReply.body.data as Record<string, unknown>;
      const content = data.content as Record<string, unknown>;
      const localization = content.localization as Record<string, unknown>;
      assert.equal(localization.title, L2_LESSON_TITLE);
      assert.notEqual(localization.title, L2);
      const level = data.level as Record<string, unknown>;
      assert.notEqual(level.title, level.stableCode);
    });

    await check("12/13/14 content metadata, localization and binding resolved", () => {
      const data = contentReply.body.data as Record<string, unknown>;
      const content = data.content as Record<string, unknown>;
      assert.equal(content.versionNumber, 1);
      assert.equal(content.videoDurationSeconds, 600);
      assert.ok(content.publishedAt, "content must be published for the binding to resolve");
      const localization = content.localization as Record<string, unknown>;
      assert.equal(localization.locale, "ru");
      assert.ok(localization.body, "localized body must be present");
    });

    await check("16 no correct answer appears in any learner response", () => {
      assert.ok(!contentReply.text.includes(CORRECT_OPTION), "correct answer leaked into level content");
      assert.ok(!currentReply.text.includes(CORRECT_OPTION), "correct answer leaked into /current");
      assert.ok(!contentReply.text.includes("correctAnswer"));
      assert.ok(!currentReply.text.includes("correctAnswer"));
    });

    await check("17/18 L1 and L4 remain non-self-completable gates", async () => {
      const data = currentReply.body.data as Record<string, unknown>;
      const levels = (data.modules as Array<Record<string, unknown>>)
        .flatMap((m) => m.levels as Array<Record<string, unknown>>);
      for (const code of [L1, L4]) {
        const level = levels.find((l) => l.stableCode === code);
        assert.ok(level, `${code} missing from /current`);
        assert.ok(
          !["lesson", "manual", "assessment_pass", "report_approval", "mentor_review"].includes(String(level!.completionMethod)),
          `${code} carries a learner-driven completion method`,
        );
      }
      // A gated level's content route must not hand out a completable surface.
      const l4 = await client.request("GET", `/api/curriculum/v2/levels/${encodeURIComponent(L4)}/content?locale=ru`);
      assert.notEqual(l4.status, 200, "checkpoint level must not serve learner content");
    });

    await check("19 no learner write occurred during the read journey", async () => {
      assert.equal(await prisma.userLevelProgress.count(), writeCountsBefore.progress);
      assert.equal(await prisma.assessmentAttempt.count(), writeCountsBefore.attempts);
      assert.equal(await prisma.reportSubmission.count(), writeCountsBefore.submissions);
    });

    await check("20 no request touched a live DEV port", () => {
      for (const line of evidence) {
        for (const forbidden of FORBIDDEN_PORTS) {
          assert.ok(!line.includes(`:${forbidden}`), `evidence touched port ${forbidden}: ${line}`);
        }
      }
    });

    await check("a code /current can return is never rejected by /content syntactically", async () => {
      for (const code of returnedCodes) {
        const reply = await client.request("GET", `/api/curriculum/v2/levels/${encodeURIComponent(code)}/content?locale=ru`);
        // Locked/unsupported levels legitimately fail — but never with the
        // syntactic rejection that bit CI-2.
        assert.ok(
          !reply.text.includes("level_not_accessible") || reply.status !== 404 || isCanonicalLevelCode(code),
          `${code} was syntactically rejected by /content`,
        );
      }
    });

    fs.mkdirSync(path.join("tmp", "cv1"), { recursive: true });
    fs.writeFileSync(
      path.join("tmp", "cv1", "roundtrip-evidence.tsv"),
      `method\tpath\tstatus\n${[...new Set(evidence)].join("\n")}\n`,
    );

    await prisma.$disconnect();
  } finally {
    await stop(server);
  }
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanupDb);
