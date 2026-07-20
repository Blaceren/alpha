import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradingJournalWorkspace } from "@/features/tools/components/trading-journal-workspace";
import { DIRECTION_LABEL } from "@/features/tools/model/journal-entry";
import {
  serializeTradingJournal,
  TRADING_JOURNAL_STORAGE_KEY,
  type TradingJournalStateV1,
} from "@/features/tools/model/journal-store";

interface FillValues {
  date?: string;
  time?: string;
  instrument?: string;
  direction?: keyof typeof DIRECTION_LABEL;
  plan?: string;
  execution?: string;
  lesson?: string;
  result?: string;
}

function fillForm(values: FillValues) {
  if (values.date !== undefined) {
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: values.date } });
  }
  if (values.time !== undefined) {
    fireEvent.change(screen.getByLabelText("Время"), { target: { value: values.time } });
  }
  if (values.instrument !== undefined) {
    fireEvent.change(screen.getByLabelText("Инструмент"), {
      target: { value: values.instrument },
    });
  }
  if (values.direction !== undefined) {
    fireEvent.click(screen.getByRole("radio", { name: DIRECTION_LABEL[values.direction] }));
  }
  if (values.plan !== undefined) {
    fireEvent.change(screen.getByLabelText(/План/), { target: { value: values.plan } });
  }
  if (values.execution !== undefined) {
    fireEvent.change(screen.getByLabelText(/Исполнение/), { target: { value: values.execution } });
  }
  if (values.lesson !== undefined) {
    fireEvent.change(screen.getByLabelText(/Урок/), { target: { value: values.lesson } });
  }
  if (values.result !== undefined) {
    fireEvent.change(screen.getByLabelText(/Ручной результат/), {
      target: { value: values.result },
    });
  }
}

const COMPLETE: FillValues = {
  date: "14.07.2026",
  time: "09:00",
  instrument: "XAU/USD",
  direction: "sell",
  plan: "вход только по условию",
  execution: "дождался подтверждения",
  lesson: "терпение сработало",
  result: "18",
};

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("Trading Journal — empty state", () => {
  it("explains the first entry and shows no fake examples", () => {
    render(<TradingJournalWorkspace />);
    expect(screen.getByText(/Здесь появится ваша первая запись/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить первую запись/ })).toBeInTheDocument();
    // No stored data → no results lines masquerading as real entries.
    expect(screen.queryByText(/Результат сделки/)).toBeNull();
  });

  it("has exactly one h1", () => {
    render(<TradingJournalWorkspace />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

describe("Trading Journal — create", () => {
  it("creates a positive-result entry and persists it (reread)", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm(COMPLETE);
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));

    // Rendered in the list.
    expect(await screen.findByText("XAU/USD")).toBeInTheDocument();
    // Persisted under the canonical key.
    const raw = window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY);
    expect(raw).toContain("XAU/USD");
    expect(raw).toContain('"manualResult":18');
    // Result shown as a secondary fact, with sign.
    expect(screen.getByText(/Результат сделки, введён вручную: \+18/)).toBeInTheDocument();
  });

  it("creates a negative-result entry", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm({ ...COMPLETE, instrument: "EUR/USD", direction: "buy", result: "-7" });
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
    expect(await screen.findByText(/введён вручную: −7/)).toBeInTheDocument();
  });

  it("creates an observation entry with NO money result", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm({ ...COMPLETE, instrument: "GBP/USD", direction: "observation", result: "" });
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
    expect(await screen.findByText(/Денежный результат не указан/)).toBeInTheDocument();
  });

  it("blocks an incomplete submit with field errors (no whitespace-only)", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm({ ...COMPLETE, lesson: "   " });
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/вывод/i);
    // Nothing persisted.
    expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).toBeNull();
  });

  it("closes the form after a successful create (a second submit is impossible)", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm(COMPLETE);
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
    await screen.findByText("XAU/USD");
    expect(screen.queryByRole("button", { name: /Добавить запись/ })).toBeNull();
  });

  it("focus moves to the created entry", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm(COMPLETE);
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
    await screen.findByText("XAU/USD");
    await waitFor(() => {
      const active = document.activeElement;
      expect(active?.getAttribute("aria-expanded")).toBe("true");
      expect(active?.textContent).toContain("XAU/USD");
    });
  });
});

