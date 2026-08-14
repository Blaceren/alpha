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
 * L2START-PLAYER-1 adds EXACTLY ONE more: the legal level start (a single POST
 * with NO body at all — the Backend takes the actor from the session and the
 * stable code only tells it which level this page believes is current).
 *
 * This test therefore allows the assessment attempt surface, the report learner
 * surface, the checkpoint verification surface and the level-start surface, and
 * NOTHING else — no reviewer/mentor review, no admin publish/archive/authoring,
 * no lesson-progress, no attachment, no other mutation — anywhere in the
 * curriculum/assessment/report/checkpoint/level-start code.
 *
 * The lesson MEDIA surface is scanned too, and is deliberately NOT sanctioned:
 * the video player must never become a hidden progress owner, so any write it
 * ever grew would fail here.
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
  "src/server/proxy/level-start-proxy.ts",
  "src/lib/level-start",
  "src/features/level-start",
  "src/features/lesson-media",
  "src/server/proxy/manual-completion-proxy.ts",
  "src/lib/manual-completion",
  "src/features/manual-completion",
  "src/server/proxy/mentor-review-proxy.ts",
  "src/lib/mentor-review",
  "src/features/mentor-review",
].map((p) => path.join(REPO_ROOT, p));

/** The sanctioned CI-3 assessment write surface (start + submit attempt). */
const ASSESSMENT_WRITE = /assessment-proxy|assessment-client|level-assessment|assessment-machine|[\\/]assessment[\\/]/;
/** The sanctioned CI-4 learner report write surface (draft + submit + resubmit). */
const REPORT_WRITE = /report-proxy|report-client|level-report|report-machine|[\\/]report[\\/]/;
/** The sanctioned L4VC-1 learner checkpoint write surface (verify). */
const CHECKPOINT_WRITE = /checkpoint-proxy|checkpoint-client|level-checkpoint|checkpoint-machine|[\\/]checkpoint[\\/]/;
/** The sanctioned L2START-PLAYER-1 learner level-start surface (start). */
const LEVEL_START_WRITE = /level-start-proxy|level-start-client|[\\/]level-start[\\/]|[\\/]start[\\/]route\.tsx?$/;
/**
 * The sanctioned G3 learner MANUAL COMPLETION surface (complete).
 *
 * The fifth and — as of G3 — final learner write. It carries a `{ requestId }`
 * body to one pinned Backend path and owns nothing: the completion decision, the
 * owner check, the XP award and the idempotency all live in the Backend command
 * it forwards to. It is listed here rather than left unsanctioned because the
 * 13 canonical `lesson:manual` levels had no learner-reachable completion path
 * at all before it existed.
 */
const MANUAL_COMPLETION_WRITE =
  /manual-completion-proxy|manual-completion-client|[\\/]manual-completion[\\/]|[\\/]complete[\\/]route\.tsx?$/;
/**
 * The sanctioned G3 learner MENTOR REVIEW SUBMISSION surface (request).
 *
 * The sixth learner write, and the narrowest of them: it forwards NO body at
 * all. It covers only the learner half of the lifecycle — `in_progress ->
 * pending_review`. The reviewer half lives on the CRM origin and is asserted
 * absent from the Academy by the reviewer-path test below.
 */
const MENTOR_REVIEW_WRITE =
  /mentor-review-proxy|mentor-review-client|[\\/]mentor-review[\\/]/;

