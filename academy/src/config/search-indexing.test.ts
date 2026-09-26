import { describe, expect, it } from "vitest";
import { indexableRobots, isIndexablePath, parsePublicOrigin, resolveSearchIndexing } from "./search-indexing";

describe("search indexing", () => {
  it("is off unless switched on with a valid https origin", () => {
    expect(resolveSearchIndexing({})).toEqual({ enabled: false, origin: null });
    expect(resolveSearchIndexing({ ACADEMY_SEARCH_INDEXING: "on" })).toEqual({ enabled: false, origin: null });
    expect(resolveSearchIndexing({ ACADEMY_SEARCH_INDEXING: "yes", ACADEMY_PUBLIC_ORIGIN: "https://alfatrade.media" }).enabled).toBe(false);
    expect(resolveSearchIndexing({ ACADEMY_SEARCH_INDEXING: " on ", ACADEMY_PUBLIC_ORIGIN: "https://alfatrade.media/" })).toEqual({
      enabled: true,
      origin: "https://alfatrade.media",
    });
  });

  it("accepts only a bare https origin", () => {
    expect(parsePublicOrigin("https://alfatrade.media")).toBe("https://alfatrade.media");
    expect(parsePublicOrigin("http://alfatrade.media")).toBeNull();
    expect(parsePublicOrigin("https://alfatrade.media/ru")).toBeNull();
    expect(parsePublicOrigin("https://alfatrade.media/?x=1")).toBeNull();
    expect(parsePublicOrigin("https://user:pw@alfatrade.media")).toBeNull();
    expect(parsePublicOrigin("alfatrade.media")).toBeNull();
    expect(parsePublicOrigin(undefined)).toBeNull();
  });

  it("names exactly the home as indexable — the news are product content (DD-326)", () => {
    expect(isIndexablePath("/")).toBe(true);
    for (const path of ["/news", "/news/ssha-bazovyy-ipts-2026-09-21", "/login", "/register", "/home", "/tools/news", "/news/", "/news/a/b", "/newsletter"]) {
      expect(isIndexablePath(path), path).toBe(false);
    }
  });

  it("gives an indexable page index only where indexing is on", () => {
    expect(indexableRobots({ enabled: true, origin: "https://alfatrade.media" })).toEqual({ index: true, follow: true });
    expect(indexableRobots({ enabled: false, origin: null })).toEqual({ index: false, follow: false });
  });
});
