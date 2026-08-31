/**
 * THE GATE: no bare <a> may carry an internal Academy route.
 *
 * A `<Link>` and an `<a>` render the same element, so a regression here is
 * invisible on the page and only shows up as a whole document reloading — which
 * is exactly how AUTHENTICATED-NAVIGATION-FULL-LOAD-1 survived unnoticed. This
 * gate reads the JSX through the TypeScript parser rather than by pattern, so
 * it sees every href form: string literals, templates, identifiers, member
 * expressions, calls and conditionals.
 *
 * Anything it cannot prove to be external, a fragment or a download is treated
 * as internal and must be a Link. The exceptions are listed below, each with a
 * reason — there is no silent allowance.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/**
 * Bare anchors that are CORRECT, each with the reason it is not a route.
 * A fragment stays on the page; a download hands a file to the browser; the
 * skip links jump within the document. None is a client navigation.
 */
const ALLOWED: Array<{ file: string; match: string; why: string }> = [
  {
    file: "src/features/lesson-reader/lesson-blocks.tsx",
    match: "block.asset.url",
    why: "asset download handed to the browser, rel=noopener — not a route",
  },
  {
    file: "src/features/reader-fidelity/reader-media.tsx",
    match: "block.asset.url",
    why: "asset download handed to the browser, rel=noopener — not a route",
  },
];

type Anchor = { file: string; line: number; form: string; text: string | null };

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

/** Classify an href initializer by AST shape, never by matching its text. */
function href(init: ts.JsxAttributeValue | undefined): { form: string; text: string | null } {
  if (!init) return { form: "missing", text: null };
  if (ts.isStringLiteral(init)) return { form: "string", text: init.text };
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e)) return { form: "string", text: e.text };
    if (ts.isNoSubstitutionTemplateLiteral(e)) return { form: "template", text: e.text };
    if (ts.isTemplateExpression(e)) return { form: "template", text: e.head.text };
    if (ts.isIdentifier(e)) return { form: "identifier", text: e.text };
    if (ts.isPropertyAccessExpression(e)) return { form: "member", text: e.getText() };
    if (ts.isConditionalExpression(e)) return { form: "conditional", text: e.getText() };
    if (ts.isCallExpression(e)) return { form: "call", text: e.getText() };
    if (ts.isBinaryExpression(e)) return { form: "binary", text: e.getText() };
    return { form: "expression", text: e.getText() };
  }
  return { form: "other", text: null };
}

function collectAnchors(): Anchor[] {
  const found: Anchor[] = [];
  for (const file of tsxFiles(join(ROOT, "src"))) {
    const rel = relative(ROOT, file);
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "a") {
        const attrs = new Map<string, ts.JsxAttributeValue | undefined>();
        for (const prop of node.attributes.properties) {
          if (ts.isJsxAttribute(prop)) attrs.set(prop.name.getText(), prop.initializer);
        }
        const h = href(attrs.get("href"));
        found.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, ...h });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

/** A destination this gate can prove is NOT a client route. */
function provablyNotARoute(a: Anchor): boolean {
  if (a.form === "string" || a.form === "template") {
    const t = a.text ?? "";
    if (t.startsWith("#")) return true;                       // fragment
    if (/^(https?:|mailto:|tel:)/i.test(t)) return true;      // external
  }
  return false;
}

describe("no bare anchor carries an internal route", () => {
  const anchors = collectAnchors();

  it("finds anchors at all, so a silent parse failure cannot pass this", () => {
    expect(anchors.length).toBeGreaterThan(10);
  });

  it("leaves every bare anchor either provably not a route, or explicitly allowed", () => {
    const isAllowed = (a: Anchor) =>
      ALLOWED.some((x) => x.file === a.file && (a.text ?? "") === x.match);
    const offenders = anchors
      .filter((a) => !provablyNotARoute(a))
      .filter((a) => !isAllowed(a))
      .map((a) => `${a.file}:${a.line} href form=${a.form} ${a.text ?? ""}`);
    expect(offenders, "these must be next/link, or listed in ALLOWED with a reason").toEqual([]);
  });

  it("keeps the allowlist honest — every entry must still be a real bare anchor", () => {
    const stale = ALLOWED.filter(
      (x) => !anchors.some((a) => a.file === x.file && (a.text ?? "") === x.match),
    ).map((x) => `${x.file} :: ${x.match} (${x.why})`);
    expect(stale, "allowlist entries that no longer point at a bare anchor").toEqual([]);
  });

  it("gives every allowance a reason", () => {
    for (const a of ALLOWED) expect(a.why.length, `${a.file} :: ${a.match}`).toBeGreaterThan(8);
  });
});