function sanctionedWrite(file: string): boolean {
  return (
    ASSESSMENT_WRITE.test(file) ||
    REPORT_WRITE.test(file) ||
    CHECKPOINT_WRITE.test(file) ||
    LEVEL_START_WRITE.test(file) ||
    MANUAL_COMPLETION_WRITE.test(file) ||
    MENTOR_REVIEW_WRITE.test(file)
  );
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

  it("level-start API paths are only ever the single start path", () => {
    // The whole level-start write surface is ONE URL, matched against real API
    // path literals so prose containing the word "start" is not mistaken for a
    // route. A second start path anywhere would mean a second start owner.
    const apiPath = /(?:\/api\/|curriculum\/levels\/)[A-Za-z0-9_${}().\\/[\]-]*\/start\b/g;
    for (const { f, src } of sources) {
      if ((src.match(apiPath) ?? []).length > 0) {
        expect(LEVEL_START_WRITE.test(f), `${f} may only use a start path in the level-start surface`).toBe(true);
      }
    }
  });

  it("the level-start surface never sends a request body", () => {
    // Structural: starting takes NO learner input. If a body, a status, a user
    // id or a level selector ever appeared here, a learner could ask to be put
    // into a state rather than asking to begin the one they are standing on.
    // Matched against how a request body is actually built in this codebase
    // (`body: JSON.stringify(...)`, `body: raw`, a form/urlencoded payload) so
    // that reading the RESPONSE body — `body: parsed.value` handed to the error
    // normalizer — is not mistaken for sending one.
    const forbidden =
      /body:\s*(JSON\.stringify|raw\b|new FormData|new URLSearchParams|["'])|\buserId\b|\blearnerId\b|\btargetStatus\b/;
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const { f, src } of sources) {
      if (!LEVEL_START_WRITE.test(f)) continue;
      expect(stripComments(src), `${f} sends something with the start request`).not.toMatch(forbidden);
    }
  });

  it("the lesson media surface issues no request of any kind", () => {
    // The player renders a URL. It does not talk to the Backend, so it cannot
    // become a progress owner by accident.
    for (const { f, src } of sources) {
      if (!f.includes(`${path.sep}lesson-media${path.sep}`)) continue;
      expect(src, `${f} performs I/O`).not.toMatch(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon/);
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

  /* --------------------------------------------------------------- G3 */

  it("manual completion API paths are only ever the single complete path", () => {
    // The whole manual write surface is ONE URL. A second completion path
    // anywhere in the Academy would mean a second way to finish a level.
    const apiPath = /(?:\/api\/|curriculum\/levels\/)[A-Za-z0-9_${}().\\/[\]-]*\/complete\b/g;
    for (const { f, src } of sources) {
      if ((src.match(apiPath) ?? []).length > 0) {
        expect(MANUAL_COMPLETION_WRITE.test(f), `${f} may only use a complete path in the manual surface`).toBe(true);
      }
    }
  });

  it("the manual completion surface SENDS only a request identity", () => {
    // Structural: the only outgoing body is `JSON.stringify({ requestId })`.
    // Checked on what is SENT rather than on every identifier in the file — the
    // module also declares the RESPONSE receipt, which legitimately names
    // `xpAwarded` and `completedAt` because the Backend reports them back.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const bodyLiteral = /body:\s*JSON\.stringify\(([^)]*)\)/g;
    for (const { f, src } of sources) {
      if (!MANUAL_COMPLETION_WRITE.test(f)) continue;
      const clean = stripComments(src);
      for (const [, payload] of clean.matchAll(bodyLiteral)) {
        // POCKET-REG-INGRESS-1: a capture group is `string | undefined` to the
        // compiler; an absent group must fail the assertion, not the typecheck.
        expect((payload ?? "").replace(/\s/g, ""), `${f} sends more than a request identity`).toBe(
          "{requestId}",
        );
      }
      // And no other body-building mechanism is used at all.
      expect(clean, `${f} builds a request body some other way`).not.toMatch(
        /body:\s*(new FormData|new URLSearchParams|["'])/,
      );
    }
  });

  it("mentor-review API paths are only ever the learner REQUEST path", () => {
    // The Academy owns exactly one half of the mentor-review lifecycle. Matched
    // against REAL API path literals (`/api/...`, `curriculum/levels/...`) so
    // that module specifiers such as `@/server/proxy/mentor-review-proxy` and
    // CSS imports are not mistaken for routes — the same technique the
    // checkpoint and level-start path tests use.
    const apiPath = /(?:\/api\/|curriculum\/levels\/)[A-Za-z0-9_${}().\\/[\]-]*mentor-review[A-Za-z0-9_${}().\\/[\]-]*/g;
    for (const { f, src } of sources) {
      for (const m of src.match(apiPath) ?? []) {
        expect(m.includes("mentor-review/request"), `${f}: unexpected mentor-review path ${m}`).toBe(true);
        expect(MENTOR_REVIEW_WRITE.test(f), `${f} may only use a mentor-review path in the mentor-review surface`).toBe(true);
      }
    }
  });

  it("the Academy never references the reviewer-only mentor-review routes", () => {
    // `mentor-reviews/` (plural) is the reviewer namespace: the approve command
    // and the queue. Both are staff surfaces on the CRM origin, and their
    // absence from every learner-facing file is what stops a learner bundle from
    // ever carrying a reviewer command.
    for (const { f, src } of sources) {
      expect(src, `${f} references a reviewer-only mentor-review route`).not.toMatch(
        /mentor-reviews\//,
      );
    }
  });

  it("the mentor-review surface sends no request body at all", () => {
    const forbidden =
      /body:\s*(JSON\.stringify|raw\b|new FormData|new URLSearchParams|["'])|\buserId\b|\blearnerId\b|\breviewerId\b|\bscore\b|\brubric\b/;
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const { f, src } of sources) {
      if (!MENTOR_REVIEW_WRITE.test(f)) continue;
      expect(stripComments(src), `${f} sends something with the mentor-review request`).not.toMatch(forbidden);
    }
  });
});
