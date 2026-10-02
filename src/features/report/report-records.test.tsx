/**
 * THE REPORT AS RECORDS, AND THE REPORT NOBODY REVIEWS (2026-10-02).
 *
 * The 30-level program's first report — «Первые пять demo-сделок» — is five
 * trade records, at least one refusal record, up to two more that the learner
 * may add, and a check the platform makes by itself: «Ручной проверки нет.
 * Система проверяет формально». The form, its adapter and its machine all
 * gained behaviour for it, and `workspace-form-fidelity.test.tsx` stopped
 * holding `level-report.tsx` to the byte for exactly that reason. This file is
 * where that behaviour is held instead.
 *
 * The fixture has the SHAPE of the published definition (67 fields: 5 × 10,
 * 5 required for the first refusal, a switch and 5 conditional fields for each
 * of two more). It is not the definition — the Backend's is authoritative and
 * the stand's end-to-end walk fills the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
import { buildReportDefinition, isGroupActive, qualifiedFieldLabel } from "@/features/report/report-definition";
import { initialState, reducer } from "@/features/report/report-machine";
import { validateReport } from "@/features/report/report-validation";
import { MAX_LISTED_ERRORS } from "@/features/report/components/validation-summary";
import { makeError } from "@/lib/api/errors";
import {
  reportAcceptanceOf,
  type ReportCommandResult,
  type ReportContext,
  type ReportFieldDefinition,
  type ReportSubmission,
} from "@/lib/report/types";

const fetchMock = vi.mocked(client.fetchReportContext);
const submitMock = vi.mocked(client.submitReport);
const saveMock = vi.mocked(client.saveReportDraft);

/* ------------------------------------------------------------------ fixture */

let order = 0;
function field(
  stableKey: string,
  type: ReportFieldDefinition["type"],
  label: string,
  extra: Partial<ReportFieldDefinition> = {},
): ReportFieldDefinition {
  order += 1;
  return {
    stableKey,
    type,
    label,
    required: true,
    sortOrder: order,
    validation: type === "short_text" || type === "long_text" ? { minLength: 1, maxLength: 1000 } : null,
    requiredWhen: null,
    choices: [],
    helpText: "",
    placeholder: "",
    ...extra,
  };
}

const SOURCE = [{ code: "exchange", label: "Биржевой" }, { code: "otc", label: "Внебиржевой (OTC)" }];

function trade(n: number): ReportFieldDefinition[] {
  return [
    field(`trade${n}-datetime`, "short_text", "Дата и время"),
    field(`trade${n}-asset`, "short_text", "Актив"),
    field(`trade${n}-source`, "single_choice", "Биржевой или внебиржевой", { choices: SOURCE }),
    field(`trade${n}-direction`, "single_choice", "Направление", { choices: [{ code: "up", label: "Вверх" }, { code: "down", label: "Вниз" }] }),
    field(`trade${n}-amount`, "short_text", "Сумма"),
    field(`trade${n}-payout`, "short_text", "Payout"),
    field(`trade${n}-expiry`, "short_text", "Момент экспирации"),
    field(`trade${n}-basis`, "long_text", "Основание словами"),
    field(`trade${n}-result`, "single_choice", "Результат", { choices: [{ code: "profit", label: "В плюс" }, { code: "loss", label: "В минус" }, { code: "refund", label: "Возврат" }] }),
    field(`trade${n}-change`, "long_text", "Что бы изменил"),
  ];
}

function refusal(n: number): ReportFieldDefinition[] {
  const optional = n > 1;
  const when = optional ? { fieldCode: `refusal${n}-added`, operator: "equals" as const, value: true } : null;
  const extra = { required: !optional, requiredWhen: when };
  return [
    ...(optional ? [field(`refusal${n}-added`, "boolean", "Добавить ещё одну запись отказа", { required: false })] : []),
    field(`refusal${n}-datetime`, "short_text", "Дата и время", extra),
    field(`refusal${n}-asset`, "short_text", "Актив", extra),
    field(`refusal${n}-source`, "single_choice", "Биржевой или внебиржевой", { ...extra, choices: SOURCE }),
    field(`refusal${n}-checked`, "long_text", "Что проверялось", extra),
    field(`refusal${n}-why`, "long_text", "Почему не подошло", extra),
  ];
}

