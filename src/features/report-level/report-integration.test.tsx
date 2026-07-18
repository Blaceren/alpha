import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getPathProgress } from "@/features/path/model/path-state";
import { emptyLessonProgress } from "@/features/lesson/model/lesson-session-progress";
import { buildLessonsLibraryModel } from "@/features/lessons-library/model/lessons-library-model";
import { LessonsLibraryWorkspace } from "@/features/lessons-library/components/lessons-library-workspace";
import { PathWorkspace } from "@/features/path/components/path-workspace";
import { getReportDefinition, REPORT_LEVEL_NUMBER } from "@/features/report-level/data/report-fixtures";
import { createReportStore } from "@/features/report-level/model/report-store";
import {
  createEmptyDraft,
  emptyReportWorkspace,
  withDraft,
  withEntryField,
  withSubmitted,
  withSummary,
  type ReportDraft,
} from "@/features/report-level/model/report-draft";
import { migrateV1Workspace } from "@/features/report-level/model/report-workspace-v2";
import {
  emptyReportWorkspaceV3,
  migrateV2WorkspaceToV3,
  withDraftV3,
  withResubmittedV3,
  withRevisionRequestedV3,
  withSubmittedV3,
  withSummaryV3,
  type ReportDraftV3,
} from "@/features/report-level/model/report-workspace-v3";
import {
  PROVISIONAL_REVIEW_COMMENT,
  PROVISIONAL_REVIEW_SECTIONS,
} from "@/features/report-level/data/report-review-fixtures";

/** Lift a v1 draft into the v3 shape — the same defaults migration applies. */
const liftToV3 = (draft: ReportDraft): ReportDraftV3 => ({
  ...draft,
  review: null,
  meaningfulRevision: draft.revision,
  approvedAt: null,
});

const definition = getReportDefinition(REPORT_LEVEL_NUMBER)!;
const session = emptyLessonProgress();
const reportMarker = getPathProgress("report");
const canonicalMarker = getPathProgress("active");

function readyDraft(): ReportDraft {
  let draft = createEmptyDraft(definition);
  for (const entry of draft.entries) {
    draft = withEntryField(draft, entry.ordinal, "noticed", `наблюдение ${entry.ordinal}`);
  }
  return withSummary(draft, "итог");
}

function seed(draft: ReportDraft) {
  createReportStore().write(withDraft(emptyReportWorkspace(), draft));
}

/** Lift through the REAL migration — the same path a legacy draft takes (v1→v2→v3). */
const workspaceOf = (draft: ReportDraft) =>
  migrateV2WorkspaceToV3(migrateV1Workspace(withDraft(emptyReportWorkspace(), draft)));

/* ------------------------------------------------------------------ *
 * Lessons library — model
 * ------------------------------------------------------------------ */

