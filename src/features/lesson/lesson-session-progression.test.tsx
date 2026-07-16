import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LessonWorkspace } from "@/features/lesson/components/lesson-workspace";
import { LessonSessionGate } from "@/features/lesson/components/lesson-session-gate";
import { LessonLockedScreen } from "@/features/lesson/components/lesson-locked-screen";
import { LessonUnknown } from "@/features/lesson/components/lesson-unknown";
import { LessonResolving } from "@/features/lesson/components/lesson-resolving";
import { getLesson, getLessonEntry } from "@/features/lesson/data/lesson-fixtures";
import { scenarioProgress, scenarioSession } from "@/features/lesson/model/lesson-scenarios";
import {
  LESSON_PROGRESS_STORAGE_KEY,
  parseLessonProgress,
} from "@/features/lesson/model/lesson-session-progress";
import { getLevel } from "@/data/curriculum/fixture";

/**
 * D2B.1 — progression is backed by the browser session, not by the dev scenario
 * query. These tests drive the real components against a real sessionStorage
 * (jsdom), so the write/read contract is exercised end to end.
 */

const lesson = getLesson(18);
const Q = lesson.assessment.questions;
const MARKER = scenarioProgress("initial"); // Артём on level 18, no dev override
const stub = getLessonEntry(19);
const NOTE = stub?.kind === "stub" ? stub.stub.note : undefined;

const correctText = (i: number) => Q[i]!.options.find((o) => o.correct)!.text;

function renderLesson(scenario: Parameters<typeof scenarioSession>[1] = "initial") {
  return render(
    <LessonWorkspace
      lesson={lesson}
      initialSession={scenarioSession(lesson, scenario)}
      progress={scenarioProgress(scenario)}
    />,
  );
}

/** The level-19 route exactly as the page composes it. */
function renderLevel19Route() {
  return render(
    <LessonSessionGate
      levelNumber={19}
      marker={MARKER}
      resolving={<LessonResolving level={getLevel(19)} />}
      locked={<LessonLockedScreen level={getLevel(19)} progress={MARKER} note={NOTE} />}
      unlocked={<LessonUnknown levelNumber={19} title={getLevel(19).title} note={NOTE} />}
    />,
  );
}

const readStored = () =>
  parseLessonProgress(window.sessionStorage.getItem(LESSON_PROGRESS_STORAGE_KEY));

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("the next-lesson link is a clean canonical URL", () => {
  it("does not exist before completion", () => {
    renderLesson("threshold-50");
    expect(screen.queryByRole("link", { name: /Перейти к уровню 19/ })).toBeNull();
  });

  it("points at /lessons/level.019 with no query after completion", () => {
    renderLesson("completed");
    const next = screen.getByRole("link", { name: /Перейти к уровню 19/ });
    expect(next).toHaveAttribute("href", "/lessons/level.019");
  });

  it("carries no scenario — a dev adapter is never a user's unlock mechanism", () => {
    renderLesson("completed");
    const href = screen.getByRole("link", { name: /Перейти к уровню 19/ }).getAttribute("href");
    expect(href).not.toContain("scenario");
    expect(href).not.toContain("?");
  });

  it("no user-facing link on the lesson carries a scenario", () => {
    const { container } = renderLesson("completed");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).not.toContain("scenario");
  });
});

describe("completion writes the session record", () => {
  it("stores nothing before the lesson is complete", () => {
    renderLesson("threshold-50");
    expect(window.sessionStorage.getItem(LESSON_PROGRESS_STORAGE_KEY)).toBeNull();
  });

  it("records level 18 completed and level 19 unlocked", () => {
    renderLesson("completed");
    expect(readStored().completed).toEqual(["level.018"]);
    expect(readStored().unlocked).toEqual(["level.019"]);
  });

  it("writes when the user actually finishes the lesson, not just on mount", async () => {
    const user = userEvent.setup();
    renderLesson("threshold-50");
    expect(window.sessionStorage.getItem(LESSON_PROGRESS_STORAGE_KEY)).toBeNull();

    await user.click(screen.getByRole("button", { name: /Начать проверку/ }));
    for (let i = 0; i < Q.length; i += 1) {
      await user.click(screen.getByRole("radio", { name: correctText(i) }));
      await user.click(screen.getByRole("button", { name: "Ответить" }));
      if (i < Q.length - 1) await user.click(screen.getByRole("button", { name: /Следующий вопрос/ }));
    }

    expect(screen.getByRole("heading", { name: /Урок завершён/ })).toBeInTheDocument();
    expect(readStored().completed).toEqual(["level.018"]);
    expect(readStored().unlocked).toEqual(["level.019"]);
  });

  it("is idempotent — re-rendering the completed lesson does not grow the record", () => {
    const first = renderLesson("completed");
    const afterFirst = window.sessionStorage.getItem(LESSON_PROGRESS_STORAGE_KEY);
    first.unmount();
    renderLesson("completed");
    expect(window.sessionStorage.getItem(LESSON_PROGRESS_STORAGE_KEY)).toBe(afterFirst);
  });

  it("stores no XP and no financial value", () => {
    renderLesson("completed");
    const raw = window.sessionStorage.getItem(LESSON_PROGRESS_STORAGE_KEY) ?? "";
    expect(raw).not.toMatch(/xp|2480|2 480|баланс|Pocket|\$/i);
  });
});

