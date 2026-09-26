/**
 * L2START-PLAYER-1 — the level start control.
 *
 * Covers the action itself, the double-click guard, refresh-on-success, the
 * recoverable-failure path, keyboard operation, and the contract that matters
 * most: the request carries no learner input at all, so nothing here can ask to
 * be put into a state rather than asking to begin one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock("@/lib/level-start/level-start-client", () => ({ startLevel: vi.fn() }));

import * as client from "@/lib/level-start/level-start-client";
import { LevelStart } from "@/features/level-start/level-start";
import { makeError } from "@/lib/api/errors";

const startMock = vi.mocked(client.startLevel);
const STABLE_CODE = "v2.l002.kak-ustroen-alfa-trade-academy";

const started = (created = true) => ({
  ok: true as const,
  data: { state: "in_progress", stableCode: STABLE_CODE, levelNumber: 2, created },
  requestId: null,
});

beforeEach(() => {
  refresh.mockReset();
  startMock.mockReset();
});

const button = () => screen.getByRole("button", { name: /Начать|Открываем/ });

describe("LevelStart", () => {
  it("offers exactly one start action on an available level", () => {
    render(<LevelStart stableCode={STABLE_CODE} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button()).toBeEnabled();
  });

  it("starts the named level and refreshes the server state", async () => {
    startMock.mockResolvedValue(started());
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    // The stable code is the ONLY argument: no learner, no status, no body.
    expect(startMock).toHaveBeenCalledWith(STABLE_CODE);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Уровень открыт.")).toBeInTheDocument();
  });

  it("shows a loading state while the start is in flight", async () => {
    let release: (value: ReturnType<typeof started>) => void = () => {};
    startMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());
    await waitFor(() => expect(button()).toHaveAttribute("aria-busy", "true"));
    expect(button()).toBeDisabled();

    release(started());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("a double click produces exactly one request", async () => {
    let release: (value: ReturnType<typeof started>) => void = () => {};
    startMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    const control = button();
    await user.click(control);
    await user.click(control);
    await user.click(control);

    expect(startMock).toHaveBeenCalledTimes(1);
    release(started());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("an idempotent repeat is still a success for the learner", async () => {
    startMock.mockResolvedValue(started(false));
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());

    expect(await screen.findByText("Уровень открыт.")).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("a locked level is explained and does not refresh the page", async () => {
    startMock.mockResolvedValue({
      ok: false,
      error: { ...makeError("FORBIDDEN", { status: 403 }), code: "LEVEL_START_LOCKED" },
    });
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());

    expect(
      await screen.findByText("Этот уровень ещё закрыт. Сначала нужно пройти предыдущие."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a completed level says so rather than pretending to start", async () => {
    startMock.mockResolvedValue({
      ok: false,
      error: { ...makeError("CONFLICT", { status: 409 }), code: "LEVEL_START_ALREADY_COMPLETED" },
    });
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());
    expect(await screen.findByText("Этот уровень уже пройден.")).toBeInTheDocument();
  });

  it("a transport failure is recoverable — the learner may try again", async () => {
    startMock.mockResolvedValueOnce({ ok: false, error: makeError("NETWORK_ERROR") });
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());
    expect(
      await screen.findByText("Не удалось связаться с сервером. Попробуй ещё раз."),
    ).toBeInTheDocument();
    // The control comes back, and the second attempt goes through.
    expect(button()).toBeEnabled();

    startMock.mockResolvedValueOnce(started());
    await user.click(button());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("never retries on the learner's behalf", async () => {
    startMock.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.click(button());
    await screen.findByText("Сервер сейчас недоступен. Попробуй ещё раз позже.");
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it("is operable from the keyboard and announces the result politely", async () => {
    startMock.mockResolvedValue(started());
    const user = userEvent.setup();
    render(<LevelStart stableCode={STABLE_CODE} />);

    await user.tab();
    expect(button()).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Уровень открыт.");
  });

  it("offers no control that could complete the level or grant XP", () => {
    const { container } = render(<LevelStart stableCode={STABLE_CODE} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toMatch(/XP|заверш|пройден/i);
  });
});
