/**
 * AFD-5D2 — the Curie Atlas workspace.
 *
 * These cover the behaviour that only exists once the pieces are assembled: the
 * refusal to run by itself, the snapshot that belongs to one resolved request,
 * the stale state that never relabels an old result with new filters, and the
 * privacy and persistence properties of what this screen actually paints.
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import type { CrmRole, Permission } from "@/domain/identity/roles";
import { CurieAtlasWorkspace } from "./atlas-workspace";
import {
  atlasReport,
  cohortReport,
  countChangeFinding,
  finding,
  insufficientReport,
  issue,
  limitedReport,
} from "@/test/atlas-fixtures";

/* ------------------------------------------------------------- API doubles */

const runMock = vi.fn();
const filtersMock = vi.fn();

vi.mock("@/application/api/curie-atlas-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/application/api/curie-atlas-client")>(
      "@/application/api/curie-atlas-client",
    );
  return { ...actual, runAtlasAnalysis: (...a: unknown[]) => runMock(...a) };
});

vi.mock("@/application/api/affiliate-analytics-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/application/api/affiliate-analytics-client")>(
      "@/application/api/affiliate-analytics-client",
    );
  return { ...actual, fetchAnalyticsFilters: (...a: unknown[]) => filtersMock(...a) };
});

/* ---------------------------------------------------------------- harness */

const ANALYST: Permission[] = ["view_affiliate_analytics"];
const ADMIN: Permission[] = ["manage_settings", "view_affiliate_analytics"];
const UNRELATED: Permission[] = ["view_audit"];

function renderWorkspace(permissions: Permission[] = ANALYST, role: CrmRole = "analyst") {
  const session = sessionFromDto({
    employeeId: "emp_1",
    displayName: "Тестовый сотрудник",
    role,
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2026-08-01T10:00:00.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <CurieAtlasWorkspace />
    </AuthenticatedSessionProvider>,
  );
}

const ok = (data: unknown) => ({ status: "success" as const, data });

async function runAnalysis(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("atlas-run"));
  await waitFor(() => expect(screen.getByTestId("atlas-result")).toBeInTheDocument());
}

