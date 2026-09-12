/**
 * AGENT-FOUNDATION-1 — the Agent Core access and privacy boundary.
 *
 * THE CLAIM: the Agent Core has no public surface, its write services cannot be
 * reached from any request, and nothing forbidden can be stored in it.
 *
 * The interesting cases here are the ADVERSARIAL ones. It is easy to show that
 * a service works when called correctly; this suite tries to call it the way an
 * attacker or a careless future phase would — with a hand-built context object,
 * with a session, with a stolen brand, with a learner id, with a secret in a
 * payload — and shows each attempt failing closed with a named code.
 *
 * Synthetic database only. No server, no port, no external request.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-agent-security-af1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

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

/**
 * Real secret NAMES, deliberately never their values.
 *
 * This suite proves the Agent Core cannot hold these. Reading their actual
 * values to do so would be the very leak being tested for, so the names alone
 * are used and no environment variable is consulted.
 */
const SECRET_NAMES = [
  "POSTBACK_SECRET",
  "SESSION_SECRET",
  "ATTRIBUTION_SECRET",
  "TURNSTILE_SECRET_KEY",
  "DATABASE_URL",
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

/** Every repository .ts/.tsx file under a root. */
function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
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
  const contextModule = await import("../../src/lib/agents/agent-core-context");
  const policy = await import("../../src/lib/agents/agent-payload-policy");
  const service = await import("../../src/lib/agents/agent-core-service");

  const agentsDir = path.join(projectRoot, "src", "lib", "agents");
  const agentSources = fs.readdirSync(agentsDir).map((file) => ({
    file,
    source: fs.readFileSync(path.join(agentsDir, file), "utf8"),
  }));

  const legitimateContext = contextModule.createInternalAgentContext({
    origin: "regression_harness",
    actorStaffId: null,
    requestId: "af1-security-0001",
  });

  /* ------------------------------------------------------------------ */
  /* A. No public route                                                  */
  /* ------------------------------------------------------------------ */

  await check("A1 no route file anywhere references the Agent Core", () => {
    const offenders = sourceFiles(path.join(projectRoot, "src", "app"))
      .filter((file) => /\/lib\/agents\//.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(projectRoot, file));
    assert.deepEqual(offenders, [], `Agent Core has no public surface:\n${offenders.join("\n")}`);
  });

  await check("A2 no agent route path exists in the app directory", () => {
    const appRoot = path.join(projectRoot, "src", "app");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (/^agents?$/i.test(entry.name) || /agent-core/i.test(entry.name)) {
            offenders.push(path.relative(projectRoot, full));
          }
          walk(full);
        }
      }
    };
    walk(appRoot);
    assert.deepEqual(offenders, []);
  });

  await check("A3 no CRM screen or component reaches the Agent Core", () => {
    const roots = [
      path.join(projectRoot, "src", "components"),
      path.join(projectRoot, "src", "app", "crm"),
    ].filter((dir) => fs.existsSync(dir));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        if (/\/lib\/agents\//.test(fs.readFileSync(file, "utf8"))) {
          offenders.push(path.relative(projectRoot, file));
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  await check("A4 the ONLY consumers of the Agent Core are the Core itself and its tests", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(path.join(projectRoot, "src"))) {
      if (file.startsWith(agentsDir)) continue;
      if (/\/lib\/agents\//.test(fs.readFileSync(file, "utf8"))) {
        offenders.push(path.relative(projectRoot, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `nothing outside src/lib/agents may import the Agent Core yet:\n${offenders.join("\n")}`,
    );
  });

  /* ------------------------------------------------------------------ */
  /* B. The internal context cannot be forged                            */
  /* ------------------------------------------------------------------ */

  await check("B1 a write with NO context is refused", async () => {
    for (const nothing of [undefined, null, 0, "", false]) {
      await rejectsWith("AGENT_CONTEXT_REQUIRED", () =>
        service.createAgentRun(nothing, {
          agentCode: "curie_atlas",
          agentVersion: "1.0.0",
          executionMode: "deterministic",
          triggerType: "test",
          inputFingerprint: "abcdef0123456789",
        }),
      );
    }
  });

  await check("B2 a hand-built look-alike context is refused", async () => {
    // Everything a plain object CAN carry, carried. It still fails, because the
    // brand is a module-private symbol no other module can write.
    const forged = {
      origin: "internal_service",
      actorStaffId: "staff-1",
      requestId: "af1-forged",
      now: new Date(),
    };
    await rejectsWith("AGENT_CONTEXT_FORGED", () =>
      service.createAgentRun(forged, {
        agentCode: "curie_atlas",
        agentVersion: "1.0.0",
        executionMode: "deterministic",
        triggerType: "test",
        inputFingerprint: "abcdef0123456789",
      }),
    );
  });

  await check("B3 a JSON round-trip of a REAL context is refused", async () => {
    // The decisive case for an HTTP surface: anything that arrives as a request
    // body has been through JSON, and a symbol does not survive that.
    const revived = JSON.parse(JSON.stringify(legitimateContext)) as unknown;
    await rejectsWith("AGENT_CONTEXT_FORGED", () =>
      service.createAgentRun(revived, {
        agentCode: "curie_atlas",
        agentVersion: "1.0.0",
        executionMode: "deterministic",
        triggerType: "test",
        inputFingerprint: "abcdef0123456789",
      }),
    );
  });

  await check("B4 a spread or cloned copy of a real context is refused", async () => {
    // The brand is defined non-enumerable precisely so that these do not carry
    // it. An enumerable symbol WOULD survive a spread, and this case is what
    // caught that during development.
    const copies: unknown[] = [
      { ...legitimateContext },
      Object.assign({}, legitimateContext),
      structuredClone({
        origin: legitimateContext.origin,
        actorStaffId: legitimateContext.actorStaffId,
        requestId: legitimateContext.requestId,
        now: legitimateContext.now,
      }),
    ];
    for (const copy of copies) {
      await rejectsWith("AGENT_CONTEXT_FORGED", () =>
        service.createAgentRun(copy, {
          agentCode: "curie_atlas",
          agentVersion: "1.0.0",
          executionMode: "deterministic",
          triggerType: "test",
          inputFingerprint: "abcdef0123456789",
        }),
      );
    }
  });

  await check("B5 an HTTP, learner or CRM origin is refused by name", () => {
    for (const origin of ["http_request", "learner_session", "crm_session", "public_api", "webhook"]) {
      rejectsWith("AGENT_CONTEXT_ORIGIN_FORBIDDEN", () =>
        contextModule.createInternalAgentContext({ origin, requestId: "af1-x" }),
      );
    }
  });

  await check("B6 an unknown origin is refused", () => {
    for (const origin of ["", "admin", "cron", "internal", "system"]) {
      rejectsWith("AGENT_CONTEXT_ORIGIN_UNKNOWN", () =>
        contextModule.createInternalAgentContext({ origin, requestId: "af1-x" }),
      );
    }
  });

  await check("B7 the context factory reads no session, cookie, header or secret", () => {
    const source = fs.readFileSync(path.join(agentsDir, "agent-core-context.ts"), "utf8");
    for (const forbidden of ["cookies(", "headers(", "getSession", "process.env", "jwt", "verify("]) {
      assert.ok(
        !source.includes(forbidden),
        `the context factory must not consult ${forbidden}: it cannot be tricked into promoting a request`,
      );
    }
  });

  await check("B8 a request-shaped object with a stolen key name is still refused", async () => {
    // Even naming a property "Symbol(ata.agent-core.internal-context)" does not
    // help: a string key is not the symbol.
    const forged = {
      "Symbol(ata.agent-core.internal-context)": true,
      origin: "internal_service",
      actorStaffId: null,
      requestId: "af1-forged-2",
      now: new Date(),
    };
    await rejectsWith("AGENT_CONTEXT_FORGED", () =>
      service.recordEvaluation(forged, {
        evaluatorType: "deterministic",
        evaluatorCode: "x",
        targetType: "agent_run",
        targetRef: "y",
        evaluationCode: "z",
        result: "passed",
      }),
    );
  });

  await check("B9 EVERY exported write service rejects a forged context", async () => {
    const forged = { origin: "internal_service", requestId: "x", actorStaffId: null, now: new Date() };
    const attempts: Array<() => Promise<unknown>> = [
      () => service.createAgentRun(forged, { agentCode: "curie_atlas", agentVersion: "1.0.0", executionMode: "deterministic", triggerType: "test", inputFingerprint: "abcdef0123456789" }),
      () => service.transitionAgentRun(forged, { runId: "x", from: "created", to: "running" }),
      () => service.recordFinding(forged, { runId: "x", findingKey: "k", code: "agent_core.self_test", category: "c", severity: "info", messageKey: "m", operands: { checkName: "x" }, supportTier: "measured", evidence: [] }),
      () => service.transitionFinding(forged, { findingId: "x", from: "active", to: "withdrawn" }),
      () => service.proposeHandoff(forged, { sourceRunId: "x", targetAgentCode: "curie_pulse", handoffCode: "retention_candidate", payload: { signalCode: "x" } }),
      () => service.proposeAction(forged, { sourceRunId: "x", actionClass: "continue_learning", subjectType: "learner", subjectRef: "1", reasonCodes: { primaryCode: "x" }, channel: "human_task", templateKey: "t", parameters: { levelCode: "l" } }),
      () => service.transitionProposal(forged, { proposalId: "x", from: "proposed", to: "awaiting_approval" }),
      () => service.decideAction(forged, { proposalId: "x", decision: "approved", decisionCode: "c", policyVersion: "v" }),
      () => service.startActionExecution(forged, { proposalId: "x", attemptNumber: 1, executionProvider: "p", idempotencyKey: "k" }),
      () => service.recordEvaluation(forged, { evaluatorType: "deterministic", evaluatorCode: "e", targetType: "agent_run", targetRef: "r", evaluationCode: "c", result: "passed" }),
      () => service.invokeModel(forged, { providerCode: "p", modelCode: "m" }),
    ];
    for (const attempt of attempts) {
      await rejectsWith("AGENT_CONTEXT_FORGED", attempt);
    }
    // And nothing was written by any of them.
    for (const table of AGENT_CORE_TABLES) {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
        `SELECT COUNT(*) AS c FROM "${table}"`,
      );
      assert.equal(Number(rows[0].c), 0, `${table} must be untouched`);
    }
  });

  /* ------------------------------------------------------------------ */
  /* C. Forbidden field scan                                             */
  /* ------------------------------------------------------------------ */

  await check("C1 no Agent Core column matches a forbidden fragment", async () => {
    const exempt = new Set<string>(policy.SCHEMA_SCAN_EXEMPT_COLUMNS);
    const violations: string[] = [];
    for (const table of AGENT_CORE_TABLES) {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM pragma_table_info('${table}')`,
      );
      for (const column of columns) {
        if (exempt.has(column.name)) continue;
        const fragment = policy.findForbiddenKeyFragment(column.name);
        if (fragment) violations.push(`${table}.${column.name} ~ ${fragment}`);
      }
    }
    assert.deepEqual(violations, []);
  });

  await check("C2 the forbidden fragment list covers every named prohibition", () => {
    // Each of these is named in the phase's privacy contract. The scan is only
    // as good as this list, so the list itself is asserted.
    for (const required of [
      "password", "secret", "cookie", "session", "csrf",
      "email", "phone", "fullname", "address",
      "card", "pan", "cvv", "iban",
      "pocketplayerid", "clickid", "rawpayload", "querystring", "callbackurl",
      "prompt", "systemprompt", "rawresponse", "completion",
    ]) {
      assert.ok(
        (policy.FORBIDDEN_KEY_FRAGMENTS as readonly string[]).includes(required),
        `the forbidden fragment list must include ${required}`,
      );
    }
  });

  await check("C3 the fragment matcher catches camelCase, snake_case and SHOUTING", () => {
    for (const key of ["email", "Email", "EMAIL", "learnerEmail", "learner_email", "LEARNER_EMAIL", "e-mail".replace("-", "")]) {
      assert.notEqual(policy.findForbiddenKeyFragment(key), null, `${key} must be caught`);
    }
    // And does not fire on ordinary operand names.
    for (const key of ["metricKey", "metricValue", "observedCount", "windowDays", "levelCode"]) {
      assert.equal(policy.findForbiddenKeyFragment(key), null, `${key} must be allowed`);
    }
  });

  /* ------------------------------------------------------------------ */
  /* D. Secret scan                                                      */
  /* ------------------------------------------------------------------ */

  await check("D1 the Agent Core reads no environment variable at all", () => {
    for (const { file, source } of agentSources) {
      assert.ok(
        !/process\.env/.test(source),
        `${file} must read no environment variable: the boundaries here are source constants, not configuration an operator can flip`,
      );
    }
  });

  await check("D2 no secret NAME appears anywhere in the Agent Core", () => {
    for (const { file, source } of agentSources) {
      for (const name of SECRET_NAMES) {
        // The forbidden-fragment list may mention `postback_secret` as a KEY to
        // reject; it must never be read, and no other file may name one.
        const mentions = source.includes(name);
        assert.ok(
          !mentions,
          `${file} must not name the secret ${name}`,
        );
      }
    }
  });

  await check("D3 a secret-shaped payload key is rejected at write time", async () => {
    const runId = (
      await service.createAgentRun(legitimateContext, {
        agentCode: "curie_atlas",
        agentVersion: "1.0.0",
        executionMode: "deterministic",
        triggerType: "test",
        inputFingerprint: "0000000000000001",
      })
    ).runId;

    for (const key of ["secret", "apiKey", "accessToken", "sessionCookie", "csrfToken", "authorization", "privateKey", "signature"]) {
      await assert.rejects(
        service.recordFinding(legitimateContext, {
          runId,
          findingKey: `f-secret-${key}`,
          code: "agent_core.self_test",
          category: "security",
          severity: "info",
          messageKey: "m",
          operands: { checkName: "x", [key]: "value" },
          supportTier: "insufficient",
          evidence: [],
        }),
        (error: { code?: string }) =>
          error.code === "PAYLOAD_KEY_FORBIDDEN" || error.code === "PAYLOAD_KEY_UNKNOWN",
      );
    }
  });

  await check("D4 a bearer token in a value is rejected", async () => {
    await rejectsWith("PAYLOAD_VALUE_FORBIDDEN", () =>
      policy.assertOpaqueReference("externalReceiptRef", "Bearer_abc123def456"),
    );
  });

  /* ------------------------------------------------------------------ */
  /* E. PII scan                                                         */
  /* ------------------------------------------------------------------ */

  await check("E1 an email address cannot be stored in any reference column", () => {
    for (const field of ["subjectRef", "sourceRef", "targetRef", "externalReceiptRef", "idempotencyKey"]) {
      rejectsWith("PAYLOAD_VALUE_FORBIDDEN", () =>
        policy.assertOpaqueReference(field, "learner@example.com"),
      );
    }
  });

  await check("E2 a raw Pocket player id cannot be stored in a reference column", () => {
    // Real Pocket player ids are long digit runs. An internal learner id is not.
    rejectsWith("PAYLOAD_VALUE_FORBIDDEN", () =>
      policy.assertOpaqueReference("subjectRef", "900000101"),
    );
    assert.equal(policy.assertOpaqueReference("subjectRef", "34"), "34");
  });

  await check("E3 a full callback URL and a query string are both refused", () => {
    for (const value of [
      "https://ata.example/api/postbacks/pocket",
      "?clickid=tq-1&goal=reg",
      "http://x.example",
    ]) {
      rejectsWith("PAYLOAD_VALUE_FORBIDDEN", () =>
        policy.assertOpaqueReference("sourceRef", value),
      );
    }
  });

  await check("E4 the pseudonymous learner subject is NOT claimed to be anonymous", () => {
    // A numeric internal learner id resolves to a person in one join. The
    // documentation must say so rather than calling it anonymous, and this is
    // the case that keeps the claim honest.
    const contractSource = fs.readFileSync(
      path.join(agentsDir, "agent-core-contract.ts"),
      "utf8",
    );
    assert.ok(
      /pseudonymous/i.test(contractSource),
      "the learner subject must be documented as pseudonymous",
    );
    assert.ok(
      /NOT anonymous|not anonymous/i.test(contractSource),
      "the contract must state explicitly that it is not anonymous",
    );
    assert.ok(!/\banonymous subject\b/i.test(contractSource));
  });

  await check("E5 no learner name, email or phone column exists anywhere in the Core", async () => {
    for (const table of AGENT_CORE_TABLES) {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT name FROM pragma_table_info('${table}')`,
      );
      const names = columns.map((column) => column.name.toLowerCase());
      for (const forbidden of ["email", "phone", "name", "firstname", "lastname", "ip", "useragent"]) {
        assert.ok(
          !names.includes(forbidden),
          `${table} must not carry a ${forbidden} column`,
        );
      }
    }
  });

  await check("E6 the Core holds no foreign key to a learner", async () => {
    // A learner reference is an OPAQUE STRING, deliberately not a User FK. A
    // foreign key would make the Core a joinable extension of the learner
    // table, which is precisely the coupling the ownership rule forbids.
    for (const table of AGENT_CORE_TABLES) {
      const keys = await prisma.$queryRawUnsafe<Array<{ table: string }>>(
        `SELECT "table" FROM pragma_foreign_key_list('${table}')`,
      );
      for (const key of keys) {
        assert.notEqual(key.table, "User", `${table} must not reference User`);
      }
    }
  });

  /* ------------------------------------------------------------------ */
  /* F. No egress, no scheduler, no communication                        */
  /* ------------------------------------------------------------------ */

  await check("F1 the Agent Core contains no network client of any kind", () => {
    for (const { file, source } of agentSources) {
      for (const forbidden of ["fetch(", "node:http", "node:https", "node:net", "node:dgram", "axios", "undici", "got(", "WebSocket", "XMLHttpRequest"]) {
        assert.ok(!source.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  await check("F2 the Agent Core contains no scheduler or timer-driven work", () => {
    for (const { file, source } of agentSources) {
      for (const forbidden of ["setInterval", "setTimeout", "cron", "node-schedule", "queueMicrotask", "child_process"]) {
        assert.ok(!source.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  await check("F3 the Agent Core sends no email, push or SMS", () => {
    for (const { file, source } of agentSources) {
      for (const forbidden of ["nodemailer", "sendMail", "sendEmail", "smtp", "firebase", "twilio", "webpush", "sendNotification"]) {
        assert.ok(!source.includes(forbidden), `${file} must not reference ${forbidden}`);
      }
    }
  });

  await check("F4 the Agent Core executes no user action and mutates no product table", () => {
    const serviceSource = fs.readFileSync(path.join(agentsDir, "agent-core-service.ts"), "utf8");
    // Every prisma delegate the service touches must be an Agent Core one.
    const delegates = [...serviceSource.matchAll(/(?:prisma|tx)\.(\w+)\./g)].map((m) => m[1]);
    const allowed = new Set([
      "agentRun",
      "agentFinding",
      "agentEvidenceReference",
      "agentHandoff",
      "agentActionProposal",
      "agentActionDecision",
      "agentActionExecution",
      "agentEvaluation",
      "modelInvocation",
    ]);
    const foreign = [...new Set(delegates)].filter((delegate) => !allowed.has(delegate));
    assert.deepEqual(
      foreign,
      [],
      `the Agent Core must write only its own tables, but touches: ${foreign.join(", ")}`,
    );
  });

  await check("F5 the Agent Core does not write to AuditLog", () => {
    // AuditLog is a live tripwire. The Core owns its own structured history and
    // must not become a chatty writer to it.
    for (const { file, source } of agentSources) {
      assert.ok(!/auditLog\.create/.test(source), `${file} must not write AuditLog`);
    }
  });

  await check("F6 no hard-delete and no bulk mutation API exists", () => {
    for (const { file, source } of agentSources) {
      for (const forbidden of ["deleteMany", "updateMany({ where: {} }", "$queryRawUnsafe", "$executeRawUnsafe"]) {
        assert.ok(!source.includes(forbidden), `${file} must not expose ${forbidden}`);
      }
    }
    const serviceSource = fs.readFileSync(path.join(agentsDir, "agent-core-service.ts"), "utf8");
    assert.ok(!/\.delete\(/.test(serviceSource), "no delete path may exist at all");
  });

  await check("F7 no row was created anywhere by this suite except the one probe run", async () => {
    assert.equal(await prisma.agentRun.count(), 1);
    for (const table of AGENT_CORE_TABLES.filter((t) => t !== "AgentRun")) {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
        `SELECT COUNT(*) AS c FROM "${table}"`,
      );
      assert.equal(Number(rows[0].c), 0, `${table} must be empty`);
    }
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAGENT-FOUNDATION-1 agent core security: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
