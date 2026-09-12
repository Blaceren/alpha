/**
 * A8 — STAGING_ATTESTED QA verification regression (product decisions R2, R3).
 *
 * Proves the sixteen-point security contract: staging-only, default off,
 * production hard-fail, operator authorization, no self-attestation, exact
 * target, durable idempotency, audit-before-success, honest provenance, no
 * balance, no fake Pocket partner event, no Pocket flag dependency, and no
 * generic "complete any level" capability.
 *
 * Runs entirely against a temporary SQLite fixture built by the shipped
 * migration runner (which applies the not-yet-deployed StagingAttestation
 * migration into that throwaway database only). No live database, no live
 * environment file, no provider and no HTTP route are used — the route's own
 * gate order is asserted from source and exercised in
 * curriculumPhaseAHttpRegression.ts.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PrismaClient,
  type LevelDefinition,
  type LevelDefinitionType,
  type UserRole,
} from "@prisma/client";

const dbPath = `/tmp/ata-curriculum-staging-attestation-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
process.env.DATABASE_URL = dbUrl;

const EVALUATION_TIME = new Date("2026-08-01T12:00:00.000Z");
const REGISTRATION_STABLE_CODE = "v2.l001.registraciya-pocket";
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
 * (`NODE_ENV=production`) on a deployment declared `staging`. Getting this pair
 * wrong in either direction is the exact mistake src/lib/environment.ts exists
 * to prevent, so the suite runs against the real combination.
 */
function stagingEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ATA_ENVIRONMENT: "staging",
    STAGING_ATTESTATION_ENABLED: "true",
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function applyProcessEnv(env: NodeJS.ProcessEnv) {
  for (const key of ["ATA_ENVIRONMENT", "STAGING_ATTESTATION_ENABLED", "NODE_ENV"]) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
}