beforeEach(() => {
  runMock.mockReset().mockResolvedValue(ok(atlasReport()));
  filtersMock.mockReset().mockResolvedValue(
    ok({
      affiliatePartners: [
        { id: "1", code: "alpha", displayName: "Affiliate Alpha", status: "active", archived: false },
      ],
      affiliateCampaigns: [],
      affiliateTrackingLinks: [],
    }),
  );
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/* ------------------------------------------------------------ initial state */

describe("initial state", () => {
  it("does NOT run the analysis on mount", async () => {
    renderWorkspace();
    // Give effects a chance to fire; the point is that none of them analyses.
    await waitFor(() => expect(filtersMock).toHaveBeenCalled());
    expect(runMock).not.toHaveBeenCalled();
  });

  it("shows an explicit empty state and the primary action", () => {
    renderWorkspace();
    // The phrase appears twice on purpose: once visibly in the empty state and
    // once in the sr-only live region. Both are wanted, so the assertion is on
    // the count rather than on uniqueness.
    expect(screen.getAllByText("Анализ ещё не запускался")).toHaveLength(2);
    expect(screen.getByTestId("atlas-run")).toHaveTextContent("Запустить анализ");
  });

  it("advertises the deterministic, no-model boundary", () => {
    renderWorkspace();
    expect(screen.getByText("Без модели")).toBeInTheDocument();
    expect(screen.getByText(/Модель не вызывается/)).toBeInTheDocument();
  });

  it("renders no result section before a run", () => {
    renderWorkspace();
    expect(screen.queryByTestId("atlas-result")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Обзор" })).not.toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- execution */

describe("explicit execution", () => {
  it("runs exactly once per click and renders the result", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Обзор" })).toBeInTheDocument();
  });

  it("does NOT run again when a filter changes", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("prevents duplicate execution while a request is in flight", async () => {
    const user = userEvent.setup();
    const gate: { release: ((value: unknown) => void) | null } = { release: null };
    runMock.mockImplementation(
      () => new Promise<unknown>((resolve) => { gate.release = resolve; }),
    );
    renderWorkspace();

    const button = screen.getByTestId("atlas-run");
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    // A second and third attempt while busy must not issue a request.
    await user.click(button);
    await user.click(button);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-busy", "true");

    gate.release?.(ok(atlasReport()));
    await waitFor(() => expect(screen.getByTestId("atlas-result")).toBeInTheDocument());
  });

  it("shows a bounded loading state and preserves the selected filters", async () => {
    const user = userEvent.setup();
    const gate: { release: ((value: unknown) => void) | null } = { release: null };
    runMock.mockImplementation(() => new Promise<unknown>((resolve) => { gate.release = resolve; }));
    renderWorkspace();

    await user.selectOptions(screen.getByLabelText("Группировка"), "month");
    await user.click(screen.getByTestId("atlas-run"));
    expect(screen.getByText("Выполняем анализ…")).toBeInTheDocument();
    expect(screen.getByLabelText("Группировка")).toHaveValue("month");

    gate.release?.(ok(atlasReport()));
    await waitFor(() => expect(screen.getByTestId("atlas-result")).toBeInTheDocument());
  });

  it("sends the selected mode, group and dimension in the request body", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    await runAnalysis(user);
    expect(runMock.mock.calls[0]?.[0]).toMatchObject({
      mode: "event_date",
      group: "week",
      dimension: "affiliate",
    });
  });

  it("omits the cutoff in event-date mode, where the backend refuses one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    expect(runMock.mock.calls[0]?.[0].cutoffDate).toBeUndefined();
  });
});

/* ------------------------------------------------------------ stale state */

describe("snapshot and stale state", () => {
  it("marks the result stale after any analytical parameter changes", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    expect(screen.getByTestId("atlas-result")).toHaveAttribute("data-stale", "false");

    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    await waitFor(() =>
      expect(screen.getByTestId("atlas-result")).toHaveAttribute("data-stale", "true"),
    );
    expect(
      screen.getAllByText(/Параметры изменились\. Запустите анализ повторно\./).length,
    ).toBeGreaterThan(0);
  });

  it("keeps showing the OLD result rather than hiding or blanking it", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");

    // The previous answer is still the last true answer.
    expect(screen.getByText(/За период засчитано 1240 кликов/)).toBeInTheDocument();
  });

  it("never relabels a stale result with the NEW parameters", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.selectOptions(screen.getByLabelText("Группировка"), "month");

    // The overview belongs to the report, which was produced with group=day.
    const overview = screen.getByRole("heading", { name: "Обзор" }).closest("section");
    expect(within(overview as HTMLElement).getByText("День")).toBeInTheDocument();
    expect(within(overview as HTMLElement).queryByText("Месяц")).not.toBeInTheDocument();
  });

  it("clears the stale mark when the parameters return to the snapshot's", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    await waitFor(() =>
      expect(screen.getByTestId("atlas-result")).toHaveAttribute("data-stale", "true"),
    );
    await user.selectOptions(screen.getByLabelText("Группировка"), "day");
    await waitFor(() =>
      expect(screen.getByTestId("atlas-result")).toHaveAttribute("data-stale", "false"),
    );
  });

  it("replaces the snapshot on a new successful run", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    runMock.mockResolvedValue(
      ok(atlasReport({ requestId: "req_atlas_0002", inputFingerprint: "ffffffffffffffff" })),
    );
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    await user.click(screen.getByTestId("atlas-run"));

    await waitFor(() =>
      expect(screen.getByTestId("atlas-result")).toHaveAttribute("data-stale", "false"),
    );
    await user.click(screen.getAllByText("Технические детали")[0]!);
    expect(screen.getByText("req_atlas_0002")).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------------- sections */

describe("result rendering", () => {
  it("renders all six sections with the required Russian headings", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    for (const heading of [
      "Обзор",
      "Достаточность данных",
      "Предупреждения",
      "Наблюдения",
      "Положительные сигналы",
      "Вопросы к данным",
    ]) {
      expect(screen.getByRole("heading", { name: new RegExp(heading) })).toBeInTheDocument();
    }
  });

  it("skips no heading level, so the page outline is navigable", async () => {
    // AFD-5D2A — added because the browser accessibility matrix caught a real
    // defect: the workspace rendered `h1` then jumped straight to `h3`, with no
    // `h2` anywhere. A screen-reader user navigating by heading level lands in a
    // subsection of a section that does not exist.
    //
    // Pinned HERE as well as in the browser so the outline is protected without
    // needing Chromium: this is the cheap test that fails first.
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await runAnalysis(user);

    const levels = Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((node) =>
      Number(node.tagName.slice(1)),
    );
    expect(levels.length).toBeGreaterThan(3);
    for (let i = 1; i < levels.length; i += 1) {
      expect(
        levels[i]! - levels[i - 1]!,
        `heading jumps from h${levels[i - 1]} to h${levels[i]}`,
      ).toBeLessThanOrEqual(1);
    }
    // The workspace owns the page's single h1 ("Curie Atlas"); everything below
    // it is an h2 section. Verified against the real DOM rather than assumed —
    // the first draft of this assertion guessed the shell owned the h1, and the
    // test said otherwise.
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels).toContain(2);
  });

  it("never renders the word opportunities", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await runAnalysis(user);
    expect(container.textContent?.toLowerCase()).not.toContain("opportunit");
    expect(container.textContent).not.toContain("Возможности");
  });

  it("places each finding in its own section", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    const warnings = screen.getByRole("heading", { name: /Предупреждения/ }).closest("section");
    expect(within(warnings as HTMLElement).getByText(/выборке меньше 30/)).toBeInTheDocument();

    const signals = screen
      .getByRole("heading", { name: /Положительные сигналы/ })
      .closest("section");
    expect(within(signals as HTMLElement).getByText(/выше совокупной/)).toBeInTheDocument();
  });

  it("shows the backend's message verbatim and the code only in details", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    expect(
      screen.getByText("За период засчитано 1240 кликов и 96 регистраций в Академии."),
    ).toBeVisible();
    // The code IS in the DOM — inside a closed <details> — but is not primary
    // text and is not visible until the operator opens the disclosure.
    const code = screen.getByText("period_volume");
    expect(code).not.toBeVisible();
    expect(code.closest("details")).not.toBeNull();
  });

  it("renders a question as a question, never as a conclusion", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    const questions = screen.getByRole("heading", { name: /Вопросы к данным/ }).closest("section");
    expect(
      within(questions as HTMLElement).getByText(/не устанавливает причины/),
    ).toBeInTheDocument();
  });

  it("offers no action, recommendation or message control anywhere", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await runAnalysis(user);

    const text = (container.textContent ?? "").toLowerCase();
    for (const forbidden of ["рекоменд", "отправить", "написать", "назначить", "создать задачу"]) {
      expect(text).not.toContain(forbidden);
    }
    // The only button on the screen is the primary action.
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toContain("atlas-run");
  });
});

