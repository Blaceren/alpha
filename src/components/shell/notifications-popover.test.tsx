/**
 * THE BELL'S WINDOW (DD-349, owner 2026-10-06): «сделай небольшое окно с
 * уведомлениями которое открывается по нажатию», like another product's window,
 * in the product's colours and words, with «Прочитать все» and «Очистить всё».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const markAll = vi.fn();
const clearAll = vi.fn();
const markOne = vi.fn();
vi.mock("@/lib/api/client", () => ({
  markAllNotificationsRead: () => markAll(),
  clearAllNotifications: () => clearAll(),
  markNotificationRead: (id: string) => markOne(id),
}));

import { NotificationsBell } from "@/components/shell/notifications-bell";
import { POPOVER_COPY } from "@/components/shell/notifications-popover";

const ITEMS = [
  {
    id: 11,
    type: "support_reply",
    title: "Ответ поддержки",
    message: "Мы проверили ваш вопрос и ответили в обращении.",
    readAt: null,
    createdAt: new Date().toISOString(),
    metadata: { learnerOpsCaseId: "case_42" },
  },
  {
    id: 12,
    type: "level_up",
    title: "Уровень 3 пройден",
    message: "Регистрация подтверждена.",
    readAt: "2026-10-05T10:00:00.000Z",
    createdAt: "2026-10-05T09:00:00.000Z",
  },
  /* The broker's own event never reaches a learner surface. */
  { id: 13, type: "postback_received", title: "Получен exchange postback: first_deposit.", message: "", readAt: null, createdAt: new Date().toISOString() },
];

let fetchMock: ReturnType<typeof vi.fn>;
function listReturns(items: unknown[] | "fail") {
  fetchMock = vi.fn(async () =>
    items === "fail"
      ? new Response("{}", { status: 502 })
      : new Response(JSON.stringify({ items, unreadCount: 0 }), { status: 200, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  refresh.mockReset();
  markAll.mockReset().mockResolvedValue({ ok: true, data: {} });
  clearAll.mockReset().mockResolvedValue({ ok: true, data: {} });
  markOne.mockReset().mockResolvedValue({ ok: true, data: {} });
  listReturns(ITEMS);
});
afterEach(() => vi.unstubAllGlobals());

const bell = () =>
  render(
    <div>
      <p>страница</p>
      <NotificationsBell presence={<span className="dot" />} current={false} placement="desktop" />
    </div>,
  );
const button = () => screen.getByRole("button", { name: "Уведомления" });
async function openWindow() {
  await userEvent.click(button());
  return screen.getByRole("dialog", { name: POPOVER_COPY.title });
}

describe("the bell opens a window in place", () => {
  it("is a disclosure: closed at first, open on a press, the window named", async () => {
    bell();
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-controls")).toBe("nt-pop-desktop");
    const dialog = await openWindow();
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(dialog.id).toBe("nt-pop-desktop");
    // Focus moves to the window's title, so its name is heard first.
    expect(document.activeElement?.textContent).toBe(POPOVER_COPY.title);
  });

  it("lists what the learner may see — newest first, unread marked, the broker's events left out", async () => {
    bell();
    const dialog = await openWindow();
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
    const items = within(dialog).getAllByRole("listitem");
    expect(items[0]!.hasAttribute("data-unread")).toBe(true);
    expect(items[0]!.textContent).toContain("Ответ поддержки");
    expect(items[1]!.hasAttribute("data-unread")).toBe(false);
    expect(dialog.textContent).not.toContain("postback");
    // A reply opens its own case.
    expect(within(items[0]!).getByRole("link", { name: "Открыть обращение" }).getAttribute("href")).toBe(
      "/profile/support?case=case_42",
    );
    // Opening the window reads nothing by itself.
    expect(markAll).not.toHaveBeenCalled();
    // The full list stays one press away.
    expect(within(dialog).getByRole("link", { name: /Все/ }).getAttribute("href")).toBe("/notifications");
  });

  it("«Прочитать все» reads them, says so, and the bell drops its mark", async () => {
    const { container } = bell();
    const dialog = await openWindow();
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.readAll }));
    expect(markAll).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog.querySelectorAll("[data-unread]")).toHaveLength(0));
    expect(within(dialog).getByRole("status").textContent).toBe(POPOVER_COPY.readDone);
    expect(container.querySelector(".dot")).toBeNull();
    expect(refresh).toHaveBeenCalled();
    // Nothing unread is left to read.
    expect(within(dialog).getByRole("button", { name: POPOVER_COPY.readAll })).toBeDisabled();
  });

  it("«Очистить всё» asks once more, can be taken back, and then empties the list", async () => {
    bell();
    const dialog = await openWindow();
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.clearAll }));
    expect(within(dialog).getByText(POPOVER_COPY.confirm)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.confirmNo }));
    expect(clearAll).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.clearAll }));
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.confirmYes }));
    expect(clearAll).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(within(dialog).getByText(POPOVER_COPY.empty)).toBeTruthy());
    expect(within(dialog).getByRole("status").textContent).toBe(POPOVER_COPY.clearDone);
    expect(within(dialog).getByRole("button", { name: POPOVER_COPY.clearAll })).toBeDisabled();
  });

  it("a failed clear keeps the list and says so", async () => {
    clearAll.mockResolvedValue({ ok: false, error: { category: "NETWORK_ERROR" } });
    bell();
    const dialog = await openWindow();
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.clearAll }));
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.confirmYes }));
    await waitFor(() => expect(within(dialog).getByRole("status").textContent).toBe(POPOVER_COPY.clearFailed));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  });

  it("opening one reads it and closes the window", async () => {
    bell();
    const dialog = await openWindow();
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
    await userEvent.click(within(dialog).getByRole("link", { name: "Открыть обращение" }));
    expect(markOne).toHaveBeenCalledWith("11");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes it and gives the keyboard back to the bell; a press outside closes it", async () => {
    bell();
    await openWindow();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button());
    await openWindow();
    await userEvent.click(screen.getByText("страница"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when there is nothing, and when the list could not be read", async () => {
    listReturns([]);
    bell();
    let dialog = await openWindow();
    await waitFor(() => expect(within(dialog).getByText(POPOVER_COPY.empty)).toBeTruthy());
    expect(within(dialog).getByRole("button", { name: POPOVER_COPY.readAll })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: POPOVER_COPY.clearAll })).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    listReturns("fail");
    await userEvent.click(button());
    dialog = screen.getByRole("dialog", { name: POPOVER_COPY.title });
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain(POPOVER_COPY.failed));
    listReturns(ITEMS);
    await userEvent.click(within(dialog).getByRole("button", { name: POPOVER_COPY.retry }));
    await waitFor(() => expect(within(dialog).getAllByRole("listitem")).toHaveLength(2));
  });
});

describe("the window never shows money", () => {
  it("carries no currency and no amount in its source", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shell/notifications-popover.tsx"), "utf8");
    expect(src).not.toMatch(/\$\d|₽|USD|баланс|депозит|withdraw/i);
  });
});
