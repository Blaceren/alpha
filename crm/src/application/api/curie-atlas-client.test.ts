/**
 * AFD-5D2 — the Curie Atlas API client.
 *
 * What matters here is not that a happy request works, but that the client
 * REFUSES correctly: without a CSRF token, on every mapped error status, on a
 * body that violates the contract, and on a body that merely fails to parse.
 * Those two last cases are separate outcomes because the operator's next step
 * differs, and a test that conflated them would let the distinction rot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_ANALYSIS_ENDPOINT,
  ATLAS_ENDPOINTS,
  buildAtlasBody,
  runAtlasAnalysis,
} from "./curie-atlas-client";
import { atlasReport } from "@/test/atlas-fixtures";

const csrfMock = vi.fn();

vi.mock("@/application/api/auth-client", () => ({
  csrfHeaders: (...args: unknown[]) => csrfMock(...args),
}));

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  csrfMock.mockReset().mockResolvedValue({ "x-csrf-token": "token-1" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("curie atlas client", () => {
  /* ------------------------------------------------------------------ paths */

  it("may call exactly one backend path", () => {
    expect(ATLAS_ENDPOINTS).toEqual(["/api/crm/v1/affiliates/analytics/analysis"]);
    expect(ATLAS_ANALYSIS_ENDPOINT).toBe("/api/crm/v1/affiliates/analytics/analysis");
  });

  it("never constructs a lead, reveal or user path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(atlasReport()));
    await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toBe(ATLAS_ANALYSIS_ENDPOINT);
    for (const forbidden of ["leads", "reveal", "users", "notes"]) {
      expect(url).not.toContain(forbidden);
    }
  });

  /* ------------------------------------------------------------------- body */

  it("serializes the body in one fixed key order and drops unset keys", () => {
    const body = buildAtlasBody({
      mode: "event_date",
      preset: "last_30_days",
      group: "day",
      dimension: "affiliate",
      affiliatePartnerId: undefined,
      startDate: "",
    });
    expect(body).toBe(
      '{"mode":"event_date","preset":"last_30_days","group":"day","dimension":"affiliate"}',
    );
  });

  it("produces a byte-identical body for two identical selections", () => {
    const a = buildAtlasBody({ mode: "event_date", group: "week", dimension: "campaign" });
    const b = buildAtlasBody({ dimension: "campaign", group: "week", mode: "event_date" });
    expect(a).toBe(b);
  });

  it("sends POST with the CSRF token, same-origin credentials and no-store", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(atlasReport()));
    await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("token-1");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("never sends an Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(atlasReport()));
    await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    for (const key of Object.keys(headers)) {
      expect(key.toLowerCase()).not.toBe("authorization");
    }
  });

  /* ------------------------------------------------------------------- CSRF */

  it("abandons the request locally when no CSRF token can be obtained", async () => {
    csrfMock.mockResolvedValue({});
    const fetchImpl = vi.fn();
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toEqual({ status: "csrf_unavailable" });
    // The decisive assertion: nothing was sent untokened.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  /* ---------------------------------------------------------------- success */

  it("returns the parsed report on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(atlasReport()));
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.data.agent.code).toBe("curie_atlas");
      expect(outcome.data.engine.modelInvoked).toBe(false);
      expect(outcome.data.requestId).toBe("req_atlas_0001");
    }
  });

  /* ------------------------------------------------------- contract refusals */

  it("refuses modelInvoked: true as a contract violation, not a parse error", async () => {
    const report = atlasReport();
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ ...report, engine: { ...report.engine, modelInvoked: true } }),
    );
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toEqual({ status: "contract_violation", reason: "model_invoked" });
  });

  it("refuses a legacy opportunities field with its own reason", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...atlasReport(), opportunities: [] }));
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toEqual({
      status: "contract_violation",
      reason: "legacy_opportunities_field",
    });
  });

  it("refuses a different agent with its own reason", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ ...atlasReport(), agent: { code: "curie_pulse", version: "1.0.0" } }),
    );
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toEqual({ status: "contract_violation", reason: "unexpected_agent" });
  });

  it("refuses an otherwise-invalid body as a schema mismatch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ agent: undefined, nope: 1 }));
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome.status).toBe("contract_violation");
  });

  it("reports a non-JSON success body as malformed, not as a violation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("<html>", { status: 200 }));
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toEqual({ status: "malformed_response" });
  });

  /* ---------------------------------------------------------- error mapping */

  it.each([
    [400, "invalid_input"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "invalid_input"],
    [429, "rate_limited"],
    [500, "upstream_unavailable"],
    [503, "upstream_unavailable"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { code: "x", messageKey: "crm.analysis.body_invalid", requestId: "req_9" },
        { status },
      ),
    );
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome.status).toBe(expected);
  });

  it("carries the backend requestId out of an error envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(
        { code: "x", messageKey: "crm.affiliates.forbidden", requestId: "req_403" },
        { status: 403 },
      ),
    );
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toMatchObject({ status: "forbidden", requestId: "req_403" });
  });

  it("tolerates an error body with no envelope", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome.status).toBe("upstream_unavailable");
  });

  /* ------------------------------------------------------ abort and timeout */

  it("reports a caller-cancelled request as cancelled, not as a failure", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const outcome = await runAtlasAnalysis(
      { mode: "event_date" },
      { fetchImpl, signal: controller.signal },
    );
    expect(outcome).toEqual({ status: "cancelled" });
  });

  it("reports its own deadline as a timeout, distinct from an unreachable backend", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl, timeoutMs: 5 });
    expect(outcome).toEqual({ status: "timeout" });
  });

  it("reports a network failure as upstream_unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network"));
    const outcome = await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(outcome).toEqual({ status: "upstream_unavailable" });
  });

  /* ---------------------------------------------------------- no persistence */

  it("writes nothing to browser storage", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(atlasReport()));
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    await runAtlasAnalysis({ mode: "event_date" }, { fetchImpl });
    expect(localSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
