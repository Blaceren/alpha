/**
 * NAVIGATION TRANSITION — the shell does not blink out between pages.
 *
 * WHAT WAS THERE. `(app)/loading.tsx` was a route-group Suspense boundary that
 * rendered `.ax[aria-label="Загрузка"]` — the legacy navy/cyan field with five
 * skeleton blocks — and rendered NO AppShell. Measured on the release this
 * branch starts from, a `/home → /tools` click showed it from 93ms to 561ms
 * with the shell entirely absent for every one of those frames.
 *
 * WHY IT COULD NOT BE FIXED IN PLACE. The shell is PAGE-LEVEL authority: every
 * page passes its own `userName`, `activeId`, `notificationPresence` and
 * `frozenSurface`, and `(app)/layout.tsx` renders only the session provider. A
 * group-level fallback therefore cannot contain the real shell — it could only
 * contain a second one built from invented values, which is the one thing a
 * loading state must never do.
 *
 * WHAT REPLACES IT. Nothing. Without a boundary the App Router holds the
 * current page — its shell included — until the next segment is ready, then
 * commits in one step. `/home` keeps its OWN loading boundary, which is
 * shell-preserving by construction and stays exactly as accepted.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const GROUP = "src/app/(app)";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}

describe("the authenticated route group", () => {
  it("has no group-level loading boundary to replace the shell with", () => {
    expect(existsSync(join(ROOT, GROUP, "loading.tsx"))).toBe(false);
  });

  it("keeps Home's own boundary, which carries the real shell", () => {
    const home = join(ROOT, GROUP, "home/loading.tsx");
    expect(existsSync(home)).toBe(true);
    const src = readFileSync(home, "utf8");
    // It renders the shell itself, so navigation never disappears on that route.
    expect(src).toContain("AppShell");
    expect(src).toContain('activeId="home"');
    // And it carries no AX field or skeleton.
    expect(src).not.toMatch(/ax-skel|ax-field|className="ax"/);
  });

  it("has no other loading boundary anywhere under the group", () => {
    const found = git("ls-files", "--", `${GROUP}/**/loading.tsx`, `${GROUP}/loading.tsx`)
      .split("\n").filter(Boolean);
    expect(found).toEqual([`${GROUP}/home/loading.tsx`]);
  });

  it("leaves no reachable loading frame carrying the legacy AX field", () => {
    /* `.ax` still belongs to error, not-found and several real screens, so the
       stylesheet is untouched. What must not exist is a LOADING surface built
       from it. */
    const loaders = git("ls-files", "--", "src/app/**/loading.tsx").split("\n").filter(Boolean);
    for (const f of loaders) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/ax-skel/);
      expect(src, f).not.toMatch(/className="ax"/);
      expect(src, f).not.toMatch(/aria-label="Загрузка"/);
    }
  });

  it("adds no artificial delay anywhere in the app shell or routes", () => {
    const files = git("ls-files", "--", "src/app", "src/components/shell").split("\n").filter(Boolean);
    for (const f of files) {
      if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/setTimeout\s*\([^)]*\b(1\d\d|[2-9]\d\d|\d{4,})\b/);
      expect(src, f).not.toMatch(/minimum(Duration|Loading)|artificialDelay/i);
    }
  });

  it("changed nothing but that one boundary", () => {
    const BASE = "1f0575cbc53dd5f373cf2c6c2f1a64230127c5c4";
    const changed = git("diff", "--name-only", BASE, "--", "src/")
      .split("\n").filter(Boolean)
      .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
    expect(changed).toEqual([`${GROUP}/loading.tsx`]);
  });

  it("leaves every accepted surface body untouched", () => {
    const BASE = "1f0575cbc53dd5f373cf2c6c2f1a64230127c5c4";
    const changed = git("diff", "--name-only", BASE, "--", "src/").split("\n").filter(Boolean);
    for (const prefix of [
      "src/features/home", "src/features/path-fidelity", "src/features/lessons",
      "src/features/level-detail-fidelity", "src/features/reader-fidelity",
      "src/features/workspace", "src/features/tools", "src/features/tools-fidelity",
      "src/features/support", "src/features/notifications", "src/features/profile",
      "src/features/auth", "src/components/shell", "src/features/academy-experience",
      "src/config/feature-visibility.ts", "src/app/layout.tsx",
    ]) {
      expect(changed.filter((f) => f.startsWith(prefix)), prefix).toEqual([]);
    }
  });
});