function setCurriculumFlags(on: boolean) {
  for (const key of ["CURRICULUM_V2_READ_ENABLED", "CURRICULUM_V2_ENROLLMENT_ENABLED"]) {
    if (on) process.env[key] = "true";
    else delete process.env[key];
  }
}

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual ?? String(error)}`);
    return;
  }
  assert.fail(`expected ${code} but the call resolved`);
}

async function main() {
  cleanupDb();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) {
    console.error(migration.stdout, migration.stderr);
    throw new Error(`migration runner exited with ${migration.status}`);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const attest = await import("../../src/lib/curriculum/staging-attestation");
  const policy = await import("../../src/lib/curriculum/staging-attestation-policy");
  const env = await import("../../src/lib/env");

  let sequence = 0;

  async function reset() {
    await prisma.xPTransaction.deleteMany();
    await prisma.stagingAttestation.deleteMany();
    await prisma.userLevelProgress.deleteMany();
    await prisma.checkpointVerificationAttempt.deleteMany();
    await prisma.levelCheckpointRequirement.deleteMany();
    await prisma.userCurriculumEnrollment.deleteMany();
    await prisma.pocketTraderIdentity.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.levelDefinition.deleteMany();
    await prisma.moduleDefinition.deleteMany();
    await prisma.curriculumVersion.deleteMany();
    await prisma.user.deleteMany();
    applyProcessEnv(stagingEnv());
    setCurriculumFlags(true);
  }

  async function createUser(label: string, role: UserRole = "user") {
    sequence += 1;
    return prisma.user.create({
      data: {
        email: `${label}-${process.pid}-${sequence}@example.com`,
        name: label,
        role,
        status: "active",
      },
    });
  }

  type LevelSpec = { type?: LevelDefinitionType; completionMethod?: string; stableCode?: string };

  async function createGraph(specs: LevelSpec[]) {
    sequence += 1;
    const version = await prisma.curriculumVersion.create({
      data: {
        code: "ata-v2",
        name: `staging-attestation-${sequence}`,
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
        title: "Attestation module",
        firstLevel: 1,
        lastLevel: specs.length,
        learningObjective: "Learn",
      },
    });
    const levels: LevelDefinition[] = [];
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      const levelNumber = index + 1;
      levels.push(
        await prisma.levelDefinition.create({
          data: {
            curriculumVersionId: version.id,
            moduleId: moduleDefinition.id,
            levelNumber,
            stableCode:
              spec.stableCode ??
              `v2.l${String(levelNumber).padStart(3, "0")}.attest-${version.id}`,
            type: spec.type ?? "lesson",
            title: `Level ${levelNumber}`,
            learningObjective: "Learn",
            completionMethod: spec.completionMethod ?? "manual",
            // Every gate is zero-reward; the attestation owners refuse anything else.
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

  /** Level 1 = the Pocket registration gate. Level 2 = a lesson. */
  async function registrationFixture() {
    await reset();
    const learner = await createUser("learner");
    const operator = await createUser("operator", "admin");
    const graph = await createGraph([
      {
        type: "external_event",
        completionMethod: "pocket_postback",
        stableCode: REGISTRATION_STABLE_CODE,
      },
      { type: "lesson", completionMethod: "manual" },
    ]);
    const enrolled = await enroll(learner.id, graph.version.id);
    return { learner, operator, graph, enrolled, level: graph.levels[0] };
  }

  /** Level 1 = a lesson (completed). Level 2 = the financial checkpoint. */
  async function checkpointFixture() {
    await reset();
    const learner = await createUser("learner");
    const operator = await createUser("operator", "admin");
    const graph = await createGraph([
      { type: "lesson", completionMethod: "manual" },
      { type: "financial_checkpoint", completionMethod: "balance_check" },
    ]);
    const enrolled = await enroll(learner.id, graph.version.id, 2);
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrolled.id,
        curriculumVersionId: graph.version.id,
        levelDefinitionId: graph.levels[0].id,
        status: "completed",
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
        completedAt: EVALUATION_TIME,
      },
    });
    return { learner, operator, graph, enrolled, level: graph.levels[1] };
  }

  /* ==================================================================== */
  /* Environment gate                                                      */
  /* ==================================================================== */

  await check("A8.1 the policy is usable ONLY on staging with the flag explicitly true", () => {
    assert.equal(policy.isStagingAttestationUsable(stagingEnv()), true);
    for (const override of [
      { ATA_ENVIRONMENT: "production" },
      { ATA_ENVIRONMENT: "dev" },
      { ATA_ENVIRONMENT: undefined },
      { ATA_ENVIRONMENT: "Staging" },
      { ATA_ENVIRONMENT: " staging" },
      { ATA_ENVIRONMENT: "staging,dev" },
      { STAGING_ATTESTATION_ENABLED: undefined },
      { STAGING_ATTESTATION_ENABLED: "false" },
      { STAGING_ATTESTATION_ENABLED: "TRUE" },
      { STAGING_ATTESTATION_ENABLED: "1" },
      { STAGING_ATTESTATION_ENABLED: " true" },
    ]) {
      assert.equal(
        policy.isStagingAttestationUsable(stagingEnv(override)),
        false,
        JSON.stringify(override),
      );
    }
  });

  await check("A8.2 absence is disabled and the reason distinguishes the two causes", () => {
    assert.deepEqual(
      policy.resolveStagingAttestationPolicy(stagingEnv({ STAGING_ATTESTATION_ENABLED: undefined })),
      { kind: "unusable", reason: "flag_disabled" },
    );
    assert.deepEqual(
      policy.resolveStagingAttestationPolicy(stagingEnv({ ATA_ENVIRONMENT: "production" })),
      { kind: "unusable", reason: "environment_not_staging" },
    );
  });

  await check("A8.3 a production deployment with the flag on REFUSES TO BOOT", () => {
    const production = env.validateRuntimeEnv(
      stagingEnv({
        ATA_ENVIRONMENT: "production",
        DATABASE_URL: "file:./x.db",
        SESSION_SECRET: "x".repeat(40),
        POSTBACK_SECRET: "y".repeat(40),
        APP_URL: "https://app.example.com",
        STORAGE_DRIVER: "local",
        POCKET_AFFILIATE_BASE_URL: "https://u3.shortink.io/register?a=x",
        CAPTCHA_PROVIDER: "turnstile",
        TURNSTILE_SECRET_KEY: "s".repeat(40),
        CAPTCHA_LOGIN_ENFORCED: "true",
      }),
    );
    assert.equal(production.ok, false);
    assert.ok(
      production.errors.some((message) =>
        message.includes("STAGING_ATTESTATION_ENABLED") && message.includes("ATA_ENVIRONMENT=staging"),
      ),
      production.errors.join(" | "),
    );
  });

  await check("A8.4 dev and unclassified deployments with the flag on also refuse to boot", () => {
    for (const environment of ["dev", undefined, "prod"]) {
      const result = env.validateRuntimeEnv(
        stagingEnv({
          ATA_ENVIRONMENT: environment,
          NODE_ENV: undefined,
          APP_URL: "http://127.0.0.1:3000",
          CAPTCHA_PROVIDER: undefined,
          TURNSTILE_SECRET_KEY: undefined,
        }),
      );
      assert.ok(
        result.errors.some((message) => message.includes("STAGING_ATTESTATION_ENABLED")),
        `${String(environment)}: ${result.errors.join(" | ")}`,
      );
    }
  });

  await check("A8.5 a staging deployment with the flag on boots cleanly", () => {
    const result = env.validateRuntimeEnv(
      stagingEnv({
        DATABASE_URL: "file:./x.db",
        SESSION_SECRET: "x".repeat(40),
        POSTBACK_SECRET: "y".repeat(40),
        APP_URL: "https://preprod.example.com",
        STORAGE_DRIVER: "local",
        POCKET_AFFILIATE_BASE_URL: "https://u3.shortink.io/register?a=x",
        CAPTCHA_PROVIDER: "turnstile",
        TURNSTILE_SECRET_KEY: "s".repeat(40),
        CAPTCHA_LOGIN_ENFORCED: "true",
      }),
    );
    assert.equal(
      result.errors.some((message) => message.includes("STAGING_ATTESTATION_ENABLED")),
      false,
      result.errors.join(" | "),
    );
  });

  await check("A8.6 the flag grants no Pocket, affiliate or CAPTCHA capability", () => {
    const on = stagingEnv();
    // Nothing about enabling attestation turns any of these on: they are absent
    // in `on` and every resolver still reports disabled.
    for (const key of [
      "POCKET_POSTBACK_ENABLED",
      "POCKET_BALANCE_PROVIDER_ENABLED",
      "CHECKPOINT_PROVIDER_MODE",
      "AFFILIATE_ATTRIBUTION_ENABLED",
      "CHECKPOINT_PROVIDER_TEST_BACKEND",
      "POCKET_PARTNER_API_TEST_MODE",
    ]) {
      assert.equal(on[key], undefined, key);
    }
    // And the policy module's CODE (comments stripped) reads exactly two env
    // keys, so it cannot consult any of them even indirectly.
    const source = fs.readFileSync("src/lib/curriculum/staging-attestation-policy.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["POCKET_", "AFFILIATE_", "TURNSTILE_", "CAPTCHA_", "NODE_ENV"]) {
      assert.equal(code.includes(forbidden), false, forbidden);
    }
    const envReads = [...code.matchAll(/env\[([A-Za-z_]+)\]/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(envReads)], ["STAGING_ATTESTATION_ENABLED_KEY"]);
  });

  /* ==================================================================== */
  /* Pocket registration attestation (R3)                                  */
  /* ==================================================================== */

  await check("A8.7 an operator attests level 1 and the canonical path completes it", async () => {
    const f = await registrationFixture();
    const receipt = await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-reg-0001",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.completed, true);
    assert.equal(receipt.levelNumber, 1);
    assert.equal(receipt.xpAwarded, 0);
    assert.equal(receipt.xpTransactionId, null);

    const enrolledAfter = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrolledAfter.currentLevel, 2);
    assert.equal(enrolledAfter.highestCompletedLevel, 1);

    // Provenance is permanent and obvious: the completion names the staging
    // owner, never `pocket_registration_postback`.
    const completion = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_LEVEL_COMPLETED" },
    });
    const metadata = completion.metadata as Record<string, unknown>;
    assert.equal(metadata.sourceType, "staging_attested_registration");
    assert.equal(completion.userId, null, "no learner actor for an operator act");
  });

  await check("A8.8 no Pocket identity, provider event or balance row is created", async () => {
    const f = await registrationFixture();
    await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-reg-0002",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(await prisma.pocketTraderIdentity.count(), 0, "no fake Pocket binding");
    assert.equal(await prisma.checkpointVerificationAttempt.count(), 0, "no fake provider attempt");
    assert.equal(await prisma.exchangeAccount.count(), 0, "no balance row");
    assert.equal(await prisma.xPTransaction.count(), 0, "a gate awards nothing");
  });

  await check("A8.9 the attestation and its audit are written together", async () => {
    const f = await registrationFixture();
    await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-reg-0003",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const row = await prisma.stagingAttestation.findFirstOrThrow();
    assert.equal(row.eventClass, "pocket_registration");
    assert.equal(row.environment, "staging");
    assert.equal(row.attestedById, f.operator.id);
    assert.equal(row.enrollmentId, f.enrolled.id);
    assert.equal(row.levelDefinitionId, f.level.id);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_STAGING_ATTESTATION_RECORDED" },
    });
    assert.equal(audit.userId, f.operator.id);
    assert.equal(audit.entityId, String(row.id));
    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata.environment, "staging");
    assert.equal(metadata.eventClass, "pocket_registration");
    assert.match(String(metadata.requestIdHash), /^sha256:[a-f0-9]{64}$/);
    // No raw request identity, no PII, no money.
    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes("attest-reg-0003"), false, "requestId is hashed");
    assert.equal(serialized.includes("@"), false, "no email");
    for (const forbidden of ["amount", "balance", "currency", "pocketUserId", "clickId", "email"]) {
      assert.equal(Object.keys(metadata).includes(forbidden), false, forbidden);
    }
  });

  /* ==================================================================== */
  /* Financial checkpoint attestation (R2)                                 */
  /* ==================================================================== */

  await check("A8.10 an operator attests a checkpoint and the level completes", async () => {
    const f = await checkpointFixture();
    const receipt = await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "financial_checkpoint",
      learnerUserId: f.learner.id,
      stableCode: f.level.stableCode,
      requestId: "attest-cp-0001",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(receipt.created, true);
    assert.equal(receipt.completed, true);
    assert.equal(receipt.levelNumber, 2);
    assert.equal(receipt.xpAwarded, 0);

    const enrolledAfter = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrolledAfter.currentLevel, 3);
    const completion = await prisma.auditLog.findFirstOrThrow({
      where: { action: "CURRICULUM_LEVEL_COMPLETED" },
    });
    assert.equal(
      (completion.metadata as Record<string, unknown>).sourceType,
      "staging_attested_checkpoint",
    );
  });

  await check("A8.11 no CheckpointVerificationAttempt is fabricated and no provider is needed", async () => {
    const f = await checkpointFixture();
    // Neither Pocket flag is set anywhere in this suite.
    assert.equal(process.env.POCKET_BALANCE_PROVIDER_ENABLED, undefined);
    assert.equal(process.env.POCKET_POSTBACK_ENABLED, undefined);
    assert.equal(process.env.CURRICULUM_V2_CHECKPOINT_ENABLED, undefined);
    await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "financial_checkpoint",
      learnerUserId: f.learner.id,
      stableCode: f.level.stableCode,
      requestId: "attest-cp-0002",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(
      await prisma.checkpointVerificationAttempt.count(),
      0,
      "the provider-attempt table means 'we asked a provider' and must stay honest",
    );
    assert.equal(await prisma.levelCheckpointRequirement.count(), 0);
  });

  await check("A8.12 the attestation carries no monetary field anywhere", async () => {
    const f = await checkpointFixture();
    await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "financial_checkpoint",
      learnerUserId: f.learner.id,
      stableCode: f.level.stableCode,
      requestId: "attest-cp-0003",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const row = await prisma.stagingAttestation.findFirstOrThrow();
    for (const forbidden of [
      "amount",
      "amountMinorUnits",
      "balance",
      "currency",
      "thresholdMinorUnits",
      "observedBalance",
      "pocketUserId",
    ]) {
      assert.equal(Object.keys(row).includes(forbidden), false, forbidden);
    }
    // And the migration itself has nowhere to put one.
    const sql = fs.readFileSync(
      "prisma/migrations/20260807000000_staging_attestation/migration.sql",
      "utf8",
    );
    const table = sql.slice(sql.indexOf('CREATE TABLE "StagingAttestation"'), sql.indexOf(");"));
    for (const forbidden of [
      "amount",
      "balance",
      "currency",
      "minorUnits",
      "pocketUserId",
      "clickId",
      "traderId",
      "deposit",
    ]) {
      assert.equal(table.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
    }
    // `pocket_registration` appears only as an event-class literal, never as a
    // column: the table names WHICH QA gate, not any Pocket value.
    assert.equal(
      (table.match(/pocket/gi) ?? []).length,
      1,
      "the only `pocket` in the table is the event-class literal",
    );
  });

  /* ==================================================================== */
  /* Authorization                                                         */
  /* ==================================================================== */

  for (const role of ["user", "mentor", "support", "news_editor"] as UserRole[]) {
    await check(`A8.13 a ${role} cannot attest`, async () => {
      const f = await registrationFixture();
      const actor = await createUser(`actor-${role}`, role);
      await expectCode(
        () =>
          attest.attestStagingGate({
            operatorUserId: actor.id,
            eventClass: "pocket_registration",
            learnerUserId: f.learner.id,
            stableCode: REGISTRATION_STABLE_CODE,
            requestId: "attest-role-0001",
            evaluationTime: EVALUATION_TIME,
            db: prisma,
          }),
        "STAGING_ATTESTATION_FORBIDDEN",
      );
      assert.equal(await prisma.stagingAttestation.count(), 0);
      assert.equal(await prisma.auditLog.count(), 0);
    });
  }

  await check("A8.14 the learner cannot attest their own gate, even as an admin", async () => {
    await reset();
    const learnerAdmin = await createUser("learner-admin", "admin");
    const graph = await createGraph([
      {
        type: "external_event",
        completionMethod: "pocket_postback",
        stableCode: REGISTRATION_STABLE_CODE,
      },
      { type: "lesson", completionMethod: "manual" },
    ]);
    await enroll(learnerAdmin.id, graph.version.id);
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: learnerAdmin.id,
          eventClass: "pocket_registration",
          learnerUserId: learnerAdmin.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-self-0001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_FORBIDDEN",
    );
    assert.equal(await prisma.stagingAttestation.count(), 0);
    assert.equal(await prisma.userLevelProgress.count(), 0);
  });

  await check("A8.15 a blocked admin cannot attest", async () => {
    const f = await registrationFixture();
    const blocked = await prisma.user.update({
      where: { id: (await createUser("blocked-admin", "admin")).id },
      data: { status: "blocked" },
    });
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: blocked.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-blocked-001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_FORBIDDEN",
    );
  });

  /* ==================================================================== */
  /* Environment enforcement at the domain, not only the route             */
  /* ==================================================================== */

  await check("A8.16 the command refuses outside staging and writes nothing", async () => {
    const f = await registrationFixture();
    for (const override of [
      { ATA_ENVIRONMENT: "production" },
      { ATA_ENVIRONMENT: "dev" },
      { ATA_ENVIRONMENT: undefined },
      { STAGING_ATTESTATION_ENABLED: undefined },
    ]) {
      await expectCode(
        () =>
          attest.attestStagingGate({
            operatorUserId: f.operator.id,
            eventClass: "pocket_registration",
            learnerUserId: f.learner.id,
            stableCode: REGISTRATION_STABLE_CODE,
            requestId: "attest-env-0001",
            evaluationTime: EVALUATION_TIME,
            db: prisma,
            env: stagingEnv(override),
          }),
        "STAGING_ATTESTATION_DISABLED",
      );
    }
    assert.equal(await prisma.stagingAttestation.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);
    assert.equal(await prisma.userLevelProgress.count(), 0);
  });

  await check("A8.17 the completion primitive itself refuses a staging source off-staging", async () => {
    const f = await registrationFixture();
    // A durable attestation exists (made legitimately while staging).
    await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-env-0002",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const attestation = await prisma.stagingAttestation.findFirstOrThrow();

    // Now the deployment is production. A direct call to the completion
    // primitive — bypassing the route and the service entirely — must still
    // refuse, because the environment is re-checked inside the transaction.
    const completion = await import("../../src/lib/curriculum/completion");
    await reset();
    const learner = await createUser("learner2");
    const graph = await createGraph([
      {
        type: "external_event",
        completionMethod: "pocket_postback",
        stableCode: REGISTRATION_STABLE_CODE,
      },
      { type: "lesson", completionMethod: "manual" },
    ]);
    const enrolled = await enroll(learner.id, graph.version.id);
    await prisma.userLevelProgress.create({
      data: {
        enrollmentId: enrolled.id,
        curriculumVersionId: graph.version.id,
        levelDefinitionId: graph.levels[0].id,
        status: "in_progress",
        startedAt: EVALUATION_TIME,
        lastProgressAt: EVALUATION_TIME,
      },
    });
    process.env.ATA_ENVIRONMENT = "production";
    const result = await completion.completeCurriculumLevel({
      enrollmentId: enrolled.id,
      levelDefinitionId: graph.levels[0].id,
      sourceType: "staging_attested_registration",
      sourceId: `staging-attestation:${attestation.id}`,
      actorId: null,
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    assert.equal(result.kind, "rejected");
    assert.equal(
      (result as { code: string }).code,
      "COMPLETION_OWNER_UNAVAILABLE",
    );
    applyProcessEnv(stagingEnv());
    const after = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: enrolled.id },
    });
    assert.equal(after.currentLevel, 1, "nothing was completed");
  });

  /* ==================================================================== */
  /* F1 — a caller-supplied env may narrow, never widen                    */
  /* ==================================================================== */

  /**
   * The independent audit's finding: `attestStagingGate` took its answer from
   * the CALLER-SUPPLIED `env`, so a direct server-side caller on a non-staging
   * host could persist a durable, audited attestation row before the completion
   * primitive refused the effect. The row is the evidence trail, so creating one
   * that claims a staging attestation happened on a production deployment is
   * itself the defect — moving the failure later is not a fix.
   *
   * The contract now: the REAL process environment and the SUPPLIED environment
   * must BOTH permit it.
   */
  await check("A8.16a the real and supplied environments must BOTH permit the attestation", async () => {
    type Case = {
      label: string;
      real: Record<string, string | undefined>;
      supplied?: Record<string, string | undefined>;
      allowed: boolean;
    };
    const cases: Case[] = [
      // 1. real staging + supplied staging, flag true -> the one legal case.
      { label: "real staging + supplied staging", real: {}, supplied: {}, allowed: true },
      // 2. the supplied env NARROWS. Still refused, as it always was.
      {
        label: "real staging + supplied production",
        real: {},
        supplied: { ATA_ENVIRONMENT: "production" },
        allowed: false,
      },
      // 3. THE FINDING. The supplied env tries to WIDEN a production host.
      {
        label: "real production + supplied staging",
        real: { ATA_ENVIRONMENT: "production" },
        supplied: {},
        allowed: false,
      },
      // 4. neither permits.
      {
        label: "real production + supplied production",
        real: { ATA_ENVIRONMENT: "production" },
        supplied: { ATA_ENVIRONMENT: "production" },
        allowed: false,
      },
      // 5/6. the flag itself, absent and explicitly false, on a real staging host.
      {
        label: "real staging, flag absent",
        real: { STAGING_ATTESTATION_ENABLED: undefined },
        supplied: {},
        allowed: false,
      },
      {
        label: "real staging, flag false",
        real: { STAGING_ATTESTATION_ENABLED: "false" },
        supplied: {},
        allowed: false,
      },
      // 7. dev is not staging, and forgetting is the safe direction.
      { label: "real dev + supplied staging", real: { ATA_ENVIRONMENT: "dev" }, supplied: {}, allowed: false },
      {
        label: "real unclassified + supplied staging",
        real: { ATA_ENVIRONMENT: undefined },
        supplied: {},
        allowed: false,
      },
    ];

    for (const scenario of cases) {
      const f = await registrationFixture();
      // `reset()` leaves the process on staging; now describe the REAL host.
      applyProcessEnv(stagingEnv(scenario.real));
      const call = () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-f1-both-0001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
          // `undefined` means "no env supplied at all", i.e. the real default.
          ...(scenario.supplied ? { env: stagingEnv(scenario.supplied) } : {}),
        });

      if (scenario.allowed) {
        const receipt = await call();
        assert.equal(receipt.completed, true, scenario.label);
        assert.equal(receipt.xpAwarded, 0, scenario.label);
        assert.equal(await prisma.stagingAttestation.count(), 1, scenario.label);
      } else {
        await expectCode(call, "STAGING_ATTESTATION_DISABLED");
        // THE POINT: nothing durable, not even the attestation row.
        assert.equal(await prisma.stagingAttestation.count(), 0, `${scenario.label}: attestation row`);
        assert.equal(
          await prisma.auditLog.count({
            where: { action: "CURRICULUM_STAGING_ATTESTATION_RECORDED" },
          }),
          0,
          `${scenario.label}: attestation audit`,
        );
        assert.equal(
          await prisma.userLevelProgress.count({ where: { status: "completed" } }),
          0,
          `${scenario.label}: completions`,
        );
        assert.equal(await prisma.xPTransaction.count(), 0, `${scenario.label}: XP rows`);
        const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
          where: { id: f.enrolled.id },
        });
        assert.equal(enrollment.currentLevel, 1, `${scenario.label}: progression`);
        assert.equal(enrollment.highestCompletedLevel, 0, `${scenario.label}: progression`);
      }
      applyProcessEnv(stagingEnv());
    }
  });

  await check("A8.16b the forged-env scenario writes NOTHING on a production host", async () => {
    const f = await registrationFixture();
    const before = {
      attestations: await prisma.stagingAttestation.count(),
      audits: await prisma.auditLog.count(),
      progress: await prisma.userLevelProgress.count(),
      xp: await prisma.xPTransaction.count(),
    };

    // The deployment is production. Only the caller lies.
    applyProcessEnv(stagingEnv({ ATA_ENVIRONMENT: "production" }));
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-f1-forged-0001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
          env: stagingEnv(),
        }),
      "STAGING_ATTESTATION_DISABLED",
    );
    applyProcessEnv(stagingEnv());

    assert.deepEqual(
      {
        attestations: await prisma.stagingAttestation.count(),
        audits: await prisma.auditLog.count(),
        progress: await prisma.userLevelProgress.count(),
        xp: await prisma.xPTransaction.count(),
      },
      before,
      "a forged env must leave no trace of any kind",
    );
    assert.equal(before.attestations, 0);
    assert.equal(before.audits, 0);
    assert.equal(before.xp, 0);
  });

  /* ==================================================================== */
  /* Exactness and idempotency                                             */
  /* ==================================================================== */

  await check("A8.18 an identical retry replays the one attestation", async () => {
    const f = await registrationFixture();
    const first = await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-idem-0001",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    const second = await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-idem-0001",
      evaluationTime: new Date(EVALUATION_TIME.getTime() + 60_000),
      db: prisma,
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.attestationId, first.attestationId);
    assert.equal(second.completed, true);
    assert.equal(await prisma.stagingAttestation.count(), 1);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "CURRICULUM_STAGING_ATTESTATION_RECORDED" } }),
      1,
    );
    assert.equal(
      await prisma.auditLog.count({ where: { action: "CURRICULUM_LEVEL_COMPLETED" } }),
      1,
    );
  });

  await check("A8.19 rotating the request identity cannot attest a gate twice", async () => {
    const f = await registrationFixture();
    await attest.attestStagingGate({
      operatorUserId: f.operator.id,
      eventClass: "pocket_registration",
      learnerUserId: f.learner.id,
      stableCode: REGISTRATION_STABLE_CODE,
      requestId: "attest-rotate-001",
      evaluationTime: EVALUATION_TIME,
      db: prisma,
    });
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-rotate-002",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_REQUEST_CONFLICT",
    );
    assert.equal(await prisma.stagingAttestation.count(), 1);
  });

  await check("A8.20 concurrent identical attestations resolve to one row", async () => {
    const f = await registrationFixture();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-conc-0001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      ),
    );
    assert.ok(results.some((r) => r.status === "fulfilled"));
    assert.equal(await prisma.stagingAttestation.count(), 1);
    assert.equal(await prisma.xPTransaction.count(), 0);
  });

  await check("A8.21 the event class is bound to exactly one level kind", async () => {
    const f = await checkpointFixture();
    // A checkpoint event pointed at the wrong level kind.
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "financial_checkpoint",
          learnerUserId: f.learner.id,
          stableCode: f.graph.levels[0].stableCode,
          requestId: "attest-kind-0001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_LEVEL_WRONG_KIND",
    );
    // And a registration event pointed at the checkpoint.
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: f.level.stableCode,
          requestId: "attest-kind-0002",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_LEVEL_WRONG_KIND",
    );
    assert.equal(await prisma.stagingAttestation.count(), 0);
  });

  await check("A8.22 there is no generic 'complete any level' capability", async () => {
    const f = await checkpointFixture();
    // A lesson, a report, an assessment and a mentor review are all unreachable
    // because no event class names their pair.
    for (const eventClass of ["pocket_registration", "financial_checkpoint"] as const) {
      await expectCode(
        () =>
          attest.attestStagingGate({
            operatorUserId: f.operator.id,
            eventClass,
            learnerUserId: f.learner.id,
            stableCode: f.graph.levels[0].stableCode,
            requestId: `attest-generic-${eventClass.slice(0, 6)}`,
            evaluationTime: EVALUATION_TIME,
            db: prisma,
          }),
        "STAGING_ATTESTATION_LEVEL_WRONG_KIND",
      );
    }
    assert.equal(attest.STAGING_ATTESTATION_EVENT_CLASSES.length, 2);
  });

  await check("A8.23 a level the learner has not reached is refused", async () => {
    await reset();
    const learner = await createUser("learner");
    const operator = await createUser("operator", "admin");
    const graph = await createGraph([
      { type: "lesson", completionMethod: "manual" },
      { type: "financial_checkpoint", completionMethod: "balance_check" },
    ]);
    // Standing on level 1, attesting the level-2 checkpoint.
    await enroll(learner.id, graph.version.id, 1);
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: operator.id,
          eventClass: "financial_checkpoint",
          learnerUserId: learner.id,
          stableCode: graph.levels[1].stableCode,
          requestId: "attest-notcur-001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_LEVEL_NOT_CURRENT",
    );
    assert.equal(await prisma.stagingAttestation.count(), 0);
  });

  await check("A8.24 an unenrolled or unknown learner is refused", async () => {
    await reset();
    const operator = await createUser("operator", "admin");
    const stranger = await createUser("stranger");
    await createGraph([
      {
        type: "external_event",
        completionMethod: "pocket_postback",
        stableCode: REGISTRATION_STABLE_CODE,
      },
    ]);
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: operator.id,
          eventClass: "pocket_registration",
          learnerUserId: stranger.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-noenrol-01",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_NOT_ENROLLED",
    );
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: operator.id,
          eventClass: "pocket_registration",
          learnerUserId: 9_999_999,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-nouser-001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_LEARNER_NOT_FOUND",
    );
  });

  await check("A8.25 a malformed request identity is refused before any read", async () => {
    const f = await registrationFixture();
    for (const requestId of ["", "short", "has space", "-leading"]) {
      await expectCode(
        () =>
          attest.attestStagingGate({
            operatorUserId: f.operator.id,
            eventClass: "pocket_registration",
            learnerUserId: f.learner.id,
            stableCode: REGISTRATION_STABLE_CODE,
            requestId,
            evaluationTime: EVALUATION_TIME,
            db: prisma,
          }),
        "STAGING_ATTESTATION_INPUT_INVALID",
      );
    }
    assert.equal(await prisma.stagingAttestation.count(), 0);
  });

  /* ==================================================================== */
  /* Source-level guarantees                                               */
  /* ==================================================================== */

  await check("A8.26 the admin route gates environment before authentication", () => {
    const source = fs.readFileSync(
      "src/app/api/admin/curriculum/staging-attestations/route.ts",
      "utf8",
    );
    // The handler body only, so an import line cannot satisfy an ordering claim.
    const handler = source.slice(source.indexOf("export async function POST"));
    const gateIndex = handler.indexOf("isStagingAttestationUsable()");
    const authIndex = handler.indexOf("requireAdmin()");
    const limitIndex = handler.indexOf("rateLimit(");
    const csrfIndex = handler.indexOf("validateCsrfToken(");
    const bodyIndex = handler.indexOf("attestBodySchema.safeParse");
    const domainIndex = handler.indexOf("attestStagingGate(");
    assert.ok(gateIndex >= 0, "the environment gate must be in the handler");
    assert.ok(authIndex > gateIndex, "environment gate must come before authentication");
    assert.ok(limitIndex > authIndex, "rate limit must follow authentication");
    assert.ok(csrfIndex > limitIndex, "CSRF must follow the rate limit");
    assert.ok(bodyIndex > csrfIndex, "body validation must follow CSRF");
    assert.ok(domainIndex > bodyIndex, "the domain runs last");
    // The body contract carries exactly four fields and is strict, so anything
    // resembling money is a 400 rather than an ignored extra key.
    const schema = source.slice(
      source.indexOf("const attestBodySchema"),
      source.indexOf("export async function POST"),
    );
    assert.match(schema, /z\.strictObject/);
    assert.deepEqual(
      [...schema.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]).sort(),
      ["eventClass", "learnerUserId", "requestId", "stableCode"],
    );
    for (const forbidden of ["amount", "balance", "currency", "minorUnits", "completedAt", "status"]) {
      assert.equal(schema.includes(forbidden), false, forbidden);
    }
    // The operator identity comes from the session, never from the body.
    assert.equal(handler.includes("parsed.data.operator"), false);
    assert.match(handler, /operatorUserId: operatorId/);
  });

  await check("A8.27 the migration file exists and is purely additive", () => {
    const sql = fs.readFileSync(
      "prisma/migrations/20260807000000_staging_attestation/migration.sql",
      "utf8",
    );
    assert.match(sql, /CREATE TABLE "StagingAttestation"/);
    // Purely additive: no ALTER, no DROP, no data statement. (`ON UPDATE
    // CASCADE` is foreign-key behaviour inside the CREATE, not a data write.)
    for (const forbidden of ["ALTER TABLE", "DROP TABLE", "UPDATE \"", "INSERT INTO", "DELETE FROM"]) {
      assert.equal(sql.includes(forbidden), false, forbidden);
    }
    assert.equal(
      sql.split(";").filter((statement) => statement.trim().length > 0).length,
      6,
      "one CREATE TABLE and five indexes",
    );
    // The runner splits on semicolons, so no comment may contain one.
    for (const line of sql.split("\n")) {
      if (line.trimStart().startsWith("--")) {
        assert.equal(line.includes(";"), false, `comment contains a semicolon: ${line}`);
      }
    }
    // The environment column is pinned by a CHECK.
    assert.match(sql, /CHECK \("environment" IN \('staging'\)\)/);
  });

  /**
   * F2 moved the zero-reward owner vocabulary into `completion-pairs.ts` so the
   * package validator and the completion engine answer "which owners award
   * nothing" from ONE list. This check used to pin the engine's old literal
   * comparisons with a regex, which asserted the spelling rather than the
   * guarantee; it now asserts the guarantee itself — from the shared vocabulary
   * and from behaviour.
   */
  await check("A8.28 the staging owners can never award XP", async () => {
    const pairs = await import("../../src/lib/curriculum/completion-pairs");

    // 1. Both staging owners are members of the one zero-reward list.
    assert.equal(pairs.ZERO_REWARD_ONLY_OWNERS.has("staging_attested_registration"), true);
    assert.equal(pairs.ZERO_REWARD_ONLY_OWNERS.has("staging_attested_checkpoint"), true);

    // 2. The XP-capable owners are exactly the four learner-driven ones, so no
    //    staging source can reach the ledger. Disjointness, not a source slice.
    const xpCapableOwners = Object.keys(pairs.PRODUCTION_COMPLETION_PAIRS)
      .filter((owner) => !pairs.ZERO_REWARD_ONLY_OWNERS.has(owner))
      .sort();
    assert.deepEqual(xpCapableOwners, [
      "assessment_pass",
      "level_completion",
      "mentor_completion",
      "report_approval",
    ]);

    // 3. Behaviour: a gate MIS-AUTHORED with a reward is refused outright
    //    rather than completed, and mints nothing.
    const f = await registrationFixture();
    await prisma.levelDefinition.update({
      where: { id: f.level.id },
      data: { xpReward: 5 },
    });
    await expectCode(
      () =>
        attest.attestStagingGate({
          operatorUserId: f.operator.id,
          eventClass: "pocket_registration",
          learnerUserId: f.learner.id,
          stableCode: REGISTRATION_STABLE_CODE,
          requestId: "attest-zero-reward-0001",
          evaluationTime: EVALUATION_TIME,
          db: prisma,
        }),
      "STAGING_ATTESTATION_COMPLETION_REFUSED",
    );
    assert.equal(await prisma.xPTransaction.count(), 0, "no XP row");
    assert.equal(
      await prisma.userLevelProgress.count({ where: { status: "completed" } }),
      0,
      "the level must not complete",
    );
    const enrollment = await prisma.userCurriculumEnrollment.findUniqueOrThrow({
      where: { id: f.enrolled.id },
    });
    assert.equal(enrollment.currentLevel, 1, "no unlock");
  });

  await prisma.$disconnect();
  cleanupDb();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  cleanupDb();
  process.exit(1);
});
