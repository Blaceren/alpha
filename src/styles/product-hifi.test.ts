/**
 * THE PRODUCT HI-FI (DD-338, owner 2026-10-03: «хай фай всего»).
 *
 * The whole signed-in platform speaks Public Home's language on the product's
 * ink: statements and titles in the display face, rounded surfaces lit from a
 * corner, pill controls, a bar that floats. These tests hold the shared values
 * in one place, the shell's new bar, and every page layer to its own scope —
 * so a layer can never leak onto another page, and the display face never
 * reaches body text, a control or a number.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const bare = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Top-level rules of a stylesheet, media blocks opened: [selector, body]. */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (block: string) => {
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf("{", i);
      if (open === -1) break;
      const prelude = block.slice(i, open).trim();
      let depth = 1;
      let k = open + 1;
      while (k < block.length && depth > 0) {
        if (block[k] === "{") depth++;
        else if (block[k] === "}") depth--;
        k++;
      }
      const inner = block.slice(open + 1, k - 1);
      if (prelude.startsWith("@")) {
        if (/^@(media|supports)/.test(prelude)) walk(inner);
      } else {
        out.push([prelude, inner]);
      }
      i = k;
    }
  };
  walk(bare(css));
  return out;
}

const LAYERS: Array<{ file: string; scopes: string[] }> = [
  { file: "src/features/auth-home-fidelity/home-hifi.css", scopes: [".hm"] },
  { file: "src/features/path-fidelity/path-hifi.css", scopes: [".pth.pth--hifi"] },
  { file: "src/features/lessons-fidelity/lessons-hifi.css", scopes: [".lsn.lsn--hifi"] },
  { file: "src/features/notifications-fidelity/notifications-hifi.css", scopes: [".nt.nt--hifi"] },
  { file: "src/features/profile-fidelity/profile-hifi.css", scopes: [".pf.pf--hifi", ".pp-support"] },
];

describe("the shared values", () => {
  const tokens = read("src/styles/tokens.css");

  it("live once, in the token file", () => {
    for (const token of [
      "--hf-display:",
      "--hf-display-tracking:",
      "--hf-title-xl:",
      "--hf-title-lg:",
      "--hf-title-md:",
      "--hf-eyebrow-tracking:",
      "--hf-radius-surface:",
      "--hf-radius-pill:",
      "--hf-surface:",
      "--hf-line:",
      "--hf-light:",
      "--hf-shadow:",
      "--hf-halo:",
      "--hf-arrow:",
    ]) {
      expect(tokens, token).toContain(token);
    }
  });

  it("bind the display face to the face Public Home already ships", () => {
    expect(tokens).toMatch(/--hf-display:\s*var\(--font-public-display\)/);
    expect(read("src/styles/fonts.css")).toContain('font-family:"ATA Source Serif 4"');
  });
});

describe("the shell", () => {
  const css = bare(read("src/features/home/home.css"));
  const rule = (selector: string) => {
    const i = css.indexOf(selector + " {");
    return i === -1 ? "" : css.slice(i, css.indexOf("}", i));
  };

  it("floats its bar as Public Home does, and keeps the 60px every body sits under", () => {
    const bar = rule(".appbar");
    expect(bar).toContain("position: sticky");
    expect(bar).toContain("top: 10px");
    expect(bar).toContain("margin: 10px 10px 0");
    expect(bar).toContain("border-radius: 20px");
    expect(bar).toContain("backdrop-filter");
    expect(bar).toContain("height: 60px");
  });

  it("floats the phone's bar above the safe area, rounded, and keeps its height", () => {
    const nav = rule(".bottomnav");
    expect(nav).toContain("position: fixed");
    expect(nav).toContain("inset-inline: 8px");
    expect(nav).toContain("bottom: calc(8px + env(safe-area-inset-bottom))");
    expect(nav).toContain("border-radius: 20px");
    expect(nav).toContain("min-height: var(--mobile-bottom-nav-height)");
  });

  it("paints the ground once, with Public Home's corner light", () => {
    expect(css).toMatch(/\.home--frozen\s*\{\s*background:\s*var\(--hf-light\),\s*var\(--background-base\)/);
  });
});

describe.each(LAYERS)("$file", ({ file, scopes }) => {
  const css = read(file);
  const all = rules(css);

  it("lets no selector escape its page", () => {
    const escapees: string[] = [];
    for (const [prelude] of all) {
      for (const part of prelude.split(",").map((p) => p.trim()).filter(Boolean)) {
        if (!scopes.some((scope) => part.startsWith(scope))) escapees.push(part);
      }
    }
    expect(escapees).toEqual([]);
  });

  it("uses the canonical edges only", () => {
    const widths = [...bare(css).matchAll(/\((min|max)-width:\s*(\d+)px\)/g)].map((m) => `${m[1]}-${m[2]}`);
    for (const w of widths) expect(["max-599", "max-899", "min-900", "max-1199", "min-1200"], w).toContain(w);
  });

  it("sets the display face on titles and statements only — never on text, controls or numbers", () => {
    const display = all.filter(([, body]) => body.includes("var(--hf-display)"));
    expect(display.length, "the layer speaks in the display face somewhere").toBeGreaterThan(0);
    for (const [prelude] of display) {
      expect(prelude, prelude).toMatch(/h1|h2|title|name|greeting|consequence/);
      expect(prelude, prelude).not.toMatch(/button|input|textarea|select|\.p-row__value|dd\b|count|code|time|fact/);
    }
  });
});

describe("each screen mounts its layer", () => {
  it.each([
    ["src/features/path-fidelity/path-fidelity-view.tsx", 'className="pth pth--hifi"', "@/features/path-fidelity/path-hifi.css"],
    ["src/features/lessons-fidelity/lessons-fidelity-screen.tsx", 'className="lsn lsn--hifi"', "@/features/lessons-fidelity/lessons-hifi.css"],
    ["src/features/notifications-fidelity/notifications-fidelity.tsx", 'className="nt nt--hifi"', "@/features/notifications-fidelity/notifications-hifi.css"],
    ["src/features/profile-fidelity/profile-fidelity.tsx", 'className="pf pf--hifi"', "@/features/profile-fidelity/profile-hifi.css"],
  ])("%s", (file, root, stylesheet) => {
    const src = read(file);
    expect(src).toContain(root);
    expect(src).toContain(`import "${stylesheet}";`);
  });
});
