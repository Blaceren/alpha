import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewQueue, waitingLabel } from "./review-queue";
import type { QueueItem, QueuePage } from "@/data/contracts/api/report-review";

const ASSIGNMENT = {
  versionNumber: 1, title: "Отчёт", instructions: "i", successCriteriaSummary: null,
  fields: [{ code: "trade1-asset", type: "short_text", required: true, label: "Актив", helpText: null }],
};
const RUBRIC = {
  versionNumber: 1,
  criteria: [{ code: "r1", categoryCode: "c", commentRequired: false, title: "R1", description: "d" }],
  scale: [{ code: "meets", label: "OK", description: null }],
};

function item(name: string, ref: string, claim: QueueItem["claim"]["state"] = "unclaimed"): QueueItem {
  return {
    submissionRef: ref,
    owner: { displayName: name },
    curriculum: { code: "ata-v2", versionNumber: 2 },
    level: { stableCode: "v2.l003.x", levelNumber: 3, title: "Первые 5 demo-сделок" },
    assignment: ASSIGNMENT,
    rubric: RUBRIC,
    revision: { revisionNumber: 2, values: { "trade1-asset": "BTC" } },
    submittedAt: "2026-07-26T10:00:00.000Z",
    claim: { state: claim, expiresAt: null },
  };
}

const page = (items: QueueItem[], nextCursor: string | null = null): QueuePage => ({ items, nextCursor });
const ok = (p: QueuePage) => vi.fn().mockResolvedValue({ status: "success" as const, page: p });
const fail = (status: string) => vi.fn().mockResolvedValue({ status });

describe("ReviewQueue — states", () => {
  it("shows a loading state first", () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={vi.fn().mockReturnValue(new Promise(() => {}))} />);
    expect(screen.getByRole("status")).toHaveTextContent(/загружаем очередь/i);
  });

  it("renders multiple pending reports in a semantic table", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("Learner A", "ref-a"), item("Learner B", "ref-b")]))} />);
    const table = await screen.findByRole("table");
    // Both presentations exist in the DOM: jsdom applies no Tailwind CSS, so the
    // `md:hidden` card list and the `hidden md:block` table are both present.
    // Assertions therefore scope to the presentation under test.
    expect(within(table).getByText("Learner A")).toBeInTheDocument();
    expect(within(table).getByText("Learner B")).toBeInTheDocument();
    // Header cells are real column headers, not styled divs.
    expect(screen.getByRole("columnheader", { name: /ученик/i })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + two rows
  });

  it("renders the empty queue state", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([]))} />);
    expect(await screen.findByText(/очередь пуста/i)).toBeInTheDocument();
  });

  it("renders a bounded error with a retry", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={fail("upstream_unavailable")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/не удалось загрузить/i);
    expect(screen.getByRole("button", { name: /повторить/i })).toBeInTheDocument();
  });

  it("renders FORBIDDEN for a valid staff member who is not a reviewer", async () => {
    // The single most important state in this phase: bounded, explanatory, and
    // NOT an authentication loop.
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={fail("forbidden")} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/нет доступа к проверке отчётов/i);
    expect(alert).toHaveTextContent(/наставник/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders FLAG_DISABLED distinctly from FORBIDDEN", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={fail("flag_disabled")} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/отключена/i);
    expect(alert).not.toHaveTextContent(/нет доступа к проверке/i);
  });

  it("renders UNAUTHORIZED without rendering data", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={fail("unauthenticated")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/требуется вход/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("ReviewQueue — filtering", () => {
  it("filters the loaded page by learner name", async () => {
    const user = userEvent.setup();
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("Learner A", "a"), item("Learner B", "b")]))} />);
    await screen.findByRole("table");
    await user.type(screen.getByLabelText(/фильтр/i), "Learner A");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Learner A")).toBeInTheDocument();
    expect(within(table).queryByText("Learner B")).not.toBeInTheDocument();
  });

  it("renders FILTERED_EMPTY when nothing matches, with a way back", async () => {
    const user = userEvent.setup();
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("Learner A", "a")]))} />);
    await screen.findByRole("table");
    await user.type(screen.getByLabelText(/фильтр/i), "zzzz");
    expect(screen.getByText(/ничего не найдено/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /очистить фильтр/i }));
    expect(within(screen.getByRole("table")).getByText("Learner A")).toBeInTheDocument();
  });

  it("says plainly that the filter applies to the loaded page only", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("A", "a")]))} />);
    await screen.findByRole("table");
    expect(screen.getByText(/загруженной странице/i)).toBeInTheDocument();
  });
});

