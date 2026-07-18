import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getReportDefinition,
  REPORT_LEVEL_NUMBER,
} from "@/features/report-level/data/report-fixtures";
import {
  PROVISIONAL_REVIEW_COMMENT,
  PROVISIONAL_REVIEW_SECTIONS,
} from "@/features/report-level/data/report-review-fixtures";
import { ReportWorkspace } from "@/features/report-level/components/report-workspace";
import { createReportStore } from "@/features/report-level/model/report-store";
import {
  createEmptyDraftV3,
  emptyReportWorkspaceV3,
  getStoredDraftV3,
  withDraftV3,
  withEntryFieldV3,
  withRevisionRequestedV3,
  withSubmittedV3,
  withSummaryV3,
  type ReportDraftV3,
} from "@/features/report-level/model/report-workspace-v3";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;

function readyDraft(): ReportDraftV3 {
  let draft = createEmptyDraftV3(definition);
  for (const entry of draft.entries) {
    draft = withEntryFieldV3(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummaryV3(draft, "итог по пяти записям");
}

function pendingDraft(): ReportDraftV3 {
  return withSubmittedV3(readyDraft(), "2026-07-17T10:00:00.000Z");
}

/** The report exactly as the dev/test adapter would leave it. */
function revisionDraft(): ReportDraftV3 {
  return withRevisionRequestedV3(pendingDraft(), definition, {
    comment: PROVISIONAL_REVIEW_COMMENT,
    sections: PROVISIONAL_REVIEW_SECTIONS,
    receivedAt: "2026-07-18T09:00:00.000Z",
  });
}

function seed(draft: ReportDraftV3) {
  createReportStore().write(withDraftV3(emptyReportWorkspaceV3(), draft));
}

const renderReport = (verdictAdapter: "revision-requested" | null = null) =>
  render(
    <ReportWorkspace definition={definition} scenario="report" verdictAdapter={verdictAdapter} />,
  );

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/* ================================================================== *
 * revision-requested — the read model on screen
 * ================================================================== */

describe("revision-requested presentation", () => {
  it("shows the status, the kept-work line and the browser-local truth", () => {
    seed(revisionDraft());
    renderReport();

    expect(screen.getByText("Нужна доработка")).toBeInTheDocument();
    expect(screen.getByText(/Все записи и итоговое наблюдение сохранены/)).toBeInTheDocument();
    expect(screen.getByText(/Вердикт записан только в этом браузере/)).toBeInTheDocument();
    expect(screen.getByText(/Серверная проверка пока не подключена/)).toBeInTheDocument();
  });

  it("shows the full review comment with its provisional marking", () => {
    seed(revisionDraft());
    renderReport();

    expect(screen.getByText("Комментарий проверки")).toBeInTheDocument();
    expect(screen.getByText(`«${PROVISIONAL_REVIEW_COMMENT}»`)).toBeInTheDocument();
    expect(screen.getAllByText(/dev\/test · provisional/).length).toBeGreaterThan(0);
  });

  it("offers two human-labelled jump links — raw section ids never render", () => {
    seed(revisionDraft());
    const { container } = renderReport();

    expect(
      screen.getByRole("button", { name: /Запись 03 · Что заметил после сделки/ }),
    ).toBeInTheDocument();
    // Exact name: distinguishes the jump link from «дальше — Итоговое наблюдение».
    expect(screen.getByRole("button", { name: "Итоговое наблюдение" })).toBeInTheDocument();

    // The raw model ids must appear NOWHERE: not as text, not in accessible names.
    expect(container.innerHTML).not.toContain("report.003.entry");
    expect(container.innerHTML).not.toContain("report.003.summary");
  });

  it("opens the first flagged entry as the current one", () => {
    seed(revisionDraft());
    renderReport();

    expect(screen.getByRole("heading", { level: 3, name: "Запись 3" })).toBeInTheDocument();
    expect(screen.getByText(/требует внимания · доработка 1 из 2/)).toBeInTheDocument();
  });

  it("keeps ordinary entries accessible and never labels them «без пометок»", () => {
    seed(revisionDraft());
    renderReport();

    // Ordinary rows stay clickable rows with their normal wording.
    const row1 = screen.getByRole("button", { name: /^Запись 1: заполнена/ });
    expect(row1).toBeEnabled();
    expect(screen.queryByText(/без пометок/)).not.toBeInTheDocument();
  });

  it("marks the flagged summary in words on the reflection surface", () => {
    seed(revisionDraft());
    renderReport();
    expect(screen.getByText(/требует внимания · доработка 2 из 2/)).toBeInTheDocument();
  });

  it("keeps the fields editable — the same work, not a copy", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    const field = screen.getByLabelText("Что заметил после сделки");
    expect(field).not.toHaveAttribute("readonly");
    await user.type(field, " — дополнено");
    expect(field).toHaveValue("наблюдение 3 — дополнено");
  });

  it("shows the pass line in words — never a percentage, a stepper or red error words", () => {
    seed(revisionDraft());
    const { container } = renderReport();

    expect(screen.getByText(/Доработка 1 из 2/)).toBeInTheDocument();
    const body = container.textContent ?? "";
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body.toLowerCase()).not.toMatch(/ошибка|неверно|провален|отклон/);
  });

  it("contains no mentor identity, avatar, countdown or financial values", () => {
    seed(revisionDraft());
    const { container } = renderReport();

    const body = container.textContent ?? "";
    expect(body).not.toContain("Alex Curie");
    expect(body).not.toMatch(/осталось.*(час|минут)/i);
    expect(container.querySelectorAll(".rl-page img")).toHaveLength(0);
    expect(body).not.toMatch(/баланс|депозит|profit|score/i);
  });
});

