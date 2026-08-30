/**
 * AUTHENTICATED-NAVIGATION-FULL-LOAD-1 — the four confirmed bare anchors.
 *
 * A `<Link>` and a bare `<a>` render the same element, so nothing on the page
 * looks different — but only the first is handled by the router. Measured on
 * the live release: clicking the Lessons row produced a new document, a fired
 * `pagehide`, a changed `performance.timeOrigin` and a full asset reload, while
 * the shell's own links produced an `?_rsc=` request and none of those.
 *
 * These four transitions are now `next/link`. The cases below fail if any of
 * them goes back to a bare anchor, and equally if the swap changed anything a
 * learner can see: the tag stays `a`, the href, class, accessible name and
 * position stay exactly as they were.
 *
 * THE REST OF THE SWEEP IS NOT FIXED HERE. Roughly two dozen internal-route
 * anchors elsewhere are still bare; they are recorded in the report, and this
 * file deliberately does not pin them, because pinning a rule nobody has
 * authorised would fail the next honest build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** The four sites the owner authorised, with the transition each one makes. */
const SITES = [
  ["src/features/lessons-fidelity/lessons-corpus.tsx", "material__open", "Lessons row → Level Detail"],
  ["src/features/reader-fidelity/reader-body.tsx", '<Link href="/path">Открыть путь</Link>', "Reader → /path"],
  ["src/features/profile-fidelity/profile-fidelity.tsx", 'data-role="support-link"', "Profile → /support"],
  ["src/features/academy-experience/level-detail-screen.tsx", '<Link href="/path">Вернуться к пути</Link>', "Level Detail → /path"],
] as const;

function src(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("the four confirmed transitions use the router", () => {
  it.each(SITES)("%s imports next/link", (path) => {
    expect(src(path)).toMatch(/^import Link from "next\/link";$/m);
  });

  it("Lessons row → Level Detail is a Link, and keeps its class and label", () => {
    const s = src(SITES[0][0]);
    expect(s).toContain('<Link className="material__open" href={material.href} aria-labelledby={titleId}>');
    expect(s).not.toContain('<a className="material__open"');
    // The element still closes as a Link, with the same two spans inside.
    expect(s).toMatch(/<Link className="material__open"[\s\S]*?material__title[\s\S]*?material__aff[\s\S]*?<\/Link>/);
  });

  it("Reader → /path is a Link, with the same words", () => {
    const s = src(SITES[1][0]);
    expect(s).toContain('<Link href="/path">Открыть путь</Link>');
    expect(s).not.toContain('<a href="/path">');
  });

  it("Profile → /support is a Link, with its data-role intact", () => {
    const s = src(SITES[2][0]);
    expect(s).toContain('<Link href="/support" data-role="support-link">');
    expect(s).not.toContain('<a href="/support"');
  });

  it("Level Detail → /path is a Link, with the same words", () => {
    const s = src(SITES[3][0]);
    expect(s).toContain('<Link href="/path">Вернуться к пути</Link>');
    expect(s).not.toContain('<a href="/path">');
  });
});

describe("the swap changed the handler and nothing else", () => {
  it("introduces no router.push, location assignment or click interception", () => {
    for (const [path] of SITES) {
      const s = src(path);
      expect(s, path).not.toMatch(/window\.location|location\.(href|assign|replace)/);
      expect(s, path).not.toMatch(/addEventListener\(\s*["']click["']/);
      // `useRouter` predates this change on Profile and is used for a refresh,
      // not for navigation — so it may exist, but never as a link handler.
      expect(s, path).not.toMatch(/onClick=\{[^}]*router\.push/);
    }
  });

  it("adds no timeout and no loading UI", () => {
    for (const [path] of SITES) {
      const s = src(path);
      expect(s, path).not.toMatch(/setTimeout\s*\([^)]*\b\d{3,}\b/);
      expect(s, path).not.toMatch(/ax-skel|className="ax"|aria-label="Загрузка"/);
    }
  });

  it("keeps every other internal anchor exactly as it was", () => {
    /* The authorisation was for four sites. If a later change quietly converts
       others, the count moves and this fails — which is the point: the rest of
       the sweep is a separate decision, not a silent follow-on. */
    const s = src(SITES[1][0]);
    /* reader-body still has its unclassed `levelHref` anchors (2) plus the two
       classed ones, and its in-page fragment links, all untouched. */
    expect((s.match(/<a href=\{levelHref\}/g) ?? []).length).toBe(2);
    expect(s).toContain('<a className="boundary__act" href={levelHref}>');
    const ld = src(SITES[3][0]);
    expect((ld.match(/<a href=\{`\/lessons\//g) ?? []).length).toBe(2);
  });

  it("leaves the route-group loading boundary absent", () => {
    // The previous phase removed it; this one must not bring it back.
    expect(() => readFileSync(join(ROOT, "src/app/(app)/loading.tsx"), "utf8")).toThrow();
  });
});