describe("the level 19 route reads the session", () => {
  it("is locked with no session marker", () => {
    renderLevel19Route();
    expect(screen.getByText(/Сначала нужно завершить уровень 18/)).toBeInTheDocument();
    expect(screen.queryByText(/Этот уровень ещё не построен/)).toBeNull();
  });

  it("is unlocked once this session recorded the completion", () => {
    renderLesson("completed").unmount(); // the write happens here
    renderLevel19Route();
    expect(screen.getByText(/Этот уровень ещё не построен/)).toBeInTheDocument();
    expect(screen.queryByText(/Сначала нужно завершить уровень 18/)).toBeNull();
  });

  it("shows the honest practical placeholder, not a fake completed state", () => {
    renderLesson("completed").unmount();
    renderLevel19Route();
    expect(screen.getByRole("heading", { level: 1, name: "Разметка графика" })).toBeInTheDocument();
    expect(screen.getByText(/Практические уровни появятся на следующем этапе/)).toBeInTheDocument();
    expect(screen.getByText(/Уровень открыт по последовательности/)).toBeInTheDocument();
    expect(screen.queryByText(/завершён/)).toBeNull();
    // both ways out are real links
    expect(screen.getByRole("link", { name: /Вернуться в Путь/ })).toHaveAttribute("href", "/path");
    expect(screen.getByRole("link", { name: /уровень 18/ })).toHaveAttribute(
      "href",
      "/lessons/level.018",
    );
  });

  it("keeps exactly one h1 in every gate state", () => {
    renderLevel19Route();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("a corrupt marker does not break the page — it falls back to locked", () => {
    window.sessionStorage.setItem(LESSON_PROGRESS_STORAGE_KEY, "{not json");
    expect(() => renderLevel19Route()).not.toThrow();
    expect(screen.getByText(/Сначала нужно завершить уровень 18/)).toBeInTheDocument();
  });

  it("a forged marker cannot unlock anything", () => {
    window.sessionStorage.setItem(
      LESSON_PROGRESS_STORAGE_KEY,
      JSON.stringify({ version: 99, completed: ["level.018"], unlocked: ["level.019"] }),
    );
    renderLevel19Route();
    expect(screen.getByText(/Сначала нужно завершить уровень 18/)).toBeInTheDocument();
  });
});

describe("the resolving state", () => {
  it("names the level and claims nothing about access", () => {
    render(<LessonResolving level={getLevel(19)} />);
    expect(screen.getByRole("heading", { level: 1, name: "Разметка графика" })).toBeInTheDocument();
    expect(screen.getByText(/Проверяем доступ к уровню/)).toBeInTheDocument();
    expect(screen.queryByText(/закрыт/)).toBeNull();
    expect(screen.queryByText(/открыт/)).toBeNull();
  });
});

describe("honesty about storage", () => {
  it("says the mark lives only in this browser session", () => {
    renderLesson("completed");
    expect(
      screen.getByText(/Отметка хранится только в текущей сессии браузера/),
    ).toBeInTheDocument();
  });

  it("never claims server persistence or a sync", () => {
    const { container } = renderLesson("completed");
    const text = container.textContent ?? "";
    for (const lie of [
      "сохранено на сервере",
      "прогресс синхронизирован",
      "синхронизировано",
      "сохранено в облаке",
    ]) {
      expect(text).not.toContain(lie);
    }
  });
});
