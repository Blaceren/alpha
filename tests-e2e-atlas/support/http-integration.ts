/**
 * AFD-5D2 — the isolated HTTP integration.
 *
 * Every request below goes to the CRM's OWN ORIGIN and reaches the backend only
 * through the CRM's explicit Next rewrite allow-list. That is the only way to
 * prove the four things this phase actually claims:
 *
 *   1. the analysis path is forwarded at all (it was added to the allow-list
 *      this phase, and a forgotten entry would 404 here rather than in review);
 *   2. the session cookie and the CSRF token survive the hop;
 *   3. the permission matrix is enforced by the BACKEND, not by a hidden button;
 *   4. running the analysis creates ZERO rows in the nine Agent Core tables.
 *
 * NO EXTERNAL REQUEST IS MADE. Both servers are loopback, every integration is
 * disabled by env, and the only hosts contacted are 127.0.0.1.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import {
  AGENT_CORE_TABLES,
  BACKEND_BRANCH,
  BACKEND_DIR,
  PASSWORD,
  assertBackendUnchanged,
  backendUrl,
  cleanupDb,
  countRows,
  crmUrl,
  dbUrl,
  migrate,
  startBackend,
  startCrm,
  stopAll,
  waitForHttp,
} from "./atlas-e2e";

const ANALYSIS_PATH = "/api/crm/v1/affiliates/analytics/analysis";

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/* ------------------------------------------------------------------ session */

/** A cookie jar that talks only to the CRM origin. */
class Client {
  private cookies = new Map<string, string>();

