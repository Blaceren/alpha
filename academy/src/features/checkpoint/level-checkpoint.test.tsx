/**
 * L4VC-1 — the financial-checkpoint screen.
 *
 * Covers every required state, the double-submit guard, refresh recovery, the
 * retry countdown, keyboard operation, and the privacy contract: no balance, no
 * remaining amount, no Pocket link, no upload, no mentor CTA — in ANY state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock("@/lib/checkpoint/checkpoint-client", () => ({
  verifyCheckpoint: vi.fn(),
  newCheckpointRequestId: vi.fn(() => "ata-cp-fixedkey01"),
}));

import * as client from "@/lib/checkpoint/checkpoint-client";
import { LevelCheckpoint } from "@/features/checkpoint/level-checkpoint";
import type { AcademyCheckpointState } from "@/lib/curriculum/academy-view";
import type { CheckpointVerificationResult } from "@/lib/checkpoint/types";

const verifyMock = vi.mocked(client.verifyCheckpoint);
const newIdMock = vi.mocked(client.newCheckpointRequestId);

const STABLE_CODE = "v2.l004.kontrolnaya-tochka-50";

function cp(partial: Partial<AcademyCheckpointState> = {}): AcademyCheckpointState {
  return {
    verificationState: "verification_unavailable",
    reason: "checkpoint_disabled",
    canVerify: false,
    canStart: false,
    canComplete: false,
    retryAfterSeconds: null,
    ...partial,
  };
}

function result(partial: Partial<CheckpointVerificationResult> = {}): CheckpointVerificationResult {
  return {
    verificationState: "not_met",
    verificationReason: "not_met",
    retryAfterSeconds: null,
    completed: false,
    replayed: false,
    level: { levelNumber: 4, stableCode: STABLE_CODE },
    nextLevelNumber: null,
    xpAwarded: 0,
    xpTransactionId: null,
    ...partial,
  };
}

const ok = (data: CheckpointVerificationResult) => ({ ok: true as const, data, requestId: null });

function renderGate(checkpoint: AcademyCheckpointState) {
  return render(
    <LevelCheckpoint levelNumber={4} stableCode={STABLE_CODE} checkpoint={checkpoint} />,
  );
}

/** Text that must never appear on this screen, in any state. */
const FORBIDDEN_TEXT = [
  /осталось/i,
  /внес/i, // внести / внесите — deposit pressure
  /пополн/i, // пополнить — top up
  /вывод/i, // withdrawal
  /\$\s?\d/, // any concrete dollar amount other than the canonical target
  /скриншот/i,
  /загруз/i, // upload
  /ментор/i,
  /наставник/i,
];

function assertNoForbiddenSurface(container: HTMLElement) {
  // The canonical curriculum target is allowed exactly once; strip it before
  // scanning so the check is about leaked money, not about the published gate.
  const text = (container.textContent ?? "").replace(/Баланс Pocket от \$50|\$50/g, "«цель»");
  for (const pattern of FORBIDDEN_TEXT) {
    expect(text, `forbidden copy matched ${pattern}`).not.toMatch(pattern);
  }
  // No outbound link of any kind, and no upload control.
  expect(container.querySelectorAll("a")).toHaveLength(0);
  expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
  expect(container.querySelectorAll("input")).toHaveLength(0);
  expect(container.querySelectorAll("progress")).toHaveLength(0);
}

