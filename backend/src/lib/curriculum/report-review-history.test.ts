import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { FIXTURE_LOCALE, seedReportScenario } from "@/lib/curriculum/report-review-history-fixture";

/**
 * LEARNER-VISIBLE REVIEW HISTORY — the contract, against a real database.
 *
 * The learner report DTO reported only `latestReview`, and only while it was a
 * rejection. The moment a report was accepted every review it had ever received
 * became invisible, so a learner who was asked to correct something, corrected
 * it and was accepted saw two versions and no reason for the second one.
 *
 * These cases run against a TEMPORARY SQLite database built from the real
 * schema and seeded with synthetic rows. Nothing here touches the live database,
 * writes through a command path, or creates a review: the reads under test are
 * reads, and the assertions below include that they stay reads.
 */

process.env.CURRICULUM_V2_READ_ENABLED = "true";
process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
process.env.CURRICULUM_V2_REPORT_ENABLED = "true";

const LOCALE = FIXTURE_LOCALE;
let dir: string;
let db: PrismaClient;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ata-report-history-"));
  const url = `file:${dir}/test.db`;
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  db = new PrismaClient({ datasources: { db: { url } } });
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The learner-visible shapes, named once so the assertions stay readable. */
type ReviewEvent = {
  decision: "approved" | "rejected";
  reviewedAt: string;
  reasonCode: string | null;
  reasonTitle: string | null;
  humanComment: string | null;
  correctiveAction: string | null;
};
type HistoryEntry = {
  revisionNumber: number;
  kind: string;
  createdAt: string;
  submittedAt: string | null;
  review: ReviewEvent | null;
};
type Submission = {
  status: string;
  workflowVersion: number;
  activeRevisionNumber: number | null;
  submittedRevisionNumber: number | null;
  approvedRevisionNumber: number | null;
  fieldValues: Record<string, unknown>;
  firstSubmittedAt: string | null;
  submittedAt: string | null;
  rejection: { reasonCode: string; reasonTitle: string; humanComment: string; correctiveAction: string; reviewedAt: string } | null;
  history: HistoryEntry[];
};
type RevisionDetail = {
  revisionNumber: number;
  review: ReviewEvent | null;
  feedback: { reasonCode: string; reasonTitle: string; humanComment: string; correctiveAction: string; reviewedAt: string } | null;
};

const submissionOf = (result: unknown): Submission =>
  (result as { submission: Submission }).submission;

/** Read the context and return the submission, failing loudly on any other kind. */
async function contextOf(seeded: { userId: number; stableCode: string }) {
  const { resolveOwnReportContext } = await import("@/lib/curriculum/report-submission");
  const result = await resolveOwnReportContext({
    actorUserId: seeded.userId, locale: LOCALE, stableCode: seeded.stableCode, db,
  });
  return result;
}

/** Submitted revisions only, in canonical order. */
function submittedOf(submission: Submission): HistoryEntry[] {
  return submission.history.filter((r) => r.kind !== "draft_autosave");
}

