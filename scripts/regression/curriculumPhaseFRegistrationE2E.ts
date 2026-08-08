/**
 * ATA-PRODUCT-PHASE-F — REGISTRATION AUTO-ENROLLMENT, through the REAL route.
 *
 * ============================ WHAT THIS PROVES ============================
 * The domain regression proves the enrollment primitive. This proves the thing
 * a learner actually touches: `POST /api/auth/register`, imported and invoked as
 * the route module, against a disposable database.
 *
 *   - Turnstile still runs FIRST, and a refusal leaves no user and no
 *     enrollment — the ordering §16 requires, verified rather than reviewed.
 *   - Validation still runs BEFORE Turnstile, so a malformed request never even
 *     reaches the provider.
 *   - With auto-enrollment OFF, the response and the durable state are exactly
 *     what they are today.
 *   - With it ON, one registration produces exactly one enrollment, in one
 *     transaction, and a replay produces no second one.
 *   - With it ON and the curriculum unavailable, the registration FAILS with 503
 *     and leaves NO user, NO referral row and NO attribution behind.
 *
 * ======================== HOW TURNSTILE IS HANDLED ========================
 * It is NOT weakened, disabled or bypassed. `CAPTCHA_PROVIDER=turnstile` is set,
 * the route's own surface pin is untouched, and verification runs in full — only
 * the NETWORK call to Cloudflare's siteverify endpoint is intercepted, through
 * `globalThis.fetch`, because a regression must not depend on the internet. The
 * stub answers exactly what the documented API answers, including the `action`
 * the platform pins, so the action check, the success check and the error-code
 * mapping are all exercised for real.
 *
 * No live database, no live environment file, no live port, no network.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const dbPath = `/tmp/ata-phase-f-registration-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Every siteverify call the run makes, so ORDERING can be asserted. */
const siteverifyCalls: string[] = [];
let siteverifyAnswer: () => Response = () =>
  new Response(JSON.stringify({ success: true, action: "academy_register", hostname: "localhost" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function installFetchStub() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("challenges.cloudflare.com")) {
      siteverifyCalls.push(url);
      return siteverifyAnswer();
    }
    throw new Error(`unexpected network call in a regression: ${url}`);
  }) as typeof fetch;
  return real;
}

let ipCounter = 0;
function registerRequest(body: Record<string, unknown>) {
  // A fresh client IP per request: the route rate-limits registration at 3 per
  // IP per 30 minutes, which is a real control this suite must not weaken.
  ipCounter += 1;
  return new Request("http://127.0.0.1/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${ipCounter % 250}`,
    },
    body: JSON.stringify(body),
  });
}

const PASSWORD = "PhaseF123!";