beforeEach(() => {
  refresh.mockClear();
  verifyMock.mockReset();
  newIdMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LevelCheckpoint — every required state", () => {
  const STATES: Array<[string, AcademyCheckpointState, string]> = [
    ["verification disabled", cp({ reason: "checkpoint_disabled" }), "disabled"],
    ["provider flag off", cp({ reason: "provider_disabled" }), "disabled"],
    ["provider unavailable", cp({ reason: "provider_unconfigured" }), "provider_unavailable"],
    ["provider maintenance", cp({ reason: "provider_maintenance" }), "provider_unavailable"],
    ["requirement missing", cp({ reason: "requirement_unconfigured" }), "provider_unavailable"],
    ["account not linked", cp({ reason: "identity_unlinked" }), "identity_unlinked"],
    ["account mismatch", cp({ reason: "identity_mismatch" }), "identity_mismatch"],
    ["unsupported currency", cp({ reason: "unsupported_currency" }), "unsupported_currency"],
    ["ready to verify", cp({ verificationState: "ready", reason: "none", canVerify: true }), "ready"],
    ["checking", cp({ verificationState: "checking", reason: "none" }), "checking"],
    [
      "cooldown",
      cp({ verificationState: "cooldown", reason: "cooldown_active", retryAfterSeconds: 30 }),
      "cooldown",
    ],
    [
      "threshold not met",
      cp({ verificationState: "not_met", reason: "not_met", canVerify: true }),
      "not_met",
    ],
    ["completed", cp({ verificationState: "completed", reason: "none" }), "completed"],
  ];

  for (const [name, checkpoint, phase] of STATES) {
    it(`renders the ${name} screen, and never a balance`, () => {
      const { container } = renderGate(checkpoint);
      expect(container.querySelector(".cp-gate")?.getAttribute("data-verification")).toBe(phase);
      // Exactly ONE polite live region in every state: a second one (or a
      // per-second countdown region) would flood a screen reader.
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      assertNoForbiddenSurface(container);
    });
  }

  it("shows the verify control ONLY when the Backend permits it", () => {
    for (const [, checkpoint] of STATES) {
      const { container, unmount } = renderGate(checkpoint);
      const button = container.querySelector("button.cp-gate__verify");
      expect(Boolean(button)).toBe(checkpoint.canVerify);
      unmount();
    }
  });

  it("shows exactly one control when it shows one at all", () => {
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("offers no disabled placeholder button while verification is unavailable", () => {
    // A greyed-out button would imply the platform could look if pressed.
    const { container } = renderGate(cp({ reason: "provider_unconfigured" }));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("says 'not met' without ever saying by how much", () => {
    const { container } = renderGate(
      cp({ verificationState: "not_met", reason: "not_met", canVerify: true }),
    );
    expect(screen.getByText(/Условие пока не выполнено/)).toBeInTheDocument();
    assertNoForbiddenSurface(container);
  });

  it("distinguishes 'cannot look' from 'not met' in the copy", () => {
    const unavailable = renderGate(cp({ reason: "provider_unconfigured" }));
    expect(screen.getByText(/Проверка условия сейчас недоступна/)).toBeInTheDocument();
    expect(unavailable.container.textContent).not.toMatch(/не выполнено/);
    unavailable.unmount();

    renderGate(cp({ verificationState: "not_met", reason: "not_met", canVerify: true }));
    expect(screen.getByText(/Условие пока не выполнено/)).toBeInTheDocument();
  });
});

describe("LevelCheckpoint — verification lifecycle", () => {
  it("sends one request with a stable identity and NO learner input", async () => {
    verifyMock.mockResolvedValue(ok(result()));
    renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(1));
    // Exactly two arguments: the level code and the request identity. There is
    // no parameter through which a balance could be sent.
    expect(verifyMock).toHaveBeenCalledWith(STABLE_CODE, "ata-cp-fixedkey01");
  });

  it("a double click produces ONE request and one identity", async () => {
    let settle: ((value: unknown) => void) | null = null;
    verifyMock.mockImplementation(
      () => new Promise((resolve) => { settle = resolve; }) as never,
    );
    renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    const button = screen.getByRole("button", { name: /Проверить условие/ });
    await userEvent.click(button);
    await userEvent.click(button);
    await userEvent.click(button);
    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(newIdMock).toHaveBeenCalledTimes(1);
    // ...and the control is disabled and busy while in flight.
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      settle?.(ok(result()));
    });
  });

  it("a retry after a failure reuses the SAME identity (replay, not a new attempt)", async () => {
    verifyMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "BACKEND_UNAVAILABLE", status: 502, requestId: null, message: "" } as never,
    });
    renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/Не удалось выполнить проверку/);

    verifyMock.mockResolvedValueOnce(ok(result()));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(2));
    expect(verifyMock.mock.calls[1]).toEqual([STABLE_CODE, "ata-cp-fixedkey01"]);
    // One identity was minted for both attempts.
    expect(newIdMock).toHaveBeenCalledTimes(1);
  });

  it("a server-confirmed pass refreshes the server-authoritative curriculum", async () => {
    verifyMock.mockResolvedValue(
      ok(result({ verificationState: "completed", verificationReason: "none", completed: true, nextLevelNumber: 5 })),
    );
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/Контрольная точка пройдена/);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // The control is gone; there is nothing left to ask.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    assertNoForbiddenSurface(container);
  });

  it("a not_met answer keeps the level open and awards nothing", async () => {
    verifyMock.mockResolvedValue(ok(result()));
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/Условие пока не выполнено/);
    expect(refresh).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/XP|опыт/i);
    assertNoForbiddenSurface(container);
  });

  it("a cooldown answer shows a countdown and closes the control", async () => {
    verifyMock.mockResolvedValue(
      ok(result({ verificationState: "cooldown", verificationReason: "cooldown_active", retryAfterSeconds: 3 })),
    );
    renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/Повторная проверка через 3 с\./);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("the countdown ticks down and reopens the control at zero", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderGate(
      cp({ verificationState: "cooldown", reason: "cooldown_active", retryAfterSeconds: 2, canVerify: true }),
    );
    expect(screen.getByText(/через 2 с\./)).toBeInTheDocument();
    expect(screen.getByRole("button")).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText(/через 1 с\./)).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(screen.queryByText(/Повторная проверка через/)).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toBeEnabled();
  });

  it("recovers the server state after a refresh, mid-cooldown and after a pass", () => {
    // A refresh re-renders from the server block: the learner returns to the
    // same honest screen without any client-held memory.
    const cooling = renderGate(
      cp({ verificationState: "cooldown", reason: "cooldown_active", retryAfterSeconds: 45 }),
    );
    expect(screen.getByText(/через 45 с\./)).toBeInTheDocument();
    cooling.unmount();

    const done = renderGate(cp({ verificationState: "completed", reason: "none" }));
    expect(screen.getByText(/Контрольная точка пройдена/)).toBeInTheDocument();
    expect(done.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("a 404 (feature switched off mid-session) fails closed to disabled", async () => {
    verifyMock.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", status: 404, requestId: null, message: "" } as never,
    });
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/пока не подключена/);
    expect(container.querySelector(".cp-gate")?.getAttribute("data-verification")).toBe("disabled");
  });

  it("never renders a provider error verbatim", async () => {
    verifyMock.mockResolvedValue({
      ok: false,
      error: {
        code: "BACKEND_UNAVAILABLE",
        status: 502,
        requestId: null,
        message: "balance 1234 below threshold",
      } as never,
    });
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/Не удалось выполнить проверку/);
    expect(container.textContent).not.toContain("1234");
    assertNoForbiddenSurface(container);
  });
});

