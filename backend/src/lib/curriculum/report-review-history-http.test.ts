import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { FIXTURE_LOCALE, seedReportScenario } from "@/lib/curriculum/report-review-history-fixture";

/**
 * THE REVIEW HISTORY OVER REAL HTTP, against a real database.
 *
 * The matrix beside this file proves what the projection returns. This proves
 * what a learner's browser actually receives: the exported route handler, the
 * real gate, the real Prisma singleton, a real `Request`, and the JSON body it
 * answers with — over a throwaway SQLite file seeded with synthetic rows.
 *
 * ONLY THE SESSION IS SUBSTITUTED. `getCurrentUser` is the one boundary that
 * cannot be reached without a browser; everything it feeds — `requireUser`,
 * `activePrincipal`, `gateReportSelf`, the flags, the route — runs for real, so
 * the blocked and signed-out cases below exercise the true gate rather than a
 * stand-in for it.
 */

process.env.CURRICULUM_V2_READ_ENABLED = "true";
process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
process.env.CURRICULUM_V2_REPORT_ENABLED = "true";

type SessionUser = { id: number; role: string; status: string } | null;
const session: { user: SessionUser } = { user: null };

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getCurrentUser: async () => session.user };
});

let dir: string;
let db: PrismaClient;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ata-report-http-"));
  const url = `file:${dir}/test.db`;
  execFileSync("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  // Set BEFORE the route is imported: the Prisma singleton reads this once.
  process.env.DATABASE_URL = url;
  db = new PrismaClient({ datasources: { db: { url } } });
}, 180_000);

afterAll(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function get(stableCode: string) {
  const { GET } = await import("@/app/api/curriculum/v2/levels/[stableCode]/report/route");
  const url = `http://backend.invalid/api/curriculum/v2/levels/${stableCode}/report?locale=${FIXTURE_LOCALE}`;
  const response = await GET(new Request(url), { params: Promise.resolve({ stableCode }) });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : null };
}

describe("the review history over HTTP", () => {
  it("answers an accepted report with both of its reviews, each on its own version", async () => {
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" },
       { draft: 3 }, { submit: 4 }, { review: "approved", of: 4, at: "2026-01-04T10:00:00.000Z" }],
      { status: "approved" },
    );
    session.user = { id: seeded.userId, role: "user", status: "active" };

    const { status, body } = await get(seeded.stableCode);
    expect(status).toBe(200);
    const submission = body.data.submission;
    expect(body.data.kind).toBe("approved");

    const submitted = submission.history.filter((r: { kind: string }) => r.kind !== "draft_autosave");
    expect(submitted.map((r: { revisionNumber: number }) => r.revisionNumber)).toEqual([2, 4]);
    expect(submitted[0].review.decision).toBe("rejected");
    expect(submitted[0].review.reasonTitle).toBe("Нужна конкретика");
    expect(submitted[0].review.correctiveAction).not.toBeNull();
    expect(submitted[1].review.decision).toBe("approved");
    expect(submitted[1].review.correctiveAction).toBeNull();
    // The pre-existing field still says nothing once the report is accepted.
    expect(submission.rejection).toBeNull();
  });

  it("carries no internal field and no answer text in the wire body", async () => {
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    session.user = { id: seeded.userId, role: "user", status: "active" };
    const { text, body } = await get(seeded.stableCode);
    const history = JSON.stringify(body.data.submission.history);
    for (const forbidden of [
      "reviewerId", "reviewerRoleSnapshot", "claimedAt", "claimExpiresAt", "requestId",
      "payloadFingerprint", "rejectionReasonId", "revisionId", "submissionId", "scores",
      "reviewStartedAt", "contentFingerprint", "createdById",
    ]) {
      expect(history, forbidden).not.toContain(forbidden);
    }
    expect(history).not.toMatch(/"id"\s*:/);
    // The learner's own answers live under `fieldValues`, never in the history.
    expect(history).not.toContain("synthetic value");
    expect(text).toContain("synthetic value");
  });

  it("shows a first-pass acceptance one version and no invented feedback", async () => {
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "approved", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "approved" },
    );
    session.user = { id: seeded.userId, role: "user", status: "active" };
    const { body } = await get(seeded.stableCode);
    const submitted = body.data.submission.history.filter((r: { kind: string }) => r.kind !== "draft_autosave");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].review.decision).toBe("approved");
    for (const field of ["reasonCode", "reasonTitle", "humanComment", "correctiveAction"]) {
      expect(submitted[0].review[field], field).toBeNull();
    }
  });

  it("refuses a signed-out request before reading anything", async () => {
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    session.user = null;
    const { status, text } = await get(seeded.stableCode);
    expect(status).toBe(401);
    expect(text).not.toContain("synthetic comment");
    expect(text).not.toContain("Нужна конкретика");
  });

  it("refuses a blocked account", async () => {
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    session.user = { id: seeded.userId, role: "user", status: "blocked" };
    const { status, text } = await get(seeded.stableCode);
    expect(status).toBe(403);
    expect(text).not.toContain("synthetic comment");
  });

  it("gives one learner nothing of another's review", async () => {
    const mine = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    const theirs = await seedReportScenario(db, [{ draft: 1 }], { status: "draft" });
    session.user = { id: theirs.userId, role: "user", status: "active" };
    const { status, text } = await get(mine.stableCode);
    expect(status).toBe(200);
    expect(text).not.toContain("synthetic comment");
    expect(text).not.toContain("synthetic corrective action");
    expect(text).not.toContain("Нужна конкретика");
  });

  it("writes nothing while answering", async () => {
    const seeded = await seedReportScenario(
      db,
      [{ draft: 1 }, { submit: 2 }, { review: "rejected", of: 2, at: "2026-01-02T10:00:00.000Z" }],
      { status: "rejected" },
    );
    session.user = { id: seeded.userId, role: "user", status: "active" };
    const before = [
      await db.reportReview.count(), await db.reportRevision.count(),
      await db.reportCommandReceipt.count(), await db.reportSubmission.count(),
    ];
    await get(seeded.stableCode);
    await get(seeded.stableCode);
    const after = [
      await db.reportReview.count(), await db.reportRevision.count(),
      await db.reportCommandReceipt.count(), await db.reportSubmission.count(),
    ];
    expect(after).toEqual(before);
  });
});
