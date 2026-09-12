import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LessonLockedScreen } from "@/features/lesson/components/lesson-locked-screen";
import { LessonUnknown } from "@/features/lesson/components/lesson-unknown";
import { getLessonEntry } from "@/features/lesson/data/lesson-fixtures";
import { scenarioProgress } from "@/features/lesson/model/lesson-scenarios";
import { getLevel } from "@/data/curriculum/fixture";

const AT_18 = scenarioProgress("locked");

describe("a locked lesson (level 19)", () => {
  const stub = getLessonEntry(19);
  const renderLocked = () =>
    render(
      <LessonLockedScreen
        level={getLevel(19)}
        progress={AT_18}
        note={stub?.kind === "stub" ? stub.stub.note : undefined}
      />,
    );

  it("resolves instead of 404, with one h1 naming the level", () => {
    renderLocked();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Разметка графика");
    expect(screen.getByText(/Состояние:/)).toBeInTheDocument();
  });

  it("explains that level 18 must be finished first", () => {
    renderLocked();
    expect(
      screen.getByText(/Сначала нужно завершить уровень 18 «Поддержка и сопротивление»/),
    ).toBeInTheDocument();
    expect(screen.getByText(/перепрыгнуть нельзя/)).toBeInTheDocument();
  });

  it("shows no financial condition — the lock is about sequence only", () => {
    const { container } = renderLocked();
    expect(container.textContent).not.toMatch(/баланс|Pocket|\$|депозит|пополн/i);
  });

  it("reveals no lesson body, question or explanation", () => {
    const { container } = renderLocked();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.textContent).toContain("Содержание уровня откроется вместе с доступом");
  });

  it("does not fake an unlock — no way into the lesson from here", () => {
    renderLocked();
    expect(screen.queryByRole("button", { name: /Начать|Смотреть|Продолжить/ })).toBeNull();
  });

  it("says what the level will ask for, including its artifact", () => {
    renderLocked();
    expect(screen.getByText("Практическое задание")).toBeInTheDocument();
    expect(screen.getByText(/Разметка 3 графиков/)).toBeInTheDocument();
  });

  it("offers both ways out — Путь and the current lesson", () => {
    renderLocked();
    expect(screen.getByRole("link", { name: /Вернуться в Путь/ })).toHaveAttribute("href", "/path");
    expect(screen.getByRole("link", { name: /Перейти к текущему уроку — уровень 18/ })).toHaveAttribute(
      "href",
      "/lessons/level.018",
    );
  });
});

describe("an unknown address", () => {
  it("explains itself rather than 404-ing, and leads back", () => {
    render(<LessonUnknown />);
    expect(screen.getByRole("heading", { level: 1, name: "Урок не найден" })).toBeInTheDocument();
    expect(screen.getByText(/Адрес не соответствует ни одному уровню пути/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Вернуться в Путь/ })).toHaveAttribute("href", "/path");
    expect(screen.getByRole("link", { name: /уровень 18/ })).toHaveAttribute(
      "href",
      "/lessons/level.018",
    );
  });
});

describe("a reached level D2B did not build", () => {
  it("is honest that the experience is missing, not that the level is gated", () => {
    const stub = getLessonEntry(19);
    render(
      <LessonUnknown
        levelNumber={19}
        title="Разметка графика"
        note={stub?.kind === "stub" ? stub.stub.note : undefined}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Разметка графика" })).toBeInTheDocument();
    expect(screen.getByText(/Практические уровни появятся на следующем этапе/)).toBeInTheDocument();
    expect(screen.getByText(/дело не в условиях доступа/)).toBeInTheDocument();
    // it does not pretend the level is finished
    expect(screen.queryByText(/завершён/)).toBeNull();
  });
});
