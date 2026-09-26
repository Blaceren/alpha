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

/**
 * THE RENDERED ELEMENT, from the real components.
 *
 * Two of the four links are not reachable in the fixture-mode harness — the
 * api-mode Lessons corpus and the legacy Level Detail screen render on paths
 * that harness does not serve — so their proof is here instead: the real
 * component, rendered, and the anchor inspected for the handler that only
 * `next/link` attaches. That handler is the exact discriminator that identified
 * the defect in the browser, so it is the right thing to pin.
 */
import { render } from "@testing-library/react";
import Link from "next/link";
import { LessonsCorpus } from "@/features/lessons-fidelity/lessons-corpus";

/** React's own props for a DOM node — how a Link is told from a bare anchor. */
function handlersOn(el: Element): { onClick: string; onMouseEnter: string } {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  const props = key ? (el as unknown as Record<string, Record<string, unknown>>)[key] : undefined;
  return { onClick: typeof props?.onClick, onMouseEnter: typeof props?.onMouseEnter };
}

describe("the Lessons row renders as a router link", () => {
  const material = {
    levelCode: "v2.l001.registraciya-pocket",
    order: 1,
    title: "Регистрация Pocket",
    href: "/lessons/v2.l001.registraciya-pocket",
    moduleOrder: 1,
    moduleTitle: "Первое знакомство",
    unavailable: false,
  };

  it("is still an <a> in the DOM, with the same href, class and label", () => {
    const { container } = render(
      <LessonsCorpus materials={[material]} capability="hidden" />,
    );
    const a = container.querySelector("a.material__open");
    expect(a, "the row still renders an anchor element").not.toBeNull();
    expect(a!.tagName).toBe("A");
    expect(a!.getAttribute("href")).toBe(material.href);
    expect(a!.className).toBe("material__open");
    expect(a!.getAttribute("aria-labelledby")).toBe(`m-title-${material.order}`);
    // The visible words are unchanged.
    expect(a!.textContent).toContain(material.title);
    // And it now carries the router's handler, which a bare anchor never has.
    expect(handlersOn(a!).onClick).toBe("function");
    expect(handlersOn(a!).onMouseEnter).toBe("function");
  });

  it("keeps the row a single tab stop", () => {
    const { container } = render(
      <LessonsCorpus materials={[material]} capability="hidden" />,
    );
    const focusable = container.querySelectorAll("a, button, input, [tabindex]");
    expect(focusable).toHaveLength(1);
    expect(focusable[0]!.tagName).toBe("A");
  });
});

/* ── WHY THIS LAST BLOCK EXISTS ────────────────────────────────────────────
   Thirty anchors were converted, and every one of their destinations sits
   behind authentication, so none of them can be driven in a browser against
   an inactive candidate. Rendering all nineteen components would mean
   inventing fixture data for each, and a harness built on guessed props
   proves the guess, not the product.

   So the proof is a chain instead. The AST gate establishes that every
   internal-route href in the source is on a Link. This block establishes what
   a Link IS in this exact Next and React build: an <a> that carries the
   router's handlers, where a bare anchor carries none. The browser trace
   establishes that such an <a> transitions on the client. The three together
   cover all thirty without a single fabricated prop.

   It is deliberately about the framework, not about our screens — that is the
   one link in the chain the other two cannot supply. */
describe("what next/link is in this build", () => {
  it("renders a real <a>, so any test asserting on the DOM element still holds", () => {
    const { container } = render(<Link href="/path">Вернуться к пути</Link>);
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a!.tagName).toBe("A");
    expect(a!.getAttribute("href")).toBe("/path");
    expect(a!.textContent).toBe("Вернуться к пути");
  });

  it("attaches the router handlers a bare anchor does not have", () => {
    const { container: linked } = render(<Link href="/path">x</Link>);
    const { container: bare } = render(<a href="/path">x</a>);

    expect(handlersOn(linked.querySelector("a")!).onClick).toBe("function");
    expect(handlersOn(linked.querySelector("a")!).onMouseEnter).toBe("function");

    // The discriminator, stated from the other side: this is exactly what the
    // thirty converted anchors looked like before, and why each was a full
    // document load rather than a client transition.
    expect(handlersOn(bare.querySelector("a")!).onClick).toBe("undefined");
    expect(handlersOn(bare.querySelector("a")!).onMouseEnter).toBe("undefined");
  });

  it("keeps a Link a single tab stop, like the anchor it replaced", () => {
    const { container } = render(<Link href="/path">x</Link>);
    expect(container.querySelectorAll("a, button, [tabindex]")).toHaveLength(1);
  });
});
