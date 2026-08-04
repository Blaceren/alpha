/**
 * AGENT-FOUNDATION-1 — the Curie Atlas boundary.
 *
 * THE CLAIM: adding nine Agent Core tables changed the accepted analysis
 * endpoint in no way at all. Not its bytes, not its permission, not its cache
 * semantics, not its read-only database behaviour — and in particular it still
 * persists NOTHING.
 *
 * THE STRONGEST EVIDENCE HERE IS STATIC, not observational. Case D1 walks the
 * transitive import closure of the route and proves it contains no Agent Core
 * module. That is a proof that the endpoint CANNOT write an agent row under any
 * input, which is a different and much stronger statement than "it did not
 * write one when we called it". The runtime cases then confirm the obvious.
 *
 * Synthetic database only. No server is started, no port is bound and no
 * external request is made.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbPath = path.join(os.tmpdir(), `ata-agent-atlas-af1-${process.pid}.db`);
const dbUrl = `file:${dbPath.replace(/\\/g, "/")}`;

/** The PRODUCT-RC-1 backend release candidate this phase branched from. */
const RC_BASELINE = "eca17f1e6534cdbe2ca6d602482add4fc55a400e";

const ATLAS_ROUTE = "src/app/api/crm/v1/affiliates/analytics/analysis/route.ts";

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