function fields(): ReportFieldDefinition[] {
  order = 0;
  return [...[1, 2, 3, 4, 5].flatMap(trade), ...[1, 2, 3].flatMap(refusal)];
}

/** `OMIT` leaves the field out entirely, as a Backend that predates it would. */
const OMIT = Symbol("omit");

function context(kind: ReportContext["kind"], submission: ReportSubmission | null, acceptance: unknown = "formal"): ReportContext {
  return {
    kind,
    submission,
    level: {
      levelNumber: 9,
      stableCode: "v2.l009.pervye-pyat-demo-sdelok-i-razbor",
      type: "report",
      title: "Первые пять demo-сделок и разбор",
      shortDescription: "",
      learningObjective: "",
      ...(acceptance === OMIT ? {} : { acceptance: acceptance as "formal" }),
    },
    assignment: {
      versionNumber: 1,
      locale: "ru",
      title: "Отчёт: первые пять demo-сделок",
      instructions: "Пять записей сделок и хотя бы одна запись отказа.",
      successCriteriaSummary: "Ручной проверки нет.",
      submitLabel: "Сдать отчёт",
      fields: fields(),
    },
  };
}

function complete(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (let n = 1; n <= 5; n += 1) {
    Object.assign(values, {
      [`trade${n}-datetime`]: `02.10 1${n}:00`,
      [`trade${n}-asset`]: "EUR/USD",
      [`trade${n}-source`]: "otc",
      [`trade${n}-direction`]: "up",
      [`trade${n}-amount`]: "10",
      [`trade${n}-payout`]: "90%",
      [`trade${n}-expiry`]: "3 минуты",
      [`trade${n}-basis`]: "Тренд вверх, откат к области.",
      [`trade${n}-result`]: "profit",
      [`trade${n}-change`]: "Ничего.",
    });
  }
  Object.assign(values, {
    "refusal1-datetime": "02.10 16:00",
    "refusal1-asset": "GBP/USD",
    "refusal1-source": "exchange",
    "refusal1-checked": "Состояние рынка.",
    "refusal1-why": "Состояние неясно.",
  });
  return { ...values, ...overrides };
}

function submission(partial: Partial<ReportSubmission> = {}): ReportSubmission {
  return {
    status: "draft",
    workflowVersion: 1,
    activeRevisionNumber: 1,
    submittedRevisionNumber: null,
    approvedRevisionNumber: null,
    fieldValues: {},
    firstSubmittedAt: null,
    submittedAt: null,
    rejection: null,
    history: [],
    ...partial,
  };
}

const ok = <T,>(data: T) => ({ ok: true as const, data, requestId: null });
const props = { stableCode: "v2.l009.x", locale: "ru", nextLevelCode: null as string | null, acceptance: "formal" as const };

beforeEach(() => {
  refresh.mockClear();
  fetchMock.mockReset();
  submitMock.mockReset();
  saveMock.mockReset();
});

/* ------------------------------------------------------------- the adapter */

