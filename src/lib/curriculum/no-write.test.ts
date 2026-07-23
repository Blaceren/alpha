import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * CI-2 no-write contract: the curriculum integration is READ-ONLY. There must be
 * no mutation route handler, no write HTTP method, and no mutation call to the
 * Backend curriculum surface anywhere in the Academy curriculum code.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const CURRICULUM_DIRS = [
  "src/lib/curriculum",
  "src/server/curriculum",
  "src/server/proxy/curriculum-proxy.ts",
  "src/app/api/backend/curriculum",
  "src/features/curriculum-api",
].map((p) => path.join(REPO_ROOT, p));

function files(): string[] {
  const result: string[] = [];
  for (const target of CURRICULUM_DIRS) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) result.push(...walk(target));
    else result.push(target);
  }
  return result;
}

describe("curriculum is read-only (no-write contract)", () => {
  const sources = files().map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));

  it("has curriculum source to scan", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it("declares no write HTTP handler in curriculum route handlers", () => {
    for (const { f, src } of sources) {
      if (!f.includes(`${path.sep}api${path.sep}`)) continue;
      expect(src, `${f} must not export POST/PUT/PATCH/DELETE`).not.toMatch(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/);
    }
  });

  it("issues no write fetch method to the Backend", () => {
    for (const { f, src } of sources) {
      expect(src, `${f} uses a write method`).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    }
  });

  it("sends no curriculum mutation/assessment-submit path", () => {
    for (const { f, src } of sources) {
      expect(src, `${f} references a mutation path`).not.toMatch(/assessment\/attempts|report\/(submit|draft|resubmit)|lesson-progress|\/publish|\/archive/);
    }
  });
});
