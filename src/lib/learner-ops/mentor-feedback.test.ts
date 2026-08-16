/**
 * THE PUBLIC / INTERNAL BOUNDARY (§2), asserted from the Academy's side.
 *
 * The Backend keeps internal notes in a table its learner routes never join, so
 * in practice the payloads below cannot occur. These tests do not assume that.
 * They hand the projector exactly the payload a Backend regression would
 * produce — internal notes, QA scores, escalations, assignment, queue,
 * priority, reason codes, SLA clocks, staff identities, another learner's case
 * — and assert that none of it can reach a learner-facing object.
 *
 * The point is the failure mode: if this boundary is ever broken, it must be
 * broken by somebody ADDING a field to the allowlist in mentor-feedback.ts,
 * which is a visible edit in review, rather than by an upstream `select`
 * quietly widening.
 */
import { describe, expect, it } from "vitest";
import {
  findLevelReviewCase,
  toMentorFeedback,
  MAX_FEEDBACK_MESSAGES,
  type LearnerOpsCaseThread,
} from "@/lib/learner-ops/mentor-feedback";

const LEVEL = "v2.l014.lichnyy-risk-plan";

const staffMessage = {
  id: "m1",
  authorKind: "staff",
  authorName: "Наставник ATA",
  body: "Risk Plan прочитал. Границы заданы честно.",
  createdAt: "2026-08-14T10:00:00.000Z",
};

describe("findLevelReviewCase", () => {
  it("matches a mentor-review case on the canonical stable code", () => {
    const found = findLevelReviewCase(
      [{ id: "c1", type: "mentor_review", level: { levelNumber: 14, stableCode: LEVEL, title: "Личный Risk Plan" } }],
      LEVEL,
    );
    expect(found).toEqual({ caseId: "c1", kind: "mentor-review" });
  });

  it("matches a report-review case", () => {
    const found = findLevelReviewCase(
      [{ id: "c2", type: "report_review", level: { levelNumber: 3, stableCode: "v2.l003.x", title: "Отчёт" } }],
      "v2.l003.x",
    );
    expect(found).toEqual({ caseId: "c2", kind: "report-review" });
  });

  it("ignores case types that are not a canonical review", () => {
    // A support conversation ABOUT a level is not review feedback. Showing it
    // on the level page would make "наставник ответил" mean two things.
    for (const type of ["support_request", "complaint", "service_recovery", "operational_followup", "educational_escalation"]) {
      expect(
        findLevelReviewCase([{ id: "c", type, level: { levelNumber: 14, stableCode: LEVEL, title: "t" } }], LEVEL),
      ).toBeNull();
    }
  });

  it("never matches a case anchored to a different level, or to no level", () => {
    const other = { levelNumber: 21, stableCode: "v2.l021.other", title: "Другой" };
    expect(findLevelReviewCase([{ id: "c", type: "mentor_review", level: other }], LEVEL)).toBeNull();
    expect(findLevelReviewCase([{ id: "c", type: "mentor_review", level: null }], LEVEL)).toBeNull();
  });

  it("does not match on subject prose or on list position", () => {
    // A case whose subject names level 14 but whose anchor is level 21 must not
    // be attached to level 14 — the coordinate is the only identity.
    const cases = [
      { id: "c1", type: "mentor_review", level: { levelNumber: 21, stableCode: "v2.l021.other", title: "Практика — уровень 14" } },
    ] as const;
    expect(findLevelReviewCase(cases, LEVEL)).toBeNull();
  });
});

