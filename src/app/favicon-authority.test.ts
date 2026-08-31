/**
 * ONE FAVICON, DECLARED ONCE, FOR EVERY DOCUMENT — INCLUDING THE 404.
 *
 * The Academy used to have two: a file-based `src/app/icon.svg` emitted on every
 * route (the old navy chart mark) and a route-level override on Public Home
 * alone. That is why exactly one page looked right. The declaration now lives in
 * the root layout, so every document inherits it — the withheld Community
 * routes' not-found page included, which is the page a learner actually lands
 * on there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { metadata as rootMetadata } from "@/app/layout";

const ROOT = process.cwd();
const ACCEPTED_SHA = "e34e436f8fccc3f5ec80f7c9b9928594";

function icons(): Array<{ url: string; type?: string }> {
  const i = rootMetadata.icons as { icon?: unknown } | undefined;
  const list = (i?.icon ?? []) as Array<{ url: string; type?: string }>;
  return Array.isArray(list) ? list : [list as { url: string; type?: string }];
}

describe("the favicon authority", () => {
  it("is declared in the root layout, so every document inherits it", () => {
    const list = icons();
    expect(list.length, "the root layout must declare an icon").toBeGreaterThan(0);
    const first = list[0];
    expect(first, "the declaration must be readable").toBeDefined();
    expect(first?.url).toBe("/brand/favicon.svg");
    expect(first?.type).toBe("image/svg+xml");
  });

  it("points at an asset that exists and is the accepted ATA mark", () => {
    const p = join(ROOT, "public", "brand", "favicon.svg");
    expect(existsSync(p), "public/brand/favicon.svg must exist").toBe(true);
    const bytes = readFileSync(p);
    expect(createHash("sha256").update(bytes).digest("hex").slice(0, 32)).toBe(ACCEPTED_SHA);
    const svg = bytes.toString("utf8");
    expect(svg, "Ink ground").toContain("#0B0D0A");
    expect(svg, "Signal mark").toContain("#C7F76D");
    // the replaced navy/blue chart mark must not come back
    for (const old of ["#10141c", "#4c8dff", "#34e1ce"]) {
      expect(svg.toLowerCase(), `the old mark's ${old} must not appear`).not.toContain(old);
    }
  });

  it("has no competing file-based icon", () => {
    // `src/app/icon.svg` would be emitted on EVERY route and would win where the
    // layout does not override it. It was the old mark; it must stay deleted.
    for (const name of ["icon.svg", "icon.png", "icon.ico", "favicon.ico", "apple-icon.png"]) {
      expect(existsSync(join(ROOT, "src", "app", name)), `src/app/${name} must not exist`).toBe(false);
    }
  });

  it("is not re-declared by any route, so there is exactly one authority", () => {
    // Public Home used to override it. Two declarations of one authority is how
    // the product drifted into showing two different icons.
    const pageSrc = readFileSync(join(ROOT, "src", "app", "page.tsx"), "utf8");
    expect(pageSrc).not.toMatch(/icons\s*:/);
  });
});

/* The middleware used to exempt `icon.svg` from the auth matcher, for the
   file-based icon this suite already asserts must not exist. An exemption for a
   path nothing serves is a hole nobody is watching: it is not visible in any
   response, and it would silently become a real bypass the day someone adds
   that file back. Removing the file without removing its exemption is exactly
   how that happens, so the two are pinned together here. */
describe("the auth matcher carries no exemption for an icon that does not exist", () => {
  const matcher = () => {
    const src = readFileSync(join(ROOT, "src", "middleware.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const m = code.match(/matcher:\s*\[([\s\S]*?)\]/);
    return m ? m[1] : "";
  };

  it("does not exempt icon.svg", () => {
    expect(matcher()).not.toContain("icon.svg");
  });

  it("still exempts favicon.ico, which browsers request unprompted", () => {
    // It does not exist either, but a redirect on an unrequested path is worse
    // than a 404 on one.
    expect(matcher()).toContain("favicon.ico");
  });

  it("still exempts the directory the real icon is served from", () => {
    expect(matcher()).toContain("brand/");
  });
});