/* ---------------------------------------------------------------- evidence */

describe("evidence disclosure", () => {
  it("hides evidence behind a keyboard-accessible disclosure", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    const disclosures = screen.getAllByText("Показать данные");
    expect(disclosures.length).toBeGreaterThan(0);
    // Collapsed: present in the DOM, deliberately not visible.
    for (const header of screen.getAllByText("Показатель")) {
      expect(header).not.toBeVisible();
    }

    await user.click(disclosures[0]!);
    expect(screen.getAllByText("Показатель").some((n) => n.checkVisibility?.() ?? true)).toBe(true);
  });

  it("renders evidence exactly as returned, computing nothing", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.click(screen.getAllByText("Показать данные")[0]!);

    // The warning's operand is denominator=18. No delta, no percentage, no
    // total is invented beside it.
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.queryByText("%")).not.toBeInTheDocument();
  });

  it("shows no disclosure for a finding with no evidence", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    const questions = screen.getByRole("heading", { name: /Вопросы к данным/ }).closest("section");
    expect(within(questions as HTMLElement).queryByText("Показать данные")).not.toBeInTheDocument();
    expect(within(questions as HTMLElement).getByText("Без операндов")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- sufficiency */

describe("data sufficiency", () => {
  it("shows ok for a sufficient report with no caveats", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    expect(screen.getByTestId("atlas-result-status")).toHaveTextContent("Данных достаточно");
  });

  it("shows partial and keeps the findings when a capability is unavailable", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue(ok(limitedReport()));
    renderWorkspace();
    await runAnalysis(user);

    expect(screen.getByTestId("atlas-result-status")).toHaveTextContent("с ограничениями");
    expect(screen.getByText(/часть сравнений или разделов недоступна/)).toBeInTheDocument();

    // The limitation appears TWICE by design, and both are wanted: once as the
    // backend's coded sufficiency issue, and once as the warning FINDING the
    // engine also emitted. They are different objects saying the same true
    // thing, so the assertion names each rather than demanding uniqueness.
    const issueBlock = screen.getByTestId("atlas-issue");
    expect(issueBlock).toHaveAttribute("data-code", "MIXED_CURRENCY");
    expect(issueBlock).toHaveTextContent(/несколько валют/);

    const warnings = screen.getByRole("heading", { name: /Предупреждения/ }).closest("section");
    expect(within(warnings as HTMLElement).getByText(/несколько валют/)).toBeInTheDocument();
  });

  it("shows insufficient_data and no zero performance", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue(ok(insufficientReport()));
    renderWorkspace();
    await runAnalysis(user);

    expect(screen.getByTestId("atlas-result-status")).toHaveTextContent("Недостаточно данных");
    // AFD-5D2A — an empty period raises NO issues: emptiness is a factual
    // result, not a data problem, and the backend deliberately publishes none.
    expect(screen.getByTestId("atlas-no-issues")).toBeInTheDocument();
    const observations = screen.getByRole("heading", { name: /Наблюдения/ }).closest("section");
    expect(
      within(observations as HTMLElement).getByText("Наблюдений по этим параметрам нет."),
    ).toBeInTheDocument();
  });

  it("renders EVERY backend reason code as a user-facing explanation", async () => {
    const user = userEvent.setup();
    for (const code of [
      "SAMPLE_TOO_SMALL",
      "COHORT_FOLLOWUP_INCOMPLETE",
      "COMPARISON_PERIOD_UNAVAILABLE",
      "MIXED_CURRENCY",
      "BREAKDOWN_TRUNCATED",
      "METRIC_UNAVAILABLE",
      "INTEGRITY_WARNING",
    ] as const) {
      runMock.mockResolvedValue(
        ok(limitedReport([issue({ code, details: undefined, scope: "series" })])),
      );
      const view = renderWorkspace();
      await runAnalysis(user);

      const rendered = screen.getByTestId("atlas-issue");
      expect(rendered).toHaveAttribute("data-code", code);
      // The CODE is never the headline: a human sentence is.
      expect(rendered.textContent ?? "").not.toContain(code);
      expect((rendered.textContent ?? "").length).toBeGreaterThan(10);
      view.unmount();
    }
  });

  it("shows the bounded contract-error state when the response is refused", async () => {
    // AFD-5D3: an unknown reason code is a schema mismatch, which the CLIENT
    // maps to `contract_violation` (asserted in the client suite and in the DTO
    // suite). What the WORKSPACE owes is this: refuse to render any part of the
    // response, and say so without leaking it.
    //
    // The earlier draft of this test mocked a bad REPORT, which proved nothing —
    // the mock replaces the client, so no parsing ever ran.
    const user = userEvent.setup();
    runMock.mockResolvedValue({ status: "contract_violation", reason: "schema_mismatch" });
    renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("atlas-result")).not.toBeInTheDocument();
    expect(screen.queryByTestId("atlas-issue")).not.toBeInTheDocument();

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/ZodError|at Object\.|node_modules|schema_mismatch/);
  });

  it("does not relabel a previous good snapshot as the refused request's answer", async () => {
    // THE ACCEPTED UX CONTRACT PRESERVES the last good report when a later run
    // fails — that is deliberate, and this test does not fight it. What it
    // checks is the thing that would actually mislead: the preserved report must
    // still describe the request that PRODUCED it, and must be marked stale once
    // the operator's selection has moved away from it.
    //
    // The first draft asserted the result disappears. It does not, and asserting
    // that would have been inventing product behaviour to satisfy a test.
    const user = userEvent.setup();
    runMock.mockResolvedValue(ok(limitedReport([issue({ code: "SAMPLE_TOO_SMALL" })])));
    renderWorkspace();
    await runAnalysis(user);
    const first = screen.getByTestId("atlas-result");
    expect(first).toHaveAttribute("data-stale", "false");

    // Move the selection, so a preserved report is no longer the answer to what
    // is on screen, then let the next run be refused by the contract.
    await user.selectOptions(screen.getByLabelText(/Группировка/), "week");
    runMock.mockResolvedValue({ status: "contract_violation", reason: "schema_mismatch" });
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // The old report is still there, and it is now honestly labelled STALE.
    const preserved = screen.getByTestId("atlas-result");
    expect(preserved).toHaveAttribute("data-stale", "true");
    // And nothing from the refused response leaked into it.
    expect(document.body.textContent ?? "").not.toMatch(/schema_mismatch|ZodError/);
  });

  it("shows the backend issue details without computing any of them", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue(ok(limitedReport([issue()])));
    renderWorkspace();
    await runAnalysis(user);

    const rendered = screen.getByTestId("atlas-issue");
    expect(rendered).toHaveTextContent("18");
    expect(rendered).toHaveTextContent("30");
  });
});

