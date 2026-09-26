/**
 * LO-REVIEW-WORKITEM-UNREACHABLE-1 §15 — the specialized mentor surface must
 * reconcile to the SAME operational work item the unified queue shows.
 *
 * The report-review surface got this first; the mentor surface shipped without
 * it, so the two review families documented their boundary differently. Found
 * during the Journey C live run, when LO-000009 existed and was correct
 * everywhere EXCEPT on the page a mentor actually works from.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MentorQueueItem } from "@/data/contracts/api/mentor-review";

const item = (over: Partial<MentorQueueItem> = {}): MentorQueueItem => ({
  progressId: 74,
  levelNumber: 14,
  stableCode: "v2.l014.lichnyy-risk-plan",
  levelTitle: "Личный Risk Plan",
  xpReward: 250,
  learnerUserId: 73,
  learnerName: "LO Mentor Learner (synthetic)",
  requestedAt: "2026-08-16T08:07:00.000Z",
  curriculumCode: "ata-v2",
  curriculumVersionNumber: 4,
  operationalWorkItem: null,
  ...over,
});

vi.mock("./use-mentor-queue", () => ({
  useMentorQueue: () => ({
    state: {
      kind: "ready",
      page: { items: (globalThis as { __items?: MentorQueueItem[] }).__items ?? [], nextCursor: null },
    },
    refresh: vi.fn(),
  }),
}));

async function mount(items: MentorQueueItem[]) {
  (globalThis as { __items?: MentorQueueItem[] }).__items = items;
  const { MentorReviewWorkspace } = await import("./mentor-review-workspace");
  render(<MentorReviewWorkspace />);
}

describe("mentor review surface — the operational pointer", () => {
  it("links the canonical review to its Learner Operations work item", async () => {
    await mount([
      item({
        operationalWorkItem: {
          caseId: "case_mentor_1",
          reference: "LO-000009",
          status: "in_progress",
          assignedStaffDisplayName: "LO Наставник (synthetic)",
        },
      }),
    ]);
    const link = await screen.findByRole("link", { name: "LO-000009" });
    expect(link.getAttribute("href")).toBe("/cases/case_mentor_1");
    expect(screen.getByText(/исполнитель: LO Наставник \(synthetic\)/)).toBeTruthy();
  });

  it("stays silent when no operational case exists rather than inventing one", async () => {
    await mount([item()]);
    await screen.findByText(/Личный Risk Plan/);
    expect(screen.queryByText(/очередь и SLA/)).toBeNull();
  });
});
