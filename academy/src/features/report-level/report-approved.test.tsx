import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { getPathProgress } from "@/features/path/model/path-state";
import { emptyLessonProgress } from "@/features/lesson/model/lesson-session-progress";
import { buildLessonsLibraryModel } from "@/features/lessons-library/model/lessons-library-model";
import { LessonsLibraryWorkspace } from "@/features/lessons-library/components/lessons-library-workspace";
import { PathWorkspace } from "@/features/path/components/path-workspace";
import { ReportWorkspace } from "@/features/report-level/components/report-workspace";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import { createReportStore } from "@/features/report-level/model/report-store";
import {
  createEmptyDraftV3,
  emptyReportWorkspaceV3,
  withApproved,
  withDraftV3,
  withEntryFieldV3,
  withResubmittedV3,
  withRevisionRequestedV3,
  withSubmittedV3,
  withSummaryV3,
  type ReportDraftV3,
  type ReportWorkspaceStateV3,
} from "@/features/report-level/model/report-workspace-v3";
import { sessionWithApprovedReports } from "@/features/report-level/model/report-progression";
import { entryFieldSectionId } from "@/features/report-level/model/report-review";

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;
const session = emptyLessonProgress();
const reportMarker = getPathProgress("report");
const canonicalMarker = getPathProgress("active");

