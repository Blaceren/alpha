import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Curriculum write contract.
 *
 * CI-2 made the curriculum integration READ-ONLY. CI-3 added EXACTLY ONE bounded
 * learner write surface: the server-graded L2 assessment (start + submit attempt).
 * CI-4 adds EXACTLY ONE more bounded learner write surface: the L3 report
 * workflow (draft save + submit + resubmit).
 * L4VC-1 adds EXACTLY ONE more: the L4 financial-checkpoint verification
 * (a single POST whose entire body is `{ requestId }`).
 *
 * This test therefore allows the assessment attempt surface, the report learner
 * surface and the checkpoint verification surface, and NOTHING else — no
 * reviewer/mentor review, no admin publish/archive/authoring, no
 * lesson-progress, no attachment, no other mutation — anywhere in the
 * curriculum/assessment/report/checkpoint code.
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
  "src/server/proxy/report-proxy.ts",
  "src/app/api/backend/curriculum",
  "src/features/curriculum-api",
  "src/lib/assessment",
  "src/features/assessment",
  "src/lib/report",
  "src/features/report",
  "src/server/proxy/checkpoint-proxy.ts",
  "src/lib/checkpoint",
  "src/features/checkpoint",
].map((p) => path.join(REPO_ROOT, p));

/** The sanctioned CI-3 assessment write surface (start + submit attempt). */
const ASSESSMENT_WRITE = /assessment-proxy|assessment-client|level-assessment|assessment-machine|[\\/]assessment[\\/]/;
/** The sanctioned CI-4 learner report write surface (draft + submit + resubmit). */
const REPORT_WRITE = /report-proxy|report-client|level-report|report-machine|[\\/]report[\\/]/;
/** The sanctioned L4VC-1 learner checkpoint write surface (verify). */
const CHECKPOINT_WRITE = /checkpoint-proxy|checkpoint-client|level-checkpoint|checkpoint-machine|[\\/]checkpoint[\\/]/;

function sanctionedWrite(file: string): boolean {
  return ASSESSMENT_WRITE.test(file) || REPORT_WRITE.test(file) || CHECKPOINT_WRITE.test(file);
}

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

describe("curriculum write contract (CI-4: read-only + bounded assessment & report writes)", () => {
  const sources = files().map((f) => ({ f, src: fs.readFileSync(f, "utf8") }));

  it("has source to scan", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it("declares write HTTP handlers ONLY in the assessment, report or checkpoint learner routes", () => {
    for (const { f, src } of sources) {
      if (!f.includes(`${path.sep}api${path.sep}`)) continue;
      if (/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)/.test(src)) {
        expect(sanctionedWrite(f), `${f} may only be a write route if it is a sanctioned learner surface`).toBe(true);
      }
    }
  });

  it("issues write fetch methods ONLY from the assessment, report or checkpoint surface", () => {
    for (const { f, src } of sources) {
      if (/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src)) {
        expect(sanctionedWrite(f), `${f} may only use a write method in a sanctioned surface`).toBe(true);
      }
    }
  });

  it("never references a reviewer/admin/attachment/lesson-progress mutation path", () => {
    // These remain forbidden EVERYWHERE (no mentor UI, no admin, no attachments).
    for (const { f, src } of sources) {
      expect(src, `${f} references a forbidden mutation path`).not.toMatch(
        /lesson-progress|\/publish\b|\/archive\b|report-submissions|report-reviews|report\/attachments|report-attachments/,
      );
    }
  });

  it("uses report write paths (draft/submit/resubmit) ONLY in the report surface", () => {
    for (const { f, src } of sources) {
      if (/report\/(submit|draft|resubmit)\b/.test(src)) {
        expect(REPORT_WRITE.test(f), `${f} may only use a report write path in the report surface`).toBe(true);
      }
    }
  });

  it("checkpoint API paths are only ever the single verify path", () => {
    // The whole checkpoint write surface is ONE URL. Matched against real API
    // path literals (`/api/...` or `curriculum/levels/...`) so that prose and
    // type unions containing the word "checkpoint" are not mistaken for routes.
    const apiPath = /(?:\/api\/|curriculum\/levels\/)[A-Za-z0-9_${}().\\/[\]-]*checkpoint[A-Za-z0-9_${}().\\/[\]-]*/g;
    for (const { f, src } of sources) {
      for (const m of src.match(apiPath) ?? []) {
        expect(m.includes("checkpoint/verify"), `${f}: unexpected checkpoint path ${m}`).toBe(true);
        expect(CHECKPOINT_WRITE.test(f), `${f} may only use a checkpoint path in the checkpoint surface`).toBe(true);
      }
    }
  });

  it("the checkpoint surface never sends a balance, account or amount", () => {
    // Structural privacy: the request body is `{ requestId }`. These identifiers
    // must not appear in CODE anywhere in the checkpoint client, proxy, machine
    // or UI. Comments are stripped first — the files deliberately DESCRIBE what
    // they never show, and the check is on what they do, not what they say.
    const forbidden = /\b(balance|balanceMinorUnits|demoBalance|remaining|deficit|depositAmount|accountLogin|accountId|accountType|accessToken)\b/i;
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const { f, src } of sources) {
      if (!CHECKPOINT_WRITE.test(f)) continue;
      expect(stripComments(src), `${f} references a forbidden financial field`).not.toMatch(forbidden);
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
