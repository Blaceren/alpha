/**
 * TOOLS-V2 — the bounded tools proxy.
 *
 * A closed list of operations, each pinned to one method and one constant
 * Backend path shape. What these cases pin is the boundary, not the happy path:
 * nothing a caller sends can choose a host, leave an id's segment, reach a
 * staff route, carry a query other than the validated ones, send a body with a
 * delete, or make a private answer cacheable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_JOURNAL_RESPONSE_BYTES,
  MAX_TOOLS_BODY_BYTES,
  MAX_TOOLS_RESPONSE_BYTES,
  proxyTools,
  resolveToolsQuery,
  resolveToolsTargetPath,
} from "@/server/proxy/tools-proxy";
import { resetAcademyConfigCache } from "@/config/academy-config";

const ORIGIN = "http://127.0.0.1:3215";
const CARD = "cm3k9x2p10000abcdefghij";

function backendJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({ "content-type": "application/json", ...headers }),
  });
}

let originalEnv: Record<string, string | undefined>;
beforeEach(() => {
  originalEnv = { ACADEMY_MODE: process.env.ACADEMY_MODE, BACKEND_ORIGIN: process.env.BACKEND_ORIGIN };
  process.env.ACADEMY_MODE = "api";
  process.env.BACKEND_ORIGIN = ORIGIN;
  resetAcademyConfigCache();
});
afterEach(() => {
  process.env.ACADEMY_MODE = originalEnv.ACADEMY_MODE;
  process.env.BACKEND_ORIGIN = originalEnv.BACKEND_ORIGIN;
  resetAcademyConfigCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const request = (method: string, path = "/api/backend/tools/trade-cards", headers: Record<string, string> = {}, body?: BodyInit) =>
  new Request(`http://academy.test${path}`, { method, headers, body });

describe("tools proxy — the path it will build", () => {
  it("pins each operation to one constant Backend path", () => {
    expect(resolveToolsTargetPath({ operation: "trade-card-state" })).toBe("/api/tools/trade-cards");
    expect(resolveToolsTargetPath({ operation: "trade-card-fix" })).toBe("/api/tools/trade-cards");
    expect(resolveToolsTargetPath({ operation: "trade-card-change", cardId: CARD })).toBe(`/api/tools/trade-cards/${CARD}`);
  });

  it("refuses a card id that is not a plain identifier", () => {
    for (const cardId of [
      "../../crm/v1/users",
      "abc/../../../etc/passwd",
      `${CARD}/notes`,
      `${CARD}?admin=1`,
      `${CARD}#x`,
      "http://evil.invalid/x",
      "//evil.invalid/x",
      "clx 1234567",
      "",
      "short",
      "x".repeat(200),
    ]) {
      expect(resolveToolsTargetPath({ operation: "trade-card-change", cardId }), JSON.stringify(cardId)).toBeNull();
    }
  });

  it("never builds a path outside the learner's own tool routes", () => {
    for (const input of [
      { operation: "trade-card-state" } as const,
      { operation: "trade-card-fix" } as const,
      { operation: "trade-card-change", cardId: CARD } as const,
    ]) {
      const path = resolveToolsTargetPath(input)!;
      expect(path.startsWith("/api/tools/trade-cards")).toBe(true);
      expect(path).not.toContain("/crm/");
    }
  });
});

describe("tools proxy — the request it sends", () => {
  it("reads with GET, fixes with POST and changes with PATCH, each on its constant path", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyTools(request("GET"), { operation: "trade-card-state" });
    await proxyTools(request("POST", undefined, { "content-type": "application/json" }, "{}"), { operation: "trade-card-fix" });
    await proxyTools(request("PATCH", `/api/backend/tools/trade-cards/${CARD}`, {}, "{}"), {
      operation: "trade-card-change",
      cardId: CARD,
    });

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      [`${ORIGIN}/api/tools/trade-cards`, "GET"],
      [`${ORIGIN}/api/tools/trade-cards`, "POST"],
      [`${ORIGIN}/api/tools/trade-cards/${CARD}`, "PATCH"],
    ]);
    for (const call of fetchMock.mock.calls) expect(call[1].redirect).toBe("manual");
  });

  it("forwards the session cookie and the browser's CSRF token on a write, and nothing else", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await proxyTools(
      request(
        "POST",
        undefined,
        {
          "content-type": "application/json",
          "x-csrf-token": "browser-token",
          cookie: "session=abc",
          authorization: "Basic dGVhbTpwYXNz",
          "x-forwarded-for": "10.0.0.1",
          "x-real-ip": "10.0.0.2",
          "x-forwarded-host": "evil.invalid",
        },
        JSON.stringify({ plan: {} }),
      ),
      { operation: "trade-card-fix" },
    );

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-csrf-token")).toBe("browser-token");
    expect(headers.get("cookie")).toBe("session=abc");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-real-ip")).toBeNull();
    expect(headers.get("x-forwarded-host")).toBeNull();
  });

  it("sends no body and no CSRF token on a read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyTools(request("GET", undefined, { "x-csrf-token": "t", cookie: "s=1" }), { operation: "trade-card-state" });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).get("x-csrf-token")).toBeNull();
    expect((init.headers as Headers).get("cookie")).toBe("s=1");
  });

  it("never mints a CSRF token of its own", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyTools(request("POST", undefined, { cookie: "s=1" }, "{}"), { operation: "trade-card-fix" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]![1].headers as Headers).get("x-csrf-token")).toBeNull();
  });
});

describe("tools proxy — what it refuses without contacting Backend", () => {
  it.each([
    ["DELETE", "trade-card-state"],
    ["POST", "trade-card-state"],
    ["GET", "trade-card-fix"],
    ["PUT", "trade-card-fix"],
    ["POST", "trade-card-change"],
    ["DELETE", "trade-card-change"],
  ] as const)("refuses %s on %s with 405", async (method, operation) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input = operation === "trade-card-change" ? { operation, cardId: CARD } : { operation };
    const response = await proxyTools(request(method), input);
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a hostile card id with 400", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("PATCH", "/api/backend/tools/trade-cards/x", {}, "{}"), {
      operation: "trade-card-change",
      cardId: "../../crm/v1/users",
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses any query string with 400", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("GET", "/api/backend/tools/trade-cards?userId=7"), { operation: "trade-card-state" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized body with 413", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("POST", undefined, {}, "x".repeat(MAX_TOOLS_BODY_BYTES + 1)), {
      operation: "trade-card-fix",
    });
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 500 outside api mode", async () => {
    process.env.ACADEMY_MODE = "fixture";
    resetAcademyConfigCache();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tools proxy — the answer it returns", () => {
  it("passes the Backend status and body through, 401 and 403 unchanged", async () => {
    for (const status of [200, 201, 400, 401, 403, 404, 409, 429]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ error: "X" }, status)));
      const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
      expect(response.status).toBe(status);
    }
  });

  it("is never cacheable, whatever the Backend said", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ data: {} }, 200, { "cache-control": "public, max-age=600" })));
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 502 on a network failure, without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers 502 on an oversized response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("x".repeat(MAX_TOOLS_RESPONSE_BYTES + 1), { status: 200 })),
    );
    const response = await proxyTools(request("GET"), { operation: "trade-card-state" });
    expect(response.status).toBe(502);
  });
});

describe("tools proxy — the Trading Journal", () => {
  const ENTRY = "cm4j0urnal0000abcdefghij";
  const journal = (method: string, path = "/api/backend/tools/journal", body?: BodyInit) =>
    request(method, path, { "content-type": "application/json", cookie: "s=1", "x-csrf-token": "t" }, body);

  it("pins its operations to the journal's own paths", () => {
    expect(resolveToolsTargetPath({ operation: "journal-page" })).toBe("/api/tools/journal");
    expect(resolveToolsTargetPath({ operation: "journal-create" })).toBe("/api/tools/journal");
    expect(resolveToolsTargetPath({ operation: "journal-change", entryId: ENTRY })).toBe(`/api/tools/journal/${ENTRY}`);
    expect(resolveToolsTargetPath({ operation: "journal-delete", entryId: ENTRY })).toBe(`/api/tools/journal/${ENTRY}`);
    for (const entryId of ["../../crm/v1/users", `${ENTRY}/x`, `${ENTRY}?a=1`, "//evil.invalid/x", "", "short"]) {
      expect(resolveToolsTargetPath({ operation: "journal-change", entryId }), JSON.stringify(entryId)).toBeNull();
      expect(resolveToolsTargetPath({ operation: "journal-delete", entryId }), JSON.stringify(entryId)).toBeNull();
    }
  });

  it("forwards a page's filter and cursor only, rebuilt from validated values", () => {
    const page = { operation: "journal-page" } as const;
    const query = (raw: string) => resolveToolsQuery(page, new URLSearchParams(raw));
    expect(query("")).toBe("");
    expect(query("filter=all")).toBe("?filter=all");
    expect(query("filter=violated")).toBe("?filter=violated");
    expect(query("filter=no_conclusion&before=" + ENTRY)).toBe(`?filter=no_conclusion&before=${ENTRY}`);
    expect(query("before=" + ENTRY)).toBe(`?before=${ENTRY}`);
    for (const raw of [
      "filter=everything",
      "filter=all&userId=7",
      "filter=all&filter=violated",
      `before=${ENTRY}&before=${ENTRY}`,
      "before=../x",
      "before=",
      "userId=7",
    ]) {
      expect(query(raw), raw).toBeNull();
    }
    // No other operation carries a query at all.
    expect(resolveToolsQuery({ operation: "journal-create" }, new URLSearchParams("filter=all"))).toBeNull();
    expect(resolveToolsQuery({ operation: "trade-card-state" }, new URLSearchParams("filter=all"))).toBeNull();
  });

  it("reads a page with GET, records with POST and changes with PATCH", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await proxyTools(journal("GET", `/api/backend/tools/journal?filter=violated&before=${ENTRY}`), {
      operation: "journal-page",
    });
    await proxyTools(journal("POST", undefined, "{}"), { operation: "journal-create" });
    await proxyTools(journal("PATCH", `/api/backend/tools/journal/${ENTRY}`, "{}"), {
      operation: "journal-change",
      entryId: ENTRY,
    });

    expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      [`${ORIGIN}/api/tools/journal?filter=violated&before=${ENTRY}`, "GET"],
      [`${ORIGIN}/api/tools/journal`, "POST"],
      [`${ORIGIN}/api/tools/journal/${ENTRY}`, "PATCH"],
    ]);
    expect((fetchMock.mock.calls[0]![1].headers as Headers).get("x-csrf-token")).toBeNull();
    expect((fetchMock.mock.calls[1]![1].headers as Headers).get("x-csrf-token")).toBe("t");
  });

  it("deletes with DELETE on the entry's own path: the session and the token, and no body at all", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: { deleted: { id: ENTRY }, summary: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyTools(
      request("DELETE", `/api/backend/tools/journal/${ENTRY}`, {
        cookie: "s=1",
        "x-csrf-token": "t",
        "content-type": "application/json",
        authorization: "Basic dGVhbTpwYXNz",
      }),
      { operation: "journal-delete", entryId: ENTRY },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect([url, init.method]).toEqual([`${ORIGIN}/api/tools/journal/${ENTRY}`, "DELETE"]);
    expect(init.body).toBeUndefined();
    const headers = init.headers as Headers;
    expect(headers.get("cookie")).toBe("s=1");
    expect(headers.get("x-csrf-token")).toBe("t");
    // Nothing is sent, so nothing is declared; and the edge's credentials stay at the edge.
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("refuses a delete that says anything but its id, without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const path = `/api/backend/tools/journal/${ENTRY}`;
    const input = { operation: "journal-delete", entryId: ENTRY } as const;

    // A body: a delete has none, and one that arrives is not dropped silently.
    expect((await proxyTools(journal("DELETE", path, JSON.stringify({ all: true })), input)).status).toBe(400);
    // A query.
    expect((await proxyTools(journal("DELETE", `${path}?all=1`), input)).status).toBe(400);
    // An id that is not one entry's.
    expect(
      (await proxyTools(journal("DELETE", "/api/backend/tools/journal/x"), { operation: "journal-delete", entryId: "../../crm/v1/users" }))
        .status,
    ).toBe(400);
    // Any other method on the delete.
    for (const method of ["GET", "POST", "PATCH", "PUT"]) {
      const body = method === "GET" ? undefined : "{}";
      expect((await proxyTools(journal(method, path, body), input)).status, method).toBe(405);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the Backend's «not found» for a delete through unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(backendJson({ error: "JOURNAL_ENTRY_NOT_FOUND" }, 404)));
    const response = await proxyTools(journal("DELETE", `/api/backend/tools/journal/${ENTRY}`), {
      operation: "journal-delete",
      entryId: ENTRY,
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "JOURNAL_ENTRY_NOT_FOUND" });
  });

  it("refuses a query it does not know, a wrong method and a hostile id, without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const refused = [
      await proxyTools(journal("GET", "/api/backend/tools/journal?filter=all&userId=7"), { operation: "journal-page" }),
      await proxyTools(journal("POST", "/api/backend/tools/journal?filter=all", "{}"), { operation: "journal-create" }),
      await proxyTools(journal("PATCH", "/api/backend/tools/journal/x", "{}"), {
        operation: "journal-change",
        entryId: "../../crm/v1/users",
      }),
    ];
    expect(refused.map((response) => response.status)).toEqual([400, 400, 400]);
    expect((await proxyTools(journal("DELETE"), { operation: "journal-page" })).status).toBe(405);
    expect((await proxyTools(journal("GET"), { operation: "journal-create" })).status).toBe(405);
    expect(
      (await proxyTools(journal("DELETE", `/api/backend/tools/journal/${ENTRY}`), { operation: "journal-change", entryId: ENTRY }))
        .status,
    ).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries a whole page of long entries, and nothing past its own cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response("x".repeat(MAX_TOOLS_RESPONSE_BYTES + 1), { status: 200 })),
    );
    expect((await proxyTools(journal("GET"), { operation: "journal-page" })).status).toBe(200);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response("x".repeat(MAX_JOURNAL_RESPONSE_BYTES + 1), { status: 200 })),
    );
    expect((await proxyTools(journal("GET"), { operation: "journal-page" })).status).toBe(502);
  });

  it("takes an entry with every text at its longest", async () => {
    const fetchMock = vi.fn().mockResolvedValue(backendJson({ data: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    // Three-byte characters, at each text's limit.
    const entry = { plan: "設".repeat(1000), execution: "設".repeat(2000), conclusion: "設".repeat(2000) };
    const response = await proxyTools(journal("POST", undefined, JSON.stringify({ entry })), { operation: "journal-create" });
    expect(response.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("tools proxy — the Risk Calculator", () => {
  const risk = (method: string, path = "/api/backend/tools/risk-plan", body?: BodyInit) =>
    request(method, path, { "content-type": "application/json", cookie: "s=1", "x-csrf-token": "t" }, body);

  it("pins both operations to the one constant path", () => {
    expect(resolveToolsTargetPath({ operation: "risk-state" })).toBe("/api/tools/risk-plan");
    expect(resolveToolsTargetPath({ operation: "risk-save" })).toBe("/api/tools/risk-plan");
  });

  it("reads with GET and saves with POST, the token only on the save", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    await proxyTools(risk("GET"), { operation: "risk-state" });
    await proxyTools(risk("POST", undefined, "{}"), { operation: "risk-save" });
    expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      [`${ORIGIN}/api/tools/risk-plan`, "GET"],
      [`${ORIGIN}/api/tools/risk-plan`, "POST"],
    ]);
    expect((fetchMock.mock.calls[0]![1].headers as Headers).get("x-csrf-token")).toBeNull();
    expect((fetchMock.mock.calls[1]![1].headers as Headers).get("x-csrf-token")).toBe("t");
  });

  it("refuses a query, a wrong method and an oversized plan without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await proxyTools(risk("GET", "/api/backend/tools/risk-plan?userId=7"), { operation: "risk-state" })).status).toBe(400);
    expect((await proxyTools(risk("DELETE"), { operation: "risk-state" })).status).toBe(405);
    expect((await proxyTools(risk("PATCH", undefined, "{}"), { operation: "risk-save" })).status).toBe(405);
    expect(
      (await proxyTools(risk("POST", undefined, "x".repeat(MAX_TOOLS_BODY_BYTES + 1)), { operation: "risk-save" })).status,
    ).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tools proxy — the Entry Checklist", () => {
  const checks = (method: string, path = "/api/backend/tools/entry-checks", body?: BodyInit) =>
    request(method, path, { "content-type": "application/json", cookie: "s=1", "x-csrf-token": "t" }, body);

  it("reads with GET and keeps a check with POST, on the one constant path", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(resolveToolsTargetPath({ operation: "checklist-state" })).toBe("/api/tools/entry-checks");
    await proxyTools(checks("GET"), { operation: "checklist-state" });
    await proxyTools(checks("POST", undefined, "{}"), { operation: "checklist-save" });
    expect(fetchMock.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      [`${ORIGIN}/api/tools/entry-checks`, "GET"],
      [`${ORIGIN}/api/tools/entry-checks`, "POST"],
    ]);
  });

  it("refuses a query and a wrong method without contacting Backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await proxyTools(checks("GET", "/api/backend/tools/entry-checks?all=1"), { operation: "checklist-state" })).status).toBe(400);
    expect((await proxyTools(checks("PATCH", undefined, "{}"), { operation: "checklist-save" })).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tools proxy — Personal Stats", () => {
  const page = { operation: "stats-page" } as const;
  const stats = (path: string) => request("GET", path, { cookie: "s=1" });

  it("forwards only a period from the list and a calendar date, rebuilt", () => {
    const query = (raw: string) => resolveToolsQuery(page, new URLSearchParams(raw));
    expect(query("")).toBe("");
    expect(query("period=all")).toBe("?period=all");
    expect(query("period=7d&today=2026-09-21")).toBe("?period=7d&today=2026-09-21");
    for (const raw of ["period=90d", "period=7d&today=21.09.2026", "period=7d&period=30d", "period=7d&userId=7", "today=x"]) {
      expect(query(raw), raw).toBeNull();
    }
  });

  it("reads with GET on the one constant path, and refuses anything else there", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(resolveToolsTargetPath(page)).toBe("/api/tools/stats");
    await proxyTools(stats("/api/backend/tools/stats?period=30d&today=2026-09-21"), page);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/tools/stats?period=30d&today=2026-09-21`);
    fetchMock.mockClear();
    expect((await proxyTools(stats("/api/backend/tools/stats?period=all&admin=1"), page)).status).toBe(400);
    expect((await proxyTools(request("POST", "/api/backend/tools/stats", {}, "{}"), page)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("tools proxy — News Calendar", () => {
  const page = { operation: "news-calendar" } as const;
  const save = { operation: "news-plan-save" } as const;

  it("forwards no query, or exactly one day as two instants, rebuilt", () => {
    const query = (raw: string) => resolveToolsQuery(page, new URLSearchParams(raw));
    expect(query("")).toBe("");
    expect(query("from=2026-09-20T22:00:00.000Z&to=2026-09-21T22:00:00.000Z")).toBe(
      "?from=2026-09-20T22%3A00%3A00.000Z&to=2026-09-21T22%3A00%3A00.000Z",
    );
    for (const raw of [
      "from=2026-09-20T22:00:00.000Z",
      "to=2026-09-21T22:00:00.000Z",
      "from=2026-09-20&to=2026-09-21",
      "from=2026-09-20T22:00:00Z&to=2026-09-21T22:00:00Z",
      "from=2026-09-20T22:00:00.000Z&to=2026-09-21T22:00:00.000Z&userId=7",
      "from=2026-09-20T22:00:00.000Z&from=2026-09-20T23:00:00.000Z&to=2026-09-21T22:00:00.000Z",
    ]) {
      expect(query(raw), raw).toBeNull();
    }
    expect(resolveToolsQuery(save, new URLSearchParams("x=1"))).toBeNull();
  });

  it("reads with GET and saves with POST on the one constant path, and refuses anything else", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => backendJson({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    expect(resolveToolsTargetPath(page)).toBe("/api/tools/news-calendar");
    expect(resolveToolsTargetPath(save)).toBe("/api/tools/news-calendar");
    await proxyTools(request("GET", "/api/backend/tools/news-calendar", { cookie: "s=1" }), page);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${ORIGIN}/api/tools/news-calendar`);
    fetchMock.mockClear();
    expect((await proxyTools(request("GET", "/api/backend/tools/news-calendar?day=today", { cookie: "s=1" }), page)).status).toBe(400);
    expect((await proxyTools(request("PATCH", "/api/backend/tools/news-calendar", {}, "{}"), save)).status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
