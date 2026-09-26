/**
 * AFD-5C1 — the chart contract (§32).
 *
 * The chart is the surface where a wrong number is least likely to be noticed,
 * so these tests assert the properties that keep it honest: the backend's own
 * buckets in the backend's own order, zero buckets present, absences not drawn
 * as zeroes, values reachable without a pointer, and counts never sharing a
 * scale with rates.
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeriesChart, type ChartBucket, type ChartSeries } from "./series-chart";

const SERIES: ChartSeries[] = [
  { key: "clicks", label: "Клики", color: "hsl(1 2% 3%)", pattern: "solid" },
  { key: "registrations", label: "Регистрации", color: "hsl(4 5% 6%)", pattern: "hatch" },
];

const BUCKETS: ChartBucket[] = [
  { label: "2026-01-01", values: { clicks: 10, registrations: 2 } },
  // A genuine zero bucket in the middle: the point of the series.
  { label: "2026-01-02", values: { clicks: 0, registrations: 0 } },
  { label: "2026-01-03", values: { clicks: 7, registrations: 3 } },
];

function renderChart(props: Partial<React.ComponentProps<typeof SeriesChart>> = {}) {
  return render(
    <SeriesChart
      buckets={BUCKETS}
      series={SERIES}
      kind="count"
      title="Динамика событий"
      valueAxisLabel="количество событий"
      emptyMessage="Нет данных"
      {...props}
    />,
  );
}

/* -------------------------------------------------------------- buckets */

describe("authoritative buckets", () => {
  it("renders every bucket the backend returned", async () => {
    renderChart();
    await userEvent.click(screen.getByRole("button", { name: /Показать таблицу/ }));
    for (const bucket of BUCKETS) {
      expect(screen.getAllByText(bucket.label).length).toBeGreaterThan(0);
    }
  });

  it("preserves the backend's order and does not regroup", async () => {
    renderChart();
    await userEvent.click(screen.getByRole("button", { name: /Показать таблицу/ }));
    const rowHeaders = screen
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent?.trim());
    expect(rowHeaders).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("shows a zero bucket as a zero rather than omitting it", async () => {
    renderChart();
    await userEvent.click(screen.getByRole("button", { name: /Показать таблицу/ }));
    const zeroRow = screen.getByRole("rowheader", { name: "2026-01-02" }).closest("tr")!;
    expect(within(zeroRow).getAllByText("0").length).toBe(2);
  });

  it("does not truncate a long series", async () => {
    const many = Array.from({ length: 90 }, (_, index) => ({
      label: `d${index}`,
      values: { clicks: index, registrations: 0 },
    }));
    renderChart({ buckets: many });
    await userEvent.click(screen.getByRole("button", { name: /Показать таблицу/ }));
    expect(screen.getAllByRole("rowheader")).toHaveLength(90);
  });

  it("renders an empty state rather than an empty axis", () => {
    renderChart({ buckets: [] });
    expect(screen.getByText("Нет данных")).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------- accessibility */

describe("accessibility", () => {
  it("marks the drawing as decorative and carries the data elsewhere", () => {
    const { container } = renderChart();
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a visible legend naming every series", () => {
    renderChart();
    const legend = screen.getByRole("list", { name: "Обозначения графика" });
    expect(within(legend).getByText("Клики")).toBeInTheDocument();
    expect(within(legend).getByText("Регистрации")).toBeInTheDocument();
  });

  it("exposes exact values without any pointer interaction", () => {
    renderChart();
    // The focused bucket's values are rendered as text on first paint — no
    // hover, no tooltip, no click required.
    expect(screen.getByText(/Клики: 10/)).toBeInTheDocument();
    expect(screen.getByText(/Регистрации: 2/)).toBeInTheDocument();
  });

  it("moves through the series with the keyboard", async () => {
    renderChart();
    const plot = screen.getByRole("group", { name: /Динамика событий/ });
    plot.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText(/Клики: 0/)).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText(/Клики: 7/)).toBeInTheDocument();
    await userEvent.keyboard("{Home}");
    expect(screen.getByText(/Клики: 10/)).toBeInTheDocument();
    await userEvent.keyboard("{End}");
    expect(screen.getByText(/Клики: 7/)).toBeInTheDocument();
  });

  it("does not trap the keyboard on unhandled keys", async () => {
    renderChart();
    const plot = screen.getByRole("group", { name: /Динамика событий/ });
    plot.focus();
    await userEvent.keyboard("{Tab}");
    expect(plot).not.toHaveFocus();
  });

  it("announces the focused bucket through a live region", () => {
    const { container } = renderChart();
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain("2026-01-01");
  });

  it("offers a table alternative with real headers", async () => {
    renderChart();
    await userEvent.click(screen.getByRole("button", { name: /Показать таблицу/ }));
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Период" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Клики" })).toBeInTheDocument();
  });

  it("labels the value axis", () => {
    renderChart();
    expect(screen.getByText(/количество событий/)).toBeInTheDocument();
  });

  it("runs no animation at all, so reduced motion changes nothing", () => {
    const { container } = renderChart();
    // The strongest form of §32's reduced-motion requirement: there is no
    // transition or animation to suppress, and no value moves after paint.
    expect(container.querySelector("animate")).toBeNull();
    expect(container.innerHTML).not.toContain("transition");
    expect(container.innerHTML).not.toContain("animate-");
  });
});

/* ------------------------------------------------------------ scale safety */

describe("count and rate scales", () => {
  it("renders rate values as percentages, not as raw counts", async () => {
    renderChart({
      kind: "rate",
      buckets: [{ label: "2026-01-01", values: { clicks: "0.25", registrations: "1" } }],
      valueAxisLabel: "доля",
    });
    // Two decimals below 10 %, one above — enough precision where it matters.
    expect(screen.getByText(/Клики: 25,0 %/)).toBeInTheDocument();
    expect(screen.getByText(/Регистрации: 100,0 %/)).toBeInTheDocument();
  });

  it("states the fixed percentage scale on a rate chart", () => {
    renderChart({ kind: "rate", buckets: BUCKETS, valueAxisLabel: "доля" });
    expect(screen.getByText(/шкала 0–100 %/)).toBeInTheDocument();
  });

  it("does not state a percentage scale on a count chart", () => {
    renderChart();
    expect(screen.queryByText(/шкала 0–100 %/)).toBeNull();
  });

  it("shows an absent rate as insufficient data rather than as zero", async () => {
    renderChart({
      kind: "rate",
      buckets: [{ label: "2026-01-01", values: { clicks: null, registrations: "0" } }],
      valueAxisLabel: "доля",
    });
    expect(screen.getByText(/Клики: Недостаточно данных/)).toBeInTheDocument();
    // The genuine zero is still a zero.
    expect(screen.getByText(/Регистрации: 0,00 %/)).toBeInTheDocument();
  });

  it("draws no bar for an absent value", () => {
    const { container } = render(
      <SeriesChart
        buckets={[{ label: "a", values: { clicks: null, registrations: 5 } }]}
        series={SERIES}
        kind="count"
        title="t"
        valueAxisLabel="v"
        emptyMessage="e"
      />,
    );
    // One bar for the value that exists; none for the absence. Bars carry a
    // `fill` attribute; the focus highlight is a class-styled rect and is
    // excluded so this counts data marks only.
    expect(container.querySelectorAll("rect[fill]")).toHaveLength(1);
  });
});