/* ── WHY THE PATH CTA NEEDS NO EXCEPTION ───────────────────────────────────
   `path-fidelity-view` used to hold the one href this gate could not classify:
   `nextAction.href ?? "#"`. Read as a string it is ambiguous — sometimes a
   route, sometimes a fragment — so it sat in ALLOWED as a HOLD.

   It was never ambiguous in fact. `deriveNextAction` returns ctaLabel and href
   together or not at all, and the CTA rendered only when both were present, so
   the fragment was unreachable and the anchor was always a route.

   That pairing is the whole licence for reading the two as one value and
   rendering a single Link. So it is checked here, exhaustively over the source
   rather than over whichever states a fixture happens to reach: if a future
   return ever sets one field without the other, this fails and the seam has to
   be reconsidered before the gate can stay silent about it. */
describe("deriveNextAction pairs its label and href", () => {
  const FILE = "src/lib/curriculum/next-action.ts";

  /** Every `return { … }` in the module, with how it supplies the two fields. */
  function returns(): Array<{ line: number; cta: string; href: string }> {
    const src = readFileSync(join(ROOT, FILE), "utf8");
    const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true);
    const out: Array<{ line: number; cta: string; href: string }> = [];
    const visit = (n: ts.Node): void => {
      if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
        // A spread inherits both fields from `base`, where href is level.href
        // (typed string) and any ctaLabel present is a literal.
        let cta = "«base»";
        let href = "«base»";
        for (const prop of n.expression.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name.getText(sf);
          const value = prop.initializer.getText(sf).replace(/\s+/g, " ");
          if (key === "ctaLabel") cta = value;
          if (key === "href") href = value;
        }
        out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, cta, href });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("reads every return in the module, so this cannot pass by finding none", () => {
    expect(returns().length).toBeGreaterThan(12);
  });

  it("never sets one of the two to null without the other", () => {
    const unpaired = returns().filter((r) => (r.cta === "null") !== (r.href === "null"));
    expect(
      unpaired,
      "a null ctaLabel with a live href (or the reverse) would make the path CTA's single Link wrong",
    ).toEqual([]);
  });

  it("guards both fields on the same condition where either is conditional", () => {
    // The one return that computes both: `target.routeAccessible ? … : null`.
    // Its two ternaries must test the same thing, or the pairing is accidental.
    const conditional = returns().filter((r) => r.cta.includes("?") && r.href.includes("?"));
    for (const r of conditional) {
      expect(r.href.split("?")[0]!.trim(), `line ${r.line}`).toBe(r.cta.split("?")[0]!.trim());
    }
    // And no return may make only ONE of them conditional on something.
    const halfConditional = returns().filter(
      (r) => r.cta.includes("?") !== r.href.includes("?") && (r.cta === "null" || r.href === "null"),
    );
    expect(halfConditional).toEqual([]);
  });

  it("leaves no fragment fallback behind in the path CTA", () => {
    const view = readFileSync(
      join(ROOT, "src/features/path-fidelity/path-fidelity-view.tsx"),
      "utf8",
    );
    const code = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain('?? "#"');
    expect(code).toMatch(/<Link[^>]*className="button button--primary"/);
  });
});

/* ── THE OTHER DIRECTION ───────────────────────────────────────────────────
   Everything above forbids a route on a bare anchor. On its own that is only
   half a classification: it would stay silent if a skip link or a download
   were "fixed" into a Link, which is just as wrong and just as invisible on
   the page. A fragment routed through the router is no longer a jump within
   the document, and a download handed to the router is not a download.

   So the classes are closed from both sides: a route must be a Link, and a
   non-route must not be. */
describe("no Link carries something that is not a route", () => {
  function collectLinks(): Anchor[] {
    const found: Anchor[] = [];
    for (const file of tsxFiles(join(ROOT, "src"))) {
      const rel = relative(ROOT, file);
      const sf = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node): void => {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText() === "Link"
        ) {
          const attrs = new Map<string, ts.JsxAttributeValue | undefined>();
          for (const prop of node.attributes.properties) {
            if (ts.isJsxAttribute(prop)) attrs.set(prop.name.getText(), prop.initializer);
          }
          const h = href(attrs.get("href"));
          found.push({
            file: rel,
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            ...h,
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return found;
  }

  const links = collectLinks();

  it("finds the Links, so a silent parse failure cannot pass this either", () => {
    expect(links.length).toBeGreaterThan(60);
  });

  it("routes none of the fragments or external destinations through the router", () => {
    const wrong = links
      .filter((l) => provablyNotARoute(l))
      .map((l) => `${l.file}:${l.line} href form=${l.form} ${l.text ?? ""}`);
    expect(wrong, "a fragment or external URL belongs on a bare <a>, not a Link").toEqual([]);
  });

  it("routes none of the allowlisted downloads through the router", () => {
    const wrong = links
      .filter((l) => ALLOWED.some((x) => x.file === l.file && (l.text ?? "") === x.match))
      .map((l) => `${l.file}:${l.line} ${l.text ?? ""}`);
    expect(wrong, "these are downloads; the browser handles them, not the router").toEqual([]);
  });
});