describe("a report is a list of records", () => {
  const model = buildReportDefinition(context("available", null));

  it("groups five trades, then the refusals, and nothing is lost", () => {
    expect(model.groups.map((g) => [g.id, g.label, g.kind])).toEqual([
      ["trade-1", "Сделка 1", "trade"],
      ["trade-2", "Сделка 2", "trade"],
      ["trade-3", "Сделка 3", "trade"],
      ["trade-4", "Сделка 4", "trade"],
      ["trade-5", "Сделка 5", "trade"],
      ["refusal-1", "Отказ 1", "refusal"],
      ["refusal-2", "Отказ 2", "refusal"],
      ["refusal-3", "Отказ 3", "refusal"],
    ]);
    expect(model.fieldCount).toBe(67);
    const grouped = model.groups.reduce((n, g) => n + g.fields.length + (g.switchField ? 1 : 0), 0);
    expect(grouped).toBe(67);
    // A refusal is not a trade: only trades carry a trade index.
    expect(model.groups.filter((g) => g.tradeIndex !== null).map((g) => g.tradeIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it("lifts an optional record's on/off out of its fields", () => {
    const second = model.groups.find((g) => g.id === "refusal-2")!;
    expect(second.switchField?.stableKey).toBe("refusal2-added");
    expect(second.fields.map((f) => f.stableKey)).toEqual([
      "refusal2-datetime", "refusal2-asset", "refusal2-source", "refusal2-checked", "refusal2-why",
    ]);
    // The first refusal is part of the check: it has no switch.
    expect(model.groups.find((g) => g.id === "refusal-1")!.switchField).toBeNull();
  });

  it("a boolean that switches nothing stays an ordinary question", () => {
    const presentation = context("available", null);
    // No field depends on it any more.
    for (const f of presentation.assignment.fields) {
      if (f.requiredWhen?.fieldCode === "refusal2-added") f.requiredWhen = null;
    }
    const plain = buildReportDefinition(presentation).groups.find((g) => g.id === "refusal-2")!;
    expect(plain.switchField).toBeNull();
    expect(plain.fields.map((f) => f.stableKey)).toContain("refusal2-added");
  });

  it("an optional record is part of the report only while its switch is exactly true", () => {
    const second = model.groups.find((g) => g.id === "refusal-2")!;
    expect(isGroupActive(second, {})).toBe(false);
    expect(isGroupActive(second, { "refusal2-added": false })).toBe(false);
    expect(isGroupActive(second, { "refusal2-added": "true" })).toBe(false);
    expect(isGroupActive(second, { "refusal2-added": true })).toBe(true);
    expect(isGroupActive(model.groups[0]!, {})).toBe(true);
  });

  it("names a field by its record, so six «Дата и время» can be told apart", () => {
    expect(qualifiedFieldLabel(model, "trade4-datetime")).toBe("Сделка 4 · Дата и время");
    expect(qualifiedFieldLabel(model, "refusal1-why")).toBe("Отказ 1 · Почему не подошло");
    expect(qualifiedFieldLabel(model, "no-such-field")).toBe("no-such-field");
  });
});

describe("what the form checks before it asks the server", () => {
  const model = buildReportDefinition(context("available", null));

  it("five trades and one refusal are a complete report", () => {
    expect(validateReport(model, complete())).toEqual([]);
  });

  it("five trades and no refusal are not — «минимум один отказ»", () => {
    const values = complete();
    for (const key of Object.keys(values)) if (key.startsWith("refusal1-")) delete values[key];
    expect(validateReport(model, values).map((e) => e.stableKey)).toEqual([
      "refusal1-datetime", "refusal1-asset", "refusal1-source", "refusal1-checked", "refusal1-why",
    ]);
  });

  it("an added refusal must be filled like the first, in plain words", () => {
    const errors = validateReport(model, complete({ "refusal2-added": true, "refusal2-asset": "USD/JPY" }));
    expect(errors.map((e) => e.stableKey)).toEqual([
      "refusal2-datetime", "refusal2-source", "refusal2-checked", "refusal2-why",
    ]);
    // Not «так как отклонились от плана»: that sentence belongs to another report.
    expect(new Set(errors.map((e) => e.message))).toEqual(new Set(["Обязательное поле."]));
  });

  it("a record that is switched off is not checked, whatever was left in it", () => {
    // A value of the wrong shape in a record that is not part of the report.
    expect(validateReport(model, complete({ "refusal2-added": false, "refusal2-source": "nonsense" }))).toEqual([]);
    expect(validateReport(model, complete({ "refusal3-asset": 12 }))).toEqual([]);
  });
});

/* ------------------------------------------------------------- the machine */

describe("a report the platform accepts by itself", () => {
  const command = (over: Partial<ReportCommandResult>): ReportCommandResult => ({
    kind: "submitted", created: true, retry: false, acceptedRevision: 2, resultingWorkflowVersion: 3,
    appliedAt: "2026-10-02T12:00:00.000Z", submission: submission(), ...over,
  });
  const ready = () => {
    let s = reducer(initialState(), { type: "load_ok", context: context("draft", submission({ fieldValues: complete() })) });
    s = reducer(s, { type: "submit_pending", requestId: "ata-rpt-submit-1" });
    expect(s.status).toBe("SUBMITTING");
    return s;
  };

  it("is APPROVED the moment the Backend says the submission was accepted", () => {
    const s = reducer(ready(), {
      type: "submit_ok",
      result: command({ submission: submission({ status: "approved", workflowVersion: 3, fieldValues: complete(), submittedRevisionNumber: 2, approvedRevisionNumber: 2 }) }),
    });
    expect(s.status).toBe("APPROVED");
    expect(s.editing).toBe(false);
    expect(s.context?.kind).toBe("approved");
    expect(s.completion).toEqual({ levelNumber: 9, nextLevelNumber: null });
  });

  it("is still PENDING_REVIEW for a report a person reads", () => {
    const s = reducer(ready(), {
      type: "submit_ok",
      result: command({ submission: submission({ status: "pending_review", workflowVersion: 3 }) }),
    });
    expect(s.status).toBe("PENDING_REVIEW");
    expect(s.context?.kind).toBe("pending_review");
    expect(s.completion).toBeNull();
  });

  it("a server refusal of an incomplete report keeps the form, and says so", () => {
    const refused = reducer(ready(), {
      type: "submit_err",
      error: makeError("VALIDATION_ERROR", { status: 422, code: "REPORT_DRAFT_INPUT_INVALID" }),
    });
    expect(refused.status).toBe("VALIDATION_ERROR");
    expect(refused.editing).toBe(true);
    expect(refused.serverRefusal).toBe(true);
    expect(refused.inFlight).toBeNull();
    // …and the next edit clears it.
    const edited = reducer(refused, { type: "edit", stableKey: "trade1-asset", value: "GBP/USD" });
    expect(edited.serverRefusal).toBe(false);
    expect(edited.status).toBe("DRAFT_DIRTY");
  });

  it("reads who accepts a report from the report, and assumes a person for anything it does not recognise", () => {
    expect(reportAcceptanceOf(context("available", null, "formal"))).toBe("formal");
    expect(reportAcceptanceOf(context("available", null, "review"))).toBe("review");
    for (const odd of [OMIT, null, "", "auto", true, "FORMAL"]) {
      expect(reportAcceptanceOf(context("available", null, odd)), String(odd)).toBe("review");
    }
    expect(reportAcceptanceOf(null)).toBe("review");
  });
});

/* ---------------------------------------------------------------- the form */

describe("LevelReport — records on the page", () => {
  it("shows five trades and one refusal as records, and the two optional ones as a single control each", async () => {
    fetchMock.mockResolvedValue(ok(context("available", null)));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Отчёт: первые пять demo-сделок");
    const groups = [...container.querySelectorAll(".rpt-group[data-group]")].map((g) => [
      g.getAttribute("data-group"),
      g.getAttribute("data-active"),
    ]);
    expect(groups).toEqual([
      ["trade-1", "true"], ["trade-2", "true"], ["trade-3", "true"], ["trade-4", "true"], ["trade-5", "true"],
      ["refusal-1", "true"], ["refusal-2", "false"], ["refusal-3", "false"],
    ]);
    // 55 fields are on the page; the ten of the optional records are not.
    expect(container.querySelectorAll("[data-field]")).toHaveLength(55);
    expect(screen.getAllByRole("button", { name: "Добавить запись отказа" })).toHaveLength(2);
    // The switch is never rendered as a «Да / Нет» question.
    expect(container.querySelector('[data-field="refusal2-added"]')).toBeNull();
    expect(screen.queryByText("Добавить ещё одну запись отказа")).toBeNull();
  });

  it("counts what is filled in each record", async () => {
    const values = complete();
    for (const key of Object.keys(values)) if (key.startsWith("trade5-") || key.startsWith("refusal1-")) delete values[key];
    values["trade5-asset"] = "USD/JPY";
    fetchMock.mockResolvedValue(ok(context("draft", submission({ fieldValues: values }))));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Отчёт: первые пять demo-сделок");
    const fill = (id: string) => container.querySelector(`[data-group="${id}"] .rpt-group__fill`)?.textContent;
    expect(fill("trade-1")).toBe("заполнено 10 из 10");
    expect(fill("trade-5")).toBe("заполнено 1 из 10");
    expect(fill("refusal-1")).toBe("заполнено 0 из 5");
  });

  it("«Добавить запись отказа» opens the record; «Убрать» closes it and clears what was typed", async () => {
    fetchMock.mockResolvedValue(ok(context("draft", submission({ fieldValues: complete() }))));
    saveMock.mockResolvedValue(ok({ kind: "saved", created: false, retry: false, acceptedRevision: 2, resultingWorkflowVersion: 2, appliedAt: "t", submission: submission({ workflowVersion: 2 }) }));
    const user = userEvent.setup();
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Отчёт: первые пять demo-сделок");

    await user.click(within(container.querySelector('[data-group="refusal-2"]') as HTMLElement).getByRole("button", { name: "Добавить запись отказа" }));
    const record = container.querySelector('[data-group="refusal-2"]') as HTMLElement;
    expect(record.getAttribute("data-active")).toBe("true");
    expect(record.querySelectorAll("[data-field]")).toHaveLength(5);
    await user.type(within(record).getByLabelText(/Актив/), "USD/JPY");

    await user.click(within(record).getByRole("button", { name: "Убрать запись отказа" }));
    expect(container.querySelector('[data-group="refusal-2"]')?.getAttribute("data-active")).toBe("false");

    // What is saved next carries no trace of the record that was taken out.
    await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const sent = saveMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(sent["refusal2-added"]).toBe(false);
    expect(sent["refusal2-asset"]).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("USD/JPY");
  });

  it("an empty report names its first problems by record, counts the rest, and asks nothing of the server", async () => {
    fetchMock.mockResolvedValue(ok(context("available", null)));
    render(<LevelReport {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Сдать отчёт" }));
    await screen.findByText("Проверьте отчёт перед отправкой");
    const summary = document.querySelector(".rpt-summary") as HTMLElement;
    const links = within(summary).getAllByRole("link");
    expect(links).toHaveLength(MAX_LISTED_ERRORS);
    expect(links[0]).toHaveTextContent("Сделка 1 · Дата и время: Обязательное поле.");
    expect(within(summary).getByText(`и ещё ${55 - MAX_LISTED_ERRORS} — они отмечены в форме ниже.`)).toBeInTheDocument();
    expect(saveMock).not.toHaveBeenCalled();
    expect(submitMock).not.toHaveBeenCalled();
  });
});

describe("LevelReport — nobody reviews it, and nothing says somebody does", () => {
  const accepted = () =>
    submission({
      status: "approved",
      workflowVersion: 3,
      fieldValues: complete(),
      submittedRevisionNumber: 2,
      approvedRevisionNumber: 2,
      submittedAt: "2026-10-02T12:00:00.000Z",
      history: [
        { revisionNumber: 2, kind: "initial_submission", createdAt: "2026-10-02T12:00:00.000Z", submittedAt: "2026-10-02T12:00:00.000Z",
          review: { decision: "approved", reviewedAt: "2026-10-02T12:00:00.000Z", reasonCode: null, reasonTitle: null, humanComment: null, correctiveAction: null } },
      ],
    });

  it("says before anything is sent that the check is automatic", async () => {
    fetchMock.mockResolvedValue(ok(context("available", null)));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Отчёт: первые пять demo-сделок");
    expect(container.querySelector(".rpt")?.getAttribute("data-acceptance")).toBe("formal");
    expect(screen.getByText(/Проверка автоматическая: отчёт принимается сразу/)).toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/наставник/i);
  });

  it("a report a mentor reads says no such thing", async () => {
    fetchMock.mockResolvedValue(ok(context("available", null, "review")));
    const { container } = render(<LevelReport {...props} acceptance="review" />);
    await screen.findByText("Отчёт: первые пять demo-сделок");
    expect(container.querySelector(".rpt")?.getAttribute("data-acceptance")).toBe("review");
    expect(screen.queryByText(/Проверка автоматическая/)).toBeNull();
  });

  it("without the page's hint, the report's own word decides", async () => {
    fetchMock.mockResolvedValue(ok(context("available", null, "formal")));
    const { container } = render(<LevelReport stableCode="v2.l009.x" locale="ru" nextLevelCode={null} />);
    await screen.findByText("Отчёт: первые пять demo-сделок");
    expect(container.querySelector(".rpt")?.getAttribute("data-acceptance")).toBe("formal");
  });

  it("a complete report is accepted at submission: APPROVED, the curriculum re-read, never «ожидает проверки»", async () => {
    fetchMock.mockResolvedValue(ok(context("draft", submission({ fieldValues: complete() }))));
    submitMock.mockResolvedValue(ok({ kind: "submitted", created: true, retry: false, acceptedRevision: 2, resultingWorkflowVersion: 3, appliedAt: "t", submission: accepted() }));
    const { container } = render(<LevelReport {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: "Сдать отчёт" }));
    await waitFor(() => expect(container.querySelector(".rpt")?.getAttribute("data-status")).toBe("APPROVED"));
    expect(refresh).toHaveBeenCalledTimes(1);
    const status = container.querySelector(".rpt__status") as HTMLElement;
    expect(status).toHaveTextContent("Отчёт принят. Уровень завершён.");
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/ожидает проверки|наставник/i);
    // A clean, already saved draft is submitted as it stands: no extra save.
    expect(saveMock).not.toHaveBeenCalled();
    // The outcome of the learner's own action takes focus.
    expect(status).toHaveFocus();
  });

  it("an accepted report stays readable, closed by default, without the record that was never added", async () => {
    fetchMock.mockResolvedValue(ok(context("approved", accepted())));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Ваш отчёт");
    const own = container.querySelector("details.rpt-own") as HTMLDetailsElement;
    expect(own.open).toBe(false);
    expect(own.querySelectorAll(".rpt-readonly__group")).toHaveLength(6); // 5 trades + 1 refusal
    expect(own.textContent).toContain("Тренд вверх, откат к области.");
    expect(own.textContent).toContain("Внебиржевой (OTC)"); // a choice is shown by its label
    expect(own.textContent).not.toContain("Отказ 2");
  });

  it("opening a page on a report accepted earlier does not take focus", async () => {
    fetchMock.mockResolvedValue(ok(context("approved", accepted())));
    const { container } = render(<LevelReport {...props} />);
    await screen.findByText("Ваш отчёт");
    expect(container.querySelector(".rpt__status")).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it("offers the way onward itself only where the page around it does not", async () => {
    fetchMock.mockResolvedValue(ok(context("approved", accepted())));
    const here = render(<LevelReport {...props} nextLevelCode="v2.l010.x" />);
    expect(await screen.findByRole("link", { name: /следующему уровню/ })).toHaveAttribute("href", "/lessons/v2.l010.x");
    here.unmount();

    fetchMock.mockResolvedValue(ok(context("approved", accepted())));
    const elsewhere = render(<LevelReport {...props} nextLevelCode="v2.l010.x" nextStep="elsewhere" />);
    await screen.findByText("Ваш отчёт");
    expect(screen.queryByRole("link", { name: /следующему уровню/ })).toBeNull();
    // What is the report's own stays: the verdict, and what the learner wrote.
    expect(elsewhere.container.querySelector(".rpt-verdict")).toHaveTextContent("Работа принята");
    expect(elsewhere.container.querySelector(".rpt-own")).not.toBeNull();
  });
});
