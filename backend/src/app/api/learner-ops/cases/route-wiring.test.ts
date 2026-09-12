/**
 * THE LEARNER-FACING ROUTE WIRING.
 *
 * WHY A SOURCE-LEVEL TEST. `learner-projection.test.ts` proves the projector
 * cannot leak an internal field. It cannot prove the routes USE it, or that they
 * select the anchor it needs — and a projector that is correct but unwired
 * produces exactly the same learner-visible symptom as one that is broken: a
 * case list with no level on it.
 *
 * It also pins the negative half, which is the half that matters. Both learner
 * routes must keep selecting only what they select today. If somebody ever adds
 * `notes`, `escalations` or `qa` to one of these queries, the projector's
 * allowlist would still hold for the level coordinate, but the route builds the
 * rest of its response by hand — so the guard belongs here, on the query.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const LIST = path.join(ROOT, "src/app/api/learner-ops/cases/route.ts");
const DETAIL = path.join(ROOT, "src/app/api/learner-ops/cases/[caseId]/route.ts");

const sources = [
  { name: "cases list", src: fs.readFileSync(LIST, "utf8") },
  { name: "case detail", src: fs.readFileSync(DETAIL, "utf8") },
];

describe("learner-ops learner routes", () => {
  it("both routes project the level through the shared projector", () => {
    for (const { name, src } of sources) {
      expect(src, `${name} does not import the projector`).toContain(
        'from "@/lib/learner-ops/learner-projection"',
      );
      expect(src, `${name} does not call the projector`).toMatch(/level:\s*learnerOpsCaseLevel\(row\)/);
    }
  });

  it("both routes select the anchor the projector needs, and only its coordinate", () => {
    for (const { name, src } of sources) {
      for (const anchor of ["userLevelProgress", "reportSubmission"]) {
        expect(src, `${name} does not select ${anchor}`).toContain(anchor);
      }
      // The nested select is the coordinate and nothing else. A widened select
      // here would hand the projector fields it is designed to drop — which is
      // safe — but would also mean somebody believed they were needed.
      const nested = src.match(
        /levelDefinition:\s*\{\s*select:\s*\{([^}]*)\}/g,
      );
      expect(nested?.length, `${name} has no levelDefinition select`).toBe(2);
      for (const block of nested ?? []) {
        expect(block).toContain("levelNumber: true");
        expect(block).toContain("stableCode: true");
        expect(block).toContain("title: true");
        expect(block).not.toMatch(/\bid:\s*true/);
        expect(block).not.toMatch(/xpReward|completionMethod|curriculumVersionId/);
      }
    }
  });

  it("neither route can reach an internal record", () => {
    // The defence is that these names do not appear in these modules at all:
    // disclosure would require ADDING a relation to a query, not getting a
    // boolean predicate wrong.
    for (const { name, src } of sources) {
      for (const forbidden of [
        "notes",
        "LearnerOpsNote",
        "escalation",
        "Escalation",
        "qa",
        "Qa",
        "assignedStaff",
        "reasonCode",
        "slaPolicy",
        "priority",
        "queue",
      ]) {
        // Comments legitimately DESCRIBE what these routes never show, so the
        // check is on code, not on prose.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
        expect(code, `${name} names ${forbidden}`).not.toMatch(
          new RegExp(`\\b${forbidden}\\b`),
        );
      }
    }
  });

  it("the anchor's own status never travels beside its coordinate", () => {
    // A `resolved` operational case is not a completion. If the canonical
    // object's status were selected here, a client could read a progression
    // verdict off an operational mirror of it.
    for (const { name, src } of sources) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      const anchorSelects = code.match(/(?:userLevelProgress|reportSubmission):\s*\{[\s\S]*?\n\s{8}\},/g) ?? [];
      expect(anchorSelects.length, `${name} anchor selects not found`).toBe(2);
      for (const block of anchorSelects) {
        expect(block, `${name} selects the anchor's status`).not.toMatch(
          /\bstatus:\s*true|completedAt|completionEvidence|approvedAt|rejectedAt/,
        );
      }
    }
  });
});
