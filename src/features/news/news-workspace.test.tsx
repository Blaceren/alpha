import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: router.replace, push: router.push, refresh: vi.fn() }),
  usePathname: () => "/news",
}));

const client = vi.hoisted(() => ({
  fetchNewsList: vi.fn(),
  fetchNewsItem: vi.fn(),
  createNewsItem: vi.fn(),
  updateNewsItem: vi.fn(),
  setNewsItemStatus: vi.fn(),
}));
vi.mock("@/application/api/news-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/application/api/news-client")>()),
  ...client,
}));

import { NewsWorkspace } from "./news-workspace";
import { NewsEditorWorkspace } from "./news-editor-workspace";

const REFERENCE = {
  countries: [
    { code: "US", label: "США", currency: "USD" },
    { code: "DE", label: "Германия", currency: "EUR" },
  ],
  currencies: ["USD", "EUR"],
  importance: [
    { value: 1, label: "Низкая" },
    { value: 2, label: "Средняя" },
    { value: 3, label: "Высокая" },
  ],
};

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "clnews0000000000000000001",
    slug: "ssha-bazovyy-indeks-potrebitelskikh-tsen-m-m-2026-09-21",
    title: "Базовый индекс потребительских цен, м/м",
    summary: "Инфляция без еды и энергии за август: рынок ждёт 0.3%.",
    body: "Первый абзац.",
    country: "US",
    countryLabel: "США",
    currency: "USD",
    importance: 3,
    releaseAt: "2026-09-21T12:30:00.000Z",
    forecast: "0.3%",
    previous: "0.2%",
    actual: null,
    sourceName: null,
    sourceUrl: null,
    status: "draft",
    slugLocked: false,
    publishedAt: null,
    publicUrl: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

function list(items: unknown[], extra: Record<string, unknown> = {}) {
  return { status: "success", data: { items, total: items.length, page: 1, pageCount: 1, reference: REFERENCE, ...extra } };
}

beforeEach(() => {
  for (const mock of Object.values(client)) mock.mockReset();
  router.replace.mockReset();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw" }).resolvedOptions(),
    timeZone: "Europe/Warsaw",
  });
});
afterEach(() => vi.restoreAllMocks());

