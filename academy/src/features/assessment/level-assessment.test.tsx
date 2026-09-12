import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

vi.mock("@/lib/assessment/assessment-client", () => ({
  startAssessment: vi.fn(),
  submitAssessment: vi.fn(),
  newRequestId: vi.fn(() => "ata-asmt-fixedkey01"),
}));

import * as client from "@/lib/assessment/assessment-client";
import { LevelAssessment } from "@/features/assessment/level-assessment";
import type { AssessmentStart, AssessmentResult } from "@/lib/assessment/types";

const startMock = vi.mocked(client.startAssessment);
const submitMock = vi.mocked(client.submitAssessment);

function fourQuestionStart(): AssessmentStart {
  const q = (n: number) => ({ questionKey: `q${n}`, questionNumber: n, type: "single_choice", prompt: `Вопрос текст ${n}`, options: [
    { code: "a", label: `A${n}` }, { code: "b", label: `B${n}` }, { code: "c", label: `C${n}` }, { code: "d", label: `D${n}` },
  ] });
  return {
    created: true,
    level: { levelNumber: 2, stableCode: "v2.l002.x", title: "L2", type: "lesson" },
    attempt: { attemptId: 11, attemptNumber: 1, status: "in_progress", startedAt: "t" },
    assessment: { versionNumber: 1, passPercent: 100, maxAttempts: null, locale: "ru", questions: [q(1), q(2), q(3), q(4)] },
  };
}
const okStart = () => ({ ok: true as const, data: fourQuestionStart(), requestId: null });
const failRes = (): { ok: true; data: AssessmentResult; requestId: null } => ({ ok: true, data: { created: true, status: "failed", passed: false, attemptNumber: 1, submittedAt: "t", durationSeconds: 3, totalQuestions: 4, correctCount: 3, scoreBasisPoints: 7500, completion: null }, requestId: null });
const passRes = (): { ok: true; data: AssessmentResult; requestId: null } => ({ ok: true, data: { created: true, status: "passed", passed: true, attemptNumber: 2, submittedAt: "t", durationSeconds: 3, totalQuestions: 4, correctCount: 4, scoreBasisPoints: 10000, completion: { levelNumber: 2, stableCode: "v2.l002.x", xpAwarded: 0, nextLevelNumber: 3, terminal: false, completedAt: "t" } }, requestId: null });

const props = { stableCode: "v2.l002.x", locale: "ru", alreadyCompleted: false, nextLevelCode: null as string | null };

async function answerAll() {
  for (let n = 1; n <= 4; n += 1) {
    await userEvent.click(screen.getByLabelText(`A${n}`));
  }
}

beforeEach(() => {
  refresh.mockClear();
  startMock.mockReset();
  submitMock.mockReset();
});

