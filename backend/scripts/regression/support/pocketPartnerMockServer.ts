/**
 * L4PA-1 — deterministic local mock of the official Pocket Partner user-info
 * endpoint. TEST-ONLY, LOOPBACK-ONLY.
 *
 * NO TEST IN THIS REPOSITORY EVER CONTACTS pocketpartners.com. This server is
 * the entire universe the adapter talks to during regression: it binds an
 * ephemeral port on 127.0.0.1 (never 0.0.0.0), speaks the exact documented path
 * shape, and independently recomputes the MD5 the adapter should have sent —
 * so "the adapter builds the official hash correctly" is proven by a party that
 * does not share the adapter's implementation.
 *
 * IT NEVER LOGS THE REQUEST. The path contains a token-derived credential, so
 * this file records a bounded call count and the LAST OBSERVED SHAPE (whether
 * the hash matched, the method, the segment count) and nothing else. There is
 * no console output, no request log and no stored URL.
 *
 * The token used against it is the synthetic
 * `test-token-not-a-real-pocket-secret`; no real credential exists here.
 */
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/** Every behaviour the adapter must survive. One name per fixture. */
export type PocketMockScenario =
  /** real_balance exactly at the USD 50 threshold. */
  | "real_at_threshold"
  /** real_balance comfortably above the threshold. */
  | "real_above_threshold"
  /** real_balance 49.99 — one cent short, and never rounded up. */
  | "real_just_below_threshold"
  /** Huge demo balance, real balance below threshold. Must be not_met. */
  | "demo_huge_real_below"
  /** Real balance met, demo balance zero. Must be met. */
  | "real_met_demo_zero"
  | "user_id_mismatch"
  | "partner_id_mismatch"
  | "status_inactive"
  | "status_unknown"
  | "status_missing"
  | "real_balance_missing"
  | "real_balance_string"
  | "real_balance_negative"
  | "real_balance_null"
  | "malformed_json"
  | "array_response"
  | "oversized_response"
  | "http_401"
  | "http_403"
  | "http_404"
  | "http_408"
  | "http_429"
  | "http_500"
  | "http_503"
  | "delayed_timeout"
  | "redirect"
  | "connection_close"
  /** Correct shape but the adapter's hash did not match ours. */
  | "hash_rejected";

export type PocketMockObservation = {
  /** True when the adapter's hash equalled our independent computation. */
  readonly hashMatched: boolean;
  readonly method: string;
  readonly segmentCount: number;
  readonly userIdSegment: string;
  readonly partnerIdSegment: string;
  /** Length only — the value itself is a credential and is never retained. */
  readonly hashLength: number;
  readonly hashIsLowercaseHex: boolean;
};

export type PocketMockServer = {
  readonly baseUrl: string;
  readonly port: number;
  /** Total requests that reached the handler. */
  callCount(): number;
  /** Requests whose path shape and hash were both correct. */
  authenticatedCallCount(): number;
  lastObservation(): PocketMockObservation | null;
  setScenario(scenario: PocketMockScenario): void;
  reset(): void;
  close(): Promise<void>;
};

export type PocketMockOptions = {
  readonly partnerId: number;
  readonly apiToken: string;
  readonly scenario?: PocketMockScenario;
  /** How long `delayed_timeout` withholds its answer. */
  readonly delayMs?: number;
};

const USER_INFO_PREFIX = ["api", "user-info"];
const LOWERCASE_HEX_MD5 = /^[0-9a-f]{32}$/;