describe("lessons library — report status (model)", () => {
  const build = (reports = emptyReportWorkspaceV3(), marker = reportMarker) =>
    buildLessonsLibraryModel({ moduleParam: "module.01", marker, session, reports });

  const level3Row = (model: ReturnType<typeof build>) =>
    model.selected.levels.find((l) => l.number === 3)!;

  it("shows the generic status when no report has been started", () => {
    expect(level3Row(build()).statusLabel).toBe("Текущий урок");
  });

  it("shows «Черновик» for a started report", () => {
    const draft = withEntryField(createEmptyDraft(definition), 1, "noticed", "a");
    expect(level3Row(build(workspaceOf(draft))).statusLabel).toBe("Черновик");
  });

  it("shows «Готов к отправке» once the readiness rule is met", () => {
    expect(level3Row(build(workspaceOf(readyDraft()))).statusLabel).toBe("Готов к отправке");
  });

  it("shows «На проверке» after a local submit", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    expect(level3Row(build(workspaceOf(submitted))).statusLabel).toBe("На проверке");
  });

  it("keeps the row href pointing at the same workspace in every state", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    expect(level3Row(build()).href).toBe("/lessons/level.003");
    expect(level3Row(build(workspaceOf(submitted))).href).toBe("/lessons/level.003");
  });

  it("labels the action for a report, not for a lesson", () => {
    expect(level3Row(build()).actionLabel).toBe("Перейти к отчёту");
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    expect(level3Row(build(workspaceOf(submitted))).actionLabel).toBe("Открыть отчёт");
  });

  it("never lets a pending report advance the current step", () => {
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    const model = build(workspaceOf(submitted));
    // Level 3 is still the continue step; level 4 has not become current.
    expect(model.continueStep?.levelNumber).toBe(3);
    expect(level3Row(model).state).toBe("current");
    const level4 = model.selected.levels.find((l) => l.number === 4)!;
    expect(level4.state).toBe("checkpoint");
    expect(level4.href).toBeNull();
  });

  it("does NOT pollute the canonical profile with a report status", () => {
    // Артём is on level 18: level 3 is completed and must stay «Завершён», even
    // while this browser holds a pending report written under the report scenario.
    const submitted = withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z");
    const model = build(workspaceOf(submitted), canonicalMarker);
    expect(level3Row(model).statusLabel).toBe("Завершён");
    expect(level3Row(model).state).toBe("completed");
    expect(model.continueStep?.levelNumber).toBe(18);
  });

  it("carries the report status onto the continue step", () => {
    const draft = withEntryField(createEmptyDraft(definition), 1, "noticed", "a");
    const model = build(workspaceOf(draft));
    expect(model.continueStep?.reportStatusLabel).toBe("Черновик");
    expect(model.continueStep?.href).toBe("/lessons/level.003");
  });

  it("leaves the canonical L18 continue step untouched", () => {
    const model = build(emptyReportWorkspaceV3(), canonicalMarker);
    expect(model.continueStep?.levelNumber).toBe(18);
    expect(model.continueStep?.actionLabel).toBe("Продолжить урок");
    expect(model.continueStep?.reportStatusLabel).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Lessons library — rendered
 * ------------------------------------------------------------------ */

describe("lessons library — report status (rendered)", () => {
  it("shows the report as the dominant next step with its status", () => {
    seed(withEntryField(createEmptyDraft(definition), 1, "noticed", "a"));
    render(<LessonsLibraryWorkspace moduleParam="module.01" scenario="report" />);

    expect(screen.getByText("Продолжить обучение")).toBeInTheDocument();
    // The dominant CTA and the row action say the same thing — scope to the band.
    const band = screen.getByRole("region", { name: "Продолжить обучение" });
    expect(within(band).getByRole("link", { name: /Перейти к отчёту/ })).toHaveAttribute(
      "href",
      "/lessons/level.003",
    );
    expect(screen.getAllByText("Черновик").length).toBeGreaterThan(0);
  });

  it("shows «На проверке» after a local submit", () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    render(<LessonsLibraryWorkspace moduleParam="module.01" scenario="report" />);
    expect(screen.getAllByText("На проверке").length).toBeGreaterThan(0);
  });

  it("emits no href carrying a scenario", () => {
    seed(readyDraft());
    render(<LessonsLibraryWorkspace moduleParam="module.01" scenario="report" />);
    for (const link of Array.from(document.querySelectorAll("a"))) {
      expect(link.getAttribute("href") ?? "").not.toContain("scenario");
    }
  });

  it("shows no balance, no remainder and no Pocket CTA", () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    render(<LessonsLibraryWorkspace moduleParam="module.01" scenario="report" />);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/осталось \$/i);
    expect(body).not.toMatch(/ваш баланс|твой баланс/i);
    expect(document.querySelector('a[href*="pocket"]')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Path
 * ------------------------------------------------------------------ */

describe("path — report status", () => {
  async function openLevel3Detail() {
    const user = userEvent.setup();
    render(<PathWorkspace scenario="report" />);
    // The current node is level 3 under the report marker.
    const node = screen.getByRole("button", { name: /Уровень 3/ });
    await user.click(node);
    return screen.getByRole("complementary", { name: /Уровень 3 — детали/ });
  }

  it("shows the report lifecycle on the level detail", async () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    const detail = await openLevel3Detail();
    expect(within(detail).getByText("Отчёт: На проверке")).toBeInTheDocument();
  });

  it("keeps the pending explanation honest — no countdown, no reviewer", async () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    const detail = await openLevel3Detail();
    const text = detail.textContent ?? "";
    expect(text).toMatch(/Обычно проверка занимает до одного дня/);
    expect(text).toMatch(/в этом прототипе не подключена/);
    expect(text).not.toMatch(/Alex Curie/);
    expect(text).not.toMatch(/осталось.*(час|минут)/i);
  });

  it("keeps level 4 locked while the report is pending", () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    render(<PathWorkspace scenario="report" />);
    // The path's own accessible outline is the reliable statement of state.
    const outline = screen.getByRole("navigation", { name: /Структура пути/i });
    expect(within(outline).getByText(/Уровень 4.*контрольная точка впереди/i)).toBeInTheDocument();
  });

  it("uses the report wording on the detail action", async () => {
    seed(withEntryField(createEmptyDraft(definition), 1, "noticed", "a"));
    const detail = await openLevel3Detail();
    expect(within(detail).getByRole("link", { name: "Перейти к отчёту" })).toHaveAttribute(
      "href",
      "/lessons/level.003",
    );
  });

  it("labels the level kind in Russian, never as «Structured report»", async () => {
    const detail = await openLevel3Detail();
    expect(within(detail).getByText("Отчёт")).toBeInTheDocument();
    expect(detail.textContent).not.toContain("Structured report");
  });

  it("does not show a report status on the canonical profile", async () => {
    seed(withSubmitted(readyDraft(), "2026-07-17T10:00:00.000Z"));
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);

    // Module 01 is behind Артём; navigate to it and open level 3.
    await user.click(screen.getByRole("button", { name: /Модуль 1\b/ }));
    await user.click(screen.getByRole("button", { name: /Уровень 3/ }));

    const detail = screen.getByRole("complementary", { name: /Уровень 3 — детали/ });
    expect(within(detail).queryByText(/Отчёт: На проверке/)).not.toBeInTheDocument();
    expect(within(detail).getByText(/Состояние: пройден/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Revision cycle statuses (D3-C) — library and path
 * ------------------------------------------------------------------ */

describe("library and path — revision statuses (D3-C)", () => {
  const revisionDraft = (): ReportDraftV3 =>
    withRevisionRequestedV3(
      withSubmittedV3(liftToV3(readyDraft()), "2026-07-17T10:00:00.000Z"),
      definition,
      {
        comment: PROVISIONAL_REVIEW_COMMENT,
        sections: PROVISIONAL_REVIEW_SECTIONS,
        receivedAt: "2026-07-18T09:00:00.000Z",
      },
    );

  const seedV2 = (draft: ReportDraftV3) =>
    createReportStore().write(withDraftV3(emptyReportWorkspaceV3(), draft));

  const buildV2 = (draft: ReportDraftV3, marker = reportMarker) =>
    buildLessonsLibraryModel({
      moduleParam: "module.01",
      marker,
      session,
      reports: withDraftV3(emptyReportWorkspaceV3(), draft),
    });

  const level3Of = (model: ReturnType<typeof buildV2>) =>
    model.selected.levels.find((l) => l.number === 3)!;

  it("library says «Нужна доработка» for an unchanged revision", () => {
    const row = level3Of(buildV2(revisionDraft()));
    expect(row.statusLabel).toBe("Нужна доработка");
    expect(row.href).toBe("/lessons/level.003");
    expect(row.actionLabel).toBe("Перейти к отчёту");
  });

  it("library says «Готов к повторной отправке» once a real change landed", () => {
    const changed = withSummaryV3(revisionDraft(), "итог, связанный со всеми записями");
    const row = level3Of(buildV2(changed));
    expect(row.statusLabel).toBe("Готов к повторной отправке");
    expect(row.actionLabel).toBe("Перейти к отчёту");
  });

  it("library says «На проверке» again after the resubmit", () => {
    const resubmitted = withResubmittedV3(
      withSummaryV3(revisionDraft(), "итог, связанный со всеми записями"),
      "2026-07-19T09:00:00.000Z",
    );
    expect(level3Of(buildV2(resubmitted)).statusLabel).toBe("На проверке");
  });

  it("the continue step carries the revision status", () => {
    const model = buildV2(revisionDraft());
    expect(model.continueStep?.reportStatusLabel).toBe("Нужна доработка");
    expect(model.continueStep?.href).toBe("/lessons/level.003");
  });

  it("a revision never advances the current step and never re-labels canonical L18", () => {
    const model = buildV2(revisionDraft(), canonicalMarker);
    expect(model.continueStep?.levelNumber).toBe(18);
    expect(model.continueStep?.reportStatusLabel).toBeNull();
    expect(level3Of(model).statusLabel).toBe("Завершён");
  });

  it("rendered library emits no scenario and no verdict in any href", () => {
    seedV2(revisionDraft());
    render(<LessonsLibraryWorkspace moduleParam="module.01" scenario="report" />);
    for (const link of Array.from(document.querySelectorAll("a"))) {
      const href = link.getAttribute("href") ?? "";
      expect(href).not.toContain("scenario");
      expect(href).not.toContain("verdict");
    }
    expect(screen.getAllByText("Нужна доработка").length).toBeGreaterThan(0);
  });

  it("path detail says «Отчёт: Нужна доработка» and keeps level 4 locked", async () => {
    seedV2(revisionDraft());
    const user = userEvent.setup();
    render(<PathWorkspace scenario="report" />);
    await user.click(screen.getByRole("button", { name: /Уровень 3/ }));

    const detail = screen.getByRole("complementary", { name: /Уровень 3 — детали/ });
    expect(within(detail).getByText("Отчёт: Нужна доработка")).toBeInTheDocument();

    const outline = screen.getByRole("navigation", { name: /Структура пути/i });
    expect(within(outline).getByText(/Уровень 4.*контрольная точка впереди/i)).toBeInTheDocument();
  });

  it("path detail says «Отчёт: Готов к повторной отправке» after a change", async () => {
    seedV2(withSummaryV3(revisionDraft(), "итог, связанный со всеми записями"));
    const user = userEvent.setup();
    render(<PathWorkspace scenario="report" />);
    await user.click(screen.getByRole("button", { name: /Уровень 3/ }));

    const detail = screen.getByRole("complementary", { name: /Уровень 3 — детали/ });
    expect(within(detail).getByText("Отчёт: Готов к повторной отправке")).toBeInTheDocument();
  });

  it("path canonical profile never shows the revision", async () => {
    seedV2(revisionDraft());
    const user = userEvent.setup();
    render(<PathWorkspace scenario="active" />);
    await user.click(screen.getByRole("button", { name: /Модуль 1\b/ }));
    await user.click(screen.getByRole("button", { name: /Уровень 3/ }));

    const detail = screen.getByRole("complementary", { name: /Уровень 3 — детали/ });
    expect(within(detail).queryByText(/Нужна доработка/)).not.toBeInTheDocument();
    expect(within(detail).getByText(/Состояние: пройден/)).toBeInTheDocument();
  });
});