describe("the learner-visible review history", () => {
  it("1 · a draft has no review anywhere", async () => {
    const seeded = await seedReportScenario(db, [{ draft: 1 }], { status: "draft" });
    const result = await contextOf(seeded);
    expect(result.kind).toBe("draft");
    const submission = submissionOf(result);
    expect(submission.rejection).toBeNull();
    expect(submission.history.every((r) => r.review === null)).toBe(true);
  });

  it("2 · an initial submission awaiting review reports no review yet", async () => {
    const seeded = await seedReportScenario(db, [{ draft: 1 }, { submit: 2 }], { status: "pending_review" });
    const result = await contextOf(seeded);
    expect(result.kind).toBe("pending_review");
    const s = submissionOf(result);
    const sub = submittedOf(s);
    expect(sub).toHaveLength(1);
    expect(sub[0]!.kind).toBe("initial_submission");
    expect(sub[0]!.review).toBeNull();
  });

  it("3 · a rejected first submission carries its feedback on that revision", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    const result = await contextOf(seeded);
    expect(result.kind).toBe("rejected");
    const s = submissionOf(result);
    const review = submittedOf(s)[0]!.review!;
    expect(review.decision).toBe("rejected");
    expect(review.reasonTitle).toBe("Нужна конкретика");
    expect(review.humanComment).not.toBeNull();
    expect(review.correctiveAction).not.toBeNull();
    expect(review.reviewedAt).toBe("2026-01-02T10:00:00.000Z");
  });

  it("4 · an approval on the first try carries a decision and no invented feedback", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "approved", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "approved" },
    );
    const result = await contextOf(seeded);
    expect(result.kind).toBe("approved");
    const s = submissionOf(result);
    const submitted = submittedOf(s);
    expect(submitted).toHaveLength(1);
    const review = submitted[0]!.review!;
    expect(review.decision).toBe("approved");
    // 8 · an approval does not inherit an earlier rejection's words.
    expect(review.reasonCode).toBeNull();
    expect(review.reasonTitle).toBeNull();
    expect(review.humanComment).toBeNull();
    expect(review.correctiveAction).toBeNull();
    expect(s.rejection).toBeNull();
  });

  it("8 · an acceptance reports no rejection words even when the row carries them", async () => {
    /* THE MUTATION THIS CASE EXISTS FOR. Dropping the decision guard from the
       projection is invisible against an acceptance whose columns are empty —
       which is every acceptance in the live data today. The schema does not
       forbid a reviewer leaving a note when they accept, so the guard has to be
       tested against a row that has one. */
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 },
       { review: "approved", of: 2, at: "2026-01-02T10:00:00.000Z", carriesRejectionColumns: true }],
      { status: "approved" },
    );
    const s = submissionOf(await contextOf(seeded));
    const review = submittedOf(s)[0]!.review!;
    expect(review.decision).toBe("approved");
    for (const field of ["reasonCode", "reasonTitle", "humanComment", "correctiveAction"] as const) {
      expect(review[field], field).toBeNull();
    }
    // And nothing of those columns reaches the wire through this path.
    const json = JSON.stringify(s.history);
    expect(json).not.toContain("synthetic comment");
    expect(json).not.toContain("synthetic corrective action");
  });

  it("5 · rejected then approved keeps BOTH reviews, each on its own revision", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: "2026-01-04T10:00:00.000Z" }],
      { status: "approved" },
    );
    const result = await contextOf(seeded);
    expect(result.kind).toBe("approved");
    const s = submissionOf(result);
    const submitted = submittedOf(s);
    expect(submitted.map((r) => r.revisionNumber)).toEqual([2, 4]);
    expect(submitted[0]!.review!.decision).toBe("rejected");
    expect(submitted[0]!.review!.correctiveAction).not.toBeNull();
    expect(submitted[1]!.review!.decision).toBe("approved");
    expect(submitted[1]!.review!.correctiveAction).toBeNull();
    // The old field still says nothing once the report is accepted.
    expect(s.rejection).toBeNull();
  });

  it("6 · two corrections keep three versions and three reviews", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "rejected", of: 4, at: "2026-01-04T10:00:00.000Z" },
       { draft: 5 }, { submit: 6 }, { review: "approved", of: 6, at: "2026-01-06T10:00:00.000Z" }],
      { status: "approved" },
    );
    const result = await contextOf(seeded);
    const s = submissionOf(result);
    const submitted = submittedOf(s);
    expect(submitted.map((r) => r.revisionNumber)).toEqual([2, 4, 6]);
    expect(submitted.map((r) => r.review!.decision)).toEqual(["rejected", "rejected", "approved"]);
    expect(submitted.map((r) => r.kind)).toEqual(["initial_submission", "resubmission", "resubmission"]);
  });

  it("7 · each review sits on the revision it reviewed, not on a neighbour", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }],
      { status: "pending_review" },
    );
    const result = await contextOf(seeded);
    const s = submissionOf(result);
    const submitted = submittedOf(s);
    expect(submitted[0]!.revisionNumber).toBe(2);
    expect(submitted[0]!.review).not.toBeNull();
    // The version awaiting review has none — the earlier one's does not slide over.
    expect(submitted[1]!.revisionNumber).toBe(4);
    expect(submitted[1]!.review).toBeNull();
  });

  it("9 · 10 · order follows revisionNumber even when two reviews share a timestamp", async () => {
    const same = "2026-01-05T10:00:00.000Z";
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: same },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: same }],
      { status: "approved" },
    );
    const s = submissionOf(await contextOf(seeded));
    const submitted = submittedOf(s);
    expect(submitted.map((r) => r.revisionNumber)).toEqual([2, 4]);
    expect(submitted.map((r) => r.review!.reviewedAt)).toEqual([same, same]);
    // Identical times, and still one fixed order — because the order is the
    // revision number, and `reviewedAt` is only when the event happened.
    expect(submitted.map((r) => r.review!.decision)).toEqual(["rejected", "approved"]);
  });

  it("11 · the old top-level rejection is unchanged in both directions", async () => {
    const rejected = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    const a = submissionOf(await contextOf(rejected));
    expect(a.rejection).not.toBeNull();
    expect(a.rejection!.reasonTitle).toBe("Нужна конкретика");
    expect(a.rejection!.reviewedAt).toBe("2026-01-02T10:00:00.000Z");

    const approved = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: "2026-01-04T10:00:00.000Z" }],
      { status: "approved" },
    );
    const b = submissionOf(await contextOf(approved));
    // Still null after acceptance — exactly as before this change.
    expect(b.rejection).toBeNull();
  });

  it("12 · the revision-detail route reports the reviewed version's own feedback", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: "2026-01-04T10:00:00.000Z" }],
      { status: "approved" },
    );
    const { getOwnReportRevision } = await import("@/lib/curriculum/report-submission");
    const rejectedOne = await getOwnReportRevision(
      seeded.userId, { stableCode: seeded.stableCode, locale: LOCALE, revisionNumber: 2 }, { db },
    );
    expect(rejectedOne.kind).toBe("resolved");
    const r = (rejectedOne as unknown as { revision: RevisionDetail }).revision;
    expect(r.feedback).not.toBeNull();
    expect(r.feedback!.reasonTitle).toBe("Нужна конкретика");
    expect(r.review!.decision).toBe("rejected");

    const approvedOne = await getOwnReportRevision(
      seeded.userId, { stableCode: seeded.stableCode, locale: LOCALE, revisionNumber: 4 }, { db },
    );
    const a = (approvedOne as unknown as { revision: RevisionDetail }).revision;
    // An acceptance is not a rejection: the older field stays null.
    expect(a.feedback).toBeNull();
    expect(a.review!.decision).toBe("approved");
  });

  it("13 · the field is additive, so a consumer that ignores it still reads everything", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "approved", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "approved" },
    );
    const s = submissionOf(await contextOf(seeded));
    for (const key of [
      "status", "workflowVersion", "activeRevisionNumber", "submittedRevisionNumber",
      "approvedRevisionNumber", "fieldValues", "firstSubmittedAt", "submittedAt", "rejection", "history",
    ]) {
      expect(Object.keys(s), key).toContain(key);
    }
    const entry = (s.history as Array<Record<string, unknown>>)[0]!;
    for (const key of ["revisionNumber", "kind", "createdAt", "submittedAt"]) {
      expect(Object.keys(entry), key).toContain(key);
    }
    // Exactly one key was added, and it is the one this phase is about.
    expect(Object.keys(entry).sort()).toEqual(
      ["createdAt", "kind", "review", "revisionNumber", "submittedAt"],
    );
  });

  it("14 · another learner reads nothing of this submission", async () => {
    const mine = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    const theirs = await seedReportScenario(db, [{ draft: 1 }], { status: "draft" });
    const { resolveOwnReportContext } = await import("@/lib/curriculum/report-submission");
    const cross = await resolveOwnReportContext({
      actorUserId: theirs.userId, locale: LOCALE, stableCode: mine.stableCode, db,
    });
    /* THE READ IS SCOPED TO THE ACTOR, NOT TO THE CODE. Each learner here is
       enrolled in their own version, and both levels carry the same stable
       code — which is the sharper test: asking with someone else's code returns
       YOUR OWN state, never theirs. */
    const json = JSON.stringify(cross);
    expect(cross.kind).toBe("draft");
    for (const leaked of ["synthetic comment", "synthetic corrective action", "Нужна конкретика"]) {
      expect(json, leaked).not.toContain(leaked);
    }
    const own = submissionOf(cross);
    expect(own.history).toHaveLength(1);
    expect(own.history[0]!.kind).toBe("draft_autosave");
    expect(own.history[0]!.review).toBeNull();
  });

  it("15 · a blocked account fails closed", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    await db.user.update({ where: { id: seeded.userId }, data: { status: "blocked" } });
    const blocked = await contextOf(seeded);
    expect(blocked.kind).toBe("user_not_found");
    expect(JSON.stringify(blocked)).not.toContain("Нужна конкретика");
    await db.user.update({ where: { id: seeded.userId }, data: { status: "active" } });
  });

  it("16 · 17 · no internal field and no report answer reaches the history", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: "2026-01-04T10:00:00.000Z" }],
      { status: "approved" },
    );
    const s = submissionOf(await contextOf(seeded));
    const json = JSON.stringify(s.history);
    for (const forbidden of [
      "reviewerId", "reviewerRoleSnapshot", "claimedAt", "claimExpiresAt", "requestId",
      "payloadFingerprint", "rejectionReasonId", "revisionId", "submissionId", "scores",
      "reviewStartedAt", "contentFingerprint", "createdById", "mentor",
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // 17 · the learner's own answers live in `fieldValues`, not in the history.
    expect(json).not.toContain("note");
    expect(json).not.toContain("…");
    // And a bare `id` must not appear as a key.
    expect(json).not.toMatch(/"id"\s*:/);
  });

  it("18 · reading the history writes nothing", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    const before = {
      reviews: await db.reportReview.count(),
      revisions: await db.reportRevision.count(),
      receipts: await db.reportCommandReceipt.count(),
      submissions: await db.reportSubmission.count(),
    };
    const { listOwnReportRevisions, getOwnReportRevision } = await import("@/lib/curriculum/report-submission");
    await contextOf(seeded);
    await listOwnReportRevisions(seeded.userId, { stableCode: seeded.stableCode, locale: LOCALE }, { db });
    await getOwnReportRevision(seeded.userId, { stableCode: seeded.stableCode, locale: LOCALE, revisionNumber: 2 }, { db });
    const after = {
      reviews: await db.reportReview.count(),
      revisions: await db.reportRevision.count(),
      receipts: await db.reportCommandReceipt.count(),
      submissions: await db.reportSubmission.count(),
    };
    expect(after).toEqual(before);
  });

  it("the revisions list route carries the same field, correlated the same way", async () => {
    const seeded = await seedReportScenario(db, 
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: "2026-01-04T10:00:00.000Z" }],
      { status: "approved" },
    );
    const { listOwnReportRevisions } = await import("@/lib/curriculum/report-submission");
    const list = await listOwnReportRevisions(
      seeded.userId, { stableCode: seeded.stableCode, locale: LOCALE, limit: 50 }, { db },
    );
    expect(list.kind).toBe("resolved");
    const rows = (list as unknown as { revisions: HistoryEntry[] }).revisions;
    const submitted = rows.filter((r) => r.kind !== "draft_autosave");
    expect(submitted.map((r) => r.revisionNumber)).toEqual([2, 4]);
    expect(submitted.map((r) => r.review!.decision)).toEqual(["rejected", "approved"]);
    expect(rows.filter((r) => r.kind === "draft_autosave").every((r) => r.review === null)).toBe(true);
  });
});
