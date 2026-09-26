import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import { ReportWorkspace } from "@/features/report-level/components/report-workspace";
import { createReportStore } from "@/features/report-level/model/report-store";
import {
  createEmptyDraft,
  withDraft,
  withEntryField,
  withSubmitted,
  withSummary,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";
import { getStoredDraftV3 } from "@/features/report-level/model/report-workspace-v3";
import { emptyReportWorkspace } from "@/features/report-level/model/report-draft";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;

function readyDraft(): ReportDraft {
  let draft = createEmptyDraft(definition);
  for (const entry of draft.entries) {
    draft = withEntryField(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummary(draft, "итог по пяти записям");
}

/** Seed the browser-local store, as a previous visit would have. */
function seed(draft: ReportDraft) {
  const store = createReportStore();
  store.write(withDraft(emptyReportWorkspace(), draft));
}

/** The report is only live work under the report marker (DD-271). */
function renderReport(scenario: "report" | "active" = "report") {
  return render(<ReportWorkspace definition={definition} scenario={scenario} />);
}

describe("report workspace — the ledger", () => {
  it("renders the level identity from the curriculum fixture", () => {
    renderReport();
    expect(
      screen.getByRole("heading", { level: 1, name: "Первые пять demo-сделок" }),
    ).toBeInTheDocument();
    // The artifact is stated twice by design: once as the level's requirement and
    // once inside «Перед отправкой» as part of the agreement.
    expect(screen.getAllByText("Отчёт по 5 demo-сделкам").length).toBeGreaterThan(0);
    expect(screen.getByText(/Модуль 01 · Первое знакомство/)).toBeInTheDocument();
  });

  it("has exactly one h1", () => {
    renderReport();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows exactly five evidence entries — one open, four collapsed", () => {
    renderReport();
    const ledger = screen.getByRole("list", { name: /Журнал наблюдений/ });
    const items = within(ledger).getAllByRole("listitem");
    expect(items).toHaveLength(5);

    // Four collapsed rows are buttons; the open one is a panel, not a button.
    const rows = within(ledger).getAllByRole("button", { expanded: false });
    expect(rows).toHaveLength(4);
    // The name states the fact once, not three times over.
    expect(rows[0]).toHaveAccessibleName("Запись 2: не заполнена");
    expect(screen.getByRole("heading", { level: 3, name: "Запись 1" })).toBeInTheDocument();
  });

  it("says the artifact structure is prototype-only, not canonical", () => {
    renderReport();
    expect(screen.getByText(/Структура задания уточняется редакцией/)).toBeInTheDocument();
  });

  it("opens another entry on click, keeping exactly one open", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.click(screen.getByRole("button", { name: /^Запись 3:/ }));

    expect(screen.getByRole("heading", { level: 3, name: "Запись 3" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Запись 1" })).not.toBeInTheDocument();
    const ledger = screen.getByRole("list", { name: /Журнал наблюдений/ });
    expect(within(ledger).getAllByRole("button", { expanded: false })).toHaveLength(4);
  });

  it("opens an entry from the keyboard", async () => {
    const user = userEvent.setup();
    renderReport();

    const row = screen.getByRole("button", { name: /^Запись 2:/ });
    row.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { level: 3, name: "Запись 2" })).toBeInTheDocument();
  });

  it("labels every field and marks the optional ones", () => {
    renderReport();
    expect(screen.getByLabelText(/Когда/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Что решил/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Что заметил после сделки/)).toBeInTheDocument();
    // The reflection region and its textarea share the heading as their name;
    // the control is the one that must be reachable by that name.
    expect(screen.getByRole("textbox", { name: "Итоговое наблюдение" })).toBeInTheDocument();
  });

  it("carries no financial or trading-performance field", () => {
    renderReport();
    const body = document.body.textContent ?? "";
    for (const forbidden of [
      "Прибыль",
      "Убыток",
      "Профит",
      "Баланс",
      "Депозит",
      "Цена входа",
      "Цена выхода",
      "Объём",
      "Плечо",
      "P/L",
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("offers no Pocket link and no XP reward", () => {
    renderReport();
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Pocket");
    expect(body).not.toContain("XP");
    expect(document.querySelector('a[href*="pocket"]')).toBeNull();
  });
});

describe("report workspace — readiness", () => {
  it("states readiness in words and disables submit until ready", () => {
    renderReport();
    // Stated in the readiness line and again in «Перед отправкой» — by design.
    expect(screen.getAllByText("Заполнено 0 из 5 записей").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Отправить на проверку" })).toBeDisabled();
  });

  it("shows no percentage, score or grade", () => {
    renderReport();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\d+\s*%/);
    expect(body).not.toMatch(/балл|оценка|score|grade/i);
  });

  it("updates the readiness copy as entries are filled", () => {
    let draft = createEmptyDraft(definition);
    draft = withEntryField(draft, 1, "noticed", "a");
    draft = withEntryField(draft, 2, "noticed", "b");
    draft = withEntryField(draft, 3, "noticed", "c");
    seed(draft);

    renderReport();
    expect(screen.getAllByText("Заполнено 3 из 5 записей").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Осталось заполнить 2 записи и итоговое наблюдение").length,
    ).toBeGreaterThan(0);
  });

  it("enables submit once the rule is satisfied", () => {
    seed(readyDraft());
    renderReport();
    expect(screen.getAllByText("Можно отправить на проверку").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Отправить на проверку" })).toBeEnabled();
  });

  it("shows no red error state before a submit attempt", () => {
    renderReport();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("report workspace — browser-local truth", () => {
  it("says the draft is local and never claims a server", () => {
    renderReport();
    expect(screen.getAllByText(/Черновик сохранён в этом браузере/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Синхронизация с сервером пока не подключена/).length,
    ).toBeGreaterThan(0);

    const body = document.body.textContent ?? "";
    for (const lie of [
      "Отправлено наставнику",
      "Сохранено на сервере",
      "Синхронизировано",
      "Наставник получил отчёт",
    ]) {
      expect(body).not.toContain(lie);
    }
  });

  it("restores a draft written by a previous visit", () => {
    seed(withEntryField(createEmptyDraft(definition), 1, "noticed", "запомнено с прошлого раза"));
    renderReport();
    expect(screen.getByDisplayValue("запомнено с прошлого раза")).toBeInTheDocument();
  });

  it("writes what the user types to browser-local storage", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.type(screen.getByLabelText(/Что заметил после сделки/), "новое наблюдение");
    // Autosave is debounced; the flush is asserted through the store, not a timer.
    await new Promise((resolve) => setTimeout(resolve, 900));

    const stored = getStoredDraftV3(createReportStore().read(), 3);
    expect(stored?.entries[0]!.noticed).toBe("новое наблюдение");
  });

  it("keeps text when moving between entries", async () => {
    const user = userEvent.setup();
    renderReport();

    await user.type(screen.getByLabelText(/Что заметил после сделки/), "первая");
    await user.click(screen.getByRole("button", { name: /^Запись 2:/ }));
    await user.click(screen.getByRole("button", { name: /^Запись 1:/ }));

    expect(screen.getByDisplayValue("первая")).toBeInTheDocument();
  });
});

describe("report workspace — submit confirmation", () => {
  it("requires confirmation before going pending", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();

    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Отметить отчёт как отправленный?" }),
    ).toBeInTheDocument();
    // Still a draft — nothing was committed by opening the dialog.
    expect(getStoredDraftV3(createReportStore().read(), 3)?.status).toBe("draft");
  });

  it("explains what submitting actually does, without lying", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();
    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));

    const dialog = screen.getByRole("dialog");
    const text = dialog.textContent ?? "";
    expect(text).toMatch(/редактирование будет заблокировано/i);
    expect(text).toMatch(/только в этом браузере/i);
    expect(text).toMatch(/серверная синхронизация отсутствует/i);
    expect(text).toMatch(/Автоматического одобрения нет/i);
    expect(text).toMatch(/Уровень 4 «Контрольная точка \$50» откроется после одобрения отчёта/);
  });

  it("never offers a misleading «Отправить наставнику» action", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();
    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));

    expect(screen.queryByRole("button", { name: /Отправить наставнику/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Отметить как отправленный" }),
    ).toBeInTheDocument();
  });

  it("returns to editing on cancel, unchanged", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();

    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));
    await user.click(screen.getByRole("button", { name: "Продолжить редактирование" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getStoredDraftV3(createReportStore().read(), 3)?.status).toBe("draft");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();

    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a modal dialog that takes focus", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();
    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("commits pending-review on confirm", async () => {
    const user = userEvent.setup();
    seed(readyDraft());
    renderReport();

    await user.click(screen.getByRole("button", { name: "Отправить на проверку" }));
    await user.click(screen.getByRole("button", { name: "Отметить как отправленный" }));

    expect(getStoredDraftV3(createReportStore().read(), 3)?.status).toBe("pending-review");
  });
});

describe("report workspace — pending review", () => {
  function renderPending() {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    return renderReport();
  }

  it("shows the review status and the calm expectation", () => {
    renderPending();
    expect(screen.getByText("На проверке")).toBeInTheDocument();
    expect(screen.getByText("Обычно проверка занимает до одного дня.")).toBeInTheDocument();
  });

  it("stays honest about there being no real review", () => {
    renderPending();
    expect(
      screen.getByText(/Отчёт отмечен как отправленный только в этом браузере/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Серверная проверка пока не подключена/)).toBeInTheDocument();
  });

  it("shows no countdown, no avatar and no named reviewer", () => {
    renderPending();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/осталось.*(час|минут|дн)/i);
    expect(body).not.toMatch(/Alex Curie/);
    expect(body).not.toMatch(/наставник\s+[А-ЯA-Z]/);
    expect(document.querySelector("img")).toBeNull();
  });

  it("makes every field read-only", () => {
    renderPending();
    expect(screen.getByLabelText(/Что заметил после сделки/)).toHaveAttribute("readonly");
    expect(screen.getByRole("textbox", { name: "Итоговое наблюдение" })).toHaveAttribute(
      "readonly",
    );
  });

  it("removes the submit CTA entirely", () => {
    renderPending();
    expect(screen.queryByRole("button", { name: "Отправить на проверку" })).not.toBeInTheDocument();
  });

  it("explains that level 4 stays closed, and offers honest exits", () => {
    renderPending();
    expect(
      screen.getByText("Уровень 4 «Контрольная точка $50» откроется после одобрения отчёта."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /К списку уроков/ })).toHaveAttribute("href", "/lessons");
    expect(screen.getByRole("link", { name: /Посмотреть Путь/ })).toHaveAttribute("href", "/path");
  });

  it("never automatically approves", () => {
    renderPending();
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("Одобрен");
    expect(body).not.toContain("Принят");
    expect(body).not.toContain("Отклонён");
  });

  /* ---- D3-B.1: a read-only blank is not an input ---- */

  it("states an unfilled optional field calmly instead of showing an empty box", () => {
    renderPending();
    // The ready fixture fills only the required field, so «Когда» and «Что решил»
    // of the open entry are blank.
    expect(screen.getAllByText("Не заполнено").length).toBeGreaterThan(0);
  });

  it("does not render an empty optional field as a textbox", () => {
    renderPending();
    // A box that cannot be typed into invites the user to try; there is nothing
    // to focus here, so there is no control here.
    expect(screen.queryByRole("textbox", { name: /Когда/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Что решил/ })).not.toBeInTheDocument();
  });

  it("keeps a filled optional field readable", () => {
    let draft = readyDraft();
    draft = withEntryField(draft, 1, "when", "среда, вторая половина дня");
    seed(withSubmitted(draft, "2026-07-17T10:00:00.000Z"));
    renderReport();

    expect(screen.getByDisplayValue("среда, вторая половина дня")).toBeInTheDocument();
    // The filled one stays a real (read-only) control — only blanks collapse.
    expect(screen.getByRole("textbox", { name: /Когда/ })).toHaveAttribute("readonly");
  });

  it("does not present the blank as an error", () => {
    renderPending();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const blank = screen.getAllByText("Не заполнено")[0]!;
    // Muted, not red: skipping optional context was never a mistake.
    expect(blank.className).toContain("rl-empty");
  });
});

describe("report workspace — optional fields stay editable while the work is live", () => {
  it("keeps a draft optional field an input", () => {
    renderReport();
    const when = screen.getByLabelText(/Когда/);
    expect(when.tagName).toBe("INPUT");
    expect(when).not.toHaveAttribute("readonly");
    expect(screen.queryByText("Не заполнено")).not.toBeInTheDocument();
  });

  it("keeps a ready optional field an input", () => {
    seed(readyDraft());
    renderReport();
    expect(screen.getByRole("button", { name: "Отправить на проверку" })).toBeEnabled();
    const when = screen.getByLabelText(/Когда/);
    expect(when.tagName).toBe("INPUT");
    expect(when).not.toHaveAttribute("readonly");
    expect(screen.queryByText("Не заполнено")).not.toBeInTheDocument();
  });
});

describe("report workspace — the canonical profile is not polluted", () => {
  it("is read-only for the canonical user, who is already past level 3", () => {
    renderReport("active");
    expect(screen.getByText(/Уровень 3 уже пройден в текущем профиле/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Что заметил после сделки/)).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Отправить на проверку" })).not.toBeInTheDocument();
  });

  it("makes NO claim about level 4 for the canonical user — it is genuinely open", () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    renderReport("active");
    // The sentence is derived from the resolver, so it is absent rather than false.
    expect(screen.queryByText(/откроется после одобрения отчёта/)).not.toBeInTheDocument();
  });

  it("emits no user-facing link carrying a scenario", () => {
    renderReport("report");
    for (const link of Array.from(document.querySelectorAll("a"))) {
      expect(link.getAttribute("href") ?? "").not.toContain("scenario");
    }
  });
});
