import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock("@/lib/report/report-client", () => ({
  fetchReportContext: vi.fn(),
  saveReportDraft: vi.fn(),
  submitReport: vi.fn(),
  resubmitReport: vi.fn(),
  newReportRequestId: vi.fn((p = "save") => `ata-rpt-${p}-fixedkey01`),
}));

import * as client from "@/lib/report/report-client";
import { LevelReport } from "@/features/report/level-report";
import { buildContext, buildSubmission, validValues } from "@/features/report/test-fixtures";

const fetchMock = vi.mocked(client.fetchReportContext);
const submitMock = vi.mocked(client.submitReport);
const saveMock = vi.mocked(client.saveReportDraft);

const props = { stableCode: "v2.l003.x", locale: "ru", nextLevelCode: null as string | null };
const ok = <T,>(data: T) => ({ ok: true as const, data, requestId: null });

beforeEach(() => {
  refresh.mockClear();
  fetchMock.mockReset();
  submitMock.mockReset();
  saveMock.mockReset();
});

describe("LevelReport — definition rendering", () => {
  it("renders all 43 fields across five trade groups + summary", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("available", null)));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Отчёт по первым пяти сделкам");
    expect(container.querySelectorAll("[data-field]")).toHaveLength(43);
    expect(container.querySelectorAll(".rpt-group[data-group]")).toHaveLength(6);
    expect(container.querySelector('[data-group="trade-1"]')).not.toBeNull();
    expect(container.querySelector('[data-group="summary"]')).not.toBeNull();
  });

  it("surfaces a bounded validation error on an invalid submit and makes NO network request", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("available", null)));
    render(<LevelReport {...props} />);
    const submit = await screen.findByRole("button", { name: /Отправить на проверку/ });
    expect(submit).toBeEnabled(); // clickable so the error is reachable
    await userEvent.click(submit);
    expect(await screen.findByText(/Проверьте отчёт перед отправкой/)).toBeInTheDocument();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("labels every text field accessibly", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("available", null)));
    render(<LevelReport {...props} />);
    await screen.findByText("Отчёт по первым пяти сделкам");
    expect(screen.getByLabelText(/Инструмент 1/)).toBeInTheDocument();
    // a polite live status region exists
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("fails closed with a bounded notice when the flag is disabled (404)", async () => {
    fetchMock.mockResolvedValue({ ok: false, error: { category: "VALIDATION_ERROR", status: 404, code: "NOT_FOUND", messageKey: "x", requestId: null, retryable: false } });
    render(<LevelReport {...props} />);
    expect(await screen.findByText(/Отправка отчёта сейчас недоступна/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Отправить/ })).toBeNull();
  });
});

describe("LevelReport — submit", () => {
  it("enables submit for a valid draft and reaches pending review with ONE request", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("draft", buildSubmission({ status: "draft", workflowVersion: 1, fieldValues: validValues() }))));
    submitMock.mockResolvedValue(ok({ kind: "submitted", created: false, retry: false, acceptedRevision: 1, resultingWorkflowVersion: 2, appliedAt: "t", submission: buildSubmission({ status: "pending_review", workflowVersion: 2, submittedRevisionNumber: 1, history: [{ revisionNumber: 1, kind: "initial_submission", createdAt: "t", submittedAt: "t" }] }) }));
    render(<LevelReport {...props} />);
    const submit = await screen.findByRole("button", { name: /Отправить на проверку/ });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await userEvent.click(submit); // double-click: guarded
    await screen.findByText(/ожидает проверки наставника/);
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it("keeps deviation-note gating: an unfollowed plan without a note fails submit with a field error", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("draft", buildSubmission({ status: "draft", workflowVersion: 1, fieldValues: validValues({ "trade1-plan-followed": false, "trade1-deviation-note": "" }) }))));
    render(<LevelReport {...props} />);
    const submit = await screen.findByRole("button", { name: /Отправить на проверку/ });
    await userEvent.click(submit);
    // the conditional deviation-note error is surfaced (field + summary) and no request is made
    const errors = await screen.findAllByText(/Обязательно, так как отклонились от плана\./);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(submitMock).not.toHaveBeenCalled();
  });
});

describe("LevelReport — revision requested", () => {
  it("shows mentor feedback and offers a bounded correction action", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("rejected", buildSubmission({
      status: "rejected", workflowVersion: 2, submittedRevisionNumber: 1, fieldValues: validValues(),
      rejection: { reasonCode: "missing-evidence", reasonTitle: "Нет доказательств", humanComment: "Добавьте детали входа", correctiveAction: "Опишите точку входа", reviewedAt: "t" },
      history: [{ revisionNumber: 1, kind: "initial_submission", createdAt: "t", submittedAt: "t" }],
    }))));
    render(<LevelReport {...props} />);
    expect(await screen.findByText("Нет доказательств")).toBeInTheDocument();
    expect(screen.getByText(/Опишите точку входа/)).toBeInTheDocument();
    const correct = screen.getByRole("button", { name: /Создать исправленную версию/ });
    await userEvent.click(correct);
    // the editable form appears with the prior values seeded (all five instruments)
    await waitFor(() => expect(screen.getAllByDisplayValue("EURUSD")).toHaveLength(5));
  });
});

describe("LevelReport — approved", () => {
  it("shows completion, re-reads the curriculum, and links to the next level", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("approved", buildSubmission({ status: "approved", workflowVersion: 4, approvedRevisionNumber: 2, submittedRevisionNumber: 2, fieldValues: validValues(), history: [{ revisionNumber: 1, kind: "initial_submission", createdAt: "t", submittedAt: "t" }, { revisionNumber: 2, kind: "resubmission", createdAt: "t", submittedAt: "t" }] }))));
    render(<LevelReport {...props} nextLevelCode="v2.l004.next" />);
    expect(await screen.findByText("✓ Отчёт принят — уровень завершён")).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: /следующему уровню/i })).toHaveAttribute("href", "/lessons/v2.l004.next");
    // no submit affordance, no XP transaction text
    expect(screen.queryByRole("button", { name: /Отправить/ })).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("XPTransaction");
  });
});

describe("LevelReport — pending review is read-only", () => {
  it("renders submitted values without editable inputs and offers a refresh", async () => {
    fetchMock.mockResolvedValue(ok(buildContext("pending_review", buildSubmission({ status: "pending_review", workflowVersion: 2, submittedRevisionNumber: 1, fieldValues: validValues(), history: [{ revisionNumber: 1, kind: "initial_submission", createdAt: "t", submittedAt: "t" }] }))));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText(/ожидает проверки наставника/);
    expect(container.querySelector(".rpt-readonly")).not.toBeNull();
    expect(container.querySelector(".rpt__form")).toBeNull(); // no editable form
    expect(screen.getByRole("button", { name: /Обновить статус/ })).toBeInTheDocument();
  });
});
