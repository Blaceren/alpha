import * as React from "react";
import { describe, expect, it, vi, type Mock } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportDetail } from "./report-detail";
import type { ApprovalResult, DetailPayload, ReviewDetail } from "@/data/contracts/api/report-review";

/** A realistic 5-trade payload derived the way the backend publishes it. */
function payload(): DetailPayload {
  const fields = [{ code: "confirm-demo-only", type: "boolean", required: true, label: "Подтверждение", helpText: null }];
  const values: Record<string, string | number | boolean | string[]> = { "confirm-demo-only": true };
  for (let n = 1; n <= 5; n += 1) {
    fields.push(
      { code: `trade${n}-asset`, type: "short_text", required: true, label: "Актив", helpText: null },
      { code: `trade${n}-direction`, type: "single_choice", required: true, label: "Направление", helpText: null },
      { code: `trade${n}-plan-followed`, type: "boolean", required: true, label: "План соблюдён", helpText: null },
      { code: `trade${n}-deviation-note`, type: "long_text", required: false, label: "Отклонение", helpText: null },
    );
    values[`trade${n}-asset`] = `ASSET${n}`;
    values[`trade${n}-direction`] = "up";
    values[`trade${n}-plan-followed`] = n !== 1;
    if (n === 1) values[`trade1-deviation-note`] = "Отклонился от плана";
  }
  fields.push({ code: "summary-repeated-pattern", type: "long_text", required: true, label: "Паттерн", helpText: null });
  values["summary-repeated-pattern"] = "Повтор";
  return {
    owner: { displayName: "Learner A" },
    curriculum: { code: "ata-v2", versionNumber: 2 },
    level: { stableCode: "v2.l003.x", levelNumber: 3, title: "Первые 5 demo-сделок" },
    assignment: { versionNumber: 1, title: "Отчёт", instructions: "i", successCriteriaSummary: null, fields },
    rubric: {
      versionNumber: 1,
      criteria: [
        { code: "r1-process", categoryCode: "c", commentRequired: true, title: "R1", description: "d1" },
        { code: "r2-risk", categoryCode: "c", commentRequired: false, title: "R2", description: "d2" },
      ],
      scale: [{ code: "meets", label: "Соответствует", description: null }],
    },
    revision: { revisionNumber: 2, values },
    rejectionReasons: [{ code: "missing-evidence", title: "Нет доказательств", guidance: null }],
    attachments: [],
  };
}

function detail(over: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    submissionRef: "ref-a", access: "full", status: "pending_review",
    submittedRevision: 2, workflowVersion: 3, claimVersion: 1,
    submittedAt: "2026-07-26T10:00:00.000Z",
    claim: { state: "owned_by_you", expiresAt: "2026-07-26T11:00:00.000Z" },
    reviewStartedAt: null, payload: payload(), operationalWorkItem: null, ...over,
  };
}

const approvalResult = (over: Partial<ApprovalResult["completion"]> = {}): ApprovalResult => ({
  operation: "approve", created: true, retry: false, submissionRef: "ref-a",
  submittedRevision: 2, workflowVersion: 4, claimVersion: 2, reviewId: 7,
  completion: { xpTransactionId: null, xpAwarded: 0, levelNumber: 3, nextLevelNumber: 4, terminal: false, completedAt: "2026-07-26T10:30:00.000Z", ...over },
  appliedAt: "2026-07-26T10:30:00.000Z",
});

const detailOk = (d: ReviewDetail) => vi.fn().mockResolvedValue({ status: "success" as const, detail: d });