/* ================================================================== *
 * The pass — jump links and movement
 * ================================================================== */

describe("revision pass", () => {
  it("the entry jump link moves focus into the flagged field", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Запись 03 · Что заметил после сделки/ }));
    expect(screen.getByLabelText("Что заметил после сделки")).toHaveFocus();
  });

  it("the summary jump link moves focus into the reflection and completes the pass", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Итоговое наблюдение" }));
    expect(screen.getByRole("textbox", { name: "Итоговое наблюдение" })).toHaveFocus();
    expect(screen.getByText(/Доработка 2 из 2/)).toBeInTheDocument();
    expect(screen.getByText(/просмотрены — работа снова целиком ваша/)).toBeInTheDocument();
  });

  it("focusing the summary by hand also advances the pass — no link required", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.click(screen.getByRole("textbox", { name: "Итоговое наблюдение" }));
    expect(screen.getByText(/Доработка 2 из 2/)).toBeInTheDocument();
  });

  it("«дальше» advances to the next flagged place", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: /дальше — Итоговое наблюдение/ })[0]!);
    expect(screen.getByRole("textbox", { name: "Итоговое наблюдение" })).toHaveFocus();
  });
});

/* ================================================================== *
 * editing-revision → ready-to-resubmit → resubmit
 * ================================================================== */

