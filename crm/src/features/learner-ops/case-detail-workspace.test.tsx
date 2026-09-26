/**
 * LEARNER-OPERATIONS-V1 — the CRM half of the internal-note invariant.
 *
 * The backend regression proves a note cannot REACH a learner. This proves the
 * operator cannot SEND one by accident: the two composers are separate
 * controls, hitting separate endpoints, with headings that say who will see the
 * text — and there is no visibility toggle anywhere on the screen that could
 * turn one into the other.
 *
 * It also pins the two §29 states this surface must always have: the bounded
 * permission-denied panel, and the conflict message a stale screen receives
 * instead of silently overwriting a colleague.
 */
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn();
const addNote = vi.fn();
const transitionCase = vi.fn();

const CASE = {
  id: "case_1",
  reference: "LO-000001",
  type: "support_request" as const,
  status: "in_progress" as const,
  priority: "normal" as const,
  subject: "Не открывается урок",
  queueKey: "support",
  queueName: "Поддержка",
  learner: { id: 42, name: "Ученик Тест" },
  assignedTo: { staffId: "emp_1", displayName: "Оператор" },
  assignmentVersion: 1,
  version: 4,
  openedAt: "2026-08-16T09:00:00.000Z",
  lastActivityAt: "2026-08-16T09:30:00.000Z",
  reopenCount: 0,
  sla: {
    policyKey: "preprod_fixture_normal",
    origin: "preprod_acceptance_fixture" as const,
    firstResponse: { state: "met" as const, dueAt: null, remainingMs: null, overdueMs: null },
    resolution: { state: "running" as const, dueAt: null, remainingMs: 1000, overdueMs: null },
    breached: false,
  },
  details: "Ошибка при загрузке",
  reasonCode: null,
  resolvedAt: null,
  closedAt: null,
  reopenedAt: null,
  firstRespondedAt: "2026-08-16T09:20:00.000Z",
  anchor: null,
  allowedTransitions: ["open", "waiting_learner", "waiting_internal", "waiting_external", "escalated", "resolved", "closed"],
};

vi.mock("@/application/api/learner-ops-client", () => ({
  fetchCase: vi.fn(async () => ({ status: "success", data: CASE })),
  fetchMessages: vi.fn(async () => ({
    status: "success",
    data: {
      items: [
        {
          id: "m1",
          authorKind: "staff",
          authorName: "Оператор",
          body: "ВИДНО-УЧЕНИКУ здравствуйте",
          createdAt: "2026-08-16T09:20:00.000Z",
          readByLearnerAt: null,
        },
      ],
      nextCursor: null,
    },
  })),
  fetchNotes: vi.fn(async () => ({
    status: "success",
    data: {
      items: [
        {
          id: "n1",
          authorName: "Оператор",
          body: "СЛУЖЕБНОЕ проверить оплату",
          createdAt: "2026-08-16T09:25:00.000Z",
        },
      ],
      nextCursor: null,
    },
  })),
  fetchEvents: vi.fn(async () => ({ status: "success", data: { items: [], nextCursor: null } })),
  fetchEscalations: vi.fn(async () => ({ status: "success", data: { items: [] } })),
  fetchConfig: vi.fn(async () => ({
    status: "success",
    data: { queues: [], reasonCodes: [], slaPolicies: [], assignableStaff: [] },
  })),
  fetchLearner360: vi.fn(async () => ({ status: "not_found" })),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
  addNote: (...args: unknown[]) => addNote(...args),
  transitionCase: (...args: unknown[]) => transitionCase(...args),
  assignCase: vi.fn(async () => ({ status: "success", data: {} })),
  changePriority: vi.fn(async () => ({ status: "success", data: {} })),
  raiseEscalation: vi.fn(async () => ({ status: "success", data: {} })),
  resolveEscalation: vi.fn(async () => ({ status: "success", data: {} })),
  recordQa: vi.fn(async () => ({ status: "success", data: {} })),
}));

let permissions: readonly string[] = ["learner_ops_view", "learner_ops_handle"];

vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({
    session: {
      employeeId: "emp_1",
      displayName: "Оператор",
      role: "support",
      effectivePermissions: permissions,
      permissionVersion: 1,
      expiresAt: "2099-12-31T00:00:00.000Z",
    },
    setRole: null,
  }),
}));

import { CaseDetailWorkspace } from "./case-detail-workspace";

describe("case detail — internal notes and learner replies are separate controls", () => {
  beforeEach(() => {
    permissions = ["learner_ops_view", "learner_ops_handle"];
    sendMessage.mockReset().mockResolvedValue({ status: "success", data: {} });
    addNote.mockReset().mockResolvedValue({ status: "success", data: {} });
    transitionCase.mockReset().mockResolvedValue({ status: "success", data: {} });
  });

  it("labels each panel with who can see it", async () => {
    render(<CaseDetailWorkspace caseId="case_1" />);
    // Anchored on the headings: "ВИДНО УЧЕНИКУ" is a substring of
    // "НЕ ВИДНО УЧЕНИКУ", so a loose matcher would match both panels and prove
    // nothing about either.
    expect(
      await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Внутренние заметки — НЕ ВИДНО УЧЕНИКУ" }),
    ).toBeInTheDocument();
  });

  it("offers NO visibility toggle that could turn a note into a message", async () => {
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    // Any checkbox on the composer that flipped visibility would be exactly the
    // fragile design the two-table split exists to avoid.
    const checkboxes = screen.queryAllByRole("checkbox");
    for (const box of checkboxes) {
      const labelText = box.closest("label")?.textContent ?? "";
      expect(labelText).not.toMatch(/видн|visib|приват|internal|внутрен/i);
    }
  });

  it("sends a reply through the MESSAGE endpoint and never the note endpoint", async () => {
    const user = userEvent.setup();
    render(<CaseDetailWorkspace caseId="case_1" />);
    const box = await screen.findByLabelText(/Ответ ученику/);
    await user.type(box, "Разбираемся");
    await user.click(screen.getByRole("button", { name: /Отправить ученику/ }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith("case_1", "Разбираемся");
    expect(addNote).not.toHaveBeenCalled();
  });

  it("saves a note through the NOTE endpoint and never the message endpoint", async () => {
    const user = userEvent.setup();
    render(<CaseDetailWorkspace caseId="case_1" />);
    const box = await screen.findByLabelText(/Внутренняя заметка/);
    await user.type(box, "Проверить оплату");
    await user.click(screen.getByRole("button", { name: /Добавить заметку/ }));

    await waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));
    expect(addNote).toHaveBeenCalledWith("case_1", "Проверить оплату");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("carries the version the screen was showing on every state change", async () => {
    const user = userEvent.setup();
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    await user.selectOptions(screen.getByLabelText("Статус"), "resolved");

    await waitFor(() => expect(transitionCase).toHaveBeenCalledTimes(1));
    expect(transitionCase).toHaveBeenCalledWith("case_1", {
      expectedVersion: CASE.version,
      nextStatus: "resolved",
    });
  });

  it("tells the operator to refresh when somebody else moved first", async () => {
    transitionCase.mockResolvedValue({ status: "conflict", detail: "case is at version 5" });
    const user = userEvent.setup();
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    await user.selectOptions(screen.getByLabelText("Статус"), "resolved");

    expect(await screen.findByRole("status")).toHaveTextContent(/Состояние изменилось/);
  });

  it("shows the SLA fixture provenance rather than presenting it as policy", async () => {
    render(<CaseDetailWorkspace caseId="case_1" />);
    expect(await screen.findByText(/PREPROD-фикстура/)).toBeInTheDocument();
  });

  it("hides every composer from an operator who may only view", async () => {
    permissions = ["learner_ops_view"];
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    expect(screen.queryByLabelText(/Ответ ученику/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Внутренняя заметка/)).not.toBeInTheDocument();
    // And it says so, rather than rendering an empty panel that looks broken.
    expect(screen.getByText(/нет права отвечать ученику/)).toBeInTheDocument();
  });

  it("keeps the learner's own message visually distinct from staff replies", async () => {
    render(<CaseDetailWorkspace caseId="case_1" />);
    const thread = await screen.findByText(/ВИДНО-УЧЕНИКУ здравствуйте/);
    expect(within(thread.closest("li")!).getByText(/сотрудник/)).toBeInTheDocument();
  });
});

describe("LO-UI-TRANSITION-CHOICES-1 — the dropdown is the server's list", () => {
  it("offers exactly what the server said is allowed, and nothing else", async () => {
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    const values = within(screen.getByLabelText("Статус"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values.sort()).toEqual([...CASE.allowedTransitions].sort());
  });

  it("offers NOTHING illegal for a resolved case", async () => {
    // The exact defect: a resolved case used to offer in_progress and the three
    // waits, every one of which the server answered 400 to.
    const resolved = { ...CASE, status: "resolved" as const, allowedTransitions: ["open", "closed"] };
    const client = await import("@/application/api/learner-ops-client");
    vi.mocked(client.fetchCase).mockResolvedValueOnce({ status: "success", data: resolved } as never);

    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    const values = within(screen.getByLabelText("Статус"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values.sort()).toEqual(["closed", "open"]);
    for (const forbidden of ["in_progress", "waiting_learner", "waiting_internal", "waiting_external"]) {
      expect(values, `${forbidden} must not be offered`).not.toContain(forbidden);
    }
  });

  it("never renders the case's OWN status as a choice", async () => {
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByRole("heading", { name: "Переписка с учеником — ВИДНО УЧЕНИКУ" });
    const values = within(screen.getByLabelText("Статус"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain(CASE.status);
  });
});

describe("LO-ESCALATION-RESOLVE-AUTHORITY-1 — raise and resolve are different controls", () => {
  const OPEN_ESCALATION = {
    items: [
      {
        id: "esc_1",
        class: "educational_methodology",
        reason: "Нужна оценка методиста",
        raisedBy: "LO Оператор",
        raisedAt: "2026-08-16T01:26:00.000Z",
        targetQueue: { key: "escalation", name: "Эскалации" },
        targetStaff: null,
        resolvedAt: null,
        resolution: null,
        resolvedBy: null,
        returnedToOwnerAt: null,
      },
    ],
  };

  async function renderWith(perms: readonly string[]) {
    permissions = perms;
    const client = await import("@/application/api/learner-ops-client");
    vi.mocked(client.fetchEscalations).mockResolvedValue({
      status: "success",
      data: OPEN_ESCALATION,
    } as never);
    render(<CaseDetailWorkspace caseId="case_1" />);
    await screen.findByText("Нужна оценка методиста");
  }

  it("shows the frontline NO resolve control — raising is not answering", async () => {
    // The exact pre-fix defect, inverted: `learner_ops_escalate` used to gate
    // the resolve form, so the party that raised the escalation could close it.
    await renderWith(["learner_ops_view", "learner_ops_handle", "learner_ops_escalate"]);
    expect(screen.queryByRole("button", { name: /Закрыть эскалацию/i })).toBeNull();
  });

  it("gives the mentor a resolve control", async () => {
    // The other half of the same defect: the authority the question was routed
    // to had no way to answer it.
    await renderWith([
      "learner_ops_view",
      "learner_ops_handle",
      "learner_ops_report_review",
      "learner_ops_mentor_review",
      "learner_ops_escalation_resolve",
    ]);
    expect(screen.getByRole("button", { name: /Закрыть эскалацию/i })).toBeTruthy();
  });

  it("does not give the mentor an escalate control either — the split cuts both ways", async () => {
    await renderWith([
      "learner_ops_view",
      "learner_ops_handle",
      "learner_ops_escalation_resolve",
    ]);
    expect(screen.queryByRole("button", { name: /^Эскалировать$/i })).toBeNull();
  });
});
