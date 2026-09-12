import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LessonsLibraryWorkspace } from "@/features/lessons-library/components/lessons-library-workspace";
import { DesktopRouteNavigation } from "@/components/navigation/desktop-route-navigation";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import {
  LESSON_PROGRESS_STORAGE_KEY,
  emptyLessonProgress,
  serializeLessonProgress,
  withCompletedLevel,
} from "@/features/lesson/model/lesson-session-progress";

/**
 * Component guarantees for the lessons library (Phase D2C-B). Rendering goes
 * through the real projector over the typed curriculum fixture — deterministic,
 * no backend.
 *
 * The session is seeded through the REAL storage key, so these tests exercise the
 * same path the browser takes (D2B.1), not a stubbed model.
 */

function seedSession(levelNumber?: number) {
  window.sessionStorage.clear();
  if (levelNumber === undefined) return;
  window.sessionStorage.setItem(
    LESSON_PROGRESS_STORAGE_KEY,
    serializeLessonProgress(withCompletedLevel(emptyLessonProgress(), levelNumber)),
  );
}

function renderLibrary(moduleParam?: string) {
  // scenario="active" is the canonical marker key (the workspace default);
  // passing it explicitly keeps the test honest about what it exercises.
  return render(<LessonsLibraryWorkspace moduleParam={moduleParam} scenario="active" />);
}

/** Every href the page offers. */
function allHrefs(): string[] {
  return Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

beforeEach(() => {
  seedSession();
});

describe("the library replaces the redirect", () => {
  it("renders a real page with exactly one h1 «Уроки»", () => {
    renderLibrary();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Уроки");
  });

  it("keeps a sane heading hierarchy (h1 → h2, no skipped level)", () => {
    renderLibrary();
    const levels = screen
      .getAllByRole("heading")
      .map((h) => Number(h.tagName.substring(1)))
      .sort((a, b) => a - b);
    expect(levels[0]).toBe(1);
    expect(new Set(levels)).toEqual(new Set([1, 2]));
  });
});

describe("desktop contents index", () => {
  it("shows all 20 modules", () => {
    renderLibrary();
    const toc = document.querySelector(".lib-toc")!;
    expect(within(toc as HTMLElement).getAllByRole("link")).toHaveLength(20);
    expect(within(toc as HTMLElement).getByText("Первое знакомство")).toBeInTheDocument();
    expect(within(toc as HTMLElement).getByText("Самостоятельная система")).toBeInTheDocument();
  });

  it("selects module 04 by default, marked with aria-current and a text state", () => {
    renderLibrary();
    const toc = document.querySelector(".lib-toc") as HTMLElement;
    const selected = within(toc).getAllByRole("link").filter((a) => a.getAttribute("aria-current"));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Чтение графика");
    // state is never colour-only
    expect(selected[0]).toHaveTextContent(/Выбран/);
  });

  it("links every module with its canonical code", () => {
    renderLibrary();
    const toc = document.querySelector(".lib-toc") as HTMLElement;
    const hrefs = within(toc)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs[0]).toBe("/lessons?module=module.01");
    expect(hrefs[3]).toBe("/lessons?module=module.04");
    expect(hrefs[19]).toBe("/lessons?module=module.20");
  });
});

