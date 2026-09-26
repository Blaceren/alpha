import { afterEach, describe, expect, it, vi } from "vitest";

const csrf = vi.hoisted(() => ({ headers: { "x-csrf-token": "token-1" } as Record<string, string> }));
vi.mock("@/application/api/auth-client", () => ({ csrfHeaders: async () => csrf.headers }));

import { createNewsItem, fetchNewsList, setNewsItemStatus, updateNewsItem, type NewsForm } from "./news-client";

const FORM: NewsForm = {
  title: "Базовый индекс потребительских цен, м/м",
  summary: "Инфляция без еды и энергии за август: рынок ждёт 0.3%.",
  body: "",
  country: "US",
  importance: 3,
  releaseDate: "2026-09-21",
  releaseTime: "14:30",
  timeZone: "Europe/Warsaw",
  forecast: "0.3%",
  previous: "",
  actual: "",
  sourceName: "",
  sourceUrl: "",
};

const ITEM = {
  id: "clnews0000000000000000001",
  slug: "ssha-bazovyy-2026-09-21",
  title: FORM.title,
  summary: FORM.summary,
  body: "",
  country: "US",
  countryLabel: "США",
  currency: "USD",
  importance: 3,
  releaseAt: "2026-09-21T12:30:00.000Z",
  forecast: "0.3%",
  previous: null,
  actual: null,
  sourceName: null,
  sourceUrl: null,
  status: "draft",
  slugLocked: false,
  publishedAt: null,
  publicUrl: null,
  createdAt: "2026-09-21T10:00:00.000Z",
  updatedAt: "2026-09-21T10:00:00.000Z",
};

const REFERENCE = {
  countries: [{ code: "US", label: "США", currency: "USD" }],
  currencies: ["USD"],
  importance: [{ value: 3, label: "Высокая" }],
};

function reply(status: number, body: unknown) {
  return vi.fn(
    async (_path: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

afterEach(() => {
  csrf.headers = { "x-csrf-token": "token-1" };
});

describe("news client", () => {
  it("reads a page of the list, with the filter and page in the query", async () => {
    const fetchImpl = reply(200, { data: { items: [ITEM], total: 1, page: 1, pageCount: 1, reference: REFERENCE } });
    const outcome = await fetchNewsList({ status: "draft", page: 2 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.status).toBe("success");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/crm/v1/news?status=draft&page=2");
  });

  it("refuses to render a body with a field it does not know", async () => {
    const fetchImpl = reply(200, { data: { items: [{ ...ITEM, clicks: 5 }], total: 1, page: 1, pageCount: 1, reference: REFERENCE } });
    const outcome = await fetchNewsList({ status: "all", page: 1 }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.status).toBe("malformed_response");
  });

  it("sends the form with the CSRF header, and never without it", async () => {
    const fetchImpl = reply(201, { data: { item: ITEM } });
    const outcome = await createNewsItem(FORM, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.status).toBe("success");
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("token-1");
    expect(JSON.parse(String(init.body))).toEqual({ item: FORM });

    csrf.headers = {};
    const unsent = reply(201, { data: { item: ITEM } });
    expect(await createNewsItem(FORM, { fetchImpl: unsent as unknown as typeof fetch })).toEqual({
      status: "forbidden",
      reason: "csrf",
    });
    expect(unsent).not.toHaveBeenCalled();
  });

  it("maps every refusal to a closed outcome", async () => {
    const run = (status: number, body: unknown) =>
      updateNewsItem("abc", FORM, ITEM.updatedAt, { fetchImpl: reply(status, body) as unknown as typeof fetch });
    expect(await run(400, { error: "NEWS_VALIDATION", detail: "invalid_title", requestId: "r1" })).toEqual({
      status: "invalid_input",
      detail: "invalid_title",
      requestId: "r1",
    });
    expect((await run(409, { error: "NEWS_STALE" })).status).toBe("stale");
    expect(await run(403, { code: "unauthorized", messageKey: "crm.news.forbidden" })).toEqual({
      status: "forbidden",
      reason: "no_permission",
    });
    expect(await run(403, { code: "unauthorized", messageKey: "crm.news.csrf_invalid" })).toEqual({
      status: "forbidden",
      reason: "csrf",
    });
    expect((await run(401, { code: "unauthorized" })).status).toBe("unauthenticated");
    expect((await run(404, { error: "NEWS_NOT_FOUND" })).status).toBe("not_found");
    expect((await run(429, {})).status).toBe("rate_limited");
    expect((await run(502, {})).status).toBe("upstream_unavailable");
  });

  it("publishes through the status path with the version it read", async () => {
    const fetchImpl = reply(200, { data: { item: { ...ITEM, status: "published" }, changed: true } });
    const outcome = await setNewsItemStatus("a/b", "published", ITEM.updatedAt, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(outcome.status).toBe("success");
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/api/crm/v1/news/a%2Fb/status");
    expect(JSON.parse(String(init.body))).toEqual({ status: "published", expectedUpdatedAt: ITEM.updatedAt });
  });
});