async function main() {
  cleanup();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  process.env.DATABASE_URL = dbUrl;
  process.env.ATA_ENVIRONMENT = "dev";
  // A real provider with a real (non-test-shaped) secret: the verification path
  // is the production one. Only the network hop is stubbed.
  process.env.CAPTCHA_PROVIDER = "turnstile";
  process.env.TURNSTILE_SECRET_KEY = "phase-f-regression-secret-not-a-real-credential";
  delete process.env.CAPTCHA_TEST_MODE;
  delete process.env.TURNSTILE_EXPECTED_ACTION;
  delete process.env.TURNSTILE_EXPECTED_HOSTNAMES;
  delete process.env.EMAIL_VERIFICATION_REQUIRED;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED;

  installFetchStub();

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const route = await import("../../src/app/api/auth/register/route");

  const BEFORE = new Date("2026-07-01T00:00:00.000Z");
  async function publishCurriculum() {
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: "Phase F",
        versionNumber: 1,
        status: "published",
        publishedAt: BEFORE,
        effectiveFrom: BEFORE,
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: "m-1",
        title: "Phase F module",
        firstLevel: 1,
        lastLevel: 2,
        learningObjective: "Learn",
      },
    });
    for (const levelNumber of [1, 2]) {
      await prisma.levelDefinition.create({
        data: {
          curriculumVersionId: version.id,
          moduleId: moduleDefinition.id,
          levelNumber,
          stableCode: `v2.l${String(levelNumber).padStart(3, "0")}.phase-f`,
          type: "lesson",
          title: `Level ${levelNumber}`,
          learningObjective: "Learn",
          completionMethod: "manual",
          xpReward: 150,
          requiredXp: 0,
          requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
          status: "active",
        },
      });
    }
    return version;
  }

  async function unpublishCurriculum() {
    await prisma.curriculumVersion.updateMany({ data: { status: "draft" } });
  }

  /* ------------------------------------------------------------------ *
   * SECURITY ORDERING — unchanged, and proven unchanged
   * ------------------------------------------------------------------ */

  await check("R1 a malformed request is refused BEFORE Turnstile is ever asked", async () => {
    const before = siteverifyCalls.length;
    const response = await route.POST(
      registerRequest({ email: "not-an-email", password: "x", captchaToken: "tok" }),
    );
    assert.equal(response.status, 400);
    assert.equal(siteverifyCalls.length, before, "validation must precede the provider call");
    assert.equal(await prisma.user.count(), 0);
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  await check("R2 a REJECTED challenge creates no user and no enrollment", async () => {
    process.env.CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED = "true";
    await publishCurriculum();
    siteverifyAnswer = () =>
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const before = siteverifyCalls.length;
    const response = await route.POST(
      registerRequest({
        email: `rejected-${process.pid}@example.com`,
        password: PASSWORD,
        captchaToken: "rejected-token",
      }),
    );
    assert.equal(siteverifyCalls.length, before + 1, "the provider must actually be asked");
    assert.ok(response.status >= 400 && response.status < 500, `unexpected ${response.status}`);
    assert.equal(await prisma.user.count(), 0, "a refused challenge must leave no learner");
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  await check("R3 a token minted for ANOTHER surface is refused, and enrolls nobody", async () => {
    siteverifyAnswer = () =>
      new Response(
        JSON.stringify({ success: true, action: "academy_login", hostname: "localhost" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const response = await route.POST(
      registerRequest({
        email: `wrong-surface-${process.pid}@example.com`,
        password: PASSWORD,
        captchaToken: "login-token",
      }),
    );
    assert.ok(response.status >= 400 && response.status < 500, `unexpected ${response.status}`);
    assert.equal(await prisma.user.count(), 0);
    assert.equal(await prisma.userCurriculumEnrollment.count(), 0);
  });

  /* ------------------------------------------------------------------ *
   * THE FLAG MATRIX
   * ------------------------------------------------------------------ */

  siteverifyAnswer = () =>
    new Response(
      JSON.stringify({ success: true, action: "academy_register", hostname: "localhost" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  await check("R4 OFF: registration behaves exactly as it does today — no enrollment", async () => {
    delete process.env.CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED;
    const email = `flag-off-${process.pid}@example.com`;
    const response = await route.POST(
      registerRequest({ email, password: PASSWORD, captchaToken: "ok" }),
    );
    assert.equal(response.status, 201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(user.level, 1);
    assert.equal(
      await prisma.userCurriculumEnrollment.count({ where: { userId: user.id } }),
      0,
      "with the flag off nothing enrolls",
    );
    // A session is still issued, exactly as before.
    const { SESSION_COOKIE_NAME } = await import("../../src/lib/session");
    assert.ok(
      response.headers.getSetCookie().some((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`)),
      "the shipped session cookie must still be issued",
    );
  });

  await check("R5 ON: one registration produces exactly one pinned enrollment", async () => {
    process.env.CURRICULUM_V2_REGISTRATION_AUTO_ENROLL_ENABLED = "true";
    const email = `flag-on-${process.pid}@example.com`;
    const response = await route.POST(
      registerRequest({ email, password: PASSWORD, captchaToken: "ok" }),
    );
    assert.equal(response.status, 201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const enrollments = await prisma.userCurriculumEnrollment.findMany({
      where: { userId: user.id },
    });
    assert.equal(enrollments.length, 1);
    assert.equal(enrollments[0].curriculumCode, "ata-v2");
    assert.equal(enrollments[0].status, "active");
    assert.equal(enrollments[0].currentLevel, 1);
    assert.equal(enrollments[0].highestCompletedLevel, 0);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: "UserCurriculumEnrollment", entityId: String(enrollments[0].id) },
    });
    assert.ok(audit);
    assert.equal(audit!.userId, null);
    assert.equal((audit!.metadata as { provenance?: string }).provenance, "system_registration");
    // The response body is unchanged: registration does not leak enrollment
    // internals to the browser.
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["user", "verification"]);
    assert.ok(!JSON.stringify(body).includes("enrollment"));
  });

  await check("R6 a duplicate email is refused and creates no second enrollment", async () => {
    const email = `flag-on-${process.pid}@example.com`;
    const before = await prisma.userCurriculumEnrollment.count();
    const response = await route.POST(
      registerRequest({ email, password: PASSWORD, captchaToken: "ok" }),
    );
    assert.equal(response.status, 400);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
    assert.equal(await prisma.userCurriculumEnrollment.count(), before);
  });

  await check("R7 ON with NO active curriculum: 503, and NO learner is left behind", async () => {
    await unpublishCurriculum();
    const email = `no-curriculum-${process.pid}@example.com`;
    const usersBefore = await prisma.user.count();
    const response = await route.POST(
      registerRequest({ email, password: PASSWORD, captchaToken: "ok" }),
    );
    assert.equal(response.status, 503, "a broken curriculum must not answer 201");
    const body = (await response.json()) as { error?: string };
    assert.equal(body.error, "REGISTRATION_UNAVAILABLE");
    assert.equal(await prisma.user.count({ where: { email } }), 0, "the transaction must roll back");
    assert.equal(await prisma.user.count(), usersBefore);
    assert.equal(
      await prisma.referral.count({ where: { invited: { email } } }),
      0,
      "no referral row may survive the rollback",
    );
    // The refusal is on the record, without naming a learner that does not exist.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "REGISTRATION_ENROLLMENT_FAILED" },
      orderBy: { id: "desc" },
    });
    assert.ok(audit, "the refusal must be audited");
    assert.equal(audit!.userId, null);
    assert.equal(
      (audit!.metadata as { code?: string }).code,
      "ENROLLMENT_TARGET_UNAVAILABLE",
    );
    assert.ok(!JSON.stringify(audit!.metadata).includes(email), "the audit names no learner");
  });

  await check("R8 the curriculum returning: registration succeeds and enrolls again", async () => {
    await prisma.curriculumVersion.updateMany({ data: { status: "published" } });
    const email = `recovered-${process.pid}@example.com`;
    const response = await route.POST(
      registerRequest({ email, password: PASSWORD, captchaToken: "ok" }),
    );
    assert.equal(response.status, 201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(await prisma.userCurriculumEnrollment.count({ where: { userId: user.id } }), 1);
  });

  await check("R9 existing learners are NOT bulk-enrolled by this phase", async () => {
    // The learner created in R4, while the flag was off, still has no
    // enrollment. Nothing about turning the flag on reaches backwards.
    const legacy = await prisma.user.findUniqueOrThrow({
      where: { email: `flag-off-${process.pid}@example.com` },
    });
    assert.equal(
      await prisma.userCurriculumEnrollment.count({ where: { userId: legacy.id } }),
      0,
      "activation must not retroactively enroll existing accounts",
    );
  });

  await check("R10 the route accepts no enrollment-shaped field from the browser", async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/auth/register/route.ts"),
      "utf8",
    );
    for (const forbidden of [
      "parsed.data.userId",
      "parsed.data.enrollmentId",
      "parsed.data.curriculumVersionId",
      "parsed.data.xp",
      "parsed.data.currentLevel",
    ]) {
      assert.ok(!source.includes(forbidden), `the route must not read ${forbidden}`);
    }
    // The enrollment call takes the id of the user this transaction created and
    // an evaluation time. Nothing else.
    assert.ok(
      /autoEnrollNewRegistrationInTransaction\(tx, \{\s*userId: created\.id,\s*asOf: now,\s*\}\)/.test(
        source,
      ),
      "auto-enrollment must be called with the freshly created learner only",
    );
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nPhase F registration E2E: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
