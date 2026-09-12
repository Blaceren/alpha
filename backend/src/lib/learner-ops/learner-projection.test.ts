/**
 * LEARNER-OPERATIONS-V1 — the learner-facing projection boundary.
 *
 * These assert the NEGATIVE contract: what a learner-facing case object must
 * never be able to carry, whatever the row handed to the projector happens to
 * contain. The positive shape is asserted too, but the negatives are the point
 * — a widened `select` upstream must not be able to reach a learner through
 * this function.
 */
import { describe, expect, it } from "vitest";
import { learnerOpsCaseLevel } from "@/lib/learner-ops/learner-projection";

const LEVEL = { levelNumber: 14, stableCode: "v2.l014.lichnyy-risk-plan", title: "Личный Risk Plan" };

describe("learnerOpsCaseLevel", () => {
  it("projects the level coordinate of a mentor-review anchor", () => {
    expect(learnerOpsCaseLevel({ userLevelProgress: { levelDefinition: LEVEL } })).toEqual(LEVEL);
  });

  it("projects the level coordinate of a report-review anchor", () => {
    expect(learnerOpsCaseLevel({ reportSubmission: { levelDefinition: LEVEL } })).toEqual(LEVEL);
  });

  it("answers null for a case anchored to no level at all", () => {
    // support_request, complaint, service_recovery, operational_followup.
    expect(learnerOpsCaseLevel({})).toBeNull();
    expect(learnerOpsCaseLevel({ userLevelProgress: null, reportSubmission: null })).toBeNull();
  });

  it("carries the coordinate and NOTHING else, whatever the row holds", () => {
    // The row is deliberately polluted with everything a widened `select`
    // could ever bring along. None of it may survive the projection.
    const polluted = {
      userLevelProgress: {
        levelDefinition: {
          ...LEVEL,
          // Fields a LevelDefinition really has, which a learner-facing case
          // object still has no business carrying.
          id: 122,
          curriculumVersionId: 4,
          xpReward: 250,
          completionMethod: "mentor_review",
        },
        // The canonical progression object itself.
        id: 74,
        status: "completed",
        completedAt: new Date(),
        completionEvidence: { source: "mentor" },
      },
    } as unknown as Parameters<typeof learnerOpsCaseLevel>[0];

    const projected = learnerOpsCaseLevel(polluted);

    expect(projected).toEqual(LEVEL);
    expect(Object.keys(projected ?? {}).sort()).toEqual(["levelNumber", "stableCode", "title"]);
  });

  it("never exposes the anchor's identity or its canonical status", () => {
    const projected = learnerOpsCaseLevel({ userLevelProgress: { levelDefinition: LEVEL } });
    const keys = Object.keys(projected ?? {});

    for (const forbidden of [
      "id",
      "userLevelProgressId",
      "reportSubmissionId",
      "status",
      "completedAt",
      "completionMethod",
      "completionEvidence",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
