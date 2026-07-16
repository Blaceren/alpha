import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LessonWorkspace } from "@/features/lesson/components/lesson-workspace";
import { getLesson } from "@/features/lesson/data/lesson-fixtures";
import { scenarioSession, scenarioProgress, type LessonScenario } from "@/features/lesson/model/lesson-scenarios";

const lesson = getLesson(18);
const Q = lesson.assessment.questions;

function renderScenario(scenario: LessonScenario = "initial") {
  return render(
    <LessonWorkspace
      lesson={lesson}
      initialSession={scenarioSession(lesson, scenario)}
      progress={scenarioProgress(scenario)}
    />,
  );
}

const correctText = (i: number) => Q[i]!.options.find((o) => o.correct)!.text;
const wrongText = (i: number) => Q[i]!.options.find((o) => !o.correct)!.text;

/** Answer the currently shown question and move on. */
async function answer(user: ReturnType<typeof userEvent.setup>, i: number, correct = true) {
  await user.click(screen.getByRole("radio", { name: correct ? correctText(i) : wrongText(i) }));
  await user.click(screen.getByRole("button", { name: "Ответить" }));
}

describe("lesson route — structure", () => {
  it("renders exactly one h1, carrying the canonical level title", () => {
    renderScenario();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Поддержка и сопротивление");
  });

  it("states the level and module context from the curriculum", () => {
    renderScenario();
    expect(screen.getByText(/Уровень 18 · Модуль 4 «Чтение графика»/)).toBeInTheDocument();
  });

  it("puts the video BEFORE the assessment in document order", () => {
    const { container } = renderScenario();
    const media = container.querySelector(".lvs")!;
    const assessment = container.querySelector(".la")!;
    expect(media).toBeInTheDocument();
    expect(assessment).toBeInTheDocument();
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(media.compareDocumentPosition(assessment) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("exposes the media as a named region and the progress as a progressbar", () => {
    renderScenario();
    expect(screen.getByRole("region", { name: /Видеоурок «Поддержка и сопротивление»/ })).toBeInTheDocument();

    const bar = screen.getByRole("progressbar", { name: /Подтверждённый просмотр/ });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("labels the player controls, with the visible word as the accessible name", () => {
    renderScenario();
    expect(screen.getByRole("button", { name: "Смотреть" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Позиция видео" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Звук", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Субтитры", pressed: false })).toBeInTheDocument();
  });

  it("is honest that the media is a demonstration, not a loaded stream", () => {
    renderScenario();
    expect(screen.getByText("Демонстрационная запись")).toBeInTheDocument();
    expect(screen.getByText(/Материал занятия готовится редакцией/)).toBeInTheDocument();
  });

  it("never shows a raw state enum", () => {
    const { container } = renderScenario("threshold-50");
    for (const raw of ["test_unlocked", "feedback_correct", "not_started", "single-choice", "level.018"]) {
      expect(container.textContent).not.toContain(raw);
    }
  });
});

describe("the 50% gate in the UI", () => {
  it("shows the test as locked and explained at 49%, without revealing it", () => {
    renderScenario("threshold-49");
    expect(screen.getByRole("heading", { name: "Проверка понимания" })).toBeInTheDocument();
    expect(screen.getByText("Закрыта")).toBeInTheDocument();
    expect(screen.getByText(/Откроется после 50% просмотра/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "49");

    // no question, no option, no start control leaks through
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText(Q[0]!.prompt)).toBeNull();
    expect(screen.queryByRole("button", { name: "Начать проверку" })).toBeNull();
  });

  it("says a full watch is not required and that mistakes cost nothing", () => {
    const { container } = renderScenario("threshold-49");
    const locked = container.querySelector(".la-locked")!;
    expect(within(locked as HTMLElement).getByText(/Смотреть видео полностью не требуется/)).toBeInTheDocument();
    expect(within(locked as HTMLElement).getByText(/Неправильный ответ ничего не отнимает/)).toBeInTheDocument();
  });

  it("opens the test at exactly 50%", () => {
    renderScenario("threshold-50");
    expect(screen.getByText("Открыта")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Начать проверку/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });

  it("does not complete the lesson merely by unlocking the test", () => {
    renderScenario("threshold-50");
    expect(screen.queryByRole("heading", { name: /Урок завершён/ })).toBeNull();
  });
});

describe("one question at a time", () => {
  it("shows only the first question, as a radio group in a fieldset", async () => {
    const user = userEvent.setup();
    renderScenario("threshold-50");
    await user.click(screen.getByRole("button", { name: /Начать проверку/ }));

    expect(screen.getByText("Вопрос 1 из 4")).toBeInTheDocument();
    expect(screen.getByText(Q[0]!.prompt)).toBeInTheDocument();
    expect(screen.queryByText(Q[1]!.prompt)).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(Q[0]!.options.length);
    expect(screen.queryByRole("button", { name: /Следующий вопрос/ })).toBeNull();
  });

  it("does not fail silently when submitting with nothing selected", async () => {
    const user = userEvent.setup();
    renderScenario("testing");
    await user.click(screen.getByRole("button", { name: "Ответить" }));
    expect(screen.getByText("Выбери один из вариантов, чтобы ответить.")).toBeInTheDocument();
    // and no verdict is invented
    expect(screen.queryByText("Верно")).toBeNull();
  });

  it("does not reveal the correct answer before submit", async () => {
    const user = userEvent.setup();
    renderScenario("testing");
    await user.click(screen.getByRole("radio", { name: correctText(0) }));
    expect(screen.queryByText("верный ответ")).toBeNull();
    expect(screen.queryByText(Q[0]!.feedback.correct)).toBeNull();
  });
});

describe("an incorrect answer", () => {
  it("explains calmly, offers a retry and keeps the next question shut", () => {
    renderScenario("incorrect");
    expect(screen.getByText("Пока не тот ответ")).toBeInTheDocument();
    expect(screen.getByText(Q[0]!.feedback.incorrect)).toBeInTheDocument();
    expect(screen.getByText("Ответ можно дать снова — ничего не теряется.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ответить снова" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Следующий вопрос/ })).toBeNull();
    expect(screen.getByText("Вопрос 1 из 4")).toBeInTheDocument();
  });

  it("marks the wrong choice with words and a glyph, not colour alone", () => {
    renderScenario("incorrect");
    expect(screen.getByText("не тот ответ")).toBeInTheDocument();
  });

  it("does not reveal which option was correct while the question stays open", () => {
    renderScenario("incorrect");
    expect(screen.queryByText("верный ответ")).toBeNull();
    expect(screen.queryByText(Q[0]!.feedback.correct)).toBeNull();
  });

  it("uses no punitive language", () => {
    const { container } = renderScenario("incorrect");
    for (const word of ["провал", "ошибка засчитана", "штраф", "потеря", "жизн", "-XP"]) {
      expect(container.textContent?.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it("reopens the same question on retry", async () => {
    const user = userEvent.setup();
    renderScenario("incorrect");
    await user.click(screen.getByRole("button", { name: "Ответить снова" }));
    expect(screen.getByText("Вопрос 1 из 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ответить" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });
});

describe("a correct answer", () => {
  it("confirms, explains and opens the next question", async () => {
    const user = userEvent.setup();
    renderScenario("testing");
    await answer(user, 0);

    expect(screen.getByText("Верно")).toBeInTheDocument();
    expect(screen.getByText(Q[0]!.feedback.correct)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Следующий вопрос/ }));
    expect(screen.getByText("Вопрос 2 из 4")).toBeInTheDocument();
    expect(screen.getByText(Q[1]!.prompt)).toBeInTheDocument();
    expect(screen.queryByText(Q[0]!.prompt)).toBeNull();
  });

  it("moves focus to the new question's legend", async () => {
    const user = userEvent.setup();
    renderScenario("testing");
    await answer(user, 0);
    await user.click(screen.getByRole("button", { name: /Следующий вопрос/ }));
    expect(document.activeElement).toHaveTextContent(Q[1]!.prompt);
  });
});

describe("completion", () => {
  it("is reached only after every question — the full flow", async () => {
    const user = userEvent.setup();
    renderScenario("threshold-50");
    await user.click(screen.getByRole("button", { name: /Начать проверку/ }));

    for (let i = 0; i < Q.length; i += 1) {
      expect(screen.queryByRole("heading", { name: /Урок завершён/ })).toBeNull();
      await answer(user, i);
      if (i < Q.length - 1) await user.click(screen.getByRole("button", { name: /Следующий вопрос/ }));
    }

    expect(screen.getByRole("heading", { name: /Урок завершён/ })).toBeInTheDocument();
    expect(screen.getByText("Пройдена")).toBeInTheDocument();
  });

  it("lists the satisfied requirements", () => {
    renderScenario("completed");
    const done = screen.getByRole("region", { name: /Урок завершён/ });
    expect(within(done).getByText("Просмотр видео не менее 50%")).toBeInTheDocument();
    expect(within(done).getByText("Проверка понимания — 4 вопроса")).toBeInTheDocument();
  });

  it("does not claim the progress was saved on a server", () => {
    const { container } = renderScenario("completed");
    expect(screen.getByText(/сервер прогресса ещё не подключён/)).toBeInTheDocument();
    for (const claim of ["сохранено на сервере", "синхронизировано", "загружено в облако"]) {
      expect(container.textContent).not.toContain(claim);
    }
  });

  it("invents no XP and no reward", () => {
    const { container } = renderScenario("completed");
    expect(container.textContent).not.toMatch(/XP/);
    expect(container.textContent).not.toMatch(/награда|приз|поздравляем|достижение/i);
  });

  it("does not look like a game reward", () => {
    const { container } = renderScenario("completed");
    expect(container.textContent).not.toMatch(
      /\bбалл|\bочк(ов|и)\b|лидер|таблица|рейтинг|серия|конфетти|уровень пройден на/i,
    );
  });
});

describe("the next-lesson gate in the UI", () => {
  it("offers no link to level 19 before completion — only an explanation", () => {
    renderScenario("threshold-50");
    expect(screen.queryByRole("link", { name: /Перейти к уровню 19/ })).toBeNull();
    expect(screen.getByText(/Уровень 19 «Разметка графика» откроется после/)).toBeInTheDocument();
  });

  it("offers the link only after completion, with a clean canonical href", () => {
    renderScenario("completed");
    const next = screen.getByRole("link", { name: /Перейти к уровню 19 «Разметка графика»/ });
    // D2B.1: no dev scenario in a user-facing link — progression is session-backed.
    expect(next).toHaveAttribute("href", "/lessons/level.019");
    expect(next.getAttribute("href")).not.toContain("scenario");
    expect(screen.queryByText(/откроется после/)).toBeNull();
  });

  it("always keeps Путь reachable", () => {
    for (const scenario of ["initial", "threshold-49", "completed"] as const) {
      const { unmount } = renderScenario(scenario);
      expect(screen.getByRole("link", { name: /Вернуться в Путь/ })).toHaveAttribute("href", "/path");
      unmount();
    }
  });
});

describe("no financial pressure anywhere in the lesson", () => {
  it("shows no Pocket CTA, no balance and no deposit ask in any state", () => {
    for (const scenario of ["initial", "threshold-49", "threshold-50", "testing", "incorrect", "completed"] as const) {
      const { container, unmount } = renderScenario(scenario);
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/пополн|депозит|внес(?:ти|и)|баланс Pocket|\$\d/i);
      expect(screen.queryByRole("link", { name: /Pocket/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /Pocket/i })).toBeNull();
      unmount();
    }
  });
});
