import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * AN OPEN ENTRY'S ACTIONS, AND THE QUESTION BEFORE A DELETE — the stylesheet half.
 *
 * What the real browser showed on 2026-10-01 while these were built (scratch
 * `overflow.cjs`, 13 widths from 320 to 1440, an entry open and the question
 * asked):
 *
 *   - three stacked full-width bars on a phone made the delete a 326px target;
 *   - at 600–650px the delete broke to a row of its own;
 *   - at 360px «Изменить запись» broke to two lines and its row grew to 68px.
 *
 * After the fix every action is 46px tall at every width, no label is on two
 * lines and nothing overflows. jsdom lays nothing out, so what is checked here
 * is the declarations those measurements rest on.
 */

const CSS = readFileSync(join(process.cwd(), "src/features/tool-windows/tool-windows.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

type Decl = Record<string, string>;

/** Every rule of `source` as [selector list, declarations]; at-rules are entered separately. */
function rulesOf(source: string): Array<[string, Decl]> {
  const out: Array<[string, Decl]> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = re.exec(source); match; match = re.exec(source)) {
    const decl: Decl = {};
    for (const line of match[2]!.split(";")) {
      const at = line.indexOf(":");
      if (at > 0) decl[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    out.push([match[1]!.trim().replace(/\s+/g, " "), decl]);
  }
  return out;
}

/** The bodies of every `@media (min-width: 600px)` block, by brace matching. */
function from600(): string {
  const header = "@media (min-width: 600px)";
  let body = "";
  for (let at = CSS.indexOf(header); at >= 0; at = CSS.indexOf(header, at + 1)) {
    const open = CSS.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === "{") depth++;
      else if (CSS[i] === "}" && --depth === 0) {
        body += CSS.slice(open + 1, i);
        break;
      }
    }
  }
  return body;
}

/** The declarations of the rules whose selector list names `selector` exactly, merged in order. */
function declared(source: string, selector: string): Decl {
  const merged: Decl = {};
  for (const [selectors, decl] of rulesOf(source)) {
    if (selectors.split(",").some((one) => one.trim() === selector)) Object.assign(merged, decl);
  }
  return merged;
}

/** Outside any at-rule: what a phone gets. */
const BASE = CSS.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
const WIDE = from600();

describe("Trading Journal — an entry's actions, laid out", () => {
  it("never breaks a label in two", () => {
    expect(declared(BASE, ".jr-entry-actions > .tw-button")["white-space"]).toBe("nowrap");
  });

  it("on a phone: the review is a full bar, the delete is as wide as its word and stands at the far end", () => {
    expect(declared(BASE, ".jr-entry-actions > .tw-button:first-child")["flex-basis"]).toBe("100%");
    const remove = declared(BASE, ".jr-entry-actions > .jr-detail__delete");
    expect(remove.flex).toBe("0 0 auto");
    expect(remove["margin-left"]).toBe("auto");
    // The pair is set tighter than a lone button so it holds one row at 360px.
    const edit = declared(BASE, ".jr-entry-actions > .tw-button:nth-child(2)");
    expect(edit.flex).toBe("1 1 auto");
    expect(Number.parseFloat(edit["padding-inline"]!)).toBeLessThan(20);
    expect(Number.parseFloat(remove["padding-inline"]!)).toBeLessThan(20);
  });

  it("from 600px: one line that never breaks — the two that change give way instead", () => {
    expect(declared(WIDE, ".jr-entry-actions")["flex-wrap"]).toBe("nowrap");
    const change = declared(WIDE, ".jr-entry-actions > .tw-button:nth-child(2)");
    expect(change.flex).toBe("0 1 200px");
    // …down to their own words, not below them.
    expect(change["min-width"]).toBe("auto");
    expect(declared(WIDE, ".jr-entry-actions > .tw-button:first-child").flex).toBe("0 1 200px");
    expect(declared(WIDE, ".jr-entry-actions > .jr-detail__delete")["min-width"]).toBe("auto");
  });

  it("keeps every action a full touch target", () => {
    expect(Number.parseFloat(declared(BASE, ".tw-button")["min-height"]!)).toBeGreaterThanOrEqual(44);
  });
});

describe("Trading Journal — the colour of a delete", () => {
  const outline = declared(BASE, '.tw-button[data-variant="danger"]');
  const solid = declared(BASE, '.tw-button[data-variant="danger"][data-solid]');

  it("is the rose of a loss and of an error, outlined where it is offered", () => {
    expect(outline.color).toBe("var(--tw-negative)");
    expect(outline.background).toBe("transparent");
    expect(outline["border-color"]).toContain("var(--tw-negative)");
  });

  it("is filled only on the step that deletes", () => {
    expect(solid.background).toBe("var(--tw-negative)");
    expect(solid.color).toBe("var(--tw-on-signal)");
  });

  it("never borrows the Signal, which is the product's «go»", () => {
    for (const [selectors, decl] of rulesOf(CSS)) {
      if (!/data-variant="danger"|\.jr-delete\b/.test(selectors)) continue;
      expect(Object.values(decl).join(" "), selectors).not.toMatch(/--tw-signal\b|--tw-signal-hover|--tw-positive/);
    }
  });

  it("marks the question itself with the same rose, on the tools' own well", () => {
    expect(declared(BASE, ".jr-delete")["border-color"]).toContain("var(--tw-negative)");
    expect(declared(BASE, ".tc-confirm").background).toBe("var(--tw-well)");
  });
});