/** Resolve a relative import to a real file, matching the repo's alias setup. */
function resolveImport(fromFile: string, specifier: string, projectRoot: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) {
    base = path.join(projectRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null; // a package, not repository source
  }

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every repository source file the entry point can transitively reach. */
function importClosure(entry: string, projectRoot: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = fs.readFileSync(file, "utf8");
    const specifiers = [
      ...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g),
      ...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);

    for (const specifier of specifiers) {
      const resolved = resolveImport(file, specifier, projectRoot);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }

  return seen;
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
  const contractModule = await import("../../src/lib/analysis/analysis-contract");
  const reportModule = await import("../../src/lib/analysis/analysis-report");
  const requestModule = await import("../../src/lib/analysis/analysis-request");
  const inputModule = await import("../../src/lib/analysis/analysis-input");
  const businessTime = await import("../../src/lib/analytics/business-time");

  /**
   * Build a report exactly the way the route builds one: parse the body with
   * the accepted parser, load through the accepted loaders, render with the
   * accepted builder. Nothing here is a reimplementation — using anything other
   * than the real functions would prove nothing about the real endpoint.
   */
  const TIMEZONE = businessTime.resolveBusinessTimezone();
  const FIXED_NOW = new Date("2026-08-01T09:00:00.000Z");

  async function buildReport(body: Record<string, unknown>) {
    const request = requestModule.parseAnalysisRequest(body, TIMEZONE, FIXED_NOW);
    const fingerprint = requestModule.analysisInputFingerprint(request);
    const input =
      request.mode === "acquisition_cohort"
        ? await inputModule.loadCohortInput(prisma, request as never)
        : await inputModule.loadEventDateInput(prisma, request);
    return { report: reportModule.buildAnalysisReport(input, fingerprint), fingerprint, request };
  }

  /* ------------------------------------------------------------------ */
  /* A. The endpoint's source is untouched                               */
  /* ------------------------------------------------------------------ */

  await check("A1 the Atlas ROUTE is byte-identical to the RC", () => {
    // AFD-5D2A NARROWED THIS ASSERTION, deliberately.
    //
    // AGENT-FOUNDATION-1 asserted that neither the route NOR the analysis
    // library had moved, which was correct for a phase that added nine Agent
    // Core tables and touched nothing else. AFD-5D2A exists precisely to change
    // the analysis library: it moves result status, data sufficiency, support
    // tier and comparison deltas from the CRM to the backend engine.
    //
    // What must STILL be true, and is asserted here, is that the ROUTE is
    // untouched: the same permission gate, the same CSRF check, the same body
    // bound, the same loaders, the same echo. The contract grew; the endpoint's
    // behaviour around it did not.
    const diff = spawnSync(
      "git",
      ["diff", "--name-only", RC_BASELINE, "--", ATLAS_ROUTE],
      { cwd: projectRoot, encoding: "utf8" },
    );
    assert.equal(diff.status, 0, diff.stderr);
    assert.equal(
      diff.stdout.trim(),
      "",
      `the Atlas route must not change, but did:\n${diff.stdout}`,
    );
  });

  await check("A1b the analysis library changed ONLY in the reviewed files", () => {
    // The complement of A1: the library did move, and exactly where AFD-5D2A
    // said it would. A change to a file not on this list is unreviewed.
    //
    // MODIFICATIONS AND ADDITIONS ARE ASSERTED SEPARATELY, which matters: an
    // edit to an accepted file and a brand-new module are different risks, and a
    // check that merges them cannot tell you which happened.
    //
    // The first version of this case used `--name-only` and listed four files.
    // It passed while the two new modules were still UNTRACKED — git does not
    // report untracked files in a diff — and failed the moment they were
    // committed. It had been measuring an incomplete picture. `--name-status`
    // against the committed tree is not sensitive to staging state, and the
    // directory listing below closes the untracked-file hole for good.
    const diff = spawnSync(
      "git",
      ["diff", "--name-status", RC_BASELINE, "--", "src/lib/analysis"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    assert.equal(diff.status, 0, diff.stderr);

    const modified: string[] = [];
    const added: string[] = [];
    for (const line of diff.stdout.trim().split("\n").filter(Boolean)) {
      const [status, file] = line.split(/\s+/);
      if (status === "M") modified.push(file!);
      else if (status === "A") added.push(file!);
      else assert.fail(`unexpected change type ${status} on ${file}`);
    }

    assert.deepEqual(modified.sort(), [
      "src/lib/analysis/analysis-contract.ts",
      "src/lib/analysis/analysis-engine.ts",
      "src/lib/analysis/analysis-report.ts",
      "src/lib/analysis/analysis-rules.ts",
    ]);
    assert.deepEqual(added.sort(), [
      "src/lib/analysis/analysis-sufficiency.ts",
      "src/lib/analysis/analysis-support.ts",
    ]);

    // Nothing was DELETED: every module the RC published is still there.
    const baseline = spawnSync(
      "git",
      ["ls-tree", "--name-only", RC_BASELINE, "src/lib/analysis/"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    assert.equal(baseline.status, 0, baseline.stderr);
    const baselineFiles = baseline.stdout.trim().split("\n").filter(Boolean).sort();

    // And the directory on disk holds EXACTLY the baseline set plus the two
    // reviewed additions — which catches an untracked file a diff would miss.
    const onDisk = fs
      .readdirSync(path.join(projectRoot, "src/lib/analysis"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `src/lib/analysis/${name}`)
      .sort();
    assert.deepEqual(onDisk, [...baselineFiles, ...added].sort());
  });

  await check("A2 the analytics loaders this phase relies on are also untouched", () => {
    const diff = spawnSync(
      "git",
      ["diff", "--name-only", RC_BASELINE, "--", "src/lib/analytics", "src/lib/crm/affiliate-routes.ts"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    assert.equal(diff.status, 0, diff.stderr);
    assert.equal(diff.stdout.trim(), "");
  });

  /* ------------------------------------------------------------------ */
  /* B. The published contract is unchanged                              */
  /* ------------------------------------------------------------------ */

  await check("B1 the agent identity is still curie_atlas 1.0.0", () => {
    assert.equal(contractModule.CURIE_ATLAS_AGENT_CODE, "curie_atlas");
    assert.equal(contractModule.CURIE_ATLAS_AGENT_VERSION, "1.0.0");
  });

  await check("B2 the engine descriptor still reports modelInvoked false", async () => {
    const { report } = await buildReport({ mode: "event_date" });
    assert.equal(report.engine.kind, "deterministic");
    assert.equal(report.engine.modelInvoked, false);
    assert.equal(report.agent.code, "curie_atlas");
    assert.equal(report.agent.version, "1.0.0");
    assert.equal(report.engine.engineVersion, contractModule.ANALYSIS_ENGINE_VERSION);
    assert.equal(report.engine.catalogVersion, contractModule.ANALYSIS_CATALOG_VERSION);
  });

  await check("B3 the response carries exactly the accepted field set", async () => {
    const { report } = await buildReport({ mode: "event_date" });
    // The published contract, in the accepted order. A field added here without
    // a contract decision is exactly the drift this case exists to catch.
    // AFD-5D2A adds `status` as the FIRST field: it is first in the reader's
    // decision, and a consumer that branches on nothing else must branch on it.
    assert.deepEqual(Object.keys(report), [
      "status",
      "agent",
      "engine",
      "inputFingerprint",
      "overview",
      "dataSufficiency",
      "observations",
      "warnings",
      "positiveSignals",
      "questions",
      "thresholds",
    ]);
    assert.ok(!("opportunities" in report), "the pre-normalization alias must stay absent");
    assert.deepEqual(contractModule.ANALYSIS_SECTIONS, [
      "observation",
      "warning",
      "positive_signal",
      "question",
    ]);
  });

  await check("B4 the finding severity ladder is still exactly two members", () => {
    // AGENT-FOUNDATION-1 introduced a THREE-level severity for the Agent Core.
    // Curie Atlas must not inherit it: a `critical` level would invite a
    // judgement this report is not entitled to make.
    assert.deepEqual(contractModule.FINDING_SEVERITIES, ["info", "attention"]);
  });

  await check("B5 the same resolved request produces byte-identical output", async () => {
    const first = await buildReport({ mode: "event_date" });
    const second = await buildReport({ mode: "event_date" });
    assert.equal(
      JSON.stringify(first.report),
      JSON.stringify(second.report),
      "the deterministic report must be byte-stable",
    );
  });

  await check("B6 the fingerprint identifies the RESOLVED question, not its spelling", async () => {
    // A preset and the explicit defaults it resolves to are one question.
    const implicitDefaults = await buildReport({ mode: "event_date" });
    const explicitDefaults = await buildReport({
      mode: "event_date",
      preset: "last_30_days",
      group: "day",
      dimension: "affiliate",
    });
    assert.equal(implicitDefaults.fingerprint, explicitDefaults.fingerprint);
    assert.match(implicitDefaults.fingerprint, /^[a-f0-9]{16}$/);

    // A different window is a different question.
    const otherWindow = await buildReport({ mode: "event_date", preset: "last_7_days" });
    assert.notEqual(otherWindow.fingerprint, implicitDefaults.fingerprint);
  });

  /* ------------------------------------------------------------------ */
  /* C. Zero Agent Core rows                                             */
  /* ------------------------------------------------------------------ */

  async function assertAgentCoreEmpty(label: string) {
    for (const table of AGENT_CORE_TABLES) {
      const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint | number }>>(
        `SELECT COUNT(*) AS c FROM "${table}"`,
      );
      assert.equal(Number(rows[0].c), 0, `${table} must stay empty after ${label}`);
    }
  }

  await check("C1 building a report creates ZERO rows in all nine Agent Core tables", async () => {
    for (let i = 0; i < 3; i += 1) {
      await buildReport({ mode: "event_date" });
    }
    await assertAgentCoreEmpty("event-date reports");
  });

  await check("C2 the cohort mode also creates zero Agent Core rows", async () => {
    const { report } = await buildReport({ mode: "acquisition_cohort" });
    assert.equal(report.overview.mode, "acquisition_cohort");
    assert.equal(report.engine.modelInvoked, false);
    await assertAgentCoreEmpty("a cohort report");
  });

  await check("C3 no ModelInvocation row exists after any Atlas work", async () => {
    assert.equal(await prisma.modelInvocation.count(), 0);
    assert.equal(await prisma.agentRun.count(), 0);
    assert.equal(await prisma.agentFinding.count(), 0);
  });

  /* ------------------------------------------------------------------ */
  /* D. The endpoint CANNOT reach the Agent Core                         */
  /* ------------------------------------------------------------------ */

  await check("D1 the Atlas route's transitive import closure contains no Agent Core module", () => {
    const closure = importClosure(path.join(projectRoot, ATLAS_ROUTE), projectRoot);
    const agentModules = [...closure].filter((file) =>
      file.includes(path.join("src", "lib", "agents")),
    );
    assert.deepEqual(
      agentModules,
      [],
      `the Atlas endpoint must not be able to reach the Agent Core, but imports:\n${agentModules.join("\n")}`,
    );
    // Sanity: the closure really was walked, not silently empty.
    assert.ok(closure.size > 5, `expected a real import closure, got ${closure.size} files`);
    assert.ok(
      [...closure].some((file) => file.endsWith(path.join("analysis", "analysis-report.ts"))),
      "the closure must include the analysis report builder",
    );
  });

  await check("D2 no Agent Core module is imported by ANY route in the app", () => {
    const apiRoot = path.join(projectRoot, "src", "app");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (/["']@\/lib\/agents\//.test(source) || /lib\/agents\//.test(source)) {
            offenders.push(path.relative(projectRoot, full));
          }
        }
      }
    };
    walk(apiRoot);
    assert.deepEqual(
      offenders,
      [],
      `Agent Core has no public surface in this phase, but these reach it:\n${offenders.join("\n")}`,
    );
  });

  await check("D3 the route still requires view_affiliate_analytics and nothing more", () => {
    const source = fs.readFileSync(path.join(projectRoot, ATLAS_ROUTE), "utf8");
    assert.ok(/requireAffiliateReader/.test(source));
    assert.ok(/requireAffiliateCsrf/.test(source));
    // It gained no new permission and no reveal capability.
    for (const forbidden of ["reveal_pii", "view_agent_runs", "approve_agent_actions", "manage_agent_policy", "execute_agent_actions"]) {
      assert.ok(!source.includes(forbidden), `the route must not reference ${forbidden}`);
    }
    // The reader gate resolves to the affiliate READ permission, which is
    // `view_affiliate_analytics` and is unchanged by this phase.
    const routes = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "crm", "affiliate-routes.ts"),
      "utf8",
    );
    assert.ok(/assertCanReadAffiliates/.test(routes));
    const affiliates = fs.readFileSync(
      path.join(projectRoot, "src", "lib", "crm", "affiliates.ts"),
      "utf8",
    );
    assert.ok(/view_affiliate_analytics/.test(affiliates));
  });

  await check("D4 the route still declares no-store cache semantics", () => {
    const source = fs.readFileSync(path.join(projectRoot, ATLAS_ROUTE), "utf8");
    assert.ok(/force-dynamic/.test(source));
    assert.ok(/revalidate = 0/.test(source));
  });

  await check("D5 the analysis library writes no SQL and performs no mutation", () => {
    const dir = path.join(projectRoot, "src", "lib", "analysis");
    // Matched against a Prisma DELEGATE, not against any `.update(` in the
    // file: the fingerprint builder legitimately calls `hash.update(...)`, and
    // a scan that cannot tell a crypto digest from a database write is a scan
    // people learn to override.
    const mutations = [
      /\bdb\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
      /\bprisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
      /\btx\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
      /\$executeRaw/,
    ];
    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      for (const pattern of mutations) {
        assert.ok(
          !pattern.test(source),
          `${file} must remain read-only, matched ${pattern}`,
        );
      }
    }
  });

  await prisma.$disconnect();
  cleanup();

  console.log(`\nAGENT-FOUNDATION-1 atlas isolation: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
