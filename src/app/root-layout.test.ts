import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE ROOT LAYOUT'S CONTRACT.
 *
 * Until 2026-10-02 the root layout was frozen by the identity guard
 * (`navigation-transition.test.ts`): it rendered `<html lang="ru">`, a body
 * with three classes, the page — and nothing else. The owner's Back-button bug
 * needed one thing mounted beside every page, so the freeze was lifted there
 * and replaced by this file, which says exactly what the layout may hold.
 *
 * Read from the source, as the guard reads it: the layout renders `<html>` and
 * `<body>`, which a component test cannot mount inside a document of its own.
 */
const ROOT = process.cwd();
const source = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");
/** The source without its comments: what the compiler sees. */
const code = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rendered = code.slice(code.indexOf("return ("));

describe("the root layout", () => {
  it("is the Russian document with the accepted body, as before", () => {
    expect(rendered).toMatch(/<html lang="ru">/);
    expect(rendered).toMatch(/<body className="font-ui text-ink antialiased">/);
  });

  it("holds the page and ONE thing beside it — the history sync, which draws nothing", () => {
    // Everything between <body …> and </body>, without whitespace.
    const body = /<body[^>]*>([\s\S]*?)<\/body>/.exec(rendered)?.[1]?.replace(/\s+/g, "") ?? "";
    expect(body).toBe("<Suspensefallback={null}><HistoryEntrySync/></Suspense>{children}");
  });

  it("puts the sync before the page, behind a boundary, so a prerendered page stays prerendered", () => {
    /* The sync reads the query string. Outside a boundary that would opt every
       prerendered page out of prerendering; inside one, only the sync itself
       waits for the browser — and it renders nothing either way. */
    expect(rendered.indexOf("<HistoryEntrySync />")).toBeGreaterThan(rendered.indexOf("<Suspense fallback={null}>"));
    expect(rendered.indexOf("{children}")).toBeGreaterThan(rendered.indexOf("</Suspense>"));
    const sync = readFileSync(join(ROOT, "src/components/navigation/history-entry-sync.tsx"), "utf8");
    expect(sync.startsWith('"use client";')).toBe(true);
    expect(sync).toMatch(/useSearchParams\(\)/);
    expect(sync).toMatch(/return null;\s*\}\s*$/);
  });

  it("imports its two stylesheets, the boundary and the sync — and nothing else", () => {
    const imports = Array.from(code.matchAll(/^import\s+(?:type\s+)?(?:[^"']+from\s+)?["']([^"']+)["'];?$/gm)).map((m) => m[1]);
    expect(imports.sort()).toEqual(
      ["@/components/navigation/history-entry-sync", "@/styles/fonts.css", "@/styles/globals.css", "next", "react"].sort(),
    );
  });

  it("declares the same metadata and viewport as before", () => {
    expect(code).toMatch(/title: "Alpha Trade Academy"/);
    expect(code).toMatch(/icons: \{ icon: \[\{ url: "\/brand\/favicon\.svg", type: "image\/svg\+xml" \}\] \}/);
    expect(code).toMatch(/themeColor: "#0b0d0a"/);
    expect(code).toMatch(/width: "device-width"/);
    expect(code).toMatch(/initialScale: 1/);
  });
});

/**
 * WHAT THE FIX STANDS ON, IN THE FRAMEWORK ITSELF.
 *
 * The sync is thirty lines because the framework does the work: it documents
 * that `history.replaceState` is taken into its router, and its router then
 * writes its own state into the entry. Neither half is ours, and a unit test of
 * the sync cannot see either. These lines read the installed framework and say
 * so the day an upgrade moves them — which is the day to run the browser check
 * again (`design-memory/reviews/back-after-anchor-review.md`), not the day a
 * learner presses Back.
 */
describe("the framework still does its half", () => {
  const dist = join(ROOT, "node_modules/next/dist/client/components");
  const router = join(dist, "app-router.js");
  const restore = join(dist, "router-reducer/reducers/restore-reducer.js");

  it("is where it was", () => {
    expect(existsSync(router), "next/dist/client/components/app-router.js").toBe(true);
    expect(existsSync(restore), "next/dist/client/components/router-reducer/reducers/restore-reducer.js").toBe(true);
  });

  it("ignores Back to an entry without a state — the bug, as the framework has it", () => {
    const text = readFileSync(router, "utf8");
    // `if (!event.state) { … return; }` at the top of its popstate handler.
    expect(text).toMatch(/const onPopState = \(event\)=>\{\s*if \(!event\.state\) \{[\s\S]{0,400}?return;\s*\}/);
  });

  it("takes a replaceState into the router, and stamps the entry with the router's state", () => {
    const text = readFileSync(router, "utf8");
    // The wrapper around the browser's replaceState tells the router the new address…
    expect(text).toMatch(/window\.history\.replaceState = function replaceState\(data, _unused, url\) \{[\s\S]{0,500}?applyUrlFromHistoryPushReplace\(url\)/);
    expect(text).toMatch(/const applyUrlFromHistoryPushReplace = \(url\)=>\{[\s\S]{0,700}?ACTION_RESTORE/);
    // …and the router's own effect then writes its state into the current entry.
    expect(text).toMatch(/__NA: true,\s*__PRIVATE_NEXTJS_INTERNALS_TREE: appHistoryState/);
    expect(text).toMatch(/window\.history\.replaceState\(historyState, '', canonicalUrl\)/);
  });

  it("keeps the page that is on screen when the entry had no state to restore from", () => {
    const text = readFileSync(restore, "utf8");
    // «…if the user navigated to a hash using a regular anchor link, the history
    // state will not contain the FlightRouterState. In this case, we'll continue
    // to use the existing tree…»
    expect(text).toMatch(/if \(historyState\) \{[\s\S]{0,200}?\} else \{\s*treeToRestore = state\.tree;/);
  });
});