function mount(over: Partial<React.ComponentProps<typeof ReportDetail>> = {}) {
  const props = {
    submissionRef: "ref-a",
    onBack: vi.fn(),
    fetchDetailImpl: detailOk(detail()),
    claimImpl: vi.fn(),
    approveImpl: vi.fn().mockResolvedValue({ status: "success" as const, result: approvalResult() }),
    requestRevisionImpl: vi.fn().mockResolvedValue({
      status: "success" as const,
      result: { operation: "reject", created: true, retry: false, submissionRef: "ref-a", submittedRevision: 2, workflowVersion: 4, claimVersion: 2, claim: { state: "closed" as const, expiresAt: null, reviewerRole: "mentor" }, reasonCode: "missing-evidence", appliedAt: "x" },
    }),
    ...over,
  };
  render(<ReportDetail {...props} />);
  return props;
}

async function completeRubric(user: ReturnType<typeof userEvent.setup>) {
  for (const radio of screen.getAllByRole("radio", { name: "Соответствует" })) await user.click(radio);
  const comments = screen.getAllByLabelText(/^Комментарий/);
  await user.type(comments[0]!, "Полный процесс");
}

async function fillRevisionFields(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/причина доработки/i), "missing-evidence");
  await user.type(screen.getByLabelText(/комментарий ученику/i), "Добавьте доказательства");
  await user.type(screen.getByLabelText(/что именно исправить/i), "Приложите скриншоты");
}

describe("ReportDetail — claim gate", () => {
  it("asks the reviewer to claim before the payload is available", async () => {
    mount({ fetchDetailImpl: detailOk(detail({ access: "summary", payload: null, claim: { state: "unclaimed", expiresAt: null } })) });
    expect(await screen.findByText(/возьмите отчёт в работу/i)).toBeInTheDocument();
    // No report content and no decision controls before a claim.
    expect(screen.queryByText("ASSET1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /принять отчёт/i })).not.toBeInTheDocument();
  });

  it("claims with the exact CAS tuple from the summary tier", async () => {
    const user = userEvent.setup();
    const claimImpl = vi.fn().mockResolvedValue({
      status: "success" as const,
      result: { operation: "claim", created: true, retry: false, submissionRef: "ref-a", submittedRevision: 2, workflowVersion: 3, claimVersion: 1, claim: { state: "active" as const, expiresAt: null, reviewerRole: "mentor" }, reasonCode: null, appliedAt: "x" },
    });
    mount({
      fetchDetailImpl: detailOk(detail({ access: "summary", payload: null, claim: { state: "unclaimed", expiresAt: null } })),
      claimImpl,
    });
    await user.click(await screen.findByRole("button", { name: /взять в работу/i }));
    await waitFor(() => expect(claimImpl).toHaveBeenCalled());
    expect(claimImpl.mock.calls[0]![1]).toEqual({
      expectedWorkflowVersion: 3, expectedClaimVersion: 1, expectedSubmittedRevision: 2,
    });
  });

  it("blocks claiming a report held by another reviewer", async () => {
    mount({ fetchDetailImpl: detailOk(detail({ access: "summary", payload: null, claim: { state: "claimed", expiresAt: null } })) });
    expect(await screen.findByRole("button", { name: /взять в работу/i })).toBeDisabled();
  });
});

describe("ReportDetail — definition-driven content", () => {
  it("renders five trade groups and a summary group", async () => {
    mount();
    await screen.findByText(/содержание отчёта/i);
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByRole("heading", { name: `Сделка ${n}` })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: /итоги и выводы/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /общие подтверждения/i })).toBeInTheDocument();
  });

  it("renders exact submitted values, read-only", async () => {
    mount();
    await screen.findByText(/содержание отчёта/i);
    expect(screen.getByText("ASSET3")).toBeInTheDocument();
    // Read-only: no textbox anywhere carries a learner value.
    for (const box of screen.getAllByRole("textbox")) {
      expect(box).not.toHaveValue("ASSET3");
    }
  });

  it("shows a choice value as its stable code, never an invented label", async () => {
    mount();
    await screen.findByText(/содержание отчёта/i);
    expect(screen.getAllByText("up").length).toBeGreaterThan(0);
  });

  it("gives an unfilled conditional note explicit not-applicable semantics", async () => {
    mount();
    await screen.findByText(/содержание отчёта/i);
    // trade1 deviated (note present); trades 2-5 followed the plan.
    expect(screen.getByText("Отклонился от плана")).toBeInTheDocument();
    expect(screen.getAllByText(/не применимо — план соблюдён/i)).toHaveLength(4);
  });

  it("renders booleans as words", async () => {
    mount();
    await screen.findByText(/содержание отчёта/i);
    expect(screen.getAllByText("Да").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Нет").length).toBeGreaterThan(0);
  });

  it("fails visibly on an unknown field type", async () => {
    const broken = detail();
    broken.payload!.assignment.fields.push({ code: "weird-thing", type: "quantum", required: true, label: "Странное", helpText: null });
    broken.payload!.revision.values["weird-thing"] = "x";
    mount({ fetchDetailImpl: detailOk(broken) });
    expect(await screen.findByText(/не отображено безопасно/i)).toBeInTheDocument();
  });

  it("shows a revision timeline and is honest about prior revision content", async () => {
    mount();
    await screen.findByText(/история ревизий/i);
    expect(screen.getByText(/Ревизия №2 — на проверке/)).toBeInTheDocument();
    // The reviewer contract does not expose prior revision content; say so
    // rather than fabricating it.
    expect(screen.getByText(/не входит в контракт проверяющего/i)).toBeInTheDocument();
  });

  it("renders no attachment affordance", async () => {
    mount();
    await screen.findByText(/содержание отчёта/i);
    expect(screen.queryByText(/вложени/i)).not.toBeInTheDocument();
  });
});