describe("selected module content", () => {
  it("shows levels 16–20 of module 04 with their canonical titles", () => {
    renderLibrary();
    const rows = document.querySelectorAll(".lib-row");
    expect(rows).toHaveLength(5);
    const open = document.querySelector(".lib-open") as HTMLElement;
    for (const title of [
      "Свечи",
      "Тренд и диапазон",
      "Поддержка и сопротивление",
      "Разметка графика",
      "Контрольная точка $200",
    ]) {
      expect(within(open).getByText(title)).toBeInTheDocument();
    }
  });

  it("states module context: range and completed count", () => {
    renderLibrary();
    const head = document.querySelector(".lib-open-head") as HTMLElement;
    expect(head).toHaveTextContent("уровни 16–20");
    expect(head).toHaveTextContent(/пройдено\s*2\s*из\s*5/);
    expect(head).toHaveTextContent("Свечи, тренд и диапазон, уровни поддержки и сопротивления, разметка.");
  });

  it("shows the required statuses as words", () => {
    renderLibrary();
    const open = document.querySelector(".lib-open") as HTMLElement;
    // read the status column itself, so the assertion is about the row grammar
    // rather than about however the label happens to be nested
    const statuses = Array.from(open.querySelectorAll(".lib-row-s")).map((el) =>
      el.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(statuses).toEqual([
      "Завершён · Пересмотреть",
      "Завершён · Пересмотреть",
      "Текущий урок · Продолжить урок",
      "Откроется после уровня 18",
      "Граница модуля",
    ]);
  });

  it("renders a duration only for level 18", () => {
    renderLibrary();
    const open = document.querySelector(".lib-open") as HTMLElement;
    expect(within(open).getAllByText("8:00")).toHaveLength(1);
    const l18Row = document.querySelector(".lib-row.is-current") as HTMLElement;
    expect(within(l18Row).getByText("8:00")).toBeInTheDocument();
  });

  it("shows no lock icon wall — a locked level is text, not a control", () => {
    renderLibrary();
    const locked = document.querySelector(".lib-row.is-locked") as HTMLElement;
    expect(locked.querySelector("a")).toBeNull();
    expect(locked.querySelector("button")).toBeNull();
    expect(locked.querySelectorAll("svg")).toHaveLength(0);
  });
});

describe("the dominant continue action", () => {
  it("points at level 18 with a clean canonical URL", () => {
    renderLibrary();
    const band = document.querySelector(".lib-cont") as HTMLElement;
    const cta = within(band).getByRole("link", { name: /Продолжить урок/ });
    expect(cta).toHaveAttribute("href", "/lessons/level.018");
    expect(band).toHaveTextContent("Поддержка и сопротивление");
    expect(band).toHaveTextContent("Продолжить обучение");
  });

  it("points at level 19 once level 18 is completed in this session", () => {
    seedSession(18);
    renderLibrary();
    const band = document.querySelector(".lib-cont") as HTMLElement;
    const cta = within(band).getByRole("link", { name: /Перейти к заданию/ });
    expect(cta).toHaveAttribute("href", "/lessons/level.019");
    expect(band).toHaveTextContent("Разметка графика");
  });

  it("re-states level 18 as completed and 19 as current after session completion", () => {
    seedSession(18);
    renderLibrary();
    const current = document.querySelector(".lib-row.is-current") as HTMLElement;
    expect(within(current).getByText("Разметка графика")).toBeInTheDocument();
    const head = document.querySelector(".lib-open-head") as HTMLElement;
    expect(head).toHaveTextContent(/пройдено\s*3\s*из\s*5/);
  });

  it("never emits an href carrying a development scenario", () => {
    for (const seed of [undefined, 18]) {
      seedSession(seed);
      const { unmount } = renderLibrary();
      const hrefs = allHrefs();
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).not.toContain("scenario");
      unmount();
    }
  });
});

describe("module query is ordinary user state", () => {
  it("opens the requested module", () => {
    renderLibrary("module.09");
    expect(document.querySelector(".lib-open-h")).toHaveTextContent("Первая стратегия");
  });

  it("falls back to the current module for an unknown code, without crashing", () => {
    for (const bad of ["module.99", "garbage", "<script>alert(1)</script>", "module.4"]) {
      const { unmount } = renderLibrary(bad);
      expect(document.querySelector(".lib-open-h")).toHaveTextContent("Чтение графика");
      unmount();
    }
  });

  it("shows an honest empty state for a module with no reachable action", () => {
    renderLibrary("module.18");
    expect(document.querySelector(".lib-open-h")).toHaveTextContent("Аналитика результатов");
    expect(screen.getByText(/Уровни этого модуля пока закрыты последовательностью/)).toBeInTheDocument();
    // the continue band still points at the user's real next step, not this module
    const band = document.querySelector(".lib-cont") as HTMLElement;
    expect(within(band).getByRole("link", { name: /Продолжить урок/ })).toHaveAttribute(
      "href",
      "/lessons/level.018",
    );
  });

  it("a corrupt session marker never unlocks and never crashes", () => {
    window.sessionStorage.setItem(LESSON_PROGRESS_STORAGE_KEY, "{not json");
    renderLibrary();
    const current = document.querySelector(".lib-row.is-current") as HTMLElement;
    expect(within(current).getByText("Поддержка и сопротивление")).toBeInTheDocument();
  });
});