describe("the news list", () => {
  it("lists drafts and published items with their release in the viewer's zone", async () => {
    client.fetchNewsList.mockResolvedValue(list([item(), item({ id: "clnews0000000000000000002", status: "published", title: "Решение по ставке ФРС" })]));
    render(<NewsWorkspace />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/21 сент\.?, 14:30/);
    expect(rows[0]).toHaveTextContent("США · USD");
    expect(within(rows[0]!).getByRole("link", { name: "Базовый индекс потребительских цен, м/м" })).toHaveAttribute(
      "href",
      "/news/clnews0000000000000000001",
    );
    expect(rows[0]).toHaveTextContent("Черновик");
    expect(rows[1]).toHaveTextContent("Опубликована");
    expect(screen.getByText(/Варшава · UTC\+2/)).toBeInTheDocument();
    expect(client.fetchNewsList).toHaveBeenCalledWith({ status: "all", page: 1 });
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    client.fetchNewsList.mockResolvedValue(list([item()]));
    render(<NewsWorkspace />);
    await screen.findByRole("table");
    await user.selectOptions(screen.getByLabelText("Показать"), "published");
    await waitFor(() => expect(client.fetchNewsList).toHaveBeenLastCalledWith({ status: "published", page: 1 }));
  });

  it("invites the first item when there are none", async () => {
    client.fetchNewsList.mockResolvedValue(list([]));
    render(<NewsWorkspace />);
    expect(await screen.findByText("Новостей пока нет")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Новая новость" })[0]).toHaveAttribute("href", "/news/new");
  });

  it("says plainly when the role has no access, and offers no button", async () => {
    client.fetchNewsList.mockResolvedValue({ status: "forbidden", reason: "no_permission" });
    render(<NewsWorkspace />);
    expect(await screen.findByText("Нет доступа")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Новая новость" })).not.toBeInTheDocument();
  });
});

describe("«Новая новость»", () => {
  it("checks the form before sending anything, and focuses the first problem", async () => {
    const user = userEvent.setup();
    client.fetchNewsList.mockResolvedValue(list([]));
    render(<NewsEditorWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Сохранить черновик" }));
    expect(client.createNewsItem).not.toHaveBeenCalled();
    expect(screen.getByText("Проверьте отмеченные поля.")).toBeInTheDocument();
    expect(screen.getByText("Укажите дату и время выхода.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Дата выхода/)).toHaveFocus();
  });

  it("saves a draft and opens it", async () => {
    const user = userEvent.setup();
    client.fetchNewsList.mockResolvedValue(list([]));
    client.createNewsItem.mockResolvedValue({ status: "success", data: item() });
    render(<NewsEditorWorkspace />);
    await user.type(await screen.findByLabelText(/Время выхода/), "14:30");
    await user.type(screen.getByLabelText(/Название события/), "Базовый индекс потребительских цен, м/м");
    await user.type(screen.getByLabelText(/^Лид/), "Инфляция без еды и энергии за август: рынок ждёт 0.3%.");
    expect(screen.getByText(/Сохранится как 12:30 UTC/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/news/clnews0000000000000000001"));
    const [form] = client.createNewsItem.mock.calls[0]!;
    expect(form).toMatchObject({ country: "US", importance: 3, releaseTime: "14:30", timeZone: "Europe/Warsaw" });
  });

  it("points a backend refusal at its field", async () => {
    const user = userEvent.setup();
    client.fetchNewsList.mockResolvedValue(list([]));
    client.createNewsItem.mockResolvedValue({ status: "invalid_input", detail: "invalid_title" });
    render(<NewsEditorWorkspace />);
    await user.type(await screen.findByLabelText(/Время выхода/), "14:30");
    await user.type(screen.getByLabelText(/Название события/), "Базовый ИПЦ");
    await user.type(screen.getByLabelText(/^Лид/), "Инфляция без еды и энергии за август.");
    await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    expect(await screen.findAllByText(/Название не подходит/)).not.toHaveLength(0);
    expect(screen.getByLabelText(/Название события/)).toHaveFocus();
  });
});

describe("one item", () => {
  it("publishes only a saved form", async () => {
    const user = userEvent.setup();
    client.fetchNewsItem.mockResolvedValue({ status: "success", data: { item: item(), reference: REFERENCE } });
    client.setNewsItemStatus.mockResolvedValue({
      status: "success",
      data: item({ status: "published", publicUrl: "https://alfatrade.media/news/x", updatedAt: "2026-09-21T10:00:00.000Z" }),
    });
    render(<NewsEditorWorkspace newsId="clnews0000000000000000001" />);
    const publish = await screen.findByRole("button", { name: "Опубликовать" });
    expect(publish).toBeEnabled();
    await user.type(screen.getByLabelText("Факт"), "0.4%");
    expect(publish).toBeDisabled();
    expect(screen.getByText("Сначала сохраните правки — публикуется сохранённая версия.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Факт"));
    await user.click(publish);
    expect(client.setNewsItemStatus).toHaveBeenCalledWith("clnews0000000000000000001", "published", "2026-09-20T10:00:00.000Z");
    expect(await screen.findByText(/Опубликовано: страница открыта/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Открыть страницу/ })).toHaveAttribute("href", "https://alfatrade.media/news/x");
  });

  it("asks before taking a page down", async () => {
    const user = userEvent.setup();
    client.fetchNewsItem.mockResolvedValue({
      status: "success",
      data: { item: item({ status: "published", slugLocked: true, publishedAt: "2026-09-20T11:00:00.000Z" }), reference: REFERENCE },
    });
    client.setNewsItemStatus.mockResolvedValue({ status: "success", data: item({ slugLocked: true }) });
    render(<NewsEditorWorkspace newsId="clnews0000000000000000001" />);
    expect(await screen.findByText(/закреплён после первой публикации/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Снять с публикации" }));
    expect(client.setNewsItemStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Страница перестанет открываться");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Снять с публикации" }));
    expect(client.setNewsItemStatus).toHaveBeenCalledWith("clnews0000000000000000001", "draft", "2026-09-20T10:00:00.000Z");
  });

  it("says a stale form was not saved, and offers to reload", async () => {
    const user = userEvent.setup();
    client.fetchNewsItem.mockResolvedValue({ status: "success", data: { item: item(), reference: REFERENCE } });
    client.updateNewsItem.mockResolvedValue({ status: "stale" });
    render(<NewsEditorWorkspace newsId="clnews0000000000000000001" />);
    await user.type(await screen.findByLabelText("Факт"), "0.4%");
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(await screen.findByText(/ваши правки не сохранены/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(client.fetchNewsItem).toHaveBeenCalledTimes(2));
  });

  it("answers an unknown item plainly", async () => {
    client.fetchNewsItem.mockResolvedValue({ status: "not_found" });
    render(<NewsEditorWorkspace newsId="missing-item-0001" />);
    expect(await screen.findByRole("heading", { name: "Новость не найдена" })).toBeInTheDocument();
  });
});