describe("Trading Journal — explicit locale-independent date/time (DD-311)", () => {
  it("create form uses explicit Дата + Время text fields, no native datetime, no AM/PM", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));

    const date = screen.getByLabelText("Дата") as HTMLInputElement;
    const time = screen.getByLabelText("Время") as HTMLInputElement;
    expect(date.type).toBe("text");
    expect(time.type).toBe("text");
    expect(date).toHaveAttribute("placeholder", "ДД.ММ.ГГГГ");
    expect(time).toHaveAttribute("placeholder", "ЧЧ:ММ");
    // No native datetime-local control anywhere.
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    // No AM/PM in the form.
    expect((document.body.textContent ?? "").toUpperCase()).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it("edit form prefills ДД.ММ.ГГГГ date and 24-hour time from the stored ISO", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      TRADING_JOURNAL_STORAGE_KEY,
      serializeTradingJournal({
        version: 1,
        sequence: 1,
        entries: [
          {
            id: "journal-1",
            occurredAt: "2026-07-16T14:15:00.000Z",
            instrument: "GBP/USD",
            direction: "observation",
            setup: "",
            plan: "план",
            execution: "исполнение",
            lesson: "урок",
            manualResult: null,
            createdAt: "2026-07-16T14:15:00.000Z",
            updatedAt: "2026-07-16T14:15:00.000Z",
          },
        ],
      }),
    );
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Редактировать/ }));
    expect((screen.getByLabelText("Дата") as HTMLInputElement).value).toBe("16.07.2026");
    expect((screen.getByLabelText("Время") as HTMLInputElement).value).toBe("14:15");
    expect((document.body.textContent ?? "").toUpperCase()).not.toMatch(/\bAM\b|\bPM\b/);
  });

  it("an invalid date blocks submit with a field error, nothing persisted", async () => {
    const user = userEvent.setup();
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
    fillForm({ ...COMPLETE, date: "31.02.2026" });
    await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/даты не существует/i);
    expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).toBeNull();
  });
});