describe("ReportDetail — decisions", () => {
  it("blocks approval while the rubric is incomplete", async () => {
    const user = userEvent.setup();
    const props = mount();
    await screen.findByText(/содержание отчёта/i);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));
    // No confirmation, no request.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.approveImpl).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });

  it("confirms before approving, and sends the complete rubric", async () => {
    const user = userEvent.setup();
    const props = mount();
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await user.click(screen.getByRole("button", { name: /да, принять/i }));

    await waitFor(() => expect(props.approveImpl).toHaveBeenCalledTimes(1));
    const [, input, key] = (props.approveImpl as unknown as Mock).mock.calls[0]!;
    expect(input.scores).toHaveLength(2);
    expect(input.expectedSubmittedRevision).toBe(2);
    expect(String(key)).toMatch(/^crm-approve-/);
  });

  it("renders the zero-reward receipt exactly as the server reported it", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));
    await user.click(await screen.findByRole("button", { name: /да, принять/i }));

    expect(await screen.findByText(/отчёт принят/i)).toBeInTheDocument();
    expect(screen.getByText(/Уровень 3 завершён на сервере/)).toBeInTheDocument();
    expect(screen.getByText(/Уровень 4 стал доступен/)).toBeInTheDocument();
    expect(screen.getByText("не создана")).toBeInTheDocument(); // xpTransactionId null
    expect(screen.getByText("0")).toBeInTheDocument(); // xpAwarded
  });

  it("does not fire a second command on a double click", async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    const approveImpl = vi.fn().mockReturnValue(new Promise((r) => { release = r; }));
    mount({ approveImpl });
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));
    const confirm = await screen.findByRole("button", { name: /да, принять/i });
    await user.click(confirm);
    // The dialog closes and a live region reports progress; a second click cannot
    // reach the handler, and the in-flight ref would refuse it anyway.
    expect(approveImpl).toHaveBeenCalledTimes(1);
    release({ status: "success", result: approvalResult() });
    await waitFor(() => expect(screen.getByText(/отчёт принят/i)).toBeInTheDocument());
    expect(approveImpl).toHaveBeenCalledTimes(1);
  });

  it("requires reason, feedback and corrective action before a revision request", async () => {
    const user = userEvent.setup();
    const props = mount();
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /отправить на доработку/i }));
    expect(props.requestRevisionImpl).not.toHaveBeenCalled();
    expect(screen.getByText(/заполните все поля/i)).toBeInTheDocument();
  });

  it("requests a revision with the contract fields and reports the non-completing result", async () => {
    const user = userEvent.setup();
    const props = mount();
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await fillRevisionFields(user);
    await user.click(screen.getByRole("button", { name: /отправить на доработку/i }));
    await user.click(await screen.findByRole("button", { name: /да, на доработку/i }));

    await waitFor(() => expect(props.requestRevisionImpl).toHaveBeenCalledTimes(1));
    const [, input, key] = (props.requestRevisionImpl as unknown as Mock).mock.calls[0]!;
    expect(input.reasonCode).toBe("missing-evidence");
    expect(input.humanComment).toBe("Добавьте доказательства");
    expect(input.correctiveAction).toBe("Приложите скриншоты");
    expect(String(key)).toMatch(/^crm-reject-/);

    expect(await screen.findByText(/отправлено на доработку/i)).toBeInTheDocument();
    expect(screen.getByText(/уровень не завершён/i)).toBeInTheDocument();
    expect(screen.getByText(/xp не начислен/i)).toBeInTheDocument();
  });

  it("shows a bounded stale state and offers a canonical refetch", async () => {
    const user = userEvent.setup();
    const approveImpl = vi.fn().mockResolvedValue({ status: "conflict" as const, code: "REPORT_WORKFLOW_VERSION_CONFLICT" });
    mount({ approveImpl });
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));
    await user.click(await screen.findByRole("button", { name: /да, принять/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/отчёт изменился/i);
    expect(alert).toHaveTextContent(/не применено/i);
    expect(screen.getByText("REPORT_WORKFLOW_VERSION_CONFLICT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /загрузить актуальное состояние/i })).toBeInTheDocument();
  });

  it("shows the reviewer-forbidden state without an auth loop", async () => {
    mount({ fetchDetailImpl: vi.fn().mockResolvedValue({ status: "forbidden" as const }) });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/нет доступа к проверке отчётов/i);
    expect(screen.getByRole("button", { name: /к очереди/i })).toBeInTheDocument();
  });

  it("shows the REPORT-disabled state", async () => {
    mount({ fetchDetailImpl: vi.fn().mockResolvedValue({ status: "flag_disabled" as const }) });
    expect(await screen.findByRole("alert")).toHaveTextContent(/отключена/i);
  });
});