describe("LevelAssessment", () => {
  it("renders four accessible questions with four options each", async () => {
    startMock.mockResolvedValue(okStart());
    render(<LevelAssessment {...props} />);
    const groups = await screen.findAllByRole("group"); // fieldsets
    expect(groups).toHaveLength(4);
    for (const g of groups) {
      expect(within(g).getAllByRole("radio")).toHaveLength(4);
    }
    // each question uses a legend
    expect(screen.getByText(/Вопрос текст 1/)).toBeInTheDocument();
  });

  it("keeps submit disabled until all four questions are answered", async () => {
    startMock.mockResolvedValue(okStart());
    render(<LevelAssessment {...props} />);
    const submit = await screen.findByRole("button", { name: /Проверить ответы/ });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText("A1"));
    expect(submit).toBeDisabled();
    await answerAll();
    expect(submit).toBeEnabled();
  });

  it("supports keyboard selection of options", async () => {
    startMock.mockResolvedValue(okStart());
    render(<LevelAssessment {...props} />);
    const a1 = await screen.findByLabelText("A1");
    a1.focus();
    await userEvent.keyboard(" ");
    expect((a1 as HTMLInputElement).checked).toBe(true);
  });

  it("shows a bounded submitting state and a failed result with retry", async () => {
    startMock.mockResolvedValue(okStart());
    let resolve!: (v: ReturnType<typeof failRes>) => void;
    submitMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<LevelAssessment {...props} />);
    await screen.findByRole("button", { name: /Проверить ответы/ });
    await answerAll();
    await userEvent.click(screen.getByRole("button", { name: /Проверить ответы/ }));
    expect(screen.getByRole("button", { name: /Проверяем/ })).toBeInTheDocument();
    resolve(failRes());
    expect(await screen.findByText(/Пока не пройдено/)).toBeInTheDocument();
    expect(screen.getAllByText(/Верно 3 из 4/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Попробовать ещё раз/ })).toBeInTheDocument();
  });

  it("retry resets to a clean answer state and re-starts a fresh attempt", async () => {
    startMock.mockResolvedValue(okStart());
    submitMock.mockResolvedValue(failRes());
    render(<LevelAssessment {...props} />);
    await screen.findByRole("button", { name: /Проверить ответы/ });
    await answerAll();
    await userEvent.click(screen.getByRole("button", { name: /Проверить ответы/ }));
    await screen.findByRole("button", { name: /Попробовать ещё раз/ });
    startMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: /Попробовать ещё раз/ }));
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1)); // fresh attempt
    const radios = await screen.findAllByRole("radio");
    expect(radios.every((r) => !(r as HTMLInputElement).checked)).toBe(true); // no preselect
  });

  it("shows the passed state and refetches server state, exposing the next-level action", async () => {
    startMock.mockResolvedValue(okStart());
    submitMock.mockResolvedValue(passRes());
    const { rerender } = render(<LevelAssessment {...props} />);
    await screen.findByRole("button", { name: /Проверить ответы/ });
    await answerAll();
    await userEvent.click(screen.getByRole("button", { name: /Проверить ответы/ }));
    expect(await screen.findByText("✓ Уровень завершён")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1); // server-authoritative refetch
    // After refresh, the server re-renders with L3 accessible -> next code appears.
    rerender(<LevelAssessment {...props} nextLevelCode="v2.l003.next" />);
    const next = screen.getByRole("link", { name: /следующему уровню/ });
    expect(next).toHaveAttribute("href", "/lessons/v2.l003.next");
  });

  it("double submit creates only one request (idempotent click)", async () => {
    startMock.mockResolvedValue(okStart());
    let resolve!: (v: ReturnType<typeof passRes>) => void;
    submitMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<LevelAssessment {...props} />);
    await screen.findByRole("button", { name: /Проверить ответы/ });
    await answerAll();
    const btn = screen.getByRole("button", { name: /Проверить ответы/ });
    await userEvent.click(btn);
    await userEvent.click(btn); // rapid second click while submitting
    expect(submitMock).toHaveBeenCalledTimes(1);
    resolve(passRes());
    await screen.findByText("✓ Уровень завершён");
  });

  it("does not compute a score locally — submits only stable identifiers", async () => {
    startMock.mockResolvedValue(okStart());
    submitMock.mockResolvedValue(passRes());
    render(<LevelAssessment {...props} />);
    await screen.findByRole("button", { name: /Проверить ответы/ });
    await answerAll();
    await userEvent.click(screen.getByRole("button", { name: /Проверить ответы/ }));
    await waitFor(() => expect(submitMock).toHaveBeenCalled());
    const [attemptId, answers, requestId] = submitMock.mock.calls[0]!;
    expect(attemptId).toBe(11);
    expect(requestId).toBe("ata-asmt-fixedkey01");
    expect(answers).toEqual([
      { questionKey: "q1", answer: { code: "a" } },
      { questionKey: "q2", answer: { code: "a" } },
      { questionKey: "q3", answer: { code: "a" } },
      { questionKey: "q4", answer: { code: "a" } },
    ]);
  });

  it("renders the already-completed canonical state without calling start", async () => {
    render(<LevelAssessment {...props} alreadyCompleted nextLevelCode="v2.l003.next" />);
    expect(screen.getByText("✓ Уровень завершён")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /следующему уровню/ })).toHaveAttribute("href", "/lessons/v2.l003.next");
    expect(startMock).not.toHaveBeenCalled();
  });

  it("fails closed with a bounded notice when the feature flag is disabled (404)", async () => {
    startMock.mockResolvedValue({ ok: false, error: { category: "UNKNOWN_ERROR", status: 404, code: "NOT_FOUND", messageKey: "k", requestId: null, retryable: false } });
    render(<LevelAssessment {...props} />);
    expect(await screen.findByText(/Проверка сейчас недоступна/)).toBeInTheDocument();
  });

  it("shows a bounded generic error on network failure", async () => {
    startMock.mockResolvedValue({ ok: false, error: { category: "NETWORK_ERROR", status: null, code: null, messageKey: "k", requestId: null, retryable: true } });
    render(<LevelAssessment {...props} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Не удалось загрузить проверку/);
  });

  it("announces status through a polite live region", async () => {
    startMock.mockResolvedValue(okStart());
    render(<LevelAssessment {...props} />);
    await screen.findByRole("button", { name: /Проверить ответы/ });
    const status = document.querySelector('[role="status"]');
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
