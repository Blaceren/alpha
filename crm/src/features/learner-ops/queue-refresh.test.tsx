/**
 * A NEW REQUEST IS NOTICED WITHOUT PRESSING «Обновить» (2026-10-04, launch audit).
 *
 * The open queue asks again every minute while its tab is in view, keeps the
 * table on screen while it does, and the tab's title counts the new requests.
 */
import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const item = (id: string, status: string) => ({
  id,
  reference: `LO-${id}`,
  type: "support",
  status,
  priority: "normal",
  subject: `Тема ${id}`,
  queueKey: "support",
  queueName: "Поддержка",
  learner: { id: 1, name: "Ученик" },
  assignedTo: null,
  assignmentVersion: 1,
  version: 1,
  openedAt: "2026-10-04T00:00:00.000Z",
  lastActivityAt: "2026-10-04T00:00:00.000Z",
  reopenCount: 0,
  sla: {
    policyKey: null,
    origin: null,
    firstResponse: { state: "running", dueAt: null, remainingMs: null, overdueMs: null },
    resolution: { state: "running", dueAt: null, remainingMs: null, overdueMs: null },
    breached: false,
  },
});

const fetchQueue = vi.fn();
vi.mock("@/application/api/learner-ops-client", () => ({
  fetchQueue: (...args: unknown[]) => fetchQueue(...args),
  fetchConfig: vi.fn(async () => ({
    status: "success",
    data: { queues: [], reasonCodes: [], slaPolicies: [], assignableStaff: [] },
  })),
  fetchKnowledge: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchVoc: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchQaReviews: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchAnalytics: vi.fn(async () => ({ status: "forbidden" })),
}));
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({
    session: {
      employeeId: "emp_1",
      displayName: "Тест",
      role: "support",
      effectivePermissions: ["learner_ops_view"],
      permissionVersion: 1,
      expiresAt: "2099-12-31T00:00:00.000Z",
    },
    setRole: null,
  }),
}));

import { LearnerOpsWorkspace, QUEUE_REFRESH_MS } from "./inbox-workspace";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  document.title = "Поддержка — ATA CRM";
  fetchQueue.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the open queue", () => {
  it("asks again every minute, keeps the table on screen, and counts new requests in the tab", async () => {
    fetchQueue.mockResolvedValueOnce({ status: "success", data: { items: [item("1", "in_progress")], nextCursor: null } });
    render(<LearnerOpsWorkspace />);
    expect(await screen.findByText("LO-1")).toBeInTheDocument();
    expect(document.title).toBe("Поддержка — ATA CRM");

    let release!: (v: unknown) => void;
    fetchQueue.mockReturnValueOnce(new Promise((r) => { release = r; }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUEUE_REFRESH_MS);
    });
    expect(fetchQueue).toHaveBeenCalledTimes(2);
    // The background ask does not blank the table.
    expect(screen.getByText("LO-1")).toBeInTheDocument();

    await act(async () => {
      release({ status: "success", data: { items: [item("1", "in_progress"), item("2", "new")], nextCursor: null } });
    });
    expect(await screen.findByText("LO-2")).toBeInTheDocument();
    expect(document.title).toBe("(1) Поддержка — ATA CRM");
  });
});