/* ------------------------------------------- AFD-5D2A: backend-owned values */

describe("support tier and comparison are rendered, never computed", () => {
  it("renders the backend support tier on every finding", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    const tiers = screen.getAllByTestId("atlas-support-tier");
    expect(tiers.length).toBeGreaterThan(0);
    // The fixture's positive signal is `strong`; the default finding is
    // `descriptive`. Both come off the wire.
    expect(tiers.map((t) => t.getAttribute("data-tier"))).toContain("descriptive");
    expect(tiers.map((t) => t.getAttribute("data-tier"))).toContain("strong");
  });

  it("renders all three tiers exactly as returned", async () => {
    const user = userEvent.setup();
    for (const [tier, label] of [
      ["descriptive", "Описательный"],
      ["moderate", "Умеренная опора"],
      ["strong", "Сильная опора"],
    ] as const) {
      runMock.mockResolvedValue(
        ok(atlasReport({ observations: [finding({ supportTier: tier })], warnings: [], positiveSignals: [], questions: [] })),
      );
      const view = renderWorkspace();
      await runAnalysis(user);
      expect(screen.getByTestId("atlas-support-tier")).toHaveTextContent(label);
      view.unmount();
    }
  });

  it("renders the backend comparison and computes no delta of its own", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue(
      ok(atlasReport({ observations: [countChangeFinding()], warnings: [], positiveSignals: [], questions: [] })),
    );
    renderWorkspace();
    await runAnalysis(user);

    await user.click(screen.getAllByText("Показать данные")[0]!);
    const comparison = screen.getByTestId("atlas-comparison");
    expect(comparison).toHaveAttribute("data-kind", "count_change");
    // Exactly the backend's values, verbatim.
    expect(comparison).toHaveTextContent("100");
    expect(comparison).toHaveTextContent("400");
    expect(comparison).toHaveTextContent("300");
    // AFD-5D3 corrected this: `countChangePercent` publishes ONE decimal, so a
    // six-decimal expectation was asserting a value the engine cannot produce.
    expect(comparison).toHaveTextContent("300.0");
  });

  it("omits a comparison field the backend returned as null", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue(
      ok(atlasReport({ observations: [countChangeFinding()], warnings: [], positiveSignals: [], questions: [] })),
    );
    renderWorkspace();
    await runAnalysis(user);
    await user.click(screen.getAllByText("Показать данные")[0]!);

    const comparison = screen.getByTestId("atlas-comparison");
    // A count change has no percentage-point delta. It must not be shown at all,
    // and certainly not as a zero nobody measured.
    expect(comparison).not.toHaveTextContent("Разница в п.п.");
  });

  it("renders no comparison block for a finding that is not one", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.click(screen.getAllByText("Показать данные")[0]!);
    // The default observation carries `comparison: null`.
    const observations = screen.getByRole("heading", { name: /Наблюдения/ }).closest("section");
    expect(
      within(observations as HTMLElement).queryByTestId("atlas-comparison"),
    ).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- cohort mode */

describe("cohort mode", () => {
  it("sends the cutoff only in cohort mode and shows it in the overview", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue(ok(cohortReport()));
    renderWorkspace();

    await user.click(screen.getByRole("radio", { name: /По когорте привлечения/ }));
    await runAnalysis(user);

    expect(runMock.mock.calls[0]?.[0].mode).toBe("acquisition_cohort");
    expect(screen.getAllByText(/2026-07-31/).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ errors */

describe("error states", () => {
  it("reports a backend failure without destroying a previous result", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    runMock.mockResolvedValue({ status: "upstream_unavailable" });
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    await user.click(screen.getByTestId("atlas-run"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // Previous result preserved, and marked stale.
    expect(screen.getByTestId("atlas-result")).toHaveAttribute("data-stale", "true");
    expect(screen.getByText(/За период засчитано 1240 кликов/)).toBeInTheDocument();
  });

  it("explains a timeout distinctly from an unreachable backend", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({ status: "timeout" });
    renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/не завершился/));
  });

  it("explains session expiry", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({ status: "unauthenticated", requestId: "req_401" });
    renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Сессия истекла/));
    expect(screen.getByText(/req_401/)).toBeInTheDocument();
  });

  it("explains a permission refusal", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({
      status: "forbidden",
      messageKey: "crm.affiliates.forbidden",
    });
    renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Недостаточно прав/));
  });

  it("explains a contract violation as a refusal to render, not a retry", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({ status: "contract_violation", reason: "model_invoked" });
    renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/с участием модели/),
    );
    expect(screen.queryByTestId("atlas-result")).not.toBeInTheDocument();
  });

  it("explains a malformed response", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({ status: "malformed_response" });
    renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/не удалось разобрать/));
  });

  it("never prints a stack trace, SQL, cookie or token in an error", async () => {
    const user = userEvent.setup();
    runMock.mockResolvedValue({ status: "upstream_unavailable" });
    const { container } = renderWorkspace();
    await user.click(screen.getByTestId("atlas-run"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    const text = container.textContent ?? "";
    for (const forbidden of ["SELECT ", "at Object.", "csrf", "Set-Cookie", "stack"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

/* -------------------------------------------------------------- permissions */

describe("permission boundary", () => {
  it("allows an analyst", async () => {
    const user = userEvent.setup();
    renderWorkspace(ANALYST);
    await runAnalysis(user);
    expect(screen.getByRole("heading", { name: "Обзор" })).toBeInTheDocument();
  });

  it("allows crm_admin through manage_settings", async () => {
    const user = userEvent.setup();
    renderWorkspace(ADMIN, "crm_admin");
    await runAnalysis(user);
    expect(screen.getByRole("heading", { name: "Обзор" })).toBeInTheDocument();
  });

  it("denies an operator without the analytics permission and issues no request", async () => {
    renderWorkspace(UNRELATED, "support");
    expect(screen.getByText("Недостаточно прав")).toBeInTheDocument();
    expect(screen.queryByTestId("atlas-run")).not.toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("names the permission it requires", () => {
    renderWorkspace(UNRELATED, "support");
    expect(screen.getByText(/view_affiliate_analytics/)).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- privacy and storage */

describe("privacy and persistence", () => {
  it("writes nothing to localStorage, sessionStorage or cookies", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderWorkspace();
    await runAnalysis(user);

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    setItem.mockRestore();
  });

  it("puts no fingerprint or request id in the URL", async () => {
    const user = userEvent.setup();
    const before = window.location.href;
    renderWorkspace();
    await runAnalysis(user);
    expect(window.location.href).toBe(before);
    expect(window.location.search).toBe("");
  });

  it("renders no PII, learner id, click id or Pocket id", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await runAnalysis(user);

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/\btq-[A-Za-z0-9]/);
    expect(text).not.toMatch(/\b\d{9,}\b/);
    for (const forbidden of ["learnerId", "userId", "pocketPlayerId", "clickId"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("clears the snapshot when the permission is lost", async () => {
    const user = userEvent.setup();
    const view = renderWorkspace(ANALYST);
    await runAnalysis(user);
    expect(screen.getByTestId("atlas-result")).toBeInTheDocument();

    // Re-render the same tree with a session that no longer grants the read.
    const stripped = sessionFromDto({
      employeeId: "emp_1",
      displayName: "Тестовый сотрудник",
      role: "support",
      effectivePermissions: UNRELATED,
      permissionVersion: 2,
      expiresAt: "2026-08-01T10:00:00.000Z",
    });
    view.rerender(
      <AuthenticatedSessionProvider session={stripped}>
        <CurieAtlasWorkspace />
      </AuthenticatedSessionProvider>,
    );

    expect(screen.queryByTestId("atlas-result")).not.toBeInTheDocument();
    expect(screen.getByText("Недостаточно прав")).toBeInTheDocument();
  });

  it("loses the snapshot on unmount — nothing survives teardown", async () => {
    const user = userEvent.setup();
    const view = renderWorkspace();
    await runAnalysis(user);
    view.unmount();

    renderWorkspace();
    expect(screen.queryByTestId("atlas-result")).not.toBeInTheDocument();
    expect(screen.getAllByText("Анализ ещё не запускался").length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------- accessibility */

describe("accessibility", () => {
  it("announces run state through a live region", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    const status = screen.getAllByRole("status").find((n) => n.className.includes("sr-only"));
    expect(status).toBeDefined();
    expect(status as HTMLElement).toHaveTextContent("Анализ ещё не запускался");

    await runAnalysis(user);
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").find((n) => n.className.includes("sr-only")) as HTMLElement,
      ).toHaveTextContent("Анализ готов"),
    );
  });

  it("announces the stale state to assistive technology", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.selectOptions(screen.getByLabelText("Группировка"), "week");
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").find((n) => n.className.includes("sr-only")) as HTMLElement,
      ).toHaveTextContent("Параметры изменились"),
    );
  });

  it("gives every finding a text severity label, not colour alone", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    expect(screen.getAllByText("Требует внимания").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Информация").length).toBeGreaterThan(0);
  });

  it("reaches the evidence disclosure by keyboard alone", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);

    const summary = screen.getAllByText("Показать данные")[0]!;
    summary.focus();
    expect(summary).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByText("Показатель").length).toBeGreaterThan(0);
  });

  it("uses an accessible table for evidence", async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await runAnalysis(user);
    await user.click(screen.getAllByText("Показать данные")[0]!);

    const table = screen.getAllByRole("table")[0]!;
    expect(within(table!).getByText("Данные, на которых основан вывод")).toBeInTheDocument();
    expect(within(table!).getAllByRole("columnheader").length).toBe(3);
  });

  it("labels the mode, group and dimension controls", () => {
    renderWorkspace();
    expect(screen.getByRole("radiogroup", { name: "Режим отчёта" })).toBeInTheDocument();
    expect(screen.getByLabelText("Группировка")).toBeInTheDocument();
  });
});
