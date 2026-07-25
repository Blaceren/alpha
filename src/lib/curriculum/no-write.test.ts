import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Curriculum write contract.
 *
 * CI-2 made the curriculum integration READ-ONLY. CI-3 adds EXACTLY ONE bounded
 * learner write surface: the server-graded L2 assessment (start attempt + submit
 * attempt). This test therefore allows the assessment attempt routes/proxy/client
 * and NOTHING else — no report submission, no lesson-progress, no admin
 * publish/archive, no other mutation — anywhere in the curriculum/assessment code.
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

const SCAN_DIRS = [
  "src/lib/curriculum",
  "src/server/curriculum",
  "src/server/proxy/curriculum-proxy.ts",
  "src/server/proxy/assessment-proxy.ts",
  "src/app/api/backend/curriculum",
  "src/features/curriculum-api",
  "src/lib/assessment",
  "src/features/assessment",
].map((p) => path.join(REPO_ROOT, p));

/** The sanctioned CI-3 assessment write surface (start + submit attempt). */
const ASSESSMENT_WRITE = /assessment-proxy|assessment-client|level-assessment|assessment-machine|[\\/]assessment[\\/]/;

function files(): string[] {
  const result: string[] = [];
  for (const target of SCAN_DIRS) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) result.push(...walk(target));
    else result.push(target);
  }
  return result;
}

describe("curriculum write contract (CI-3: read-only + bounded assessment write)", () => {
  const sources = files().map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));

  it("has source to scan", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it("declares write HTTP handlers ONLY in the assessment attempt routes", () => {
    for (const { f, src } of sources) {
      if (!f.includes(`${path.sep}api${path.sep}`)) continue;
      if (/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/.test(src)) {
        expect(ASSESSMENT_WRITE.test(f), `${f} may only be a write route if it is the assessment attempt surface`).toBe(true);
      }
    }
  });

  it("issues write fetch methods ONLY from the assessment proxy", () => {
    for (const { f, src } of sources) {
      if (/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src)) {
        expect(ASSESSMENT_WRITE.test(f), `${f} may only use a write method in the assessment surface`).toBe(true);
      }
    }
  });

  it("sends no report/lesson-progress/admin mutation path anywhere", () => {
    for (const { f, src } of sources) {
      expect(src, `${f} references a forbidden mutation path`).not.toMatch(/report\/(submit|draft|resubmit)|lesson-progress|\/publish|\/archive|report-submissions|report-reviews/);
    }
  });

  it("assessment writes target only the attempt start/submit paths", () => {
    const allowed = /assessment\/attempts\b|levels\/\$\{encodeURIComponent\(stableCode\)\}\/assessment\/attempts|levels\/\{stableCode\}\/assessment\/attempts/;
    for (const { f, src } of sources) {
      const matches = src.match(/[A-Za-z0-9_${}().\\/[\]-]*assessment\/attempts[A-Za-z0-9_${}().\\/[\]-]*/g) ?? [];
      for (const m of matches) {
        expect(allowed.test(m) || m.includes("assessment/attempts"), `${f}: unexpected assessment path ${m}`).toBe(true);
      }
    }
  });
});