  private header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const index = pair?.indexOf("=") ?? -1;
      if (index > 0) this.cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
    }
  }

  async request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.header();
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${crmUrl}${path}`, {
      ...init,
      method,
      headers,
      redirect: "manual",
    });
    this.absorb(response);
    return response;
  }

  get csrfToken(): string | undefined {
    return this.cookies.get("trading_platform_csrf");
  }
}

/**
 * Log in ONCE per role.
 *
 * The backend rate-limits login on (ip, email) at 5 attempts per 10 minutes, so
 * a suite that logged in per assertion would start answering 429 half way
 * through and report a permission failure that is really a throttle. Each role
 * therefore authenticates once and its cookie jar is reused, which is also how a
 * real operator's browser behaves.
 */
async function attemptLogin(email: string): Promise<{ client: Client; status: number }> {
  const client = new Client();
  await client.request("GET", "/api/crm/auth/csrf");
  const response = await client.request("POST", "/api/crm/auth/login", {
    headers: {
      "content-type": "application/json",
      ...(client.csrfToken ? { "x-csrf-token": client.csrfToken } : {}),
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { client, status: response.status };
}

async function loginAs(email: string): Promise<Client> {
  const { client, status } = await attemptLogin(email);
  assert(status === 200, `login failed for ${email}: ${status}`);
  return client;
}

const BODY = JSON.stringify({
  mode: "event_date",
  preset: "custom",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  group: "day",
  dimension: "affiliate",
});

async function analyse(client: Client, body = BODY): Promise<Response> {
  return client.request("POST", ANALYSIS_PATH, {
    headers: {
      "content-type": "application/json",
      ...(client.csrfToken ? { "x-csrf-token": client.csrfToken } : {}),
    },
    body,
  });
}

/* --------------------------------------------------------------------- main */

async function main() {
  cleanupDb();
  console.log(`backend candidate ${BACKEND_BRANCH}`);
  assertBackendUnchanged();

  migrate();

  /**
   * Node resolves `bcryptjs` and `@prisma/client` from the SEED FILE's own
   * directory, not from the working directory, so a seed living in the CRM tree
   * cannot see the backend's dependencies.
   *
   * It is therefore staged into the backend's `node_modules`, which is a
   * gitignored build-artifact directory rather than source: the backend
   * worktree stays tracked-clean, `assertBackendUnchanged()` proves it before
   * and after, and the staged file is removed in the `finally` block.
   */
  const stagedSeed = `${BACKEND_DIR}/node_modules/.afd5d3-seed.ts`;
  fs.copyFileSync(`${process.cwd()}/tests-e2e-atlas/support/seed.ts`, stagedSeed);

  const seeded = spawnSync("npx", ["tsx", stagedSeed], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl, ATLAS_E2E_PASSWORD: PASSWORD },
    encoding: "utf8",
  });
  fs.rmSync(stagedSeed, { force: true });
  if (seeded.status !== 0) throw new Error(`seed failed:\n${seeded.stdout}\n${seeded.stderr}`);

  const backend = startBackend();
  const crm = startCrm();

  try {
    await waitForHttp(`${backendUrl}/api/crm/v1/session`);
    await waitForHttp(`${crmUrl}/login`);

    /* ------------------------------------------------- one session per role */

    const analyst = await loginAs("afd5d3-e2e-analyst@example.invalid");
    const admin = await loginAs("afd5d3-e2e-crm_admin@example.invalid");
    const support = await loginAs("afd5d3-e2e-support@example.invalid");

    /* ---------------------------------------------------- permission matrix */

    let analystRequestId = "";

    await check("analyst receives 200 through the CRM origin", async () => {
      const response = await analyse(analyst);
      assert(response.status === 200, `expected 200, got ${response.status}`);
      const report = (await response.json()) as Record<string, unknown>;
      analystRequestId = String(report.requestId);
      assert(
        (report.agent as Record<string, unknown>).code === "curie_atlas",
        "agent code must be curie_atlas",
      );
      assert(
        (report.engine as Record<string, unknown>).modelInvoked === false,
        "modelInvoked must be false",
      );
    });

    await check("crm_admin receives 200", async () => {
      const response = await analyse(admin);
      assert(response.status === 200, `expected 200, got ${response.status}`);
    });

    await check("support without the permission receives 403 FROM THE BACKEND", async () => {
      const response = await analyse(support);
      assert(response.status === 403, `expected 403, got ${response.status}`);
    });

    await check("a learner cannot obtain a CRM session at all", async () => {
      // The stronger statement: a learner is refused one step EARLIER than the
      // analysis route, because the CRM session is a staff surface. There is no
      // authenticated learner who could then be refused by the analysis route.
      const { client, status } = await attemptLogin("afd5d3-e2e-learner@example.invalid");
      assert(status !== 200, `a learner must not obtain a CRM session, got ${status}`);
      const response = await analyse(client);
      assert(
        response.status === 401 || response.status === 403,
        `expected 401 or 403 for a learner, got ${response.status}`,
      );
    });

    await check("an anonymous caller receives 401", async () => {
      const response = await fetch(`${crmUrl}${ANALYSIS_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: BODY,
        redirect: "manual",
      });
      assert(response.status === 401, `expected 401, got ${response.status}`);
    });

    await check("a missing CSRF token receives 403 even for an authorised analyst", async () => {
      const response = await analyst.request("POST", ANALYSIS_PATH, {
        headers: { "content-type": "application/json" },
        body: BODY,
      });
      assert(response.status === 403, `expected 403, got ${response.status}`);
    });

    /* ------------------------------------------------------------- contract */

    await check("the response is private, no-store", async () => {
      const response = await analyse(analyst);
      const cache = response.headers.get("cache-control") ?? "";
      assert(cache.includes("no-store"), `cache-control was "${cache}"`);
      assert(cache.includes("private"), `cache-control was "${cache}"`);
    });

    await check("the request id is preserved in the header and the body", async () => {
      const response = await analyse(analyst);
      const header = response.headers.get("x-request-id");
      const report = (await response.json()) as Record<string, unknown>;
      assert(header, "X-Request-Id header missing");
      assert(report.requestId === header, "body requestId must equal the header");
    });

    await check("the same request produces the same fingerprint and the same findings", async () => {
      const first = (await (await analyse(analyst)).json()) as Record<string, unknown>;
      const second = (await (await analyse(analyst)).json()) as Record<string, unknown>;

      assert(
        first.inputFingerprint === second.inputFingerprint,
        "the same resolved question must fingerprint identically",
      );
      const strip = (report: Record<string, unknown>) => {
        const { requestId: _r, generatedAt: _g, ...rest } = report;
        return JSON.stringify(rest);
      };
      assert(strip(first) === strip(second), "two identical requests must produce one answer");
      assert(first.requestId !== second.requestId, "each call must carry its own request id");
    });

    await check("the response carries positiveSignals and never opportunities", async () => {
      const text = await (await analyse(analyst)).text();
      assert(text.includes('"positiveSignals"'), "positiveSignals missing");
      assert(!text.includes('"opportunities"'), "the legacy alias must not be published");
    });

    await check("the response carries no PII, lead, click id or Pocket id", async () => {
      const text = await (await analyse(analyst)).text();
      assert(
        !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text),
        "an email address leaked",
      );
      assert(
        !/"(email|phone|fullName|leadId|pocketPlayerId|ataClickId|anonymousVisitorId)"/.test(text),
        "a forbidden key leaked",
      );
      const longDigits = text.match(/\b\d{9,}\b/g) ?? [];
      assert(
        longDigits.length === 0,
        `identifier-shaped digit runs leaked: ${longDigits.slice(0, 3).join(", ")}`,
      );
    });

    await check("an unknown request key is refused with 400", async () => {
      const response = await analyse(
        analyst,
        JSON.stringify({ mode: "event_date", trafficQualityScore: true }),
      );
      assert(response.status === 400, `expected 400, got ${response.status}`);
    });

    /* -------------------------------------------------- the Agent Core claim */

    await check("running the analysis creates ZERO Agent Core rows", () => {
      for (const table of AGENT_CORE_TABLES) {
        const rows = countRows(table);
        assert(rows === 0, `${table} must stay empty, found ${rows}`);
      }
    });

    await check("no ModelInvocation row exists after every analysis in this run", () => {
      assert(countRows("ModelInvocation") === 0, "ModelInvocation must stay empty");
    });

    await check("the CRM forwards the analysis path but not an unlisted sibling", async () => {
      const listed = await analyse(analyst);
      assert(listed.status === 200, "the analysis path must be forwarded");
      const unlisted = await analyst.request(
        "POST",
        "/api/crm/v1/affiliates/analytics/analysis/extra",
        { headers: { "content-type": "application/json" }, body: BODY },
      );
      assert(
        unlisted.status === 404 || unlisted.status === 405,
        `an unlisted path must not reach the backend, got ${unlisted.status}`,
      );
    });

    await check("the backend origin never leaks into the response body", async () => {
      const text = await (await analyse(analyst)).text();
      const backendPortToken = new URL(backendUrl).port;
      assert(!text.includes(backendPortToken), "the backend port leaked into the response body");
    });

    await check("the analyst request id was a real value", () => {
      assert(analystRequestId.length > 0, "no request id captured");
    });

  } finally {
    stopAll();
    // Give the groups a moment to die before the process exits.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assertBackendUnchanged();
    if (failed > 0) {
      console.error(`--- backend log tail ---\n${backend.logs().slice(-2000)}`);
      console.error(`--- crm log tail ---\n${crm.logs().slice(-2000)}`);
    }
    cleanupDb();
  }

  console.log(`\nAFD-5D2 http integration: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  stopAll();
  cleanupDb();
  process.exitCode = 1;
});
