/**
 * AGENT-FOUNDATION-1 — the shared Agent Core.
 *
 * Synthetic database only. NO EXTERNAL REQUEST IS MADE, no model provider is
 * contacted, no API key is read and no message of any kind is sent — the suite
 * proves those things are impossible rather than merely not attempted.
 *
 * The claim under test is the one the whole phase rests on: **the Agent Core
 * records what an agent did and what it pointed at, it can be written only from
 * inside the server, nothing it holds can cause an effect without a named human
 * decision, and no PII, secret, prompt or provider payload can enter it.**
 *
 * Proven here:
 *   A. registry   — four exact agents, and every rejection axis.
 *   B. runs       — creation, subjects, idempotency, transitions, concurrency.
 *   C. findings   — codes, operands, PII-shaped operands, evidence, immutability.
 *   D. evidence   — minimal reference, unsupported domain, oversize, DTO, immutable.
 *   E. handoffs   — proposal, target validation, dedup, expiry, no consumer.
 *   F. proposals  — approval always required, forbidden actions, no free text.
 *   G. decisions  — staff required, anonymous refused, one decision ever.
 *   H. executions — provider disabled, no network call, no row written.
 *   I. evaluation — deterministic only, model evaluator disabled.
 *   J. model      — provider disabled, fail-closed code, no prompt/response column.
 *   K. migration  — count, nine tables, indexes, constraints, no AgentDefinition.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { EXPECTED_MIGRATION_COUNT } from "./support/migrationCount";

const dbPath = path.join(os.tmpdir(), `ata-agent-core-af1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

const MIGRATION_NAME = "20260804000000_agent_core_foundation";

const AGENT_CORE_TABLES = [
  "AgentRun",
  "AgentFinding",
  "AgentEvidenceReference",
  "AgentHandoff",
  "AgentActionProposal",
  "AgentActionDecision",
  "AgentActionExecution",
  "AgentEvaluation",
  "ModelInvocation",
] as const;

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Assert that `fn` throws an AgentCore-family error carrying exactly `code`. */
async function rejectsWith(code: string, fn: () => Promise<unknown> | unknown) {
  try {
    await fn();
  } catch (error) {
    const actual = (error as { code?: string }).code;
    assert.equal(actual, code, `expected ${code}, got ${actual ?? String(error)}`);
    return;
  }
  assert.fail(`expected rejection ${code}, but the call resolved`);
}

let fingerprintSeq = 0;
/** A distinct, well-formed resolved-input fingerprint per run. */
function nextFingerprint() {
  fingerprintSeq += 1;
  return fingerprintSeq.toString(16).padStart(16, "0");
}