function readyDraft(): ReportDraftV3 {
  let draft = createEmptyDraftV3(definition);
  for (const entry of draft.entries) {
    draft = withEntryFieldV3(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummaryV3(draft, "итог по пяти записям");
}
function approvedDraft(): ReportDraftV3 {
  return withApproved(withSubmittedV3(readyDraft(), "2026-07-17T10:00:00.000Z"), "2026-07-18T12:00:00.000Z");
}
/** The full lifecycle: pending → revision → edit → resubmit → approved. The
 *  review survives to the approved screen as quiet history. */
function approvedWithHistory(): ReportDraftV3 {
  let d = withSubmittedV3(readyDraft(), "2026-07-17T10:00:00.000Z");
  d = withRevisionRequestedV3(d, definition, {
    comment: "Уточните условие входа.",
    sections: [entryFieldSectionId(REPORT_LEVEL_NUMBER, 3, "noticed")],
    receivedAt: "2026-07-18T09:00:00.000Z",
  });
  d = withEntryFieldV3(d, 3, "noticed", "наблюдение 3 — условие записано до входа");
  d = withResubmittedV3(d, "2026-07-18T11:00:00.000Z");
  return withApproved(d, "2026-07-18T12:00:00.000Z");
}

const workspaceWith = (draft: ReportDraftV3): ReportWorkspaceStateV3 =>
  withDraftV3(emptyReportWorkspaceV3(), draft);

function seed(draft: ReportDraftV3) {
  createReportStore().write(workspaceWith(draft));
}

beforeEach(() => {
  window.localStorage.clear();
});

/* ================================================================== *
 * Report screen — the approved archive (component)
 * ================================================================== */

describe("report screen — approved archive", () => {
  it("shows the calm «Одобрено» chip and the completion line", () => {
    seed(approvedDraft());
    render(<ReportWorkspace definition={definition} scenario="report" />);

    expect(screen.getByText("Одобрено")).toBeInTheDocument();
    expect(screen.getByText("Отчёт принят. Уровень 3 завершён.")).toBeInTheDocument();
    // The provisional / browser-local honesty stays visible in the approval context.
    expect(screen.getAllByText(/dev\/test · provisional/).length).toBeGreaterThan(0);
    expect(screen.getByText(/только в этом браузере/)).toBeInTheDocument();
  });

  it("keeps the Evidence Ledger read-only — no field accepts input", () => {
    seed(approvedDraft());
    render(<ReportWorkspace definition={definition} scenario="report" />);

    const summary = screen.getByRole("textbox", { name: "Итоговое наблюдение" });
    expect(summary).toHaveAttribute("readonly");
    // No submit / resubmit control exists.
    expect(screen.queryByRole("button", { name: /Отправить/ })).toBeNull();
  });

  it("has exactly one h1 and expresses status in words", () => {
    seed(approvedDraft());
    render(<ReportWorkspace definition={definition} scenario="report" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Одобрено")).toBeInTheDocument();
  });

  it("shows the next step as the L4 checkpoint with the $50 target and nothing financial", () => {
    seed(approvedDraft());
    render(<ReportWorkspace definition={definition} scenario="report" />);

    expect(screen.getByText("Уровень 4 · Контрольная точка")).toBeInTheDocument();
    expect(screen.getByText(/Требуется: Баланс Pocket от \$50/)).toBeInTheDocument();

    const body = document.body.textContent ?? "";
    // No balance, remainder, percentage, XP, Pocket link, rubric/score.
    expect(body).not.toMatch(/осталось\s*\$/i);
    expect(body).not.toMatch(/%/);
    expect(body).not.toMatch(/\bXP\b/);
    expect(body).not.toMatch(/балл|оценка|рейтинг/i);
    expect(document.querySelector('a[href*="pocket" i]')).toBeNull();
  });

  it("primary CTA is a clean /path link; no href carries a scenario or verdict", () => {
    seed(approvedDraft());
    render(<ReportWorkspace definition={definition} scenario="report" />);

    const path = screen.getByRole("link", { name: "Посмотреть Путь" });
    expect(path).toHaveAttribute("href", "/path");
    // Secondary exit to lessons is allowed.
    expect(screen.getByRole("link", { name: /К списку уроков/ })).toHaveAttribute("href", "/lessons");

    for (const link of Array.from(document.querySelectorAll("a"))) {
      const href = link.getAttribute("href") ?? "";
      expect(href).not.toContain("scenario");
      expect(href).not.toContain("verdict");
    }
  });

  it("shows prior feedback as quiet history — no jump links, no attention pass", () => {
    seed(approvedWithHistory());
    render(<ReportWorkspace definition={definition} scenario="report" />);

    expect(screen.getByText("Комментарий последней проверки")).toBeInTheDocument();
    expect(screen.getByText(/Уточните условие входа/)).toBeInTheDocument();
    // No revision jump link, no pass counter.
    expect(screen.queryByRole("button", { name: /Запись 03 ·/ })).toBeNull();
    expect(screen.queryByText(/Доработка \d+ из \d+/)).toBeNull();
  });

  it("does NOT render approvedAt anywhere", () => {
    seed(approvedDraft());
    render(<ReportWorkspace definition={definition} scenario="report" />);
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("2026-07-18T12:00:00.000Z");
  });
});

/* ================================================================== *
 * Canonical L18 — a stored approved must NOT show «Одобрено»
 * ================================================================== */

describe("report screen — canonical L18 with a stored approved", () => {
  it("is a neutral archive: no «Одобрено», no approved CTA", () => {
    seed(approvedDraft());
    // No ?scenario → canonical marker (Артём on L18).
    render(<ReportWorkspace definition={definition} />);

    expect(screen.getByText(/уже пройден в текущем профиле/)).toBeInTheDocument();
    expect(screen.queryByText("Одобрено")).toBeNull();
    expect(screen.queryByText(/Отчёт принят/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Посмотреть Путь" })).toBeNull();
  });
});

/* ================================================================== *
 * Library integration — L3 completed, L4 checkpoint next
 * ================================================================== */

describe("lessons library — after approval (model)", () => {
  const build = (reports: ReportWorkspaceStateV3, marker = reportMarker) =>
    // The workspace augments the session with approved reports; mirror that here.
    buildLessonsLibraryModel({
      moduleParam: "module.01",
      marker,
      session: sessionWithApprovedReports(session, reports),
      reports,
    });
  const level3 = (m: ReturnType<typeof build>) => m.selected.levels.find((l) => l.number === 3)!;
  const level4 = (m: ReturnType<typeof build>) => m.selected.levels.find((l) => l.number === 4)!;

  it("shows L3 «Завершён · Пересмотреть», never «Одобрено»", () => {
    const m = build(workspaceWith(approvedDraft()));
    expect(level3(m).state).toBe("completed");
    expect(level3(m).statusLabel).toBe("Завершён");
    expect(level3(m).actionLabel).toBe("Пересмотреть");
    expect(level3(m).statusLabel).not.toBe("Одобрено");
  });

  it("advances the current step to the L4 checkpoint, honestly", () => {
    const m = build(workspaceWith(approvedDraft()));
    expect(level4(m).state).toBe("checkpoint");
    expect(level4(m).href).toBeNull(); // no href on an unbuilt /lessons/level.004
    expect(m.continueStep).toBeNull();
    expect(m.continueNote).toBe("Следующий шаг — контрольная точка · Уровень 4.");
  });

  it("leaves canonical L18 untouched by a stored approved", () => {
    const m = build(workspaceWith(approvedDraft()), canonicalMarker);
    expect(level3(m).state).toBe("completed");
    expect(level3(m).statusLabel).toBe("Завершён");
    expect(m.continueStep?.levelNumber).toBe(18);
  });
});

describe("lessons library — after approval (rendered)", () => {
  it("shows the checkpoint next-step note and no «Одобрено»", () => {
    seed(approvedDraft());
    render(<LessonsLibraryWorkspace moduleParam="module.01" scenario="report" />);
    expect(screen.getByText("Следующий шаг — контрольная точка · Уровень 4.")).toBeInTheDocument();
    expect(screen.queryByText("Одобрено")).toBeNull();
    expect(document.querySelector('a[href="/lessons/level.004"]')).toBeNull();
  });
});

/* ================================================================== *
 * Path integration — L3 completed, L4 current
 * ================================================================== */

describe("path — after approval (rendered)", () => {
  it("marks L3 completed and opens L4 as the current checkpoint", async () => {
    seed(approvedDraft());
    render(<PathWorkspace scenario="report" />);

    // Level 3 detail: completed, no approved banner, no report label.
    const l3 = screen.getByRole("button", { name: /Уровень 3/ });
    l3.click();
    expect(await screen.findByText(/Состояние: пройден/)).toBeInTheDocument();
    expect(screen.queryByText(/Отчёт:/)).toBeNull();
    expect(screen.queryByText("Одобрено")).toBeNull();
  });
});
