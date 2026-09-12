/**
 * LO-UI-CASE-CREATE-1 — the affordance is gated, and hiding it is NOT the gate.
 *
 * Two separate assertions, deliberately. The first is about the UI: a principal
 * without `learner_ops_handle` is not shown a control it cannot use. The second
 * is the one that matters: the CRM never treats that hiding as the boundary —
 * the backend enforces the identical permission on POST, which
 * `learnerOperationsRegression` and the live 403 probes cover.
 */
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/application/api/learner-ops-client", () => ({
  fetchQueue: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchConfig: vi.fn(async () => ({
    status: "success",
    data: { queues: [], reasonCodes: [], slaPolicies: [], assignableStaff: [] },
  })),
  fetchKnowledge: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchVoc: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchQaReviews: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchAnalytics: vi.fn(async () => ({ status: "forbidden" })),
}));

let permissions: readonly string[] = [];
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({
    session: {
      employeeId: "emp_1",
      displayName: "Тест",
      role: "support",
      effectivePermissions: permissions,
      permissionVersion: 1,
      expiresAt: "2099-12-31T00:00:00.000Z",
    },
    setRole: null,
  }),
}));

import { LearnerOpsWorkspace } from "./inbox-workspace";

describe("create affordance visibility", () => {
  it("is offered to a principal holding learner_ops_handle", async () => {
    permissions = ["learner_ops_view", "learner_ops_handle"];
    render(<LearnerOpsWorkspace />);
    expect(await screen.findByRole("button", { name: "Создать кейс" })).toBeInTheDocument();
  });

  it("is NOT offered to a view-only principal", async () => {
    permissions = ["learner_ops_view"];
    render(<LearnerOpsWorkspace />);
    // The queue still renders — this principal may look.
    await waitFor(() => expect(screen.getByText("Работа")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Создать кейс" })).not.toBeInTheDocument();
  });

  it("renders nothing at all for a principal with no Learner Operations permission", async () => {
    permissions = [];
    render(<LearnerOpsWorkspace />);
    expect(await screen.findByText("Недоступно для вашей роли")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Создать кейс" })).not.toBeInTheDocument();
  });
});