describe("ReportDetail — confirmation dialog accessibility", () => {
  it("is a labelled modal that takes focus and closes on Escape", async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName();
    await waitFor(() => expect(dialog).toHaveFocus());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancel closes without deciding", async () => {
    const user = userEvent.setup();
    const props = mount();
    await screen.findByText(/содержание отчёта/i);
    await completeRubric(user);
    await user.click(screen.getByRole("button", { name: /принять отчёт/i }));
    await user.click(await screen.findByRole("button", { name: /отмена/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.approveImpl).not.toHaveBeenCalled();
  });
});

describe("LO-REVIEW-WORKITEM-UNREACHABLE-1 — the specialized view reconciles to the operational case", () => {
  it("links the canonical review to its Learner Operations work item", async () => {
    mount({
      fetchDetailImpl: detailOk(
        detail({
          operationalWorkItem: {
            caseId: "case_abc",
            reference: "LO-000007",
            status: "in_progress",
            assignedStaffDisplayName: "LO Наставник (synthetic)",
          },
        }),
      ),
    });
    const link = await screen.findByRole("link", { name: "LO-000007" });
    expect(link.getAttribute("href")).toBe("/cases/case_abc");
    expect(screen.getByText(/исполнитель: LO Наставник \(synthetic\)/)).toBeTruthy();
  });

  it("says nothing at all when there is no operational case", async () => {
    // Before the reconciler runs, a pre-integration report has no mirror. The
    // view must stay silent rather than inventing a placeholder reference.
    mount();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Операционная карточка")).toBeNull();
  });
});
