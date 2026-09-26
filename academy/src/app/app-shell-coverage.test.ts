/**
 * EVERY authenticated page renders the app shell.
 *
 * WHY THIS EXISTS. `(app)/layout.tsx` guards the session but does NOT render the
 * navigation — each page composes `<AppShell>` itself. That is easy to forget,
 * it compiles, it renders perfectly, and the result is a page with no way back
 * to anything: no sidebar, no bottom bar, no bell, no avatar.
 *
 * COMMUNITY-V1 shipped exactly that defect to PREPROD and it was caught by
 * opening the page in a browser, not by any test — `/community` returned 200
 * with ZERO `<nav>` elements while `/`, `/support` and `/tools` each returned
 * two. The nav entry that had just been switched on was invisible, because the
 * shell that draws it was not on the page that needed it.
 *
 * This is the cheap structural guard that would have caught it, and it is the
 * same idea as `built-routes.ts`: one place that says what is true, checked
 * rather than remembered.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.join(process.cwd(), "src/app/(app)");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

const SRC = path.join(process.cwd(), "src");

/**
 * Resolve the `@/...` modules a file imports, one level deep.
 *
 * A page may render the shell itself, or it may delegate to a single feature
 * screen that does — `/lessons/[levelCode]/material` legitimately does the
 * latter, because the reader owns its own empty and error states inside the
 * shell. What must never happen is that NEITHER does.
 */
function importedSources(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/from "@\/([^"]+)"/g)) {
    for (const ext of [".tsx", ".ts"]) {
      const candidate = path.join(SRC, `${match[1]}${ext}`);
      if (existsSync(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

function rendersShell(text: string): boolean {
  return text.includes('from "@/components/shell/app-shell"') && /<AppShell\b/.test(text);
}

const PAGES = pages(APP_DIR).map((file) => {
  const text = readFileSync(file, "utf8");
  const delegates = importedSources(text).map((f) => readFileSync(f, "utf8"));
  return {
    file: path.relative(process.cwd(), file),
    text,
    shellSomewhere: rendersShell(text) || delegates.some(rendersShell),
    activeIdSomewhere:
      /activeId="[a-z-]+"/.test(text) || delegates.some((d) => /activeId="[a-z-]+"/.test(d)),
  };
});

describe("app shell coverage", () => {
  it("finds the authenticated pages", () => {
    // A sanity check on the walker itself: if this ever drops to zero the whole
    // suite below would pass vacuously.
    expect(PAGES.length).toBeGreaterThanOrEqual(8);
  });

  for (const page of PAGES) {
    it(`${page.file} renders AppShell, directly or through its screen`, () => {
      expect(
        page.shellSomewhere,
        `${page.file} renders no AppShell — the learner would have no navigation at all`,
      ).toBe(true);
    });

    it(`${page.file} passes an activeId`, () => {
      expect(page.activeIdSomewhere, `${page.file} must set activeId`).toBe(true);
    });
  }
});
