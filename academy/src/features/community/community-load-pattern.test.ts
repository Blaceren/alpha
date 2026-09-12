/**
 * COMMUNITY-V1 — the read effect must not abort its own load.
 *
 * WHAT HAPPENED. The three Community surfaces created an `AbortController` per
 * effect and aborted it on cleanup, guarding the response with a `cancelled`
 * flag. When React runs an effect, cleans it up and settles — which the App
 * Router does — the abort lands on the read whose `.then` is then skipped
 * because `cancelled` is true. Nothing sets state, nothing errors, and the
 * surface sits on its skeleton forever.
 *
 * It was intermittent, which is why it survived a full desktop acceptance, 1663
 * unit tests and a production build. It was caught at a real 320px viewport by
 * an A/B in one browser tab: `/support` — which uses the pattern this test
 * pins — loaded its client-fetched list, and `/community` seconds later did
 * not.
 *
 * WHY A SOURCE TEST. The failure needs a mount/cleanup/settle interleaving that
 * jsdom does not reproduce on demand, so a behavioural test would pass against
 * the broken code. What is checkable, and what actually went wrong, is the
 * PATTERN: no Community read effect may hold an abort signal.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMMUNITY = path.join(process.cwd(), "src/features/community/components");
const SUPPORT = path.join(process.cwd(), "src/features/support/components/support-hub.tsx");

const files = readdirSync(COMMUNITY)
  .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
  .map((name) => ({ file: name, text: readFileSync(path.join(COMMUNITY, name), "utf8") }));

describe("Community read effects", () => {
  it("finds the Community components", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const { file, text } of files) {
    it(`${file} creates no AbortController`, () => {
      const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(code, `${file} must not abort its own read`).not.toContain("AbortController");
      expect(code, `${file} must not abort its own read`).not.toContain(".abort()");
    });

    it(`${file} guards stale responses with a cancelled flag`, () => {
      if (!text.includes("useEffect")) return;
      // The guard must still exist — removing the abort must not have removed
      // the protection against a late response from a previous render.
      expect(text, `${file} must keep the cancelled guard`).toContain("cancelled");
    });
  }

  it("matches the pattern the accepted Support surface uses", () => {
    const support = readFileSync(SUPPORT, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    // If Support ever adopts an abort signal this test should be revisited
    // deliberately rather than silently diverging.
    expect(support).not.toContain("AbortController");
    expect(support).toContain("cancelled");
  });
});
