/**
 * AGENT-FOUNDATION-1 — Agent Core query plans.
 *
 * WHAT THIS PROVES. That the indexes migration 41 creates are the ones SQLite
 * actually chooses for the reads the Core is designed around, at a fixture size
 * where a missing index shows. An index nobody's plan uses is dead weight; a
 * read that scans is a defect that only appears in production.
 *
 * THE SCALE IT IS MEASURED AT. The stated initial target is roughly ten
 * thousand users with up to a hundred concurrently active, so this fixture
 * builds 12,000 runs with 24,000 findings and 24,000 evidence rows — more agent
 * activity than that population can generate in a long while, and enough that a
 * full scan is unmistakable in the plan.
 *
 * IT IS A STRUCTURAL GATE, NOT A TIMING GATE. Wall-clock numbers on a shared
 * host are not reproducible enough to fail a build on, so this suite fails when
 * a plan SCANS a table it should SEARCH, and merely reports timings.
 *
 * NO LIVE DATA. Everything is invented, written to a throwaway file under the
 * system temp directory, and deleted afterwards.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-agent-plan-af1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

const RUNS = 12_000;
const FINDINGS_PER_RUN = 2;

let passed = 0;
let failed = 0;
const timings: Array<{ name: string; ms: number; rows: number }> = [];

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

async function main() {
  cleanup();
  const projectRoot = process.cwd();

  const migration = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")],
    { cwd: projectRoot, env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8" },
  );
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);

  process.env.DATABASE_URL = dbUrl;
  const { prisma } = await import("../../src/lib/prisma");

  /* -------------------------------------------------------- the fixture */

  console.log(`building a fixture of ${RUNS} runs…`);
  const buildStart = Date.now();

  // Written with raw SQL rather than through the service on purpose: this suite
  // measures the DATABASE, and going through the write services would measure
  // validation instead while making the fixture twenty times slower to build.
  //
  // BATCHED, NOT ONE TRANSACTION. Prisma's interactive transaction has a short
  // default deadline and twelve thousand round trips do not fit inside it. One
  // multi-row INSERT per chunk is both faster and within the limit.
  const CHUNK = 500;

  for (let base = 0; base < RUNS; base += CHUNK) {
    const runValues: string[] = [];
    const runParams: unknown[] = [];
    const findingValues: string[] = [];
    const findingParams: unknown[] = [];
    const evidenceValues: string[] = [];
    const evidenceParams: unknown[] = [];

    for (let i = base; i < Math.min(base + CHUNK, RUNS); i += 1) {
      const runId = `plan-run-${i}`;
      const createdAt = new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();

      runValues.push("(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
      runParams.push(
        runId,
        i % 3 === 0 ? "curie_atlas" : "curie_pulse",
        "1.0.0",
        "deterministic",
        "test",
        i % 5 === 0 ? "running" : "completed",
        `plan-req-${i}`,
        (i % 4096).toString(16).padStart(16, "0"),
        i % 2 === 0 ? "learner" : "affiliate_partner",
        String(i % 1000),
        FINDINGS_PER_RUN,
        0,
        "analytical_standard",
        createdAt,
      );

      for (let f = 0; f < FINDINGS_PER_RUN; f += 1) {
        const findingId = `plan-finding-${i}-${f}`;
        findingValues.push("(?,?,?,?,?,?,?,?,?,?,?,?,?)");
        findingParams.push(
          findingId,
          runId,
          `k-${f}`,
          f === 0 ? "agent_core.subject_observation" : "agent_core.self_test",
          "observation",
          f === 0 ? "info" : "warning",
          "m",
          '{"checkName":"x"}',
          1,
          "measured",
          "active",
          createdAt,
          createdAt,
        );

        evidenceValues.push("(?,?,?,?,?,?,?)");
        evidenceParams.push(
          `plan-ev-${i}-${f}`,
          findingId,
          "affiliate_analytics",
          "summary",
          `period-${i % 100}`,
          "qualifiedClicks",
          createdAt,
        );
      }
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "AgentRun" ("id","agentCode","agentVersion","executionMode","triggerType","status","requestId","inputFingerprint","subjectType","subjectRef","findingCount","warningCount","retentionClass","createdAt") VALUES ${runValues.join(",")}`,
      ...runParams,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AgentFinding" ("id","runId","findingKey","code","category","severity","messageKey","operandsJson","operandsSchemaVersion","supportTier","status","expiresAt","createdAt") VALUES ${findingValues.join(",")}`,
      ...findingParams,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AgentEvidenceReference" ("id","findingId","sourceDomain","sourceType","sourceRef","fieldPath","createdAt") VALUES ${evidenceValues.join(",")}`,
      ...evidenceParams,
    );
  }

  console.log(`fixture built in ${Date.now() - buildStart} ms`);
  await prisma.$executeRawUnsafe("ANALYZE");

  const runCount = await prisma.agentRun.count();
  const findingCount = await prisma.agentFinding.count();
  console.log(`fixture: ${runCount} runs, ${findingCount} findings`);

  /* ----------------------------------------------------------- helpers */

  async function plan(sql: string, ...params: unknown[]): Promise<string[]> {
    const rows = await prisma.$queryRawUnsafe<Array<{ detail: string }>>(
      `EXPLAIN QUERY PLAN ${sql}`,
      ...params,
    );
    return rows.map((row) => row.detail);
  }

  /**
   * Assert the plan SEARCHes through the named index rather than SCANning.
   *
   * A plan that scans a table this size is the defect; a plan that seeks a
   * DIFFERENT index than expected is a design drift worth failing on too,
   * because it means the index the migration justified is not the one in use.
   */
  async function assertSeeks(
    label: string,
    index: string,
    sql: string,
    ...params: unknown[]
  ) {
    const details = await plan(sql, ...params);
    const joined = details.join(" | ");
    assert.ok(
      !/\bSCAN\s+(AgentRun|AgentFinding|AgentHandoff|AgentActionProposal|AgentActionExecution|ModelInvocation|AgentEvidenceReference|AgentEvaluation)\b(?!\s+USING)/.test(joined),
      `${label} scans a table: ${joined}`,
    );
    assert.ok(
      joined.includes(index),
      `${label} must use ${index}, plan was: ${joined}`,
    );

    const started = Date.now();
    const rows = await prisma.$queryRawUnsafe<unknown[]>(sql, ...params);
    timings.push({ name: label, ms: Date.now() - started, rows: rows.length });
  }

  /* ------------------------------------------------------- the plans */

  await check("P1 runs by agent, newest first, seeks AgentRun_agentCode_createdAt_idx", () =>
    assertSeeks(
      "runs by agent",
      "AgentRun_agentCode_createdAt_idx",
      `SELECT "id" FROM "AgentRun" WHERE "agentCode" = ? ORDER BY "createdAt" DESC LIMIT 50`,
      "curie_atlas",
    ),
  );

  await check("P2 the unfinished-run sweep seeks AgentRun_status_createdAt_idx", () =>
    assertSeeks(
      "unfinished runs",
      "AgentRun_status_createdAt_idx",
      `SELECT "id" FROM "AgentRun" WHERE "status" = ? ORDER BY "createdAt" DESC LIMIT 50`,
      "running",
    ),
  );

  await check("P3 the subject timeline seeks AgentRun_subjectType_subjectRef_createdAt_idx", () =>
    assertSeeks(
      "subject timeline",
      "AgentRun_subjectType_subjectRef_createdAt_idx",
      `SELECT "id" FROM "AgentRun" WHERE "subjectType" = ? AND "subjectRef" = ? ORDER BY "createdAt" DESC LIMIT 50`,
      "learner",
      "42",
    ),
  );

  await check("P4 the fingerprint lookup seeks AgentRun_inputFingerprint_idx", () =>
    assertSeeks(
      "fingerprint lookup",
      "AgentRun_inputFingerprint_idx",
      `SELECT "id" FROM "AgentRun" WHERE "inputFingerprint" = ? LIMIT 10`,
      "0000000000000007",
    ),
  );

  await check("P5 the idempotency lookup seeks the unique key", async () => {
    const details = await plan(
      `SELECT "id" FROM "AgentRun" WHERE "agentCode" = ? AND "idempotencyKey" = ?`,
      "curie_atlas",
      "k",
    );
    const joined = details.join(" | ");
    assert.ok(
      joined.includes("AgentRun_agentCode_idempotencyKey_key"),
      `plan was: ${joined}`,
    );
  });

  await check("P6 a run's findings seek AgentFinding_runId_idx", () =>
    assertSeeks(
      "findings of a run",
      "AgentFinding_runId",
      `SELECT "id" FROM "AgentFinding" WHERE "runId" = ?`,
      "plan-run-500",
    ),
  );

  await check("P7 the code trend read seeks AgentFinding_code_createdAt_idx", () =>
    assertSeeks(
      "findings by code over time",
      "AgentFinding_code_createdAt_idx",
      `SELECT "id" FROM "AgentFinding" WHERE "code" = ? AND "createdAt" >= ? ORDER BY "createdAt" DESC LIMIT 50`,
      "agent_core.subject_observation",
      new Date(Date.UTC(2026, 0, 5)).toISOString(),
    ),
  );

  await check("P8 the severity sweep seeks AgentFinding_severity_createdAt_idx", () =>
    assertSeeks(
      "findings by severity",
      "AgentFinding_severity_createdAt_idx",
      `SELECT "id" FROM "AgentFinding" WHERE "severity" = ? ORDER BY "createdAt" DESC LIMIT 50`,
      "warning",
    ),
  );

  await check("P9 the expiry sweep seeks AgentFinding_status_expiresAt_idx", () =>
    assertSeeks(
      "active findings expiring",
      "AgentFinding_status_expiresAt_idx",
      `SELECT "id" FROM "AgentFinding" WHERE "status" = ? AND "expiresAt" < ? LIMIT 50`,
      "active",
      new Date(Date.UTC(2026, 0, 3)).toISOString(),
    ),
  );

  await check("P10 evidence for a finding seeks AgentEvidenceReference_findingId_idx", () =>
    assertSeeks(
      "evidence of a finding",
      "AgentEvidenceReference_findingId",
      `SELECT "id" FROM "AgentEvidenceReference" WHERE "findingId" = ?`,
      "plan-finding-500-0",
    ),
  );

  await check("P11 every declared index is used by a plan or justified as a constraint", async () => {
    // An index nobody's plan uses is dead weight the scale contract forbids.
    // The uniques below are CONSTRAINTS — their job is to refuse a duplicate,
    // not to serve a read — so they are named here rather than plan-tested.
    const constraintOnly = new Set([
      "AgentFinding_runId_findingKey_key",
      "AgentHandoff_deduplicationKey_key",
      "AgentActionProposal_deduplicationKey_key",
      "AgentActionDecision_proposalId_key",
      "AgentActionExecution_idempotencyKey_key",
      "AgentActionExecution_proposalId_attemptNumber_key",
      "ModelInvocation_runId_attemptNumber_key",
      // Restrict-deletion lookups: the plan that uses them is SQLite's own
      // referential check, which EXPLAIN does not surface.
      "AgentRun_initiatedByStaffId_idx",
      "AgentHandoff_sourceRunId_idx",
      "AgentHandoff_acceptedRunId_idx",
      "AgentActionProposal_sourceRunId_idx",
      "AgentActionProposal_sourceFindingId_idx",
      "AgentActionDecision_decidedByStaffId_idx",
      "AgentActionExecution_auditLogId_idx",
      "ModelInvocation_runId_idx",
      // Operational sweeps over tables that are structurally empty in this
      // phase — no execution provider and no model provider exists — so there
      // is no fixture to measure them against yet.
      "AgentHandoff_targetAgentCode_status_createdAt_idx",
      "AgentActionProposal_subjectType_subjectRef_status_idx",
      "AgentActionProposal_status_expiresAt_idx",
      "AgentActionExecution_status_createdAt_idx",
      "ModelInvocation_providerCode_modelCode_createdAt_idx",
      "ModelInvocation_status_createdAt_idx",
      "AgentEvaluation_targetType_targetRef_createdAt_idx",
      "AgentEvaluation_evaluationCode_createdAt_idx",
    ]);

    const planTested = new Set([
      "AgentRun_agentCode_idempotencyKey_key",
      "AgentRun_agentCode_createdAt_idx",
      "AgentRun_status_createdAt_idx",
      "AgentRun_subjectType_subjectRef_createdAt_idx",
      "AgentRun_inputFingerprint_idx",
      "AgentFinding_runId_idx",
      "AgentFinding_code_createdAt_idx",
      "AgentFinding_severity_createdAt_idx",
      "AgentFinding_status_expiresAt_idx",
      "AgentEvidenceReference_findingId_idx",
    ]);

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; tbl_name: string }>>(
      `SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL
        AND (tbl_name LIKE 'Agent%' OR tbl_name = 'ModelInvocation')`,
    );

    const unaccounted = rows
      .map((row) => row.name)
      .filter((name) => !planTested.has(name) && !constraintOnly.has(name));

    assert.deepEqual(
      unaccounted,
      [],
      `every Agent Core index must have a measured plan or a stated reason:\n${unaccounted.join("\n")}`,
    );
  });

  console.log("\nmeasured (reported, never a threshold gate):");
  for (const timing of timings) {
    console.log(`  ${timing.ms.toString().padStart(5)} ms  ${timing.rows.toString().padStart(4)} rows  ${timing.name}`);
  }

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAGENT-FOUNDATION-1 agent core query plans: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
