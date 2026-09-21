import { afterEach, describe, expect, it, vi } from "vitest";

const readNewsSitemap = vi.fn();
vi.mock("@/server/news/public-news-read", () => ({ readNewsSitemap: () => readNewsSitemap() }));

import robots from "./robots";
import sitemap from "./sitemap";

const saved = { indexing: process.env.ACADEMY_SEARCH_INDEXING, origin: process.env.ACADEMY_PUBLIC_ORIGIN };
afterEach(() => {
  process.env.ACADEMY_SEARCH_INDEXING = saved.indexing;
  process.env.ACADEMY_PUBLIC_ORIGIN = saved.origin;
  readNewsSitemap.mockReset();
});

describe("robots.txt and the sitemap — PREPROD indexes nothing", () => {
  it("lets crawlers in, names no sitemap and lists nothing when indexing is off", async () => {
    delete process.env.ACADEMY_SEARCH_INDEXING;
    delete process.env.ACADEMY_PUBLIC_ORIGIN;
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
    expect(await sitemap()).toEqual([]);
    expect(readNewsSitemap).not.toHaveBeenCalled();
  });
});

describe("robots.txt and the sitemap — production indexes the home and the news", () => {
  it("names the sitemap and keeps crawlers off the API", () => {
    process.env.ACADEMY_SEARCH_INDEXING = "on";
    process.env.ACADEMY_PUBLIC_ORIGIN = "https://alfatrade.media";
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://alfatrade.media/sitemap.xml",
      host: "https://alfatrade.media",
    });
  });

  it("lists the home, the news list and every published news page, and nothing else", async () => {
    process.env.ACADEMY_SEARCH_INDEXING = "on";
    process.env.ACADEMY_PUBLIC_ORIGIN = "https://alfatrade.media";
    readNewsSitemap.mockResolvedValue([{ slug: "ssha-ipts-2026-09-21", updatedAt: "2026-09-21T12:40:00.000Z" }]);
    const entries = await sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://alfatrade.media/",
      "https://alfatrade.media/news",
      "https://alfatrade.media/news/ssha-ipts-2026-09-21",
    ]);
    expect(entries[2]!.lastModified).toBe("2026-09-21T12:40:00.000Z");
  });
});