describe("checkpoint — financial privacy", () => {
  it("states only the target and what it opens, with no Pocket link", () => {
    renderLibrary();
    const cp = document.querySelector(".lib-row.is-checkpoint") as HTMLElement;
    expect(cp).toHaveTextContent("Баланс Pocket от $200");
    expect(cp).toHaveTextContent("Chart Markup Tool");
    expect(cp).toHaveTextContent("ранг Наблюдатель IV");
    expect(cp).toHaveTextContent("канал Разбор графиков");
    expect(cp.querySelector("a")).toBeNull();
    expect(cp.querySelector("button")).toBeNull();
  });

  it("leaks no balance, remainder, percentage or XP anywhere on the page", () => {
    renderLibrary();
    const text = document.body.textContent ?? "";
    for (const forbidden of [/осталось/i, /остаток/i, /ваш баланс/i, /депозит/i, /вывод/i, /XP/, /%/]) {
      expect(text).not.toMatch(forbidden);
    }
    for (const href of allHrefs()) expect(href).not.toMatch(/pocket/i);
  });
});

describe("mobile module picker", () => {
  it("opens, marks the selected module in text, and closes on Escape returning focus", async () => {
    const user = userEvent.setup();
    renderLibrary();

    const trigger = screen.getByRole("button", { name: /Открыть список всех модулей/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const selected = within(dialog)
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current"));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Чтение графика");
    expect(selected[0]).toHaveTextContent(/Выбран/);
    expect(within(dialog).getAllByRole("link")).toHaveLength(20);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes via the close button and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const trigger = screen.getByRole("button", { name: /Открыть список всех модулей/ });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Закрыть" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("steps to the neighbouring modules with canonical hrefs", () => {
    renderLibrary();
    expect(screen.getByRole("link", { name: /Предыдущий модуль — Управление риском/ })).toHaveAttribute(
      "href",
      "/lessons?module=module.03",
    );
    expect(screen.getByRole("link", { name: /Следующий модуль — Индикаторы/ })).toHaveAttribute(
      "href",
      "/lessons?module=module.05",
    );
  });

  it("offers no dead arrows at the ends of the curriculum", () => {
    const { unmount } = renderLibrary("module.01");
    expect(screen.queryByRole("link", { name: /Предыдущий модуль/ })).toBeNull();
    unmount();

    renderLibrary("module.20");
    expect(screen.queryByRole("link", { name: /Следующий модуль/ })).toBeNull();
  });

  it("does not mount the full contents twice while the sheet is closed", () => {
    renderLibrary();
    expect(document.querySelectorAll(".lib-idx")).toHaveLength(1);
  });
});

describe("navigation", () => {
  it("marks «Уроки» as the current page on desktop, with no «Скоро» label", () => {
    render(<DesktopRouteNavigation activeId="lessons" />);
    const lessons = screen.getByRole("link", { name: "Уроки" });
    expect(lessons).toHaveAttribute("href", "/lessons");
    expect(lessons).toHaveAttribute("aria-current", "page");
    expect(lessons).not.toHaveAttribute("aria-disabled");
    expect(lessons).not.toHaveAttribute("title", "Скоро");
  });

  it("marks «Уроки» as the current page on mobile, with no «Скоро» label", () => {
    render(<MobileBottomNavigation activeId="lessons" />);
    const lessons = screen.getByRole("link", { name: "Уроки" });
    expect(lessons).toHaveAttribute("href", "/lessons");
    expect(lessons).toHaveAttribute("aria-current", "page");
    expect(lessons).not.toHaveAttribute("aria-disabled");
  });

  it("offers every built destination and advertises no unbuilt one", () => {
    render(<DesktopRouteNavigation activeId="lessons" />);
    // LEARNER-OPERATIONS-V1: «Ещё» was a DISABLED button whose own id was not in
    // the built list, so it could never open the menu it existed for — and that
    // is what hid Поддержка after it shipped. Unbuilt sections are now absent
    // rather than advertised, and Поддержка is a real link.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Главная" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "Путь" })).toHaveAttribute("href", "/path");
    expect(screen.getByRole("link", { name: "Инструменты" })).toHaveAttribute("href", "/tools");
    expect(screen.getByRole("link", { name: "Поддержка" })).toHaveAttribute("href", "/support");
  });
});