describe("resubmit", () => {
  it("asks for changes calmly until a real change lands", () => {
    seed(revisionDraft());
    renderReport();

    expect(screen.getByText("Внесите изменения после комментария проверки.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отправить на проверку повторно" }),
    ).toBeDisabled();
  });

  it("a meaningful change in ANY field enables the resubmit CTA", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    // Entry 3 is open; edit an UNMARKED optional field of it — guidance, not a
    // validator (DD-287).
    await user.type(screen.getByLabelText(/Когда/), "среда, вечер");

    expect(
      screen.getByText("Есть изменения после вердикта — можно отправить на проверку повторно."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Отправить на проверку повторно" })).toBeEnabled();
  });

  it("a whitespace-only edit does not enable resubmit", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Что заметил после сделки"), "  ");
    expect(screen.getByRole("button", { name: "Отправить на проверку повторно" })).toBeDisabled();
  });

  it("confirmation dialog explains the consequences and offers the two honest actions", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Что заметил после сделки"), " — условие записано");
    await user.click(screen.getByRole("button", { name: "Отправить на проверку повторно" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Отправить отчёт на проверку повторно?" }),
    ).toBeInTheDocument();

    const text = dialog.textContent ?? "";
    expect(text).toMatch(/Редактирование снова будет заблокировано/);
    expect(text).toMatch(/только в этом браузере/);
    expect(text).toMatch(/останется закрыт до результата проверки/);
    expect(text).toMatch(/Автоматического одобрения нет/);
    expect(text).toMatch(/серверная проверка пока не подключена/i);
    expect(within(dialog).queryByText(/наставнику/i)).not.toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "Продолжить доработку" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Отправить повторно" })).toBeVisible();
  });

  it("cancelling keeps the revision editable and stores nothing new", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Что заметил после сделки"), " — правка");
    await user.click(screen.getByRole("button", { name: "Отправить на проверку повторно" }));
    await user.click(screen.getByRole("button", { name: "Продолжить доработку" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getStoredDraftV3(createReportStore().read(), 3)?.status).toBe("revision-requested");
  });

  it("confirming returns the report to «На проверке», read-only, review preserved", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Что заметил после сделки"), " — условие записано");
    await user.click(screen.getByRole("button", { name: "Отправить на проверку повторно" }));
    await user.click(screen.getByRole("button", { name: "Отправить повторно" }));

    expect(screen.getByText("На проверке")).toBeInTheDocument();
    expect(
      screen.getByText(/Исправления отмечены как отправленные только в этом браузере/),
    ).toBeInTheDocument();

    // Read-only again, by construction.
    expect(screen.getByLabelText("Что заметил после сделки")).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Итоговое наблюдение" })).toHaveAttribute(
      "readonly",
    );

    // The stored record: pending again, submittedAt moved, review kept.
    const stored = getStoredDraftV3(createReportStore().read(), 3)!;
    expect(stored.status).toBe("pending-review");
    expect(stored.review?.comment).toBe(PROVISIONAL_REVIEW_COMMENT);
    expect(stored.submittedAt).not.toBe("2026-07-17T10:00:00.000Z");

    // No lesson progress was written — pending is not completion.
    expect(window.sessionStorage.getItem("ata.lesson-progress.v1")).toBeNull();
    expect(window.localStorage.getItem("ata.lesson-progress.v1")).toBeNull();
  });

  it("after resubmit the former feedback reads as quiet context, not a task list", async () => {
    seed(revisionDraft());
    renderReport();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Что заметил после сделки"), " — дополнено");
    await user.click(screen.getByRole("button", { name: "Отправить на проверку повторно" }));
    await user.click(screen.getByRole("button", { name: "Отправить повторно" }));

    expect(screen.getByText("Комментарий последней проверки")).toBeInTheDocument();
    expect(screen.getByText(`«${PROVISIONAL_REVIEW_COMMENT}»`)).toBeInTheDocument();
    // Not an active list: the jump links are gone.
    expect(screen.queryByRole("button", { name: /Запись 03/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Доработка \d из/)).not.toBeInTheDocument();
  });
});

/* ================================================================== *
 * The dev/test verdict adapter (DD-286)
 * ================================================================== */

describe("verdict adapter", () => {
  it("turns a pending report into revision-requested under the report scenario", () => {
    seed(pendingDraft());
    renderReport("revision-requested");

    expect(screen.getByText("Нужна доработка")).toBeInTheDocument();
    const stored = getStoredDraftV3(createReportStore().read(), 3)!;
    expect(stored.status).toBe("revision-requested");
    expect(stored.review?.comment).toBe(PROVISIONAL_REVIEW_COMMENT);
    // The verdict writes the report workspace ONLY.
    expect(window.sessionStorage.getItem("ata.lesson-progress.v1")).toBeNull();
  });

  it("does nothing to a draft — a verdict cannot precede a submit", () => {
    seed(readyDraft());
    renderReport("revision-requested");

    expect(screen.queryByText("Нужна доработка")).not.toBeInTheDocument();
    expect(getStoredDraftV3(createReportStore().read(), 3)?.status).toBe("draft");
  });

  it("does not re-verdict a resubmitted report — one verdict per explicit query", async () => {
    seed(revisionDraft());
    renderReport("revision-requested");
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Что заметил после сделки"), " — дополнено");
    await user.click(screen.getByRole("button", { name: "Отправить на проверку повторно" }));
    await user.click(screen.getByRole("button", { name: "Отправить повторно" }));

    // Still pending: the adapter saw review !== null and stayed out.
    expect(screen.getByText("На проверке")).toBeInTheDocument();
    expect(getStoredDraftV3(createReportStore().read(), 3)?.status).toBe("pending-review");
  });
});

/* ================================================================== *
 * Canonical profile isolation
 * ================================================================== */

describe("canonical profile", () => {
  it("a stored revision never re-labels the completed level 3 for Артём (L18)", () => {
    seed(revisionDraft());
    render(<ReportWorkspace definition={definition} scenario="active" />);

    // Archive mode: no verdict chrome, no resubmit, read-only.
    expect(screen.queryByText("Нужна доработка")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Отправить на проверку повторно" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/уже пройден в текущем профиле/)).toBeInTheDocument();
  });
});
