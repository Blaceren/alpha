/**
 * QAOPS-1 — the PREPROD QA operator capability regression.
 *
 * Proves the whole contract: exactly one reserved synthetic principal, minimum
 * source-derived role and profile, externally supplied password, exact-reuse and
 * conflict-refuse semantics, a PREPROD-only guard that fails closed on
 * production and on an unclassified host, host-only attestation limited to the
 * two existing event classes, reuse of the accepted domain services with no
 * direct progress mutation, operator audit attribution, and no new HTTP surface.
 *
 * Runs entirely against a disposable SQLite database built by the shipped
 * migration runner. The live PREPROD database is never opened: `DATABASE_URL` is
 * repointed at a temporary file BEFORE any module that could construct a client
 * is imported, and the path is asserted to be outside the live data directory
 * before anything is written.
 *
 * Some cases drive the REAL CLI as a subprocess rather than calling into it, so
 * that argument parsing, the guard order, stdin handling and the exit codes are
 * exercised exactly as an operator would meet them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient, type LevelDefinition, type LevelDefinitionType } from "@prisma/client";

/* --------------------------------------------------------- disposable state */

const dbPath = path.join(os.tmpdir(), `ata-preprod-qa-operator-${process.pid}.db`);
const dbUrl = `file:${dbPath}`;