export async function startPocketPartnerMockServer(
  options: PocketMockOptions,
): Promise<PocketMockServer> {
  let scenario: PocketMockScenario = options.scenario ?? "real_at_threshold";
  let calls = 0;
  let authenticated = 0;
  let observation: PocketMockObservation | null = null;
  const delayMs = options.delayMs ?? 10_000;
  const pending = new Set<NodeJS.Timeout>();

  const server = http.createServer((req, res) => {
    calls += 1;

    // Parsed against a fixed origin purely to split the path; the URL is never
    // stored, echoed or logged.
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const segments = url.pathname.split("/").filter(Boolean);
    const [p1, p2, userIdSegment = "", partnerIdSegment = "", hash = ""] = segments;

    const shapeOk =
      segments.length === 5 && p1 === USER_INFO_PREFIX[0] && p2 === USER_INFO_PREFIX[1];

    // The independent check: recompute the documented preimage ourselves and
    // compare. A matching hash proves the adapter used exactly
    // `{user_id}:{partner_id}:{api_token}` with colons, no padding and no
    // encoding — because any other preimage yields a different digest.
    const expected = shapeOk
      ? crypto
          .createHash("md5")
          .update(`${userIdSegment}:${partnerIdSegment}:${options.apiToken}`, "utf8")
          .digest("hex")
      : "";
    const hashMatched = shapeOk && hash.length > 0 && hash === expected;

    observation = {
      hashMatched,
      method: req.method ?? "",
      segmentCount: segments.length,
      userIdSegment,
      partnerIdSegment,
      hashLength: hash.length,
      hashIsLowercaseHex: LOWERCASE_HEX_MD5.test(hash),
    };

    // The documented endpoint is GET-only.
    if (req.method !== "GET") return sendJson(res, 405, { error: "method_not_allowed" });
    if (!shapeOk) return sendJson(res, 404, { error: "not_found" });
    if (!hashMatched || scenario === "hash_rejected") {
      return sendJson(res, 403, { error: "forbidden" });
    }

    authenticated += 1;

    const userId = Number(userIdSegment);
    const partnerId = Number(partnerIdSegment);
    respond(res, scenario, userId, partnerId, delayMs, pending);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    callCount: () => calls,
    authenticatedCallCount: () => authenticated,
    lastObservation: () => observation,
    setScenario(next) {
      scenario = next;
    },
    reset() {
      calls = 0;
      authenticated = 0;
      observation = null;
    },
    async close() {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Drop one documented field so its absence can be exercised. */
function omit(body: Record<string, unknown>, key: string) {
  const copy = { ...body };
  delete copy[key];
  return copy;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** The canonical shape from the official manual, with synthetic values only. */
function baseBody(userId: number, partnerId: number) {
  return {
    user_id: userId,
    partner_id: partnerId,
    country: "BR",
    registered_at: "2025-01-15T10:23:00Z",
    ftd_amount: 150,
    total_deposits: 420,
    real_balance: 50,
    demo_balance: 10000,
    status: "active",
  } as Record<string, unknown>;
}

function respond(
  res: http.ServerResponse,
  scenario: PocketMockScenario,
  userId: number,
  partnerId: number,
  delayMs: number,
  pending: Set<NodeJS.Timeout>,
) {
  const body = baseBody(userId, partnerId);

  switch (scenario) {
    case "real_at_threshold":
      return sendJson(res, 200, { ...body, real_balance: 50 });
    case "real_above_threshold":
      return sendJson(res, 200, { ...body, real_balance: 260 });
    case "real_just_below_threshold":
      return sendJson(res, 200, { ...body, real_balance: 49.99 });
    case "demo_huge_real_below":
      return sendJson(res, 200, { ...body, real_balance: 0, demo_balance: 10_000 });
    case "real_met_demo_zero":
      return sendJson(res, 200, { ...body, real_balance: 75.5, demo_balance: 0 });
    case "user_id_mismatch":
      return sendJson(res, 200, { ...body, user_id: userId + 1 });
    case "partner_id_mismatch":
      return sendJson(res, 200, { ...body, partner_id: partnerId + 1 });
    case "status_inactive":
      return sendJson(res, 200, { ...body, status: "inactive" });
    case "status_unknown":
      return sendJson(res, 200, { ...body, status: "some-new-status" });
    case "status_missing":
      return sendJson(res, 200, omit(body, "status"));
    case "real_balance_missing":
      return sendJson(res, 200, omit(body, "real_balance"));
    case "real_balance_string":
      return sendJson(res, 200, { ...body, real_balance: "260" });
    case "real_balance_negative":
      return sendJson(res, 200, { ...body, real_balance: -10 });
    case "real_balance_null":
      return sendJson(res, 200, { ...body, real_balance: null });
    case "malformed_json": {
      const broken = '{"user_id": 101010, "real_balance": 260,';
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(broken),
      });
      return res.end(broken);
    }
    case "array_response":
      return sendJson(res, 200, [body]);
    case "oversized_response": {
      // Well over the adapter's 64 KiB ceiling, and streamed so the cap is
      // exercised rather than a single oversized buffer.
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"user_id":' + userId + ',"padding":"');
      for (let i = 0; i < 200; i += 1) res.write("x".repeat(1024));
      return res.end('"}');
    }
    case "http_401":
      return sendJson(res, 401, { error: "unauthorized" });
    case "http_403":
      return sendJson(res, 403, { error: "forbidden" });
    case "http_404":
      return sendJson(res, 404, { error: "not_found" });
    case "http_408":
      return sendJson(res, 408, { error: "request_timeout" });
    case "http_429":
      res.writeHead(429, { "content-type": "application/json", "retry-after": "90" });
      return res.end(JSON.stringify({ error: "rate_limited" }));
    case "http_500":
      return sendJson(res, 500, { error: "server_error" });
    case "http_503":
      return sendJson(res, 503, { error: "maintenance" });
    case "delayed_timeout": {
      // Never answers within the adapter's deadline. The engine's AbortSignal
      // is what must resolve this, which is the point of the fixture.
      const timer = setTimeout(() => {
        pending.delete(timer);
        if (!res.writableEnded) sendJson(res, 200, body);
      }, delayMs);
      pending.add(timer);
      return;
    }
    case "redirect":
      res.writeHead(302, { location: "https://example.invalid/api/user-info" });
      return res.end();
    case "connection_close":
      return res.socket?.destroy();
    case "hash_rejected":
      return sendJson(res, 403, { error: "forbidden" });
  }
}
