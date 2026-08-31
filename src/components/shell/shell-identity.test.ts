/**
 * SHELL-VIEWER-IDENTITY-2 — the shell says who is actually looking.
 *
 * Eleven authenticated shells passed `userName="Артём"`. All eleven sat in
 * fixture-mode branches behind `mode === "api"`, so PREPROD never rendered a
 * stranger's name — the settled accessible name was already `atalerntest` on
 * every authenticated route, which is what makes this a latent trap rather than
 * a live defect. But a fixture name is not a fallback. A surface that cannot
 * know who is looking has one thing to say, «Ученик», and it claims nothing.
 *
 * The route-level `loading.tsx` and `error.tsx` shells are the deliberate
 * exception and are asserted as such below: a suspense fallback renders before
 * anything is awaited, and an error boundary is a client component. Neither can
 * consult the server viewer. This is why `/home` streams «Ученик» first and
 * then the real name — the only route with a loading boundary, and correct.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** Every `<AppShell …>` opening tag in the source, with the file it sits in. */
function shells(): Array<{ file: string; tag: string }> {
  const found: Array<{ file: string; tag: string }> = [];
  for (const file of tsxFiles(join(ROOT, "src"))) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<AppShell\b[^>]*>/g)) {
      found.push({ file: relative(ROOT, file), tag: m[0].replace(/\s+/g, " ") });
    }
  }
  return found;
}

/** The two boundaries that cannot read a server viewer, and why. */
const CANNOT_READ_THE_VIEWER = [
  "src/app/(app)/home/loading.tsx",   // suspense fallback: renders before any await
  "src/app/(app)/home/error.tsx",     // "use client": no server data here
];

describe("the shell's name comes from the viewer", () => {
  const all = shells();

  it("finds the shells, so a silent parse failure cannot pass this", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("names no person anywhere in the source", () => {
    // The fixture learner. Any literal name in a shell is the bug this pins.
    const named = all.filter((s) => /userName="[^"{]/.test(s.tag));
    const offenders = named
      .filter((s) => !CANNOT_READ_THE_VIEWER.includes(s.file))
      .map((s) => `${s.file}  ${s.tag.slice(0, 90)}`);
    expect(offenders, "a shell must read the viewer, not a literal").toEqual([]);
  });

  it("allows a literal only in the two boundaries that cannot await, and only the neutral one", () => {
    for (const f of CANNOT_READ_THE_VIEWER) {
      const here = all.filter((s) => s.file === f);
      expect(here.length, `${f} should still render a shell`).toBeGreaterThan(0);
      for (const s of here) {
        // Neutral, and never a person's name.
        expect(s.tag, f).toContain('userName="Ученик"');
      }
    }
  });

  it("keeps the exception list honest — every entry must still exist and still be a boundary", () => {
    for (const f of CANNOT_READ_THE_VIEWER) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const isBoundary = f.endsWith("loading.tsx") || src.includes('"use client"');
      expect(isBoundary, `${f} is listed as unable to read the viewer; it must be a loading or client boundary`).toBe(true);
    }
  });
});

describe("the shell's unread presence is not route-dependent", () => {
  /* One viewer must get the same shell everywhere. The presence indicator
     renders nothing when there is nothing unread, so a route that never passes
     it looks identical for most learners and differs only for the ones who have
     unread notifications — the hardest kind of divergence to notice.
     `/lessons/[levelCode]` was such a route, and is now fixed.

     The exceptions below are every shell this rule does NOT apply to, each with
     the reason it does not. None of them is silent. */
  const EXEMPT: Array<{ file: string; why: string }> = [
    { file: "src/app/(app)/home/page.tsx", why: "fixture-mode branch behind mode === 'api'; the prototype has no notification authority" },
    { file: "src/app/(app)/path/page.tsx", why: "fixture-mode branch behind mode === 'api'; unreachable on PREPROD" },
    { file: "src/app/(app)/lessons/page.tsx", why: "fixture-mode branch behind mode === 'api'; unreachable on PREPROD" },
    { file: "src/app/(app)/lessons/[levelCode]/page.tsx", why: "fixture-mode branches behind mode === 'api'; unreachable on PREPROD" },
    { file: "src/features/academy-experience/home-screen.tsx", why: "no non-test importer: superseded by auth-home-fidelity" },
    { file: "src/features/academy-experience/lessons-screen.tsx", why: "no non-test importer: superseded by lessons-fidelity" },
    { file: "src/features/academy-experience/path-screen.tsx", why: "no non-test importer: superseded by path-fidelity" },
    { file: "src/features/curriculum-api/api-screens.tsx", why: "no non-test importer anywhere in src; unreachable from any route" },
    { file: "src/features/curriculum-api/api-level-detail.tsx", why: "no non-test importer anywhere in src; unreachable from any route" },
    { file: "src/app/(app)/support/page.tsx", why: "REACHABLE and diverging — recorded as SHELL-UNREAD-PRESENCE-SUPPORT-1. Support is an accepted surface; adding the mark changes what a learner with unread notifications sees there, which is the owner's call, not this phase's" },
    { file: "src/app/(app)/community/page.tsx", why: "Community is hidden by product decision; its shells are frozen with it" },
    { file: "src/app/(app)/community/[spaceCode]/page.tsx", why: "Community is hidden by product decision" },
    { file: "src/app/(app)/community/d/[discussionId]/page.tsx", why: "Community is hidden by product decision" },
  ];

  const all = shells().filter(
    (s) => !CANNOT_READ_THE_VIEWER.includes(s.file) && /userName=\{/.test(s.tag),
  );

  it("passes notificationPresence from every reachable viewer-aware shell", () => {
    const missing = all
      .filter((s) => !EXEMPT.some((e) => e.file === s.file))
      .filter((s) => !s.tag.includes("notificationPresence"))
      .map((s) => `${s.file}  ${s.tag.slice(0, 80)}`);
    expect(missing, "these shells know the viewer but withhold the unread mark").toEqual([]);
  });

  it("carries no stale exemption", () => {
    const files = new Set(all.map((s) => s.file));
    const stale = EXEMPT.filter((e) => !files.has(e.file)).map((e) => e.file);
    expect(stale, "an exemption for a shell that no longer exists hides the next one").toEqual([]);
  });

  it("gives every exemption a reason", () => {
    for (const e of EXEMPT) expect(e.why.length, e.file).toBeGreaterThan(20);
  });
});

/* The fallback now lives in exactly one place, which makes that one place the
   thing to guard. A mutation battery caught this: changing «Ученик» to a person's
   name inside shellViewerName() passed every assertion above, because they all
   read JSX and none of them read the authority. So this one runs it. */
describe("the neutral fallback, executed rather than read", () => {
  it("returns «Ученик» when there is no viewer", async () => {
    const { shellViewerName } = await import("@/server/auth/server-session");
    // Outside api mode getServerViewer() resolves null without touching cookies,
    // which is exactly the "cannot know who is looking" case.
    await expect(shellViewerName()).resolves.toBe("Ученик");
  });

  it("names no person in the authority itself", () => {
    const src = readFileSync(join(ROOT, "src/server/auth/server-session.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain('?? "Ученик"');
    expect(code).not.toMatch(/"Артём"/);
  });
});