describe("toMentorFeedback — the allowlist", () => {
  it("carries exactly id, authorName, body and createdAt", () => {
    const feedback = toMentorFeedback({ messages: [staffMessage] }, "mentor-review", LEVEL);
    expect(feedback).not.toBeNull();
    expect(feedback!.messages).toHaveLength(1);
    expect(Object.keys(feedback!.messages[0]!).sort()).toEqual(["authorName", "body", "createdAt", "id"]);
    expect(Object.keys(feedback!).sort()).toEqual(["kind", "levelCode", "messages"]);
  });

  it("drops every internal field a regressed payload could carry", () => {
    const poisoned = {
      messages: [
        {
          ...staffMessage,
          // Everything §2 forbids, all at once.
          internalNote: "ВНУТРЕННЕЕ: учётка синтетическая",
          notes: [{ id: "n1", body: "ВНУТРЕННЕЕ" }],
          qaNote: "QA: 3/5",
          qaScore: 3,
          escalation: { class: "methodology", reason: "внутреннее" },
          assignedStaffId: "staff_1",
          assignedStaff: { email: "operator@ata.internal", displayName: "Operator" },
          queue: "mentor-review",
          priority: "urgent",
          reasonCode: "RC-14",
          slaBreached: true,
          firstResponseDueAt: "2026-08-14T12:00:00.000Z",
          authorStaffId: "staff_1",
          authorUserId: 73,
          readByLearnerAt: null,
          visibility: "internal_only",
        },
      ],
      // Case-level internals, beside the thread.
      notes: [{ id: "n2", body: "ВНУТРЕННЕЕ: не показывать" }],
      escalations: [{ id: "e1", reason: "внутреннее" }],
      qa: { score: 3, reviewer: "qa@ata.internal" },
      assignedStaff: { email: "operator@ata.internal" },
    } as unknown as LearnerOpsCaseThread;

    const feedback = toMentorFeedback(poisoned, "mentor-review", LEVEL);
    const serialized = JSON.stringify(feedback);

    // Not a key-by-key check: nothing internal may appear ANYWHERE in the
    // object that reaches the component.
    for (const forbidden of [
      "ВНУТРЕННЕЕ",
      "internalNote",
      "notes",
      "qaNote",
      "qaScore",
      "escalation",
      "assignedStaff",
      "authorStaffId",
      "authorUserId",
      "priority",
      "queue",
      "reasonCode",
      "slaBreached",
      "firstResponseDueAt",
      "visibility",
      "internal_only",
      "ata.internal",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("never carries a message written by anyone other than staff", () => {
    const thread = {
      messages: [
        { id: "m0", authorKind: "learner", authorName: "Вы", body: "моя работа", createdAt: staffMessage.createdAt },
        staffMessage,
        // An author kind this build does not know is not assumed to be safe.
        { id: "m2", authorKind: "system", authorName: "system", body: "internal", createdAt: staffMessage.createdAt },
        { id: "m3", authorKind: "internal", authorName: "op", body: "ВНУТРЕННЕЕ", createdAt: staffMessage.createdAt },
      ],
    };
    const feedback = toMentorFeedback(thread, "mentor-review", LEVEL);
    expect(feedback!.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("answers null when there is no staff reply at all", () => {
    expect(
      toMentorFeedback(
        { messages: [{ id: "m0", authorKind: "learner", authorName: "Вы", body: "x", createdAt: staffMessage.createdAt }] },
        "mentor-review",
        LEVEL,
      ),
    ).toBeNull();
    expect(toMentorFeedback({ messages: [] }, "mentor-review", LEVEL)).toBeNull();
  });

  it("skips malformed rows instead of rendering an empty or broken reply", () => {
    const thread = {
      messages: [
        { ...staffMessage, id: "", },
        { ...staffMessage, id: "m2", body: "   " },
        { ...staffMessage, id: "m3", createdAt: 1786867744910 as unknown as string },
        { ...staffMessage, id: "m4" },
      ],
    } as unknown as LearnerOpsCaseThread;
    const feedback = toMentorFeedback(thread, "mentor-review", LEVEL);
    expect(feedback!.messages.map((m) => m.id)).toEqual(["m4"]);
  });

  it("falls back to a neutral author name rather than an empty byline", () => {
    const feedback = toMentorFeedback(
      { messages: [{ ...staffMessage, authorName: "" }] },
      "mentor-review",
      LEVEL,
    );
    expect(feedback!.messages[0]!.authorName).toBe("Наставник");
  });

  it("bounds how many replies one level may show", () => {
    const many = Array.from({ length: MAX_FEEDBACK_MESSAGES + 15 }, (_, i) => ({
      ...staffMessage,
      id: `m${i}`,
    }));
    const feedback = toMentorFeedback({ messages: many }, "mentor-review", LEVEL);
    expect(feedback!.messages).toHaveLength(MAX_FEEDBACK_MESSAGES);
  });

  it("carries no progression fact of any kind", () => {
    // §3 as a type-level assertion: there is nothing on this object a surface
    // could read as a decision, a score, XP, or a completion.
    const feedback = toMentorFeedback({ messages: [staffMessage] }, "mentor-review", LEVEL)!;
    const serialized = JSON.stringify(feedback);
    for (const forbidden of ["approved", "completed", "status", "verdict", "xp", "score", "passed", "decision"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden);
    }
  });
});