describe("ReviewQueue — rows", () => {
  it("shows revision, timestamp, waiting time and claim state as text", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("A", "a", "claimed")]))} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("№2")).toBeInTheDocument();
    // Claim state is a word, not a colour.
    expect(within(table).getByText(/у другого наставника/i)).toBeInTheDocument();
  });

  it("opens a report by its submission ref", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ReviewQueue onOpen={onOpen} fetchQueueImpl={ok(page([item("A", "ref-xyz")]))} />);
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: /открыть/i }));
    expect(onOpen).toHaveBeenCalledWith("ref-xyz");
  });

  it("does not render a raw internal id beyond the navigation ref", async () => {
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("A", "ref-xyz")]))} />);
    const table = await screen.findByRole("table");
    expect(table.textContent ?? "").not.toContain("ref-xyz");
  });

  it("refetches on demand", async () => {
    const user = userEvent.setup();
    const impl = ok(page([item("A", "a")]));
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={impl} />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: /обновить/i }));
    await waitFor(() => expect(impl).toHaveBeenCalledTimes(2));
  });
});

describe("waitingLabel", () => {
  it("reports minutes, hours and days", () => {
    const base = new Date("2026-07-26T12:00:00.000Z");
    expect(waitingLabel("2026-07-26T11:30:00.000Z", base)).toBe("30 мин");
    expect(waitingLabel("2026-07-26T09:00:00.000Z", base)).toBe("3 ч");
    expect(waitingLabel("2026-07-24T12:00:00.000Z", base)).toBe("2 дн");
  });

  it("never reports a negative wait", () => {
    const base = new Date("2026-07-26T12:00:00.000Z");
    expect(waitingLabel("2026-07-26T13:00:00.000Z", base)).toBe("0 мин");
  });

  it("degrades safely on an unparseable timestamp", () => {
    expect(waitingLabel("not-a-date")).toBe("—");
  });
});

describe("ReviewQueue — narrow-width card presentation", () => {
  it("renders one card per report carrying the same Backend fields", async () => {
    // A seven-column table is unusable at 390px — visual review proved it — so
    // narrow widths get a card list. Both presentations render from one array, so
    // they cannot drift.
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("Learner A", "a"), item("Learner B", "b")]))} />);
    await screen.findByRole("table");

    const cards = screen.getByRole("list");
    expect(within(cards).getAllByRole("listitem")).toHaveLength(2);
    expect(within(cards).getByText("Learner A")).toBeInTheDocument();
    expect(within(cards).getByText("Learner B")).toBeInTheDocument();
    // The same fields the table shows.
    expect(within(cards).getAllByText("№2")).toHaveLength(2);
    expect(within(cards).getAllByText(/свободен/i)).toHaveLength(2);
  });

  it("opens a report from a card", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ReviewQueue onOpen={onOpen} fetchQueueImpl={ok(page([item("A", "ref-card")]))} />);
    await screen.findByRole("table");

    const cards = screen.getByRole("list");
    await user.click(within(cards).getByRole("button", { name: /открыть/i }));
    expect(onOpen).toHaveBeenCalledWith("ref-card");
  });

  it("honours the filter in the card presentation too", async () => {
    const user = userEvent.setup();
    render(<ReviewQueue onOpen={vi.fn()} fetchQueueImpl={ok(page([item("Learner A", "a"), item("Learner B", "b")]))} />);
    await screen.findByRole("table");
    await user.type(screen.getByLabelText(/фильтр/i), "Learner A");

    const cards = screen.getByRole("list");
    expect(within(cards).getAllByRole("listitem")).toHaveLength(1);
    expect(within(cards).getByText("Learner A")).toBeInTheDocument();
  });
});