describe("LevelCheckpoint — accessibility", () => {
  it("is operable by keyboard alone", async () => {
    verifyMock.mockResolvedValue(ok(result()));
    renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.tab();
    const button = screen.getByRole("button", { name: /Проверить условие/ });
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(verifyMock).toHaveBeenCalledTimes(1));
  });

  it("moves focus to the answer once a verdict arrives", async () => {
    verifyMock.mockResolvedValue(ok(result()));
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    await userEvent.click(screen.getByRole("button", { name: /Проверить условие/ }));
    await screen.findByText(/Условие пока не выполнено/);
    await waitFor(() =>
      expect(container.querySelector(".cp-gate__status")).toHaveFocus(),
    );
  });

  it("labels the section and announces status politely", () => {
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    const section = container.querySelector("section");
    expect(section).toHaveAttribute("aria-labelledby", "cp-gate-title");
    expect(container.querySelector("#cp-gate-title")?.textContent).toBe("Контрольная точка");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("keeps the status focusable programmatically but out of the tab order", () => {
    const { container } = renderGate(cp({ verificationState: "ready", reason: "none", canVerify: true }));
    expect(container.querySelector(".cp-gate__status")).toHaveAttribute("tabindex", "-1");
  });

  it("declares a visible focus ring for the control and the status line", async () => {
    // Read from the shipped stylesheet: the outline must never be removed.
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/features/checkpoint/level-checkpoint.css", "utf8");
    expect(css).toMatch(/\.cp-gate__verify:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    expect(css).toMatch(/\.cp-gate__status:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });

  /**
   * Responsive coverage is a CSS-CONTRACT check, not a browser paint.
   *
   * jsdom does not lay out or evaluate media queries, so these assert the rules
   * that govern each viewport rather than measuring pixels. Stated plainly so
   * the coverage is not read as stronger than it is.
   */
  it("collapses to a single column at 320px (no side-by-side grid)", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/features/checkpoint/level-checkpoint.css", "utf8");
    // 320px < 400px < 720px, so BOTH narrow blocks apply: one column, and the
    // decorative gate is dropped rather than squeezing the text.
    const narrow = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(narrow).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    const narrowest = css.slice(css.indexOf("@media (max-width: 400px)"));
    expect(narrowest).toMatch(/\.checkpoint-gate\s*\{[^}]*display: none/);
  });

  it("collapses to a single column at 390px", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/features/checkpoint/level-checkpoint.css", "utf8");
    // 390px is below the 720px breakpoint and below 400px, so the same two
    // blocks apply — there is no intermediate rule that could reintroduce a
    // multi-column layout between 320px and 400px.
    const breakpoints = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(breakpoints).toEqual([720, 400]);
    expect(breakpoints.every((bp) => bp === 720 || bp === 400)).toBe(true);
  });

  it("survives 200% zoom on a 640px viewport (effective 320px)", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/features/checkpoint/level-checkpoint.css", "utf8");
    // 200% zoom halves the CSS viewport, so 640px lands in the 400px block —
    // the same single-column, ornament-free layout as a 320px phone.
    expect(css).toMatch(/@media \(max-width: 400px\)/);
    // Nothing is sized in a unit that ignores the user's zoom or font settings.
    expect(css).not.toMatch(/font-size:\s*\d+px/);
    // Every column track is minmax(0, …) so a long word cannot force overflow.
    for (const track of css.match(/grid-template-columns:[^;]+;/g) ?? []) {
      expect(track).toMatch(/minmax\(0,/);
    }
  });

  it("has no layout rule that could force horizontal overflow at 320px", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/features/checkpoint/level-checkpoint.css", "utf8");
    // The grid collapses to one column and the ornament is dropped on the
    // narrowest viewports (320px and 640px @ 200% zoom both land here).
    expect(css).toMatch(/@media \(max-width: 720px\)/);
    expect(css).toMatch(/@media \(max-width: 400px\)/);
    expect(css).toMatch(/grid-template-columns: minmax\(0, 1fr\);/);
    // No fixed pixel width anywhere, and the control wraps rather than overflows.
    // `max-width` / `min-width` in media queries are fine; a fixed `width` is not.
    expect(css).not.toMatch(/(?<![a-z-])width:\s*\d{3,}px/);
    expect(css).toMatch(/white-space: normal/);
    expect(css).toMatch(/overflow-wrap: anywhere/);
    expect(css).toMatch(/max-width: 100%/);
  });
});