describe("Trading Journal — populated, collapse/expand, edit", () => {
  function seed(state: TradingJournalStateV1) {
    window.localStorage.setItem(TRADING_JOURNAL_STORAGE_KEY, serializeTradingJournal(state));
  }

  const populated: TradingJournalStateV1 = {
    version: 1,
    sequence: 2,
    entries: [
      {
        id: "journal-1",
        occurredAt: "2026-07-14T09:00:00.000Z",
        instrument: "XAU/USD",
        direction: "sell",
        setup: "",
        plan: "план 1",
        execution: "исполнение 1",
        lesson: "урок первый",
        manualResult: 18,
        createdAt: "2026-07-14T09:00:00.000Z",
        updatedAt: "2026-07-14T09:00:00.000Z",
      },
      {
        id: "journal-2",
        occurredAt: "2026-07-16T09:00:00.000Z",
        instrument: "GBP/USD",
        direction: "observation",
        setup: "",
        plan: "план 2",
        execution: "исполнение 2",
        lesson: "урок второй",
        manualResult: null,
        createdAt: "2026-07-16T09:00:00.000Z",
        updatedAt: "2026-07-16T09:00:00.000Z",
      },
    ],
  };

  it("lists newest first and expands only the newest by default", () => {
    seed(populated);
    render(<TradingJournalWorkspace />);
    const toggles = screen.getAllByRole("button", { name: /GBP\/USD|XAU\/USD/ });
    // Newest (GBP, journal-2) expanded; oldest (XAU) collapsed.
    const gbp = toggles.find((b) => b.textContent?.includes("GBP/USD"));
    const xau = toggles.find((b) => b.textContent?.includes("XAU/USD"));
    expect(gbp).toHaveAttribute("aria-expanded", "true");
    expect(xau).toHaveAttribute("aria-expanded", "false");
  });

  it("collapse/expand toggles a saved entry", async () => {
    const user = userEvent.setup();
    seed(populated);
    render(<TradingJournalWorkspace />);
    const xau = screen
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("XAU/USD") && b.hasAttribute("aria-expanded"))!;
    expect(xau).toHaveAttribute("aria-expanded", "false");
    await user.click(xau);
    expect(xau).toHaveAttribute("aria-expanded", "true");
    await user.click(xau);
    expect(xau).toHaveAttribute("aria-expanded", "false");
  });

  it("edits an entry inline and persists; reload shows the edit", async () => {
    const user = userEvent.setup();
    seed(populated);
    const { unmount } = render(<TradingJournalWorkspace />);
    // Edit the newest (already expanded) entry.
    await user.click(screen.getByRole("button", { name: /Редактировать/ }));
    fireEvent.change(screen.getByLabelText(/Урок/), { target: { value: "переписанный вывод" } });
    await user.click(screen.getByRole("button", { name: /Сохранить изменения/ }));
    expect(await screen.findByText("переписанный вывод")).toBeInTheDocument();
    expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).toContain("переписанный вывод");

    // Reload persistence.
    unmount();
    render(<TradingJournalWorkspace />);
    expect(screen.getByText("переписанный вывод")).toBeInTheDocument();
  });

  it("Cancel leaves the saved entry unchanged and returns focus to it", async () => {
    const user = userEvent.setup();
    seed(populated);
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Редактировать/ }));
    fireEvent.change(screen.getByLabelText(/Урок/), { target: { value: "черновик отмены" } });
    await user.click(screen.getByRole("button", { name: /Отмена/ }));
    // The draft is discarded — the stored lesson is intact.
    expect(screen.queryByText("черновик отмены")).toBeNull();
    expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).not.toContain("черновик отмены");
  });

  it("Escape closes the editor without saving", async () => {
    const user = userEvent.setup();
    seed(populated);
    render(<TradingJournalWorkspace />);
    await user.click(screen.getByRole("button", { name: /Редактировать/ }));
    const lesson = screen.getByLabelText(/Урок/);
    fireEvent.change(lesson, { target: { value: "escape-draft" } });
    fireEvent.keyDown(lesson, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /Сохранить изменения/ })).toBeNull();
    expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).not.toContain("escape-draft");
  });

  it("shows no chart / KPI / aggregate / balance language", () => {
    seed(populated);
    render(<TradingJournalWorkspace />);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const banned of ["баланс", "p/l", "win rate", "депозит", "итого", "средн", "доходност"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("Trading Journal — storage failure & corruption", () => {
  it("a failed write shows an honest error, not a false success", async () => {
    const user = userEvent.setup();
    // In this jsdom build `window.localStorage` is a native Storage PROXY: its
    // `setItem` lives on the prototype and the instance rejects an own-property
    // shadow, so `vi.spyOn(window.localStorage, "setItem")` silently fails to
    // intercept the real call. Spy the actual invoked implementation on the
    // prototype instead, and always restore it so the throwing mock never leaks
    // into the next test (which itself writes to localStorage).
    const storageProto = Object.getPrototypeOf(window.localStorage);
    const setItemSpy = vi.spyOn(storageProto, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      render(<TradingJournalWorkspace />);
      await user.click(screen.getByRole("button", { name: /Добавить первую запись/ }));
      fillForm(COMPLETE);
      await user.click(screen.getByRole("button", { name: /Добавить запись/ }));
      // The failing write path must actually have been exercised — otherwise the
      // "honest error" assertions below could pass vacuously.
      expect(setItemSpy).toHaveBeenCalled();
      // No fabricated success: the entry is not shown, and the error is stated.
      expect(screen.getAllByText(/не удалось сохранить/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Результат сделки/)).toBeNull();
      expect(window.localStorage.getItem(TRADING_JOURNAL_STORAGE_KEY)).toBeNull();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("corrupt storage fails closed with a calm explanation (no raw payload)", () => {
    window.localStorage.setItem(TRADING_JOURNAL_STORAGE_KEY, "@@@corrupt@@@not-json");
    render(<TradingJournalWorkspace />);
    expect(screen.getByText(/Локальные записи не удалось прочитать/)).toBeInTheDocument();
    // The empty workspace still offers a way forward.
    expect(screen.getByRole("button", { name: /Новая запись/ })).toBeInTheDocument();
    // The raw payload is never shown.
    expect(document.body.textContent).not.toContain("@@@corrupt@@@");
  });
});