async function main() {
  cleanup();
  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;

  const { prisma } = await import("../../src/lib/prisma");
  const registry = await import("../../src/lib/agents/agent-registry");
  const contract = await import("../../src/lib/agents/agent-core-contract");
  const contextModule = await import("../../src/lib/agents/agent-core-context");
  const policy = await import("../../src/lib/agents/agent-payload-policy");
  const service = await import("../../src/lib/agents/agent-core-service");

  const projectRoot = process.cwd();

  /* ------------------------------------------------------------------ */
  /* Fixtures                                                            */
  /* ------------------------------------------------------------------ */

  const staffUser = await prisma.user.create({
    data: { email: "af1-staff@example.com", name: "AF1 Staff" },
  });
  const staff = await prisma.staffProfile.create({
    data: { userId: staffUser.id, displayName: "AF1 Staff", staffRole: "analyst" },
  });

  /** The server-owned context every write needs. */
  const ctx = contextModule.createInternalAgentContext({
    origin: "regression_harness",
    actorStaffId: staff.id,
    requestId: "af1-request-0001",
  });

  /** A context with no human actor, for the system-run and anonymous cases. */
  const systemCtx = contextModule.createInternalAgentContext({
    origin: "regression_harness",
    actorStaffId: null,
    requestId: "af1-request-system",
  });

  /** Create a legal Atlas run and return its id. */
  async function createRun(
    overrides: Partial<Parameters<typeof service.createAgentRun>[1]> = {},
  ) {
    const result = await service.createAgentRun(ctx, {
      agentCode: "curie_atlas",
      agentVersion: "1.0.0",
      executionMode: "deterministic",
      triggerType: "test",
      inputFingerprint: nextFingerprint(),
      ...overrides,
    });
    return result.runId;
  }

  /* ------------------------------------------------------------------ */
  /* A. Registry                                                         */
  /* ------------------------------------------------------------------ */

  await check("A1 the registry holds exactly four agents, in the locked order", () => {
    assert.deepEqual(registry.AGENT_CODES, [
      "curie_atlas",
      "curie_pulse",
      "curie_mentor",
      "curie_sentinel",
    ]);
    assert.equal(registry.listAgents().length, 4);
  });

  await check("A2 curie_atlas is available at 1.0.0 in deterministic mode", () => {
    const atlas = registry.AGENT_REGISTRY.curie_atlas;
    assert.equal(atlas.displayName, "Curie Atlas");
    assert.equal(atlas.currentVersion, "1.0.0");
    assert.equal(atlas.currentMode, "deterministic");
    assert.equal(atlas.implementationStatus, "available");
    assert.equal(atlas.automaticActionsAllowed, false);
  });

  await check("A3 the registry version equals the published Atlas contract version", async () => {
    const atlasContract = await import("../../src/lib/analysis/analysis-contract");
    // Two hand-maintained copies of one version WILL drift. This is the check
    // that turns that from a silent inconsistency into a build failure.
    assert.equal(
      registry.AGENT_REGISTRY.curie_atlas.currentVersion,
      atlasContract.CURIE_ATLAS_AGENT_VERSION,
    );
    assert.equal(
      registry.AGENT_REGISTRY.curie_atlas.code,
      atlasContract.CURIE_ATLAS_AGENT_CODE,
    );
  });

  await check("A4 pulse, mentor and sentinel are reserved and forbid automatic actions", () => {
    for (const code of ["curie_pulse", "curie_mentor", "curie_sentinel"] as const) {
      const agent = registry.AGENT_REGISTRY[code];
      assert.equal(agent.implementationStatus, "reserved");
      assert.equal(agent.currentVersion, null);
      assert.equal(agent.currentMode, null);
      assert.equal(agent.automaticActionsAllowed, false);
    }
  });

  await check("A5 no agent anywhere allows an automatic action", () => {
    for (const agent of registry.listAgents()) {
      assert.equal(agent.automaticActionsAllowed, false);
    }
  });

  await check("A6 an unknown agent code is rejected", () => {
    rejectsWith("AGENT_UNKNOWN", () =>
      registry.resolveAgentForExecution({
        agentCode: "curie_rogue",
        agentVersion: "1.0.0",
        executionMode: "deterministic",
      }),
    );
  });

  await check("A7 a runtime-defined agent name cannot be registered", () => {
    // The registry is a frozen source constant. Assigning to it must not create
    // an agent, which is the property that keeps the database from becoming the
    // source of agent identity.
    const before = registry.listAgents().length;
    try {
      (registry.AGENT_REGISTRY as Record<string, unknown>).curie_injected = {
        code: "curie_injected",
      };
    } catch {
      /* a frozen object throws in strict mode, which is also acceptable */
    }
    assert.equal(registry.listAgents().length, before);
    assert.equal(registry.findAgent("curie_injected"), null);
  });

  await check("A8 a version mismatch is rejected", () => {
    rejectsWith("AGENT_VERSION_MISMATCH", () =>
      registry.resolveAgentForExecution({
        agentCode: "curie_atlas",
        agentVersion: "1.0.1",
        executionMode: "deterministic",
      }),
    );
  });

  await check("A9 an unsupported execution mode is rejected", () => {
    rejectsWith("AGENT_MODE_UNSUPPORTED", () =>
      registry.resolveAgentForExecution({
        agentCode: "curie_atlas",
        agentVersion: "1.0.0",
        executionMode: "telepathic",
      }),
    );
  });

  await check("A10 model_assisted and model_only are schema-legal but NOT executable", () => {
    // A distinct code from A9 on purpose: these are REAL modes that are
    // DISABLED, and reporting them as "unsupported" would hide that.
    for (const mode of ["model_assisted", "model_only"]) {
      rejectsWith("AGENT_MODE_NOT_EXECUTABLE", () =>
        registry.resolveAgentForExecution({
          agentCode: "curie_atlas",
          agentVersion: "1.0.0",
          executionMode: mode,
        }),
      );
      assert.ok(
        (registry.AGENT_EXECUTION_MODES as readonly string[]).includes(mode),
        `${mode} must remain a legal schema value`,
      );
    }
    assert.deepEqual(registry.EXECUTABLE_EXECUTION_MODES, ["deterministic"]);
  });

  await check("A11 pulse, mentor and sentinel cannot be executed", () => {
    for (const code of ["curie_pulse", "curie_mentor", "curie_sentinel"]) {
      rejectsWith("AGENT_NOT_IMPLEMENTED", () =>
        registry.resolveAgentForExecution({
          agentCode: code,
          agentVersion: "1.0.0",
          executionMode: "deterministic",
        }),
      );
    }
  });

  await check("A12 there is no AgentDefinition table and no Prisma model for one", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE name LIKE '%AgentDefinition%'`,
    );
    assert.deepEqual(rows, []);
    const schema = fs.readFileSync(path.join(projectRoot, "prisma", "schema.prisma"), "utf8");
    assert.ok(
      !/model\s+AgentDefinition\b/.test(schema),
      "AgentDefinition must stay a source registry, never a table",
    );
  });

  /* ------------------------------------------------------------------ */
  /* B. Agent run                                                        */
  /* ------------------------------------------------------------------ */

  await check("B1 a legal global run is created at status created", async () => {
    const runId = await createRun();
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.agentCode, "curie_atlas");
    assert.equal(run.agentVersion, "1.0.0");
    assert.equal(run.executionMode, "deterministic");
    assert.equal(run.status, "created");
    assert.equal(run.subjectType, null);
    assert.equal(run.subjectRef, null);
    assert.equal(run.initiatedByStaffId, staff.id);
    assert.equal(run.findingCount, 0);
  });

  await check("B2 a subject-scoped run stores both halves of the pair", async () => {
    const runId = await createRun({ subjectType: "learner", subjectRef: "34" });
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.subjectType, "learner");
    assert.equal(run.subjectRef, "34");
  });

  await check("B3 a half-specified subject is rejected, in both directions", async () => {
    await rejectsWith("AGENT_RUN_SUBJECT_INVALID", () =>
      createRun({ subjectType: "learner" }),
    );
    await rejectsWith("AGENT_RUN_SUBJECT_INVALID", () =>
      createRun({ subjectRef: "34" }),
    );
  });

  await check("B4 an unsupported subject type is rejected", async () => {
    await rejectsWith("AGENT_RUN_SUBJECT_INVALID", () =>
      createRun({
        subjectType: "credit_card" as never,
        subjectRef: "1",
      }),
    );
  });

  await check("B5 a subjectRef that looks like PII is rejected", async () => {
    // The subject is an INTERNAL OPAQUE REFERENCE. An email address, a URL and
    // a raw Pocket player id must all be unstorable in it.
    for (const ref of ["learner@example.com", "https://pocket.example/u/1", "900000101"]) {
      await rejectsWith("PAYLOAD_VALUE_FORBIDDEN", () =>
        createRun({ subjectType: "learner", subjectRef: ref }),
      );
    }
  });

  await check("B6 the database itself refuses a half-specified subject", async () => {
    // Belt and braces: even a caller bypassing the service cannot store one.
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AgentRun" ("id","agentCode","agentVersion","executionMode","triggerType","status","requestId","inputFingerprint","subjectType","findingCount","warningCount","createdAt")
         VALUES ('af1-raw-1','curie_atlas','1.0.0','deterministic','test','created','af1-raw','abcdef01','learner',0,0,CURRENT_TIMESTAMP)`,
      ),
    );
  });

  await check("B7 the same idempotency key returns the first run, not a second", async () => {
    const key = "af1-idem-alpha";
    const fingerprint = nextFingerprint();
    const first = await service.createAgentRun(ctx, {
      agentCode: "curie_atlas",
      agentVersion: "1.0.0",
      executionMode: "deterministic",
      triggerType: "test",
      inputFingerprint: fingerprint,
      idempotencyKey: key,
    });
    const second = await service.createAgentRun(ctx, {
      agentCode: "curie_atlas",
      agentVersion: "1.0.0",
      executionMode: "deterministic",
      triggerType: "test",
      inputFingerprint: fingerprint,
      idempotencyKey: key,
    });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.runId, first.runId);
    const count = await prisma.agentRun.count({
      where: { agentCode: "curie_atlas", idempotencyKey: key },
    });
    assert.equal(count, 1);
  });

  await check("B8 concurrent creation under one key still yields exactly one run", async () => {
    const key = "af1-idem-race";
    const fingerprint = nextFingerprint();
    const make = () =>
      service.createAgentRun(ctx, {
        agentCode: "curie_atlas",
        agentVersion: "1.0.0",
        executionMode: "deterministic",
        triggerType: "test",
        inputFingerprint: fingerprint,
        idempotencyKey: key,
      });
    const results = await Promise.all([make(), make(), make(), make()]);
    const ids = new Set(results.map((r) => r.runId));
    assert.equal(ids.size, 1, "all concurrent callers must converge on one run");
    assert.equal(
      await prisma.agentRun.count({ where: { agentCode: "curie_atlas", idempotencyKey: key } }),
      1,
    );
  });

  await check("B9 many keyless runs coexist under one agent", async () => {
    // SQLite treats NULLs as distinct in a unique index, which is exactly the
    // semantics the contract needs: optional for interactive, mandatory later.
    await createRun();
    await createRun();
    const nullKeyed = await prisma.agentRun.count({
      where: { agentCode: "curie_atlas", idempotencyKey: null },
    });
    assert.ok(nullKeyed >= 2, `expected several keyless runs, got ${nullKeyed}`);
  });

  await check("B10 the full success lifecycle runs created -> running -> completed", async () => {
    const runId = await createRun();
    await service.transitionAgentRun(ctx, { runId, from: "created", to: "running" });
    await service.transitionAgentRun(ctx, {
      runId,
      from: "running",
      to: "completed",
      findingCount: 3,
      warningCount: 1,
    });
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, "completed");
    assert.ok(run.startedAt instanceof Date);
    assert.ok(run.completedAt instanceof Date);
    assert.equal(run.findingCount, 3);
    assert.equal(run.warningCount, 1);
    assert.equal(run.failedAt, null);
  });

  await check("B11 the failure lifecycle records failedAt and a failure code", async () => {
    const runId = await createRun();
    await service.transitionAgentRun(ctx, { runId, from: "created", to: "running" });
    await service.transitionAgentRun(ctx, {
      runId,
      from: "running",
      to: "failed",
      failureCode: "input_unavailable",
    });
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, "failed");
    assert.equal(run.failureCode, "input_unavailable");
    assert.ok(run.failedAt instanceof Date);
  });

  await check("B12 an illegal transition is refused and mutates nothing", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_RUN_TRANSITION_ILLEGAL", () =>
      service.transitionAgentRun(ctx, { runId, from: "created", to: "completed" }),
    );
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, "created", "the run must not have moved");
    assert.equal(run.startedAt, null);
    assert.equal(run.completedAt, null);
  });

  await check("B13 a terminal run can never be moved again", async () => {
    const runId = await createRun();
    await service.transitionAgentRun(ctx, { runId, from: "created", to: "cancelled" });
    for (const to of ["running", "completed", "failed"] as const) {
      await rejectsWith("AGENT_RUN_TRANSITION_ILLEGAL", () =>
        service.transitionAgentRun(ctx, { runId, from: "cancelled", to }),
      );
    }
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, "cancelled");
  });

  await check("B14 two concurrent terminal transitions: exactly one wins", async () => {
    const runId = await createRun();
    await service.transitionAgentRun(ctx, { runId, from: "created", to: "running" });
    const results = await Promise.allSettled([
      service.transitionAgentRun(ctx, { runId, from: "running", to: "completed" }),
      service.transitionAgentRun(ctx, { runId, from: "running", to: "failed", failureCode: "x" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one transition may succeed");
    assert.equal(rejected.length, 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    assert.ok(
      reason.code === "AGENT_RUN_TERMINAL" || reason.code === "AGENT_RUN_TRANSITION_LOST",
      `unexpected loser code ${reason.code}`,
    );
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    assert.ok(["completed", "failed"].includes(run.status));
  });

  await check("B15 a non-executable trigger type is refused", async () => {
    // scheduled, handoff and system are legal SCHEMA values with no runtime:
    // this phase implements no scheduler and no handoff consumer.
    for (const trigger of ["scheduled", "handoff", "system"]) {
      await rejectsWith("AGENT_TRIGGER_NOT_EXECUTABLE", () =>
        createRun({ triggerType: trigger }),
      );
      assert.ok((contract.AGENT_TRIGGER_TYPES as readonly string[]).includes(trigger));
    }
  });

  await check("B16 a malformed input fingerprint is refused", async () => {
    for (const bad of ["", "short", "NOTHEX-NOTHEX-NOT", "  abcdef01  "]) {
      await rejectsWith("AGENT_RUN_SUBJECT_INVALID", () =>
        createRun({ inputFingerprint: bad }),
      );
    }
  });

  /* ------------------------------------------------------------------ */
  /* C. Findings                                                         */
  /* ------------------------------------------------------------------ */

  const evidenceFixture = {
    sourceDomain: "affiliate_analytics" as const,
    sourceType: "summary",
    sourceRef: "period-2026-08",
    fieldPath: "qualifiedClicks",
    observedValue: { metricKey: "qualifiedClicks", metricValue: "1240" },
  };

  await check("C1 a valid structured finding is written with its evidence", async () => {
    const runId = await createRun();
    const { findingId } = await service.recordFinding(ctx, {
      runId,
      findingKey: "f-001",
      code: "agent_core.subject_observation",
      category: "observation",
      severity: "info",
      messageKey: "agent_core.subject_observation.v1",
      operands: { metricKey: "qualifiedClicks", metricValue: "1240" },
      supportTier: "measured",
      evidence: [evidenceFixture],
    });
    const finding = await prisma.agentFinding.findUniqueOrThrow({
      where: { id: findingId },
      include: { evidence: true },
    });
    assert.equal(finding.code, "agent_core.subject_observation");
    assert.equal(finding.status, "active");
    assert.equal(finding.operandsSchemaVersion, 1);
    assert.equal(finding.evidence.length, 1);
    assert.deepEqual(finding.operandsJson, {
      metricKey: "qualifiedClicks",
      metricValue: "1240",
    });
  });

  await check("C2 there is NO rendered-message column on a finding", () => {
    // The authoritative representation is code + messageKey + operands +
    // evidence. A free-text column would silently undo "no invented causes".
    const columns = Object.keys(
      (prisma.agentFinding as unknown as { fields: Record<string, unknown> }).fields,
    );
    for (const forbidden of ["message", "text", "body", "prose", "summary", "narrative"]) {
      assert.ok(
        !columns.includes(forbidden),
        `AgentFinding must not carry a ${forbidden} column`,
      );
    }
    assert.ok(columns.includes("messageKey"));
  });

  await check("C3 an unknown finding code is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_FINDING_CODE_UNKNOWN", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-bad",
        code: "agent_core.invented_by_a_caller",
        category: "observation",
        severity: "info",
        messageKey: "x",
        operands: {},
        supportTier: "measured",
        evidence: [evidenceFixture],
      }),
    );
  });

  await check("C4 an unknown operand key is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("PAYLOAD_KEY_UNKNOWN", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-unknown-key",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x", metricValue: "1", surpriseKey: "2" },
        supportTier: "measured",
        evidence: [evidenceFixture],
      }),
    );
  });

  await check("C5 a PII-shaped operand key is rejected", async () => {
    const runId = await createRun();
    for (const key of ["email", "learnerEmail", "phone_number", "fullName", "pocketPlayerId", "clickId", "prompt", "sessionSecret"]) {
      await rejectsWith("PAYLOAD_KEY_FORBIDDEN", () =>
        service.recordFinding(ctx, {
          runId,
          findingKey: `f-pii-${key}`,
          code: "agent_core.subject_observation",
          category: "observation",
          severity: "info",
          messageKey: "m",
          operands: { metricKey: "x", metricValue: "1", [key]: "value" },
          supportTier: "measured",
          evidence: [evidenceFixture],
        }),
      );
    }
  });

  await check("C6 a PII-shaped operand VALUE is rejected under a legal key", async () => {
    const runId = await createRun();
    for (const value of [
      "learner@example.com",
      "https://pocket.example/cb?ow=secret",
      "900000101",
      "SELECT * FROM User",
      "Bearer abc123",
    ]) {
      await rejectsWith("PAYLOAD_VALUE_FORBIDDEN", () =>
        service.recordFinding(ctx, {
          runId,
          findingKey: `f-val-${value.slice(0, 8)}`,
          code: "agent_core.subject_observation",
          category: "observation",
          severity: "info",
          messageKey: "m",
          operands: { metricKey: "x", metricValue: value },
          supportTier: "measured",
          evidence: [evidenceFixture],
        }),
      );
    }
  });

  await check("C7 a nested operand value is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("PAYLOAD_NESTED_VALUE", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-nested",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: { deep: "payload" }, metricValue: "1" },
        supportTier: "measured",
        evidence: [evidenceFixture],
      }),
    );
  });

  await check("C8 an oversized operand payload is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("PAYLOAD_VALUE_TOO_LONG", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-huge",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x", metricValue: "z".repeat(500) },
        supportTier: "measured",
        evidence: [evidenceFixture],
      }),
    );
  });

  await check("C9 a required operand may not be missing", async () => {
    const runId = await createRun();
    await rejectsWith("PAYLOAD_KEY_UNKNOWN", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-missing",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x" },
        supportTier: "measured",
        evidence: [evidenceFixture],
      }),
    );
  });

  await check("C10 a measured finding with NO evidence is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_FINDING_EVIDENCE_REQUIRED", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-no-evidence",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x", metricValue: "1" },
        supportTier: "measured",
        evidence: [],
      }),
    );
  });

  await check("C11 only an insufficient-tier finding may cite no evidence", async () => {
    const runId = await createRun();
    const { findingId } = await service.recordFinding(ctx, {
      runId,
      findingKey: "f-insufficient",
      code: "agent_core.insufficient_data",
      category: "sufficiency",
      severity: "info",
      messageKey: "agent_core.insufficient_data.v1",
      operands: { reasonCode: "no_events_in_period" },
      supportTier: "insufficient",
      evidence: [],
    });
    const finding = await prisma.agentFinding.findUniqueOrThrow({
      where: { id: findingId },
      include: { evidence: true },
    });
    assert.equal(finding.evidence.length, 0);
    assert.equal(finding.supportTier, "insufficient");
  });

  await check("C12 a rejected finding leaves NO partial row and NO orphan evidence", async () => {
    // The finding and all its evidence are written in one transaction, so a
    // finding with zero evidence must not exist even transiently.
    const runId = await createRun();
    const before = await prisma.agentFinding.count();
    const evidenceBefore = await prisma.agentEvidenceReference.count();
    await rejectsWith("AGENT_EVIDENCE_DOMAIN_UNSUPPORTED", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-atomic",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x", metricValue: "1" },
        supportTier: "measured",
        evidence: [evidenceFixture, { ...evidenceFixture, sourceDomain: "communication_event" }],
      }),
    );
    assert.equal(await prisma.agentFinding.count(), before);
    assert.equal(await prisma.agentEvidenceReference.count(), evidenceBefore);
  });

  await check("C13 a finding's content is immutable — only its status may move", async () => {
    const runId = await createRun();
    const { findingId } = await service.recordFinding(ctx, {
      runId,
      findingKey: "f-immutable",
      code: "agent_core.subject_observation",
      category: "observation",
      severity: "info",
      messageKey: "m",
      operands: { metricKey: "x", metricValue: "7" },
      supportTier: "measured",
      evidence: [evidenceFixture],
    });
    // The service module exposes no function that writes a finding's content.
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    assert.ok(
      !/agentFinding\.update\b/.test(source),
      "no content update path may exist for a finding",
    );
    assert.ok(!/agentFinding\.delete/.test(source), "no delete path may exist");
    assert.ok(!/agentEvidenceReference\.(update|delete)/.test(source));

    await service.transitionFinding(ctx, {
      findingId,
      from: "active",
      to: "withdrawn",
    });
    const finding = await prisma.agentFinding.findUniqueOrThrow({ where: { id: findingId } });
    assert.equal(finding.status, "withdrawn");
    assert.deepEqual(finding.operandsJson, { metricKey: "x", metricValue: "7" });
    // Withdrawn is terminal: re-asserting means a new run producing a new finding.
    await rejectsWith("AGENT_FINDING_TRANSITION_ILLEGAL", () =>
      service.transitionFinding(ctx, { findingId, from: "withdrawn", to: "active" }),
    );
  });

  await check("C14 critical is a legal severity and Curie Atlas has no such level", async () => {
    const atlasContract = await import("../../src/lib/analysis/analysis-contract");
    assert.ok((contract.AGENT_FINDING_SEVERITIES as readonly string[]).includes("critical"));
    // The accepted Atlas ladder stays exactly two members. A severity ladder
    // invites a judgement that report is not entitled to make.
    assert.deepEqual(atlasContract.FINDING_SEVERITIES, ["info", "attention"]);
    assert.ok(!(atlasContract.FINDING_SEVERITIES as readonly string[]).includes("critical"));
  });

  /* ------------------------------------------------------------------ */
  /* D. Evidence                                                         */
  /* ------------------------------------------------------------------ */

  await check("D1 a minimal evidence reference needs no observed value", async () => {
    const runId = await createRun();
    const { findingId } = await service.recordFinding(ctx, {
      runId,
      findingKey: "f-min-evidence",
      code: "agent_core.subject_observation",
      category: "observation",
      severity: "info",
      messageKey: "m",
      operands: { metricKey: "x", metricValue: "1" },
      supportTier: "measured",
      evidence: [
        {
          sourceDomain: "affiliate_analytics",
          sourceType: "summary",
          sourceRef: "period-2026-08",
          fieldPath: "qualifiedClicks",
        },
      ],
    });
    const evidence = await prisma.agentEvidenceReference.findFirstOrThrow({
      where: { findingId },
    });
    assert.equal(evidence.observedValueJson, null);
    assert.equal(evidence.sourceDomain, "affiliate_analytics");
  });

  await check("D2 an unimplemented evidence domain is rejected", async () => {
    const runId = await createRun();
    for (const domain of ["curriculum", "progression", "pocket_event", "money_event", "communication_event"]) {
      await rejectsWith("AGENT_EVIDENCE_DOMAIN_UNSUPPORTED", () =>
        service.recordFinding(ctx, {
          runId,
          findingKey: `f-domain-${domain}`,
          code: "agent_core.subject_observation",
          category: "observation",
          severity: "info",
          messageKey: "m",
          operands: { metricKey: "x", metricValue: "1" },
          supportTier: "measured",
          evidence: [{ ...evidenceFixture, sourceDomain: domain as never }],
        }),
      );
      assert.ok(
        (contract.AGENT_EVIDENCE_DOMAINS as readonly string[]).includes(domain),
        `${domain} must remain a legal schema value`,
      );
    }
  });

  await check("D3 an entire DTO cannot be stored as an observed value", async () => {
    const runId = await createRun();
    await rejectsWith("PAYLOAD_KEY_UNKNOWN", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-dto",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x", metricValue: "1" },
        supportTier: "measured",
        evidence: [
          {
            ...evidenceFixture,
            observedValue: {
              id: 1,
              name: "Full Name",
              createdAt: "2026-08-01",
              status: "active",
            },
          },
        ],
      }),
    );
  });

  await check("D4 an oversized observed value is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("PAYLOAD_VALUE_TOO_LONG", () =>
      service.recordFinding(ctx, {
        runId,
        findingKey: "f-big-observed",
        code: "agent_core.subject_observation",
        category: "observation",
        severity: "info",
        messageKey: "m",
        operands: { metricKey: "x", metricValue: "1" },
        supportTier: "measured",
        evidence: [
          { ...evidenceFixture, observedValue: { metricKey: "x", metricValue: "9".repeat(400) } },
        ],
      }),
    );
  });

  await check("D5 evidence is immutable: no update or delete path exists", () => {
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    assert.ok(!/agentEvidenceReference\.update/.test(source));
    assert.ok(!/agentEvidenceReference\.delete/.test(source));
    assert.ok(!/deleteMany/.test(source), "the Core exposes no bulk deletion at all");
  });

  /* ------------------------------------------------------------------ */
  /* E. Handoffs                                                         */
  /* ------------------------------------------------------------------ */

  await check("E1 a valid handoff to a reserved agent is proposed and stays inert", async () => {
    const runId = await createRun();
    const { handoffId } = await service.proposeHandoff(ctx, {
      sourceRunId: runId,
      targetAgentCode: "curie_pulse",
      handoffCode: "retention_candidate",
      payload: { signalCode: "no_activity_observed", windowDays: 30 },
      deduplicationKey: "af1-handoff-alpha",
    });
    const handoff = await prisma.agentHandoff.findUniqueOrThrow({ where: { id: handoffId } });
    assert.equal(handoff.status, "proposed");
    assert.equal(handoff.targetAgentCode, "curie_pulse");
    assert.equal(handoff.targetAgentVersion, null);
    assert.equal(handoff.acceptedRunId, null);
    assert.equal(handoff.acceptedAt, null);
  });

  await check("E2 an unknown handoff target is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_UNKNOWN", () =>
      service.proposeHandoff(ctx, {
        sourceRunId: runId,
        targetAgentCode: "curie_unknown",
        handoffCode: "retention_candidate",
        payload: { signalCode: "x" },
      }),
    );
  });

  await check("E3 a pinned target version must match the registry", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_VERSION_MISMATCH", () =>
      service.proposeHandoff(ctx, {
        sourceRunId: runId,
        targetAgentCode: "curie_pulse",
        targetAgentVersion: "1.0.0",
        handoffCode: "retention_candidate",
        payload: { signalCode: "x" },
      }),
    );
  });

  await check("E4 an unknown handoff code is rejected", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_HANDOFF_CODE_UNKNOWN", () =>
      service.proposeHandoff(ctx, {
        sourceRunId: runId,
        targetAgentCode: "curie_pulse",
        handoffCode: "do_whatever_you_think_best",
        payload: {},
      }),
    );
  });

  await check("E5 a natural-language instruction cannot be put in a handoff", async () => {
    const runId = await createRun();
    for (const key of ["message", "instruction", "note", "prompt"]) {
      await assert.rejects(
        service.proposeHandoff(ctx, {
          sourceRunId: runId,
          targetAgentCode: "curie_pulse",
          handoffCode: "retention_candidate",
          payload: { signalCode: "x", [key]: "please contact this learner" },
        }),
        (error: { code?: string }) =>
          error.code === "PAYLOAD_KEY_UNKNOWN" || error.code === "PAYLOAD_KEY_FORBIDDEN",
      );
    }
  });

  await check("E6 a duplicate deduplication key returns the existing handoff", async () => {
    const runId = await createRun();
    const first = await service.proposeHandoff(ctx, {
      sourceRunId: runId,
      targetAgentCode: "curie_pulse",
      handoffCode: "engagement_review",
      payload: { signalCode: "y" },
      deduplicationKey: "af1-handoff-dupe",
    });
    const second = await service.proposeHandoff(ctx, {
      sourceRunId: runId,
      targetAgentCode: "curie_pulse",
      handoffCode: "engagement_review",
      payload: { signalCode: "y" },
      deduplicationKey: "af1-handoff-dupe",
    });
    assert.equal(second.reused, true);
    assert.equal(second.handoffId, first.handoffId);
    assert.equal(
      await prisma.agentHandoff.count({ where: { deduplicationKey: "af1-handoff-dupe" } }),
      1,
    );
  });

  await check("E7 an expiry may be recorded and no sweeper acts on it", async () => {
    const runId = await createRun();
    const expiresAt = new Date(Date.now() + 3_600_000);
    const { handoffId } = await service.proposeHandoff(ctx, {
      sourceRunId: runId,
      targetAgentCode: "curie_mentor",
      handoffCode: "engagement_review",
      payload: { signalCode: "z" },
      expiresAt,
    });
    const handoff = await prisma.agentHandoff.findUniqueOrThrow({ where: { id: handoffId } });
    assert.equal(handoff.expiresAt?.getTime(), expiresAt.getTime());
    assert.equal(handoff.status, "proposed", "no sweeper may have moved it");
  });

  await check("E8 NO handoff is ever accepted and NO target run is created from one", async () => {
    const accepted = await prisma.agentHandoff.count({ where: { status: "accepted" } });
    assert.equal(accepted, 0);
    const withRun = await prisma.agentHandoff.count({ where: { NOT: { acceptedRunId: null } } });
    assert.equal(withRun, 0);
    // There is no consumer in source either.
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    assert.ok(
      !/acceptHandoff|consumeHandoff|processHandoff/.test(source),
      "no handoff consumer may exist in this phase",
    );
  });

  await check("E9 the database refuses an accepted handoff with no accepting run", async () => {
    const runId = await createRun();
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AgentHandoff" ("id","sourceRunId","targetAgentCode","handoffCode","payloadJson","payloadSchemaVersion","status","createdAt")
         VALUES ('af1-h-raw','${runId}','curie_pulse','retention_candidate','{}',1,'accepted',CURRENT_TIMESTAMP)`,
      ),
    );
  });

  /* ------------------------------------------------------------------ */
  /* F. Action proposals                                                 */
  /* ------------------------------------------------------------------ */

  const proposalFixture = {
    actionClass: "continue_learning" as const,
    subjectType: "learner" as const,
    subjectRef: "34",
    reasonCodes: { primaryCode: "no_recent_lesson", findingCount: 1 },
    channel: "human_task" as const,
    templateKey: "education.continue_learning.v1",
    parameters: { levelCode: "v2.l002.risk", completedLevelCount: 1 },
  };

  await check("F1 a proposal always requires human approval and starts inert", async () => {
    const runId = await createRun();
    const { proposalId } = await service.proposeAction(ctx, {
      sourceRunId: runId,
      ...proposalFixture,
      deduplicationKey: "af1-proposal-alpha",
    });
    const proposal = await prisma.agentActionProposal.findUniqueOrThrow({
      where: { id: proposalId },
    });
    assert.equal(proposal.requiresHumanApproval, true);
    assert.equal(proposal.status, "proposed");
  });

  await check("F2 requiresHumanApproval is not a parameter any caller can set", () => {
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    // Outside comments it appears exactly once, as a hard-coded `true` in the
    // create call — never in an input type and never read from a parameter.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const occurrences = code.match(/requiresHumanApproval/g) ?? [];
    assert.equal(occurrences.length, 1, "it must not be an input field anywhere");
    assert.ok(/requiresHumanApproval: true/.test(code));
    assert.ok(
      !/requiresHumanApproval\s*[?:]\s*(boolean|input)/.test(code),
      "it must never appear in an input type",
    );
  });

  await check("F3 the database permits exactly one value for requiresHumanApproval", async () => {
    const runId = await createRun();
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "AgentActionProposal" ("id","sourceRunId","actionClass","subjectType","subjectRef","reasonCodesJson","channel","templateKey","parametersJson","parametersSchemaVersion","status","requiresHumanApproval","createdAt")
         VALUES ('af1-p-raw','${runId}','continue_learning','learner','34','{}','human_task','t','{}',1,'approved',0,CURRENT_TIMESTAMP)`,
      ),
      "an auto-approved proposal must be impossible at the storage layer",
    );
  });

  await check("F4 every forbidden financial action class is rejected", async () => {
    const runId = await createRun();
    // Named one by one so that adding any of them becomes a test failure, not a
    // quiet widening of the enum.
    for (const forbidden of [
      "deposit_encouragement",
      "trading_encouragement",
      "bid_change",
      "cpa_change",
      "affiliate_disablement",
      "financial_pressure",
    ]) {
      await rejectsWith("AGENT_ACTION_CLASS_FORBIDDEN", () =>
        service.proposeAction(ctx, {
          sourceRunId: runId,
          ...proposalFixture,
          actionClass: forbidden as never,
        }),
      );
      assert.ok(
        !(contract.AGENT_ACTION_CLASSES as readonly string[]).includes(forbidden),
        `${forbidden} must never enter the action class list`,
      );
    }
  });

  await check("F5 the closed action class list is exactly the five educational ones", () => {
    assert.deepEqual(contract.AGENT_ACTION_CLASSES, [
      "education_reminder",
      "continue_learning",
      "complete_registration",
      "review_feedback",
      "support_followup",
    ]);
  });

  await check("F6 an arbitrary message cannot be attached to a proposal", async () => {
    const runId = await createRun();
    for (const key of ["body", "text", "message", "subject", "html"]) {
      await assert.rejects(
        service.proposeAction(ctx, {
          sourceRunId: runId,
          ...proposalFixture,
          parameters: { levelCode: "v2.l002.risk", [key]: "Deposit now for a bonus" },
        }),
        (error: { code?: string }) =>
          error.code === "PAYLOAD_KEY_UNKNOWN" || error.code === "PAYLOAD_KEY_FORBIDDEN",
      );
    }
  });

  await check("F7 an agent-supplied URL cannot be attached to a proposal", async () => {
    const runId = await createRun();
    await assert.rejects(
      service.proposeAction(ctx, {
        sourceRunId: runId,
        ...proposalFixture,
        parameters: { levelCode: "https://evil.example/claim" },
      }),
      (error: { code?: string }) => error.code === "PAYLOAD_VALUE_FORBIDDEN",
    );
    await assert.rejects(
      service.proposeAction(ctx, {
        sourceRunId: runId,
        ...proposalFixture,
        templateKey: "https://evil.example/template",
      }),
      (error: { code?: string }) => error.code === "PAYLOAD_VALUE_FORBIDDEN",
    );
  });

  await check("F8 a recipient address cannot be attached to a proposal", async () => {
    const runId = await createRun();
    for (const key of ["recipient", "destination", "toEmail", "phone", "address"]) {
      await assert.rejects(
        service.proposeAction(ctx, {
          sourceRunId: runId,
          ...proposalFixture,
          parameters: { levelCode: "v2.l002.risk", [key]: "x" },
        }),
        (error: { code?: string }) =>
          error.code === "PAYLOAD_KEY_UNKNOWN" || error.code === "PAYLOAD_KEY_FORBIDDEN",
      );
    }
  });

  await check("F9 a proposal cannot be global — it is always about a subject", async () => {
    const runId = await createRun();
    await rejectsWith("AGENT_RUN_SUBJECT_INVALID", () =>
      service.proposeAction(ctx, {
        sourceRunId: runId,
        ...proposalFixture,
        subjectType: undefined as never,
        subjectRef: undefined as never,
      }),
    );
  });

  await check("F10 proposing an action creates NO execution", async () => {
    const executions = await prisma.agentActionExecution.count();
    assert.equal(executions, 0);
  });

  /* ------------------------------------------------------------------ */
  /* G. Decisions                                                        */
  /* ------------------------------------------------------------------ */

  await check("G1 an authorised staff context records a decision", async () => {
    const runId = await createRun();
    const { proposalId } = await service.proposeAction(ctx, {
      sourceRunId: runId,
      ...proposalFixture,
      deduplicationKey: "af1-proposal-decided",
    });
    await service.transitionProposal(ctx, {
      proposalId,
      from: "proposed",
      to: "awaiting_approval",
    });
    const { decisionId } = await service.decideAction(ctx, {
      proposalId,
      decision: "approved",
      decisionCode: "operator_approved",
      policyVersion: "af1.1",
    });
    const decision = await prisma.agentActionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    });
    assert.equal(decision.decidedByStaffId, staff.id);
    assert.equal(decision.decision, "approved");
    assert.equal(decision.policyVersion, "af1.1");
  });

  await check("G2 an anonymous decision is refused", async () => {
    const runId = await createRun();
    const { proposalId } = await service.proposeAction(ctx, {
      sourceRunId: runId,
      ...proposalFixture,
      deduplicationKey: "af1-proposal-anon",
    });
    await rejectsWith("AGENT_DECISION_ACTOR_REQUIRED", () =>
      service.decideAction(systemCtx, {
        proposalId,
        decision: "approved",
        decisionCode: "system_approved",
        policyVersion: "af1.1",
      }),
    );
    assert.equal(await prisma.agentActionDecision.count({ where: { proposalId } }), 0);
  });

  await check("G3 the decider comes from the context, never from the input", () => {
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    assert.ok(
      /decidedByStaffId: ctx\.actorStaffId/.test(source),
      "a caller must not be able to name somebody else as the decider",
    );
  });

  await check("G4 a second final decision on one proposal is refused", async () => {
    const runId = await createRun();
    const { proposalId } = await service.proposeAction(ctx, {
      sourceRunId: runId,
      ...proposalFixture,
      deduplicationKey: "af1-proposal-twice",
    });
    await service.decideAction(ctx, {
      proposalId,
      decision: "approved",
      decisionCode: "first",
      policyVersion: "af1.1",
    });
    await rejectsWith("AGENT_DECISION_DUPLICATE", () =>
      service.decideAction(ctx, {
        proposalId,
        decision: "rejected",
        decisionCode: "second",
        policyVersion: "af1.1",
      }),
    );
    assert.equal(await prisma.agentActionDecision.count({ where: { proposalId } }), 1);
  });

  await check("G5 a decision is immutable — no update or delete path exists", () => {
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    assert.ok(!/agentActionDecision\.update/.test(source));
    assert.ok(!/agentActionDecision\.delete/.test(source));
  });

  await check("G6 the decision staff FK is Restrict — a decider cannot be deleted away", async () => {
    await assert.rejects(
      prisma.staffProfile.delete({ where: { id: staff.id } }),
      "a staff profile named in an immutable decision must not be deletable",
    );
  });

  /* ------------------------------------------------------------------ */
  /* H. Executions                                                       */
  /* ------------------------------------------------------------------ */

  await check("H1 the execution provider registry is empty", () => {
    assert.deepEqual(contract.ENABLED_EXECUTION_PROVIDERS, []);
  });

  await check("H2 every execution attempt fails closed, whatever the provider", async () => {
    const runId = await createRun();
    const { proposalId } = await service.proposeAction(ctx, {
      sourceRunId: runId,
      ...proposalFixture,
      deduplicationKey: "af1-proposal-exec",
    });
    for (const provider of ["smtp", "inapp", "push", "twilio", ""]) {
      await rejectsWith("EXECUTION_PROVIDER_DISABLED", () =>
        service.startActionExecution(ctx, {
          proposalId,
          attemptNumber: 1,
          executionProvider: provider,
          idempotencyKey: `af1-exec-${provider || "empty"}`,
        }),
      );
    }
  });

  await check("H3 a disabled execution writes NO row at all", async () => {
    assert.equal(await prisma.agentActionExecution.count(), 0);
  });

  await check("H4 the Agent Core imports no network client", () => {
    // The strongest available proof that no external call can be made: the
    // module graph contains nothing that could make one.
    const dir = path.join(projectRoot, "src", "lib", "agents");
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const forbidden of ["fetch(", "node:http", "node:https", "axios", "undici", "XMLHttpRequest", "WebSocket"]) {
        assert.ok(
          !source.includes(forbidden),
          `${file} must not reference ${forbidden}`,
        );
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* I. Evaluations                                                      */
  /* ------------------------------------------------------------------ */

  await check("I1 a deterministic evaluation is recorded", async () => {
    const runId = await createRun();
    const { evaluationId } = await service.recordEvaluation(ctx, {
      evaluatorType: "deterministic",
      evaluatorCode: "af1_self_check",
      targetType: "agent_run",
      targetRef: runId,
      evaluationCode: "agent_core.run_terminates",
      scoreValue: "1.00",
      result: "passed",
      evidence: { checkCode: "terminal_status_reached", observedCount: 1, expectedCount: 1 },
    });
    const evaluation = await prisma.agentEvaluation.findUniqueOrThrow({
      where: { id: evaluationId },
    });
    assert.equal(evaluation.evaluatorType, "deterministic");
    assert.equal(evaluation.result, "passed");
    assert.equal(evaluation.scoreValue, "1.00");
  });

  await check("I2 a model evaluator is disabled", async () => {
    await rejectsWith("AGENT_EVALUATOR_DISABLED", () =>
      service.recordEvaluation(ctx, {
        evaluatorType: "model",
        evaluatorCode: "grader",
        targetType: "agent_run",
        targetRef: "x",
        evaluationCode: "quality",
        result: "passed",
      }),
    );
    assert.deepEqual(contract.ENABLED_EVALUATOR_TYPES, ["deterministic"]);
    assert.ok((contract.AGENT_EVALUATOR_TYPES as readonly string[]).includes("model"));
  });

  await check("I3 a human evaluator is disabled in this phase", async () => {
    await rejectsWith("AGENT_EVALUATOR_DISABLED", () =>
      service.recordEvaluation(ctx, {
        evaluatorType: "human",
        evaluatorCode: "reviewer",
        targetType: "agent_run",
        targetRef: "x",
        evaluationCode: "quality",
        result: "passed",
      }),
    );
  });

  await check("I4 an invalid evaluation target is rejected", async () => {
    await rejectsWith("AGENT_EVALUATION_TARGET_INVALID", () =>
      service.recordEvaluation(ctx, {
        evaluatorType: "deterministic",
        evaluatorCode: "af1_self_check",
        targetType: "user_account" as never,
        targetRef: "1",
        evaluationCode: "quality",
        result: "passed",
      }),
    );
  });

  await check("I5 a free-form evaluation report cannot be stored", async () => {
    await assert.rejects(
      service.recordEvaluation(ctx, {
        evaluatorType: "deterministic",
        evaluatorCode: "af1_self_check",
        targetType: "agent_run",
        targetRef: "abc",
        evaluationCode: "quality",
        result: "passed",
        evidence: { checkCode: "x", narrative: "The agent did well overall" },
      }),
      (error: { code?: string }) => error.code === "PAYLOAD_KEY_UNKNOWN",
    );
  });

  /* ------------------------------------------------------------------ */
  /* J. Model invocation                                                 */
  /* ------------------------------------------------------------------ */

  await check("J1 the model provider registry is empty", () => {
    assert.deepEqual(contract.ENABLED_MODEL_PROVIDERS, []);
    assert.equal(contract.MODEL_PROVIDER_DISABLED, "MODEL_PROVIDER_DISABLED");
  });

  await check("J2 every model invocation fails closed with MODEL_PROVIDER_DISABLED", async () => {
    const runId = await createRun();
    for (const provider of ["anthropic", "openai", "local", "", "any_future_provider"]) {
      await rejectsWith("MODEL_PROVIDER_DISABLED", () =>
        service.invokeModel(ctx, {
          runId,
          providerCode: provider,
          modelCode: "some-model",
        }),
      );
    }
  });

  await check("J3 a disabled invocation writes NO ModelInvocation row", async () => {
    assert.equal(await prisma.modelInvocation.count(), 0);
  });

  await check("J4 ModelInvocation has NO prompt and NO response column", () => {
    const columns = Object.keys(
      (prisma.modelInvocation as unknown as { fields: Record<string, unknown> }).fields,
    );
    for (const forbidden of [
      "prompt",
      "systemPrompt",
      "rawPrompt",
      "response",
      "rawResponse",
      "completion",
      "output",
      "messages",
      "featurePacket",
      "apiKey",
    ]) {
      assert.ok(!columns.includes(forbidden), `ModelInvocation must not carry ${forbidden}`);
    }
    // What it DOES carry: that a call happened, and what it cost.
    for (const required of ["providerCode", "modelCode", "inputTokenCount", "costMinorUnits", "latencyMs"]) {
      assert.ok(columns.includes(required), `ModelInvocation must carry ${required}`);
    }
  });

  await check("J5 no API key is read anywhere in the Agent Core", () => {
    const dir = path.join(projectRoot, "src", "lib", "agents");
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      assert.ok(
        !/process\.env\./.test(source),
        `${file} must read no environment variable: the model boundary is a source constant, not configuration`,
      );
    }
  });

  await check("J6 a cost without a currency is refused by the database", async () => {
    await assert.rejects(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ModelInvocation" ("id","providerCode","modelCode","attemptNumber","status","validationStatus","costMinorUnits","createdAt")
         VALUES ('af1-mi-raw','p','m',1,'pending','not_run',100,CURRENT_TIMESTAMP)`,
      ),
    );
  });

  await check("J7 the validation status ladder is exactly the five required members", () => {
    assert.deepEqual(contract.MODEL_VALIDATION_STATUSES, [
      "not_run",
      "valid",
      "invalid_schema",
      "invalid_policy",
      "unsupported_claim",
    ]);
  });

  /* ------------------------------------------------------------------ */
  /* K. Migration and schema                                             */
  /* ------------------------------------------------------------------ */

  await check("K1 the canonical migration count matches the directory", () => {
    const entries = fs
      .readdirSync(path.join(projectRoot, "prisma", "migrations"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    // PHASE-G0: the literal was pinned to 41 while the repository had already
    // reached 42, so this assertion had been failing on the accepted base and
    // guarded nothing. The count now lives ONLY in the shared constant, which
    // is the arrangement scripts/regression/support/migrationCount.ts exists to
    // enforce -- a second hand-written copy here is what let it drift.
    assert.equal(entries.length, EXPECTED_MIGRATION_COUNT);
    assert.ok(entries.includes(MIGRATION_NAME));
  });

  await check("K2 the applied database reports the canonical migration count", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
      'SELECT COUNT(*) AS c FROM "_prisma_migrations" WHERE "rolled_back_at" IS NULL',
    );
    assert.equal(Number(rows[0].c), EXPECTED_MIGRATION_COUNT);
  });

  await check("K3 migration 41 contains no semicolon inside a comment", () => {
    // prisma/migrate.ts splits the file on that character before executing, so
    // one inside prose would cut a CREATE TABLE in half.
    const sql = fs.readFileSync(
      path.join(projectRoot, "prisma", "migrations", MIGRATION_NAME, "migration.sql"),
      "utf8",
    );
    for (const [index, line] of sql.split("\n").entries()) {
      const trimmed = line.trim();
      if (trimmed.startsWith("--")) {
        assert.ok(!trimmed.includes(";"), `line ${index + 1} has a semicolon in a comment`);
      }
    }
  });

  await check("K4 migration 41 is purely additive", () => {
    const sql = fs.readFileSync(
      path.join(projectRoot, "prisma", "migrations", MIGRATION_NAME, "migration.sql"),
      "utf8",
    );
    for (const forbidden of ["ALTER TABLE", "DROP TABLE", "DROP INDEX", "DELETE FROM", "INSERT INTO"]) {
      assert.ok(!sql.includes(forbidden), `migration 41 must not contain ${forbidden}`);
    }
    // `UPDATE` only ever appears as part of ON UPDATE CASCADE on a foreign key,
    // never as a statement that rewrites a row.
    const updateOccurrences = sql.match(/\bUPDATE\b/g) ?? [];
    const referentialUpdates = sql.match(/ON UPDATE CASCADE/g) ?? [];
    assert.equal(
      updateOccurrences.length,
      referentialUpdates.length,
      "migration 41 must contain no UPDATE statement",
    );
    assert.equal((sql.match(/CREATE TABLE "/g) ?? []).length, 9);
  });

  await check("K5 all nine Agent Core tables exist", async () => {
    for (const table of AGENT_CORE_TABLES) {
      const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name = '${table}'`,
      );
      assert.equal(rows.length, 1, `${table} must exist`);
    }
  });

  await check("K6 every index the scale contract requires exists", async () => {
    const required: Record<string, string[]> = {
      AgentRun: [
        "AgentRun_agentCode_idempotencyKey_key",
        "AgentRun_agentCode_createdAt_idx",
        "AgentRun_status_createdAt_idx",
        "AgentRun_subjectType_subjectRef_createdAt_idx",
        "AgentRun_inputFingerprint_idx",
      ],
      AgentFinding: [
        "AgentFinding_runId_idx",
        "AgentFinding_code_createdAt_idx",
        "AgentFinding_severity_createdAt_idx",
        "AgentFinding_status_expiresAt_idx",
      ],
      AgentHandoff: [
        "AgentHandoff_targetAgentCode_status_createdAt_idx",
        "AgentHandoff_deduplicationKey_key",
      ],
      AgentActionProposal: [
        "AgentActionProposal_subjectType_subjectRef_status_idx",
        "AgentActionProposal_status_expiresAt_idx",
        "AgentActionProposal_deduplicationKey_key",
      ],
      AgentActionExecution: [
        "AgentActionExecution_proposalId_attemptNumber_key",
        "AgentActionExecution_status_createdAt_idx",
      ],
      ModelInvocation: [
        "ModelInvocation_runId_idx",
        "ModelInvocation_providerCode_modelCode_createdAt_idx",
        "ModelInvocation_status_createdAt_idx",
      ],
    };

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='index'`,
    );
    const present = new Set(rows.map((row) => row.name));
    for (const [table, indexes] of Object.entries(required)) {
      for (const index of indexes) {
        assert.ok(present.has(index), `${table} is missing index ${index}`);
      }
    }
  });

  await check("K7 the one-decision-per-proposal uniqueness exists", async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name = 'AgentActionDecision_proposalId_key'`,
    );
    assert.equal(rows.length, 1);
  });

  await check("K8 the source enums and the database CHECK lists agree", async () => {
    const sql = fs.readFileSync(
      path.join(projectRoot, "prisma", "migrations", MIGRATION_NAME, "migration.sql"),
      "utf8",
    );
    const mirrored: Array<[string, readonly string[]]> = [
      ["executionMode", contract.AGENT_TRIGGER_TYPES.length > 0 ? ["deterministic", "model_assisted", "model_only"] : []],
      ["triggerType", contract.AGENT_TRIGGER_TYPES],
      ["retentionClass", contract.AGENT_RETENTION_CLASSES],
      ["supportTier", contract.AGENT_SUPPORT_TIERS],
      ["actionClass", contract.AGENT_ACTION_CLASSES],
      ["channel", contract.AGENT_ACTION_CHANNELS],
      ["validationStatus", contract.MODEL_VALIDATION_STATUSES],
      ["result", contract.AGENT_EVALUATION_RESULTS],
    ];
    for (const [column, members] of mirrored) {
      for (const member of members) {
        assert.ok(
          sql.includes(`'${member}'`),
          `migration 41 must list ${member} for ${column}`,
        );
      }
    }
  });

  await check("K9 the state graphs declare no edge out of a terminal status", () => {
    const graphs: Array<[string, Record<string, readonly string[]>]> = [
      ["run", contract.AGENT_RUN_TRANSITIONS],
      ["finding", contract.AGENT_FINDING_TRANSITIONS],
      ["handoff", contract.AGENT_HANDOFF_TRANSITIONS],
      ["proposal", contract.AGENT_ACTION_TRANSITIONS],
      ["execution", contract.AGENT_EXECUTION_TRANSITIONS],
      ["model", contract.MODEL_INVOCATION_TRANSITIONS],
    ];
    for (const [name, graph] of graphs) {
      for (const [from, targets] of Object.entries(graph)) {
        assert.ok(!targets.includes(from), `${name}: ${from} must not transition to itself`);
        for (const target of targets) {
          assert.ok(target in graph, `${name}: ${from} -> ${target} names an unknown status`);
        }
      }
    }
  });

  await check("K10 retention is schema-only: no purge scheduler and no invented duration", async () => {
    const dir = path.join(projectRoot, "src", "lib", "agents");
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      assert.ok(!/purgeExpired|runRetention|deleteExpired|cron|schedule\(/.test(source));
    }
    assert.deepEqual(contract.AGENT_RETENTION_CLASSES, [
      "operational_short",
      "analytical_standard",
      "decision_record",
      "execution_record",
      "evaluation_record",
    ]);
    // No row was deleted by anything in this suite.
    assert.ok((await prisma.agentRun.count()) > 0);
  });

  await check("K11 the four future permissions are documented and granted to nobody", async () => {
    assert.deepEqual(contract.FUTURE_AGENT_PERMISSIONS, [
      "view_agent_runs",
      "approve_agent_actions",
      "manage_agent_policy",
      "execute_agent_actions",
    ]);
    const roles = await import("../../src/lib/crm/roles");
    for (const permission of contract.FUTURE_AGENT_PERMISSIONS) {
      assert.ok(
        !(roles.CRM_PERMISSIONS as readonly string[]).includes(permission),
        `${permission} must NOT be in the live permission matrix`,
      );
    }
    // The accepted eleven are untouched, in their canonical order. PHASE-G0
    // appended three curriculum permissions AFTER them, so position 10 still
    // means what it meant and no Agent Core permission has appeared.
    assert.equal(roles.CRM_PERMISSIONS[10], "view_affiliate_analytics");
    assert.deepEqual(roles.CRM_PERMISSIONS.slice(11), [
      "curriculum_read", "curriculum_author", "curriculum_approve",
      "curriculum_source_authority",
    ]);
    assert.equal(roles.CRM_PERMISSIONS.length, 15);
  });

  await check("K12 no Agent Core column name matches a forbidden fragment", async () => {
    // The same array that governs a runtime payload governs the schema, read
    // from one place so the two rules cannot disagree. The two exemptions are
    // named individually in source with their reason.
    const exempt = new Set<string>(policy.SCHEMA_SCAN_EXEMPT_COLUMNS);
    for (const table of AGENT_CORE_TABLES) {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM pragma_table_info('${table}')`,
      );
      for (const column of columns) {
        if (exempt.has(column.name)) continue;
        const fragment = policy.findForbiddenKeyFragment(column.name);
        assert.equal(
          fragment,
          null,
          `${table}.${column.name} matches the forbidden fragment "${fragment}"`,
        );
      }
    }
  });

  await check("K12b the schema exemptions buy nothing at runtime", async () => {
    // A column may be called promptVersion. A PAYLOAD KEY may not — the one
    // place a caller could smuggle content is the one place nothing is excused.
    const runId = await createRun();
    for (const exempted of policy.SCHEMA_SCAN_EXEMPT_COLUMNS) {
      await assert.rejects(
        service.recordFinding(ctx, {
          runId,
          findingKey: `f-exempt-${exempted}`,
          code: "agent_core.subject_observation",
          category: "observation",
          severity: "info",
          messageKey: "m",
          operands: { metricKey: "x", metricValue: "1", [exempted]: "v3" },
          supportTier: "measured",
          evidence: [evidenceFixture],
        }),
        (error: { code?: string }) =>
          error.code === "PAYLOAD_KEY_UNKNOWN" || error.code === "PAYLOAD_KEY_FORBIDDEN",
      );
    }
  });

  await check("K13 no Agent Core table holds a balance, an amount or a payout", async () => {
    // Tokenised on camelCase boundaries rather than matched as a substring:
    // `expiresAt` contains the letters of `xp` and means nothing of the kind,
    // and a scan that cannot tell those apart teaches people to ignore it.
    const forbiddenTokens = new Set([
      "balance",
      "amount",
      "payout",
      "deposit",
      "commission",
      "xp",
      "price",
      "revenue",
    ]);
    for (const table of AGENT_CORE_TABLES) {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM pragma_table_info('${table}')`,
      );
      for (const column of columns) {
        const tokens = column.name
          .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        for (const token of tokens) {
          assert.ok(
            !forbiddenTokens.has(token),
            `${table}.${column.name} names product money via the token "${token}"`,
          );
        }
      }
    }
    // costMinorUnits is MODEL SPEND, not product money. It is deliberately not
    // called `amount`, and it is the only money-shaped column in the Core.
    const modelColumns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM pragma_table_info('ModelInvocation')`,
    );
    assert.ok(modelColumns.some((column) => column.name === "costMinorUnits"));
  });

  await check("K14 every Agent Core write requires the internal context", () => {
    const source = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "agents", "agent-core-service.ts"),
      "utf8",
    );
    const exported = source.match(/export async function (\w+)/g) ?? [];
    assert.ok(exported.length >= 8, `expected the write services, found ${exported.length}`);
    // Every exported service asserts the context before doing anything.
    const bodies = source.split(/export async function /).slice(1);
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf("("));
      assert.ok(
        /assertInternalContext\(context\)/.test(body),
        `${name} must assert the internal execution context`,
      );
    }
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAGENT-FOUNDATION-1 agent core: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