// The live PREPROD database lives under /srv/ata-data. A regression that could
// ever resolve a path inside it is a regression that must not start.
const LIVE_DATA_ROOT = "/srv/ata-data";
if (path.resolve(dbPath).startsWith(LIVE_DATA_ROOT)) {
  throw new Error("refusing to run: the temporary database resolves inside the live data root");
}
process.env.DATABASE_URL = dbUrl;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join("scripts", "ops", "preprodQaOperator.ts");
const TSX = path.join("node_modules", "tsx", "dist", "cli.mjs");
const EVALUATION_TIME = new Date("2026-08-01T12:00:00.000Z");

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${passed + failed}. ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${passed + failed}. ${name}`);
    console.error(error);
  }
}

function cleanupDb() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/**
 * The PREPROD environment, reproduced faithfully: a production BUILD
 * (`NODE_ENV=production`) on a deployment declared `staging`. The secrets are
 * throwaway values that exist only so `validateRuntimeEnv` can answer — none is
 * read from the host and none is a real key.
 */
function stagingEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ATA_ENVIRONMENT: "staging",
    STAGING_ATTESTATION_ENABLED: "true",
    DATABASE_URL: dbUrl,
    SESSION_SECRET: "regression-session-secret-value-0123456789",
    APP_URL: "https://preprod.example.invalid",
    CAPTCHA_PROVIDER: "turnstile",
    CAPTCHA_LOGIN_ENFORCED: "true",
    TURNSTILE_SECRET_KEY: "regression-turnstile-secret",
    POSTBACK_SECRET: "regression-postback-secret",
    STORAGE_DRIVER: "local",
    POCKET_AFFILIATE_BASE_URL: "https://pocket.example.invalid/affiliate",
    CURRICULUM_V2_READ_ENABLED: "true",
    CURRICULUM_V2_ENROLLMENT_ENABLED: "true",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

const MANAGED_ENV_KEYS = [
  "NODE_ENV",
  "ATA_ENVIRONMENT",
  "STAGING_ATTESTATION_ENABLED",
  "SESSION_SECRET",
  "APP_URL",
  "CAPTCHA_PROVIDER",
  "CAPTCHA_LOGIN_ENFORCED",
  "TURNSTILE_SECRET_KEY",
  "POSTBACK_SECRET",
  "STORAGE_DRIVER",
  "POCKET_AFFILIATE_BASE_URL",
  "CURRICULUM_V2_READ_ENABLED",
  "CURRICULUM_V2_ENROLLMENT_ENABLED",
  "ATA_QA_OPS_CONFIRM",
  "ATA_QA_OPERATOR_PASSWORD",
];

function applyProcessEnv(env: NodeJS.ProcessEnv) {
  for (const key of MANAGED_ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key] as string;
  }
}

/** Run the real CLI in a child process with an explicit environment. */
function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input = "",
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [TSX, CLI, ...args], {
    cwd: REPO_ROOT,
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    input,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const VALID_PASSWORD = "PreprodQa2026x";

async function main() {
  cleanupDb();
  const migration = spawnSync(process.execPath, [TSX, path.join("prisma", "migrate.ts")], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_URL: dbUrl },
    encoding: "utf8",
  });
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  applyProcessEnv(stagingEnv());

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const identity = await import("../ops/preprod-qa-operator/identity");
  const guard = await import("../ops/preprod-qa-operator/guard");
  const password = await import("../ops/preprod-qa-operator/password");
  const provision = await import("../ops/preprod-qa-operator/provision");
  const attestModule = await import("../ops/preprod-qa-operator/attest");
  const cli = await import("../ops/preprodQaOperator");
  const roles = await import("../../src/lib/crm/roles");

  let sequence = 0;

  async function reset() {
    await prisma.xPTransaction.deleteMany();
    await prisma.stagingAttestation.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.staffProfile.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
    applyProcessEnv(stagingEnv());
  }

  async function counts() {
    return {
      users: await prisma.user.count(),
      staffProfiles: await prisma.staffProfile.count(),
      auditLogs: await prisma.auditLog.count(),
      enrollments: await prisma.userCurriculumEnrollment.count(),
      progress: await prisma.userLevelProgress.count(),
      xp: await prisma.xPTransaction.count(),
      exchangeAccounts: await prisma.exchangeAccount.count(),
      pocketIdentities: await prisma.pocketTraderIdentity.count(),
      attributions: await prisma.affiliateAttribution.count(),
      attestations: await prisma.stagingAttestation.count(),
    };
  }

  async function createLearner(label: string) {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.invalid`,
        name: label,
        role: "user",
        status: "active",
      },
    });
  }

  type LevelSpec = {
    type?: LevelDefinitionType;
    completionMethod?: string;
    stableCode?: string;
  };

  async function createGraph(specs: LevelSpec[]) {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `qa-operator-${sequence}`,
        versionNumber: sequence,
        status: "published",
        publishedAt: EVALUATION_TIME,
        effectiveFrom: new Date(EVALUATION_TIME.getTime() - 60_000),
      },
    });
    const moduleDefinition = await prisma.moduleDefinition.create({
      data: {
        curriculumVersionId: version.id,
        moduleNumber: 1,
        code: `m-${version.id}`,
        title: "QA operator module",
        firstLevel: 1,
        lastLevel: specs.length,
        learningObjective: "Learn",
      },
    });
    const levels: LevelDefinition[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index] as LevelSpec;
      const levelNumber = index + 1;
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode:
              spec.stableCode ?? `v2.l${String(levelNumber).padStart(3, "0")}.qaops-${version.id}`,
            type: spec.type ?? "lesson",
            title: `Level ${levelNumber}`,
            learningObjective: "Learn",
            completionMethod: spec.completionMethod ?? "manual",
            xpReward: spec.type === "lesson" ? 10 : 0,
            requiredXp: 0,
            requiredPreviousLevel: levelNumber === 1 ? null : levelNumber - 1,
            status: "active",
          },
        }),
      );
    }
    return { version, levels };
  }

  async function enroll(userId: number, versionId: number, currentLevel = 1) {
    const version = await prisma.curriculumVersion.findUniqueOrThrow({ where: { id: versionId } });
    return prisma.userCurriculumEnrollment.create({
      data: {
        userId,
        curriculumVersionId: version.id,
        curriculumCode: version.code,
        status: "active",
        enrolledAt: EVALUATION_TIME,
        currentLevel,
        highestCompletedLevel: currentLevel - 1,
      },
    });
  }

  /** Provision through the real service, from a clean database. */
  async function provisionFresh() {
    await reset();
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    assert.equal(outcome.action, "created");
    return outcome;
  }

  /* ================================================================ IDENTITY */

  await check("the reserved identity is a lowercase, non-routable .invalid address", () => {
    assert.equal(identity.QA_OPERATOR_EMAIL, identity.QA_OPERATOR_EMAIL.toLowerCase());
    assert.match(identity.QA_OPERATOR_EMAIL, /@[a-z0-9.-]+\.invalid$/);
    assert.ok(!identity.QA_OPERATOR_EMAIL.includes("test.com"));
    // Login lowercases the submitted address and then matches EXACTLY against a
    // case-sensitive unique column, so an uppercase character here would be an
    // account nobody could ever log into.
    assert.ok(identity.QA_OPERATOR_EMAIL.includes("qa"));
    assert.ok(identity.QA_OPERATOR_EMAIL.includes("preprod"));
  });

  await check("the identity is clearly marked as synthetic PREPROD QA", () => {
    assert.match(identity.QA_OPERATOR_NAME, /PREPROD QA/);
    assert.match(identity.QA_OPERATOR_NAME, /synthetic/i);
    assert.match(identity.QA_OPERATOR_STAFF_DISPLAY_NAME, /PREPROD QA/);
  });

  await check("User.role is the source-derived floor: admin, required by requireAdmin", () => {
    assert.equal(identity.QA_OPERATOR_USER_ROLE, "admin");
  });

  await check("StaffProfile.staffRole resolves to the EMPTY CRM permission set", () => {
    const permissions = roles.resolveEffectivePermissions(identity.QA_OPERATOR_STAFF_ROLE);
    assert.deepEqual(permissions, [], "the QA staff role must grant no CRM permission at all");
    // And it is not an eligible CRM learner-owner either, which is the one axis
    // on which the other empty-permission role (`mentor`) is wider.
    assert.equal(roles.isEligibleOwnerRole(identity.QA_OPERATOR_STAFF_ROLE), false);
    assert.equal(roles.isCrmStaffRole(identity.QA_OPERATOR_STAFF_ROLE), true);
  });

  await check("the QA staff role grants no curriculum authoring capability", async () => {
    const authoring = await import("../../src/lib/curriculum/authoring-authorization");
    for (const capability of ["read", "author", "approve", "adjudicate"] as const) {
      assert.equal(
        authoring.staffRoleGrantsCurriculumCapability(identity.QA_OPERATOR_STAFF_ROLE, capability),
        false,
        `staffRole must not grant ${capability}`,
      );
    }
  });

  /* ============================================================= ENVIRONMENT */

  await check("staging with the capability marker and the sentinel is allowed", () => {
    const env = stagingEnv({ ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision });
    assert.equal(guard.checkQaOpsAllowed("provision", env).kind, "allowed");
  });

  await check("ATA_ENVIRONMENT=production is refused", () => {
    const env = stagingEnv({
      ATA_ENVIRONMENT: "production",
      ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision,
    });
    const result = guard.checkQaOpsAllowed("provision", env);
    assert.equal(result.kind, "refused");
    assert.equal(result.kind === "refused" && result.reason, "environment_not_staging");
  });

  await check("a missing environment identity is refused", () => {
    const env = stagingEnv({
      ATA_ENVIRONMENT: undefined,
      ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision,
    });
    const result = guard.checkQaOpsAllowed("provision", env);
    assert.equal(result.kind === "refused" && result.reason, "environment_not_staging");
  });

  await check("an unknown or misspelled environment is refused", () => {
    for (const value of ["Staging", " staging", "preprod", "stage", "dev", ""]) {
      const env = stagingEnv({
        ATA_ENVIRONMENT: value,
        ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision,
      });
      const result = guard.checkQaOpsAllowed("provision", env);
      assert.equal(
        result.kind === "refused" && result.reason,
        "environment_not_staging",
        `ATA_ENVIRONMENT=${JSON.stringify(value)} must be refused`,
      );
    }
  });

  await check("the PREPROD capability marker is required and is not NODE_ENV", () => {
    const env = stagingEnv({
      STAGING_ATTESTATION_ENABLED: undefined,
      ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision,
    });
    const result = guard.checkQaOpsAllowed("provision", env);
    assert.equal(result.kind === "refused" && result.reason, "staging_capability_absent");

    // A non-production build does not unlock anything either: "not production"
    // is never the question this guard asks.
    const devBuild = stagingEnv({
      NODE_ENV: "development",
      ATA_ENVIRONMENT: "production",
      ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision,
    });
    assert.equal(
      guard.checkQaOpsAllowed("provision", devBuild).kind === "refused" &&
        (guard.checkQaOpsAllowed("provision", devBuild) as { reason: string }).reason,
      "environment_not_staging",
    );
  });

  await check("an environment the application would not boot on is refused", async () => {
    const envModule = await import("../../src/lib/env");
    // Two independently invalid deployments: one still carrying the development
    // session secret, and one missing a key production requires. Neither is a
    // deployment this tool may act on, whatever ATA_ENVIRONMENT claims.
    for (const overrides of [
      { SESSION_SECRET: envModule.DEV_SESSION_SECRET },
      { POSTBACK_SECRET: undefined },
      { STORAGE_DRIVER: undefined },
    ]) {
      const env = stagingEnv({
        ...overrides,
        ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.provision,
      });
      const result = guard.checkQaOpsAllowed("provision", env);
      assert.equal(
        result.kind === "refused" && result.reason,
        "runtime_env_invalid",
        `${JSON.stringify(overrides)} must be refused`,
      );
    }
  });

  await check("the acknowledgement is required, exact, and per-verb", () => {
    const missing = guard.checkQaOpsAllowed("provision", stagingEnv());
    assert.equal(missing.kind === "refused" && missing.reason, "acknowledgement_missing");

    // The other verb's sentinel does not authorize this one.
    const crossed = guard.checkQaOpsAllowed(
      "provision",
      stagingEnv({ ATA_QA_OPS_CONFIRM: guard.QA_OPS_CONFIRM_VALUES.attest }),
    );
    assert.equal(crossed.kind === "refused" && crossed.reason, "acknowledgement_missing");
    assert.notEqual(guard.QA_OPS_CONFIRM_VALUES.provision, guard.QA_OPS_CONFIRM_VALUES.attest);

    // Near-misses are refused rather than normalised.
    for (const value of ["provision_preprod_qa_operator", "PROVISION_PREPROD_QA_OPERATOR ", "true", "yes"]) {
      const result = guard.checkQaOpsAllowed("provision", stagingEnv({ ATA_QA_OPS_CONFIRM: value }));
      assert.equal(result.kind === "refused" && result.reason, "acknowledgement_missing");
    }
  });

  await check("the environment half refuses before the acknowledgement is even consulted", () => {
    // A production host is answered "wrong environment" whatever anyone typed, so
    // the sentinel is never a value a production host can be walked toward.
    const env = stagingEnv({ ATA_ENVIRONMENT: "production", ATA_QA_OPS_CONFIRM: "anything" });
    const result = guard.checkPreprodEnvironment(env);
    assert.equal(result.kind === "refused" && result.reason, "environment_not_staging");
  });

  /* ============================================================ PROVISIONING */

  await check("provisioning creates exactly one operator, with exactly one staff profile", async () => {
    await reset();
    const before = await counts();
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    const after = await counts();

    assert.equal(outcome.action, "created");
    assert.equal(after.users - before.users, 1);
    assert.equal(after.staffProfiles - before.staffProfiles, 1);
    assert.equal(after.auditLogs - before.auditLogs, 1);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
      include: { staffProfile: true },
    });
    assert.equal(user.role, identity.QA_OPERATOR_USER_ROLE);
    assert.equal(user.status, "active");
    assert.equal(user.name, identity.QA_OPERATOR_NAME);
    assert.notEqual(user.emailVerifiedAt, null);
    assert.notEqual(user.passwordHash, "");
    assert.equal(user.staffProfile?.staffRole, identity.QA_OPERATOR_STAFF_ROLE);
    assert.equal(user.staffProfile?.displayName, identity.QA_OPERATOR_STAFF_DISPLAY_NAME);
  });

  await check("the stored password verifies with bcrypt, so the principal can log in", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
    });
    assert.equal(await bcrypt.compare(VALID_PASSWORD, user.passwordHash), true);
    assert.equal(await bcrypt.compare("not-the-password", user.passwordHash), false);
  });

  await check("provisioning creates NO learner, financial or curriculum row", async () => {
    const after = await counts();
    assert.equal(after.enrollments, 0);
    assert.equal(after.progress, 0);
    assert.equal(after.xp, 0);
    assert.equal(after.exchangeAccounts, 0);
    assert.equal(after.pocketIdentities, 0);
    assert.equal(after.attributions, 0);
    assert.equal(await prisma.curriculumVersion.count(), 0);
  });

  await check("the provisioning audit row is attributed to the synthetic principal", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
    });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: identity.QA_OPERATOR_AUDIT_ACTION },
    });
    assert.equal(log.userId, user.id, "the actor must not be null or a system actor");
    const metadata = log.metadata as Record<string, unknown>;
    assert.equal(metadata.environment, "staging");
    assert.equal(metadata.synthetic, true);
    assert.equal(metadata.purpose, "preprod_qa_operator");
    // No password material of any kind in the trail.
    const serialised = JSON.stringify(metadata);
    assert.ok(!serialised.includes(VALID_PASSWORD));
    assert.ok(!/\$2[aby]\$/.test(serialised), "no bcrypt hash may appear in audit metadata");
  });

  await check("a second run is idempotent and writes nothing at all", async () => {
    const before = await counts();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
    });
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    const after = await counts();

    assert.equal(outcome.action, "already_configured");
    assert.equal(outcome.readOnly, true);
    assert.deepEqual(after, before, "an exact-reuse run must write nothing");
    const again = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
    });
    assert.equal(again.passwordHash, user.passwordHash, "the password hash must not be rewritten");
    assert.deepEqual(again.updatedAt, user.updatedAt, "the User row must not be touched");
  });

  await check("a DIFFERENT password on a reuse run does not re-key the account", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const outcome = await provision.provisionQaOperator(prisma, "CompletelyOther9");
    assert.equal(outcome.action, "already_configured");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
    });
    assert.equal(await bcrypt.compare(VALID_PASSWORD, user.passwordHash), true);
    assert.equal(await bcrypt.compare("CompletelyOther9", user.passwordHash), false);
  });

  await check("a conflicting principal at the reserved address is refused, with no write", async () => {
    await reset();
    await prisma.user.create({
      data: {
        email: identity.QA_OPERATOR_EMAIL,
        name: "Somebody Else",
        role: "user",
        status: "active",
        passwordHash: "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder",
        emailVerifiedAt: EVALUATION_TIME,
      },
    });
    const before = await counts();
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    const after = await counts();

    assert.equal(outcome.action, "conflict");
    assert.equal(outcome.readOnly, true);
    assert.deepEqual(after, before, "a conflict must write nothing");
    assert.ok(outcome.conflicts.some((c) => c.includes("role is user")));
    assert.ok(outcome.conflicts.some((c) => c.includes("name")));

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { email: identity.QA_OPERATOR_EMAIL },
    });
    assert.equal(untouched.role, "user", "an existing principal's role must never be rewritten");
    assert.equal(untouched.name, "Somebody Else");
  });

  await check("a principal carrying learner state is refused even if otherwise identical", async () => {
    await reset();
    const graph = await createGraph([{ type: "lesson", completionMethod: "manual" }]);
    const user = await prisma.user.create({
      data: {
        email: identity.QA_OPERATOR_EMAIL,
        name: identity.QA_OPERATOR_NAME,
        role: identity.QA_OPERATOR_USER_ROLE,
        status: "active",
        passwordHash: "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder",
        emailVerifiedAt: EVALUATION_TIME,
      },
    });
    await enroll(user.id, graph.version.id);

    const before = await counts();
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    assert.equal(outcome.action, "conflict");
    assert.ok(outcome.conflicts.some((c) => c.includes("enrollment")));
    assert.deepEqual(await counts(), before);
  });

  await check("a staff profile with a different role is a conflict, never an update", async () => {
    await reset();
    const user = await prisma.user.create({
      data: {
        email: identity.QA_OPERATOR_EMAIL,
        name: identity.QA_OPERATOR_NAME,
        role: identity.QA_OPERATOR_USER_ROLE,
        status: "active",
        passwordHash: "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder",
        emailVerifiedAt: EVALUATION_TIME,
      },
    });
    await prisma.staffProfile.create({
      data: { userId: user.id, displayName: "Wrong", staffRole: "crm_admin" },
    });

    const before = await counts();
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    assert.equal(outcome.action, "conflict");
    assert.deepEqual(await counts(), before);
    const profile = await prisma.staffProfile.findUniqueOrThrow({ where: { userId: user.id } });
    assert.equal(profile.staffRole, "crm_admin", "an existing staff role must never be rewritten");
  });

  await check("a half-finished run is completed by creating only the missing profile", async () => {
    await reset();
    const user = await prisma.user.create({
      data: {
        email: identity.QA_OPERATOR_EMAIL,
        name: identity.QA_OPERATOR_NAME,
        role: identity.QA_OPERATOR_USER_ROLE,
        status: "active",
        passwordHash: "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder",
        emailVerifiedAt: EVALUATION_TIME,
      },
    });
    const before = await counts();
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    const after = await counts();

    assert.equal(outcome.action, "staff_profile_created");
    assert.equal(after.users, before.users, "no user is created on this path");
    assert.equal(after.staffProfiles - before.staffProfiles, 1);
    assert.equal(after.auditLogs - before.auditLogs, 1);
    const again = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(again.passwordHash, user.passwordHash);
    assert.deepEqual(again.updatedAt, user.updatedAt);
  });

  await check("a principal with no password set is a conflict, not a silent re-key", async () => {
    await reset();
    await prisma.user.create({
      data: {
        email: identity.QA_OPERATOR_EMAIL,
        name: identity.QA_OPERATOR_NAME,
        role: identity.QA_OPERATOR_USER_ROLE,
        status: "active",
        emailVerifiedAt: EVALUATION_TIME,
      },
    });
    const outcome = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    assert.equal(outcome.action, "conflict");
    assert.ok(outcome.conflicts.some((c) => c.includes("no password")));
  });

  await check("this is not the six-account upsertLiveTestAccounts behaviour", async () => {
    await provisionFresh();
    const users = await prisma.user.findMany({ select: { email: true } });
    assert.equal(users.length, 1, "exactly one principal, never six");
    assert.equal(users[0]?.email, identity.QA_OPERATOR_EMAIL);

    // And the source shares nothing with it: no `.com` identity, no shared
    // password constant, no update branch.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, "scripts", "ops", "preprod-qa-operator", "provision.ts"),
      "utf8",
    );
    assert.ok(!source.includes("test.com"));
    assert.ok(!source.includes("TEST_ACCOUNT_PASSWORD"));
    assert.ok(!/\.\s*update\s*\(/.test(source), "no update call may exist in the provisioner");
    assert.ok(!/\.\s*upsert\s*\(/.test(source), "no upsert call may exist in the provisioner");
    assert.ok(!/deleteMany|\.\s*delete\s*\(/.test(source), "the provisioner may not delete");
  });

  /* ================================================================ PASSWORD */

  await check("a password is required: absent input fails closed", async () => {
    const intake = await password.intakeOperatorPassword(
      stagingEnv({ ATA_QA_OPERATOR_PASSWORD: undefined }),
      { isTTY: true } as NodeJS.ReadStream,
    );
    assert.equal(intake.kind, "absent");
  });

  await check("a weak password is rejected by the product's own registration policy", async () => {
    for (const weak of ["short", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"]) {
      const intake = await password.intakeOperatorPassword(
        stagingEnv({ ATA_QA_OPERATOR_PASSWORD: weak }),
        { isTTY: true } as NodeJS.ReadStream,
      );
      assert.equal(intake.kind, "rejected", `${weak} must be rejected`);
    }
  });

  await check("the password is accepted from the environment and from stdin", async () => {
    const fromEnv = await password.intakeOperatorPassword(
      stagingEnv({ ATA_QA_OPERATOR_PASSWORD: VALID_PASSWORD }),
      { isTTY: true } as NodeJS.ReadStream,
    );
    assert.equal(fromEnv.kind, "supplied");
    assert.equal(fromEnv.kind === "supplied" && fromEnv.source, "env");

    async function* piped() {
      yield Buffer.from(`${VALID_PASSWORD}\n`);
    }
    const stdinStub = Object.assign(piped(), { isTTY: false }) as unknown as NodeJS.ReadStream;
    const fromStdin = await password.intakeOperatorPassword(
      stagingEnv({ ATA_QA_OPERATOR_PASSWORD: undefined }),
      stdinStub,
    );
    assert.equal(fromStdin.kind === "supplied" && fromStdin.password, VALID_PASSWORD);
    assert.equal(fromStdin.kind === "supplied" && fromStdin.source, "stdin");
  });

  await check("no password or hash is hardcoded anywhere in the capability", () => {
    for (const file of [
      path.join("scripts", "ops", "preprodQaOperator.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "identity.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "guard.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "password.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "provision.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "attest.ts"),
    ]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      assert.ok(!/\$2[aby]\$/.test(source), `${file} must contain no bcrypt hash`);
      assert.ok(
        !/password\s*[:=]\s*["'][^"']+["']/i.test(source),
        `${file} must contain no password literal`,
      );
    }
  });

  /* ============================================================= ATTESTATION */

  /**
   * A learner standing on the L1 registration gate, with a checkpoint at L2.
   *
   * L1 carries the CANONICAL registration stable code. That is not decoration:
   * `reconcilePocketRegistrationLevelCompletion` resolves the level by the fixed
   * `POCKET_REGISTRATION_STABLE_CODE` constant rather than by whatever code the
   * caller passed, so a registration attestation against any other code is
   * refused `configuration_error` by the domain. The live PREPROD L1 carries the
   * same code.
   */
  const REGISTRATION_STABLE_CODE = "v2.l001.registraciya-pocket";

  async function attestationFixture() {
    await reset();
    const operator = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    const learner = await createLearner("learner");
    const graph = await createGraph([
      {
        type: "external_event",
        completionMethod: "pocket_postback",
        stableCode: REGISTRATION_STABLE_CODE,
      },
      { type: "financial_checkpoint", completionMethod: "balance_check" },
      { type: "lesson", completionMethod: "manual" },
    ]);
    const enrollment = await enroll(learner.id, graph.version.id, 1);
    return { operatorId: operator.userId as number, learner, graph, enrollment };
  }

  await check("pocket_registration is attested on the correct target and completes L1", async () => {
    const fixture = await attestationFixture();
    const target = {
      eventClass: "pocket_registration" as const,
      learnerUserId: fixture.learner.id,
      stableCode: fixture.graph.levels[0]!.stableCode,
      requestId: "qaops-registration-0001",
    };
    const preflight = await attestModule.preflightAttestation(prisma, target);
    assert.equal(preflight.kind, "ok");

    const receipt = await attestModule.attestAsQaOperator(prisma, fixture.operatorId, target);
    assert.equal(receipt.created, true);
    assert.equal(receipt.completed, true);
    assert.equal(receipt.xpAwarded, 0);
    assert.equal(receipt.xpTransactionId, null);

    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: fixture.enrollment.id, levelDefinitionId: fixture.graph.levels[0]!.id },
    });
    assert.equal(progress.status, "completed");
    assert.equal(await prisma.xPTransaction.count(), 0, "a gate awards nothing");
  });

  await check("financial_checkpoint is attested on the correct target and completes it", async () => {
    const fixture = await attestationFixture();
    // The learner reaches L2 the only legitimate way: by completing L1 through
    // the engine. Editing `currentLevel` by hand would leave the enrollment
    // summary inconsistent, which the completion primitive correctly refuses as
    // `COMPLETION_STATE_CORRUPT` — the fixture must not fake progression either.
    await attestModule.attestAsQaOperator(prisma, fixture.operatorId, {
      eventClass: "pocket_registration",
      learnerUserId: fixture.learner.id,
      stableCode: fixture.graph.levels[0]!.stableCode,
      requestId: "qaops-checkpoint-prereq",
    });
    const advanced = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: fixture.enrollment.id },
    });
    assert.equal(advanced.currentLevel, 2, "completing L1 must advance the learner");

    const target = {
      eventClass: "financial_checkpoint" as const,
      learnerUserId: fixture.learner.id,
      stableCode: fixture.graph.levels[1]!.stableCode,
      requestId: "qaops-checkpoint-0001",
    };
    assert.equal((await attestModule.preflightAttestation(prisma, target)).kind, "ok");
    const receipt = await attestModule.attestAsQaOperator(prisma, fixture.operatorId, target);
    assert.equal(receipt.created, true);
    assert.equal(receipt.completed, true);
    assert.equal(receipt.xpAwarded, 0);
  });

  await check("the attestation is attributed to the synthetic QA operator", async () => {
    const fixture = await attestationFixture();
    const target = {
      eventClass: "pocket_registration" as const,
      learnerUserId: fixture.learner.id,
      stableCode: fixture.graph.levels[0]!.stableCode,
      requestId: "qaops-attribution-0001",
    };
    await attestModule.attestAsQaOperator(prisma, fixture.operatorId, target);

    const row = await prisma.stagingAttestation.findFirstOrThrow({});
    assert.equal(row.attestedById, fixture.operatorId);
    assert.equal(row.environment, "staging");

    const constants = await import("../../src/lib/curriculum/constants");
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: constants.CURRICULUM_AUDIT_ACTIONS.stagingAttestationRecorded },
    });
    assert.equal(log.userId, fixture.operatorId, "the audit actor must be the QA operator");
    const metadata = log.metadata as Record<string, unknown>;
    assert.equal(metadata.attestedById, fixture.operatorId);
    assert.equal(metadata.environment, "staging");

    // And the actor is demonstrably the synthetic principal, not a real one.
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: fixture.operatorId } });
    assert.equal(actor.email, identity.QA_OPERATOR_EMAIL);
  });

  await check("the wrong event class for a level is refused", async () => {
    const fixture = await attestationFixture();
    const result = await attestModule.preflightAttestation(prisma, {
      eventClass: "financial_checkpoint",
      learnerUserId: fixture.learner.id,
      // The L1 registration gate, aimed at with the checkpoint event class.
      stableCode: fixture.graph.levels[0]!.stableCode,
      requestId: "qaops-wrong-type-0001",
    });
    assert.equal(result.kind === "refused" && result.code, "LEVEL_WRONG_KIND");
  });

  await check("a lesson level can never be attested by either event class", async () => {
    const fixture = await attestationFixture();
    for (const eventClass of ["pocket_registration", "financial_checkpoint"] as const) {
      const result = await attestModule.preflightAttestation(prisma, {
        eventClass,
        learnerUserId: fixture.learner.id,
        stableCode: fixture.graph.levels[2]!.stableCode,
        requestId: `qaops-lesson-${eventClass}`,
      });
      assert.equal(result.kind === "refused" && result.code, "LEVEL_WRONG_KIND");
    }
    // And the domain refuses it too, not merely the pre-flight.
    await assert.rejects(
      attestModule.attestAsQaOperator(prisma, fixture.operatorId, {
        eventClass: "pocket_registration",
        learnerUserId: fixture.learner.id,
        stableCode: fixture.graph.levels[2]!.stableCode,
        requestId: "qaops-lesson-domain",
      }),
      (error: { code?: string }) => error.code === "STAGING_ATTESTATION_LEVEL_WRONG_KIND",
    );
  });

  await check("a level the learner is not standing on is refused", async () => {
    const fixture = await attestationFixture();
    const result = await attestModule.preflightAttestation(prisma, {
      eventClass: "financial_checkpoint",
      learnerUserId: fixture.learner.id,
      stableCode: fixture.graph.levels[1]!.stableCode,
      requestId: "qaops-not-current-0001",
    });
    assert.equal(result.kind === "refused" && result.code, "LEVEL_NOT_CURRENT");
  });

  await check("an unknown stable code is refused", async () => {
    const fixture = await attestationFixture();
    const result = await attestModule.preflightAttestation(prisma, {
      eventClass: "pocket_registration",
      learnerUserId: fixture.learner.id,
      stableCode: "v2.l999.not-in-this-curriculum",
      requestId: "qaops-unknown-level-0001",
    });
    assert.equal(result.kind === "refused" && result.code, "LEVEL_NOT_FOUND");
  });

  await check("a missing, blocked or unenrolled learner is refused", async () => {
    const fixture = await attestationFixture();
    const base = {
      eventClass: "pocket_registration" as const,
      stableCode: fixture.graph.levels[0]!.stableCode,
      requestId: "qaops-learner-state-0001",
    };

    const missing = await attestModule.preflightAttestation(prisma, {
      ...base,
      learnerUserId: 999_999,
    });
    assert.equal(missing.kind === "refused" && missing.code, "LEARNER_NOT_FOUND");

    const unenrolled = await createLearner("unenrolled");
    const notEnrolled = await attestModule.preflightAttestation(prisma, {
      ...base,
      learnerUserId: unenrolled.id,
    });
    assert.equal(notEnrolled.kind === "refused" && notEnrolled.code, "LEARNER_NOT_ENROLLED");

    await prisma.user.update({ where: { id: fixture.learner.id }, data: { status: "blocked" } });
    const blocked = await attestModule.preflightAttestation(prisma, {
      ...base,
      learnerUserId: fixture.learner.id,
    });
    assert.equal(blocked.kind === "refused" && blocked.code, "LEARNER_NOT_ACTIVE");
  });

  await check("the operator cannot attest a gate for itself", async () => {
    await reset();
    const operator = await provision.provisionQaOperator(prisma, VALID_PASSWORD);
    const graph = await createGraph([{ type: "external_event", completionMethod: "pocket_postback" }]);
    await enroll(operator.userId as number, graph.version.id, 1);

    const result = await attestModule.preflightAttestation(prisma, {
      eventClass: "pocket_registration",
      learnerUserId: operator.userId as number,
      stableCode: graph.levels[0]!.stableCode,
      requestId: "qaops-self-0001",
    });
    assert.equal(result.kind === "refused" && result.code, "OPERATOR_IS_THE_LEARNER");

    await assert.rejects(
      attestModule.attestAsQaOperator(prisma, operator.userId as number, {
        eventClass: "pocket_registration",
        learnerUserId: operator.userId as number,
        stableCode: graph.levels[0]!.stableCode,
        requestId: "qaops-self-0002",
      }),
      (error: { code?: string }) => error.code === "STAGING_ATTESTATION_FORBIDDEN",
    );
  });

  await check("an unprovisioned or unauthorized operator cannot attest", async () => {
    await reset();
    const learner = await createLearner("learner");
    const graph = await createGraph([{ type: "external_event", completionMethod: "pocket_postback" }]);
    await enroll(learner.id, graph.version.id, 1);
    const target = {
      eventClass: "pocket_registration" as const,
      learnerUserId: learner.id,
      stableCode: graph.levels[0]!.stableCode,
      requestId: "qaops-no-operator-0001",
    };

    const none = await attestModule.preflightAttestation(prisma, target);
    assert.equal(none.kind === "refused" && none.code, "OPERATOR_NOT_PROVISIONED");

    // A LEARNER sitting at the reserved address is refused: the capability is not
    // reachable by demoting the operator, and the domain refuses it as well.
    const impostor = await prisma.user.create({
      data: {
        email: identity.QA_OPERATOR_EMAIL,
        name: identity.QA_OPERATOR_NAME,
        role: "user",
        status: "active",
        passwordHash: "$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder",
        emailVerifiedAt: EVALUATION_TIME,
      },
    });
    const demoted = await attestModule.preflightAttestation(prisma, target);
    assert.equal(demoted.kind === "refused" && demoted.code, "OPERATOR_NOT_AUTHORIZED");
    await assert.rejects(
      attestModule.attestAsQaOperator(prisma, impostor.id, target),
      (error: { code?: string }) => error.code === "STAGING_ATTESTATION_FORBIDDEN",
    );
    assert.equal(await prisma.stagingAttestation.count(), 0);
  });

  await check("only the two existing event classes exist; anything else is not a class", async () => {
    const domain = await import("../../src/lib/curriculum/staging-attestation");
    assert.deepEqual(
      [...domain.STAGING_ATTESTATION_EVENT_CLASSES],
      ["pocket_registration", "financial_checkpoint"],
    );
    for (const bogus of [
      "report_approval",
      "assessment_pass",
      "mentor_review",
      "level_completion",
      "deposit",
      "",
    ]) {
      assert.equal(attestModule.asEventClass(bogus), null, `${bogus} must not be an event class`);
    }
  });

  await check("the ops modules never write progress, XP or enrollment", () => {
    // Every Prisma model whose rows are owned by the completion engine. The ops
    // layer may READ them (the pre-flight does) and must never write one: the
    // whole point of calling `attestStagingGate` is that the engine owns these.
    const OWNED_BY_THE_ENGINE = [
      "userLevelProgress",
      "xPTransaction",
      "xpTransaction",
      "userCurriculumEnrollment",
      "stagingAttestation",
    ];
    const WRITE_VERBS = [
      "create",
      "createMany",
      "update",
      "updateMany",
      "upsert",
      "delete",
      "deleteMany",
    ];
    // Raw SQL of any kind, which no path in this capability may use.
    const RAW_SQL = ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"];

    for (const file of ["attest.ts", "provision.ts", "guard.ts", "identity.ts", "password.ts"]) {
      const source = fs.readFileSync(
        path.join(REPO_ROOT, "scripts", "ops", "preprod-qa-operator", file),
        "utf8",
      );
      for (const model of OWNED_BY_THE_ENGINE) {
        for (const verb of WRITE_VERBS) {
          assert.ok(
            !source.includes(`${model}.${verb}(`),
            `${file} must not call ${model}.${verb}()`,
          );
        }
      }
      for (const raw of RAW_SQL) {
        assert.ok(!source.includes(raw), `${file} must not use ${raw}`);
      }
    }

    // The negative control: this same scan MUST flag a source that does write
    // one of these, or the scan above proves nothing about the real files.
    const canary = "await tx.userLevelProgress.create({ data: {} });";
    assert.ok(
      OWNED_BY_THE_ENGINE.some((model) =>
        WRITE_VERBS.some((verb) => canary.includes(`${model}.${verb}(`)),
      ),
      "the scan must be able to detect a forbidden write",
    );
  });

  /* ============================================================ THE REAL CLI */

  await check("the CLI refuses to apply on a production deployment and writes nothing", async () => {
    await provisionFresh();
    const before = await counts();
    const result = runCli(
      ["provision", "--apply"],
      stagingEnv({
        ATA_ENVIRONMENT: "production",
        STAGING_ATTESTATION_ENABLED: undefined,
        ATA_QA_OPS_CONFIRM: "PROVISION_PREPROD_QA_OPERATOR",
        ATA_QA_OPERATOR_PASSWORD: VALID_PASSWORD,
      }),
    );
    assert.equal(result.status, cli.EXIT.refusedByGuard);
    assert.match(result.stderr, /environment_not_staging/);
    assert.deepEqual(await counts(), before);
  });

  await check("the CLI refuses even a DRY RUN off staging, so it never reads PROD", async () => {
    const result = runCli(["provision"], stagingEnv({ ATA_ENVIRONMENT: undefined }));
    assert.equal(result.status, cli.EXIT.refusedByGuard);
    assert.match(result.stderr, /environment_not_staging/);
  });

  await check("the CLI fails closed when no password is supplied", async () => {
    await reset();
    const before = await counts();
    const result = runCli(
      ["provision", "--apply"],
      stagingEnv({
        ATA_QA_OPS_CONFIRM: "PROVISION_PREPROD_QA_OPERATOR",
        ATA_QA_OPERATOR_PASSWORD: undefined,
      }),
      "", // an empty stdin pipe: not a TTY, and nothing on it
    );
    assert.equal(result.status, cli.EXIT.refusedByGuard);
    assert.match(result.stderr, /a password is required/);
    assert.deepEqual(await counts(), before);
  });

  await check("the CLI refuses to apply without the acknowledgement", async () => {
    await reset();
    const before = await counts();
    const result = runCli(
      ["provision", "--apply"],
      stagingEnv({ ATA_QA_OPS_CONFIRM: undefined, ATA_QA_OPERATOR_PASSWORD: VALID_PASSWORD }),
    );
    assert.equal(result.status, cli.EXIT.refusedByGuard);
    assert.match(result.stderr, /acknowledgement_missing/);
    assert.deepEqual(await counts(), before);
  });

  await check("the CLI dry run reports without writing", async () => {
    await reset();
    const before = await counts();
    const result = runCli(["provision"], stagingEnv());
    assert.equal(result.status, cli.EXIT.ok);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.applied, false);
    assert.equal(payload.action, "created");
    assert.equal(payload.email, identity.QA_OPERATOR_EMAIL);
    assert.deepEqual(await counts(), before);
  });

  await check("the CLI provisions end to end with the sentinel and a piped password", async () => {
    await reset();
    const result = runCli(
      ["provision", "--apply"],
      stagingEnv({
        ATA_QA_OPS_CONFIRM: "PROVISION_PREPROD_QA_OPERATOR",
        ATA_QA_OPERATOR_PASSWORD: undefined,
      }),
      `${VALID_PASSWORD}\n`,
    );
    assert.equal(result.status, cli.EXIT.ok);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.applied, true);
    assert.equal(payload.action, "created");
    assert.equal(payload.staffRole, identity.QA_OPERATOR_STAFF_ROLE);
    // The password never appears in either stream.
    assert.ok(!result.stdout.includes(VALID_PASSWORD));
    assert.ok(!result.stderr.includes(VALID_PASSWORD));
    assert.ok(!/\$2[aby]\$/.test(result.stdout + result.stderr));
    assert.equal(await prisma.user.count(), 1);
  });

  await check("the CLI refuses money-shaped options by name", () => {
    for (const flag of ["--amount", "--balance", "--deposit", "--pnl", "--currency", "--transaction"]) {
      const result = runCli(
        ["attest", "--learner", "1", "--level", "x", "--event", "financial_checkpoint", flag, "50"],
        stagingEnv(),
      );
      assert.equal(result.status, cli.EXIT.usage, `${flag} must be a usage refusal`);
      assert.match(result.stderr, /is refused/);
    }
  });

  await check("the CLI refuses unknown options, unknown verbs and an unknown event class", () => {
    const unknownFlag = runCli(["provision", "--operator", "7"], stagingEnv());
    assert.equal(unknownFlag.status, cli.EXIT.usage);

    const unknownVerb = runCli(["delete-user"], stagingEnv());
    assert.equal(unknownVerb.status, cli.EXIT.usage);
    assert.match(unknownVerb.stderr, /exactly two/);

    const unknownEvent = runCli(
      ["attest", "--learner", "1", "--level", "x", "--event", "report_approval", "--request-id", "r-0000001"],
      stagingEnv(),
    );
    assert.equal(unknownEvent.status, cli.EXIT.usage);
  });

  await check("the CLI attests end to end and the level completes", async () => {
    const fixture = await attestationFixture();
    const result = runCli(
      [
        "attest",
        "--learner",
        String(fixture.learner.id),
        "--level",
        fixture.graph.levels[0]!.stableCode,
        "--event",
        "pocket_registration",
        "--request-id",
        "qaops-cli-e2e-0001",
        "--apply",
      ],
      stagingEnv({ ATA_QA_OPS_CONFIRM: "ATTEST_PREPROD_QA_GATE" }),
    );
    assert.equal(result.status, cli.EXIT.ok);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.applied, true);
    assert.equal(payload.completed, true);
    assert.equal(payload.xpAwarded, 0);
    assert.equal(payload.operatorUserId, fixture.operatorId);

    const progress = await prisma.userLevelProgress.findFirstOrThrow({
      where: { enrollmentId: fixture.enrollment.id },
    });
    assert.equal(progress.status, "completed");
  });

  await check("an identical CLI retry replays instead of attesting twice", async () => {
    const before = await prisma.stagingAttestation.count();
    const result = runCli(
      [
        "attest",
        "--learner",
        String((await prisma.user.findFirstOrThrow({ where: { role: "user" } })).id),
        "--level",
        (await prisma.levelDefinition.findFirstOrThrow({ where: { type: "external_event" } }))
          .stableCode,
        "--event",
        "pocket_registration",
        "--request-id",
        "qaops-cli-e2e-0001",
        "--apply",
      ],
      stagingEnv({ ATA_QA_OPS_CONFIRM: "ATTEST_PREPROD_QA_GATE" }),
    );
    assert.equal(result.status, cli.EXIT.ok);
    assert.match(result.stderr, /replayed/);
    assert.equal(await prisma.stagingAttestation.count(), before);
  });

  /* ================================================================ SECURITY */

  await check("no HTTP route, and nothing under src/app, references this capability", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (source.includes("preprod-qa-operator") || source.includes("preprodQaOperator")) {
            hits.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    };
    walk(path.join(REPO_ROOT, "src"));
    assert.deepEqual(hits, [], "the capability must not be reachable from application source");
  });

  await check("the capability adds no route file at all", () => {
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") {
          // Matched on the REPO-RELATIVE path: the checkout directory itself may
          // be named after this phase, and matching the absolute path would then
          // flag every route in the application.
          const relative = path.relative(REPO_ROOT, full);
          if (/qa[-_]?operator/i.test(relative)) routes.push(relative);
        }
      }
    };
    walk(path.join(REPO_ROOT, "src", "app"));
    assert.deepEqual(routes, []);
  });

  await check("the capability touches no CAPTCHA and no admin feature flag", () => {
    for (const file of [
      path.join("scripts", "ops", "preprodQaOperator.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "identity.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "guard.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "password.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "provision.ts"),
      path.join("scripts", "ops", "preprod-qa-operator", "attest.ts"),
    ]) {
      const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const forbidden of [
        "CAPTCHA_LOGIN_ENFORCED",
        "CAPTCHA_PROVIDER",
        "CAPTCHA_TEST_MODE",
        "TURNSTILE",
        "CURRICULUM_V2_ADMIN_ENABLED",
        "POCKET_POSTBACK_ENABLED",
      ]) {
        assert.ok(!source.includes(forbidden), `${file} must not mention ${forbidden}`);
      }
    }
  });

  await check("the admin authoring surface stays feature-gated and is not implied", async () => {
    const flags = await import("../../src/lib/env");
    // With the flag absent — as it is on PREPROD — the authoring admin API is off,
    // whatever role any principal holds.
    delete process.env.CURRICULUM_V2_ADMIN_ENABLED;
    assert.equal(flags.isCurriculumV2AdminEnabled(), false);
    applyProcessEnv(stagingEnv());
    assert.equal(flags.isCurriculumV2AdminEnabled(), false);
  });

  /* ------------------------------------------------------------------ done */

  await prisma.$disconnect();
  cleanupDb();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exitCode = 1;
});
