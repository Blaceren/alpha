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
  {
    file: "src/features/path-fidelity/path-fidelity-view.tsx",
    match: 'nextAction.href ?? "#"',
    why: 'HOLD: the fallback is a fragment, so this href is not uniformly a route',
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
