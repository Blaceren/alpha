/**
 * THE LEARNER'S OWN COMPLETION — two things that can be declared, one command.
 *
 * `practice` is the control the 100-level program's practical levels have
 * always had: a confirmation and a button, both required. `lesson` (2026-10-02)
 * is a lesson with no test: one named button. Both send the same request, and
 * neither decides anything the Backend does not confirm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@/lib/manual-completion/manual-completion-client", () => ({
  completeManualLevel: vi.fn(),
  newManualCompletionRequestId: vi.fn(() => "ata-manual-fixedkey01"),
}));

import * as client from "@/lib/manual-completion/manual-completion-client";
import { LevelManualCompletion } from "@/features/manual-completion/level-manual-completion";
import { makeError } from "@/lib/api/errors";

const complete = vi.mocked(client.completeManualLevel);
const done = () => ({ ok: true as const, data: {} as never, requestId: null });
const props = { stableCode: "v2.l001.x", xpReward: 50, alreadyCompleted: false };

beforeEach(() => {
  refresh.mockClear();
  complete.mockReset();
});

describe("a lesson without a test", () => {
  it("is one named button: no confirmation to tick", () => {
    render(<LevelManualCompletion {...props} variant="lesson" />);
    expect(screen.getByRole("heading", { name: "Урок без теста" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Отметить урок пройденным" })).toBeEnabled();
    expect(screen.getByText(/В этом уроке нет теста/)).toBeInTheDocument();
    expect(screen.getByText(/За уровень начисляется 50 XP/)).toBeInTheDocument();
  });

  it("completes through the Backend, with one request identity, and re-reads the page", async () => {
    complete.mockResolvedValue(done());
    render(<LevelManualCompletion {...props} variant="lesson" />);
    await userEvent.click(screen.getByRole("button", { name: "Отметить урок пройденным" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("v2.l001.x", "ata-manual-fixedkey01");
  });

  it("a double click asks once", async () => {
    let release: (value: ReturnType<typeof done>) => void = () => {};
    complete.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<LevelManualCompletion {...props} variant="lesson" />);
    const button = screen.getByRole("button", { name: "Отметить урок пройденным" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(complete).toHaveBeenCalledTimes(1);
    release(done());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says what happened when the Backend refuses, and a retry replays the same request", async () => {
    complete.mockResolvedValueOnce({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    complete.mockResolvedValueOnce(done());
    render(<LevelManualCompletion {...props} variant="lesson" />);
    const button = screen.getByRole("button", { name: "Отметить урок пройденным" });
    await userEvent.click(button);
    expect(await screen.findByText("Сервер сейчас недоступен. Попробуйте ещё раз позже.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(button);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(complete.mock.calls.map((call) => call[1])).toEqual(["ata-manual-fixedkey01", "ata-manual-fixedkey01"]);
  });

  it("names a stale page in the Backend's own terms", async () => {
    complete.mockResolvedValue({
      ok: false,
      error: makeError("CONFLICT", { status: 409, code: "MANUAL_COMPLETION_LEVEL_NOT_STARTED" }),
    });
    render(<LevelManualCompletion {...props} variant="lesson" />);
    await userEvent.click(screen.getByRole("button", { name: "Отметить урок пройденным" }));
    expect(await screen.findByText("Сначала нужно начать уровень.")).toBeInTheDocument();
  });

  it("a finished lesson says so, with nothing to press", () => {
    render(<LevelManualCompletion {...props} variant="lesson" alreadyCompleted />);
    expect(screen.getByRole("heading", { name: "Урок пройден" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("a practical level", () => {
  it("still needs the confirmation AND the button", async () => {
    complete.mockResolvedValue(done());
    render(<LevelManualCompletion {...props} xpReward={150} />);
    expect(screen.getByRole("heading", { name: "Практическое задание" })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Отметить выполнение" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(complete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("checkbox", { name: /Подтверждаю, что выполнил/ }));
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("addresses the learner formally, like the rest of the product", () => {
    const { container } = render(<LevelManualCompletion {...props} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Когда закончите — отметьте выполнение/);
    expect(text).not.toMatch(/закончишь|отметь выполнение,/);
  });

  it("shows no reward line for a level worth nothing", () => {
    render(<LevelManualCompletion {...props} xpReward={0} />);
    expect(screen.queryByText(/начисляется/)).toBeNull();
  });
});
