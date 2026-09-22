import { afterEach, describe, expect, it } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";

const saved = { indexing: process.env.ACADEMY_SEARCH_INDEXING, origin: process.env.ACADEMY_PUBLIC_ORIGIN };
afterEach(() => {
  process.env.ACADEMY_SEARCH_INDEXING = saved.indexing;
  process.env.ACADEMY_PUBLIC_ORIGIN = saved.origin;
});

describe("robots.txt and the sitemap — PREPROD indexes nothing", () => {
  it("lets crawlers in, names no sitemap and lists nothing when indexing is off", async () => {
    delete process.env.ACADEMY_SEARCH_INDEXING;
    delete process.env.ACADEMY_PUBLIC_ORIGIN;
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
    expect(await sitemap()).toEqual([]);
  });
});

describe("robots.txt and the sitemap — production indexes the home only", () => {
  it("names the sitemap and keeps crawlers off the API", () => {
    process.env.ACADEMY_SEARCH_INDEXING = "on";
    process.env.ACADEMY_PUBLIC_ORIGIN = "https://alfatrade.media";
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://alfatrade.media/sitemap.xml",
      host: "https://alfatrade.media",
    });
  });

  it("lists the home and nothing else — the news are never listed (DD-326)", async () => {
    process.env.ACADEMY_SEARCH_INDEXING = "on";
    process.env.ACADEMY_PUBLIC_ORIGIN = "https://alfatrade.media";
    const entries = await sitemap();
    expect(entries.map((entry) => entry.url)).toEqual(["https://alfatrade.media/"]);
  });
});
