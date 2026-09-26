/**
 * SUPPORT — every state the desk can be in, driven through the real component.
 *
 * The surface had no component test at all: the proxy was covered and the route
 * was covered, and what a learner actually sees was not. These cases drive the
 * real `SupportHub` with real events against a mocked transport, so no request
 * leaves the process and no case is ever created.
 *
 * WHAT IS NOT HERE IS DELIBERATE. There is no attachment, category, priority,
 * SLA, rating or read-receipt case below, because the product has none of those
 * and a test that pretended otherwise would be describing a different product.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/support/support-client", () => ({
  listSupportCases: vi.fn(),
  getSupportCase: vi.fn(),
  openSupportCase: vi.fn(),
  replyToSupportCase: vi.fn(),
}));

import * as client from "@/lib/support/support-client";
import { SupportHub } from "@/features/support/components/support-hub";
import { makeError } from "@/lib/api/errors";

const list = vi.mocked(client.listSupportCases);
const detail = vi.mocked(client.getSupportCase);
const open = vi.mocked(client.openSupportCase);
const reply = vi.mocked(client.replyToSupportCase);

/** Every status the component maps. Taken from the component, not invented. */
const STATUSES = [
  ["new", "Получено"],
  ["open", "Получено"],
  ["in_progress", "В работе"],
  ["waiting_learner", "Ждём вашего ответа"],
  ["waiting_internal", "Уточняем внутри команды"],
  ["waiting_external", "Ждём ответа провайдера"],
  ["escalated", "Передано специалисту"],
  ["resolved", "Решено"],
  ["closed", "Закрыто"],
] as const;

function summary(over: Partial<client.SupportCaseSummary> = {}): client.SupportCaseSummary {
  return {
    id: "c1",
    reference: "SUP-001",
    type: "question",
    status: "open",
    subject: "Не открывается урок",
    openedAt: "2026-08-01T10:00:00.000Z",
    lastActivityAt: "2026-08-02T11:30:00.000Z",
    resolvedAt: null,
    ...over,
  };
}
function full(over: Partial<client.SupportCaseDetail> = {}): client.SupportCaseDetail {
  return { ...summary(), details: "Описание проблемы.", messages: [], ...over };
}

const never = <T,>() => new Promise<T>(() => {});

beforeEach(() => {
  list.mockReset(); detail.mockReset(); open.mockReset(); reply.mockReset();
  list.mockResolvedValue({ ok: true, data: [] });
});
afterEach(() => vi.clearAllMocks());

/* ------------------------------------------------------------ the desk --- */

describe("the desk", () => {
  it("has exactly one h1, and the register and form are both labelled regions", async () => {
    render(<SupportHub />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Поддержка");
    expect(screen.getByRole("region", { name: "Новое обращение" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Мои обращения" })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------ opening a case --- */

describe("opening a case", () => {
  it("starts empty with the action unavailable", async () => {
    render(<SupportHub />);
    expect(screen.getByLabelText("Тема")).toHaveValue("");
    expect(screen.getByLabelText("Опишите подробнее")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Отправить обращение" })).toBeDisabled();
  });

  it("stays unavailable while only one field is filled", async () => {
    const user = userEvent.setup();
    render(<SupportHub />);
    const cta = screen.getByRole("button", { name: "Отправить обращение" });
    await user.type(screen.getByLabelText("Тема"), "Тема есть");
    expect(cta, "subject alone").toBeDisabled();
    await user.clear(screen.getByLabelText("Тема"));
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание есть");
    expect(cta, "body alone").toBeDisabled();
  });

  it.each([
    ["a blank subject", "   ", "настоящее описание"],
    ["a blank body", "настоящая тема", "   "],
  ])("refuses %s — whitespace is not content", async (_label, subject, details) => {
    const user = userEvent.setup();
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), subject);
    await user.type(screen.getByLabelText("Опишите подробнее"), details);
    expect(screen.getByRole("button", { name: "Отправить обращение" })).toBeDisabled();
    expect(open).not.toHaveBeenCalled();
  });

  it("becomes available once both fields carry content", async () => {
    const user = userEvent.setup();
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Не открывается урок");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Нажимаю и ничего не происходит.");
    expect(screen.getByRole("button", { name: "Отправить обращение" })).toBeEnabled();
  });

  it("shows the in-flight label and blocks the control while submitting", async () => {
    const user = userEvent.setup();
    open.mockReturnValue(never());
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    const busy = await screen.findByRole("button", { name: "Отправка…" });
    expect(busy).toBeDisabled();
  });

  it("writes ONCE even when the form itself is submitted again", async () => {
    /* Pressing a DISABLED button dispatches nothing, so clicking twice proves
       only that the attribute is set. The handler carries its own `busy` guard
       for the submit paths that do not go through the button — implicit
       submission among them — and this fires the form directly to reach it.
       Without the guard this case sees two writes. */
    const user = userEvent.setup();
    open.mockReturnValue(never());
    const { container } = render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("writes ONCE however many times the control is pressed", async () => {
    const user = userEvent.setup();
    open.mockReturnValue(never());
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    const cta = screen.getByRole("button", { name: "Отправить обращение" });
    await user.click(cta);
    await user.click(cta);
    await user.click(cta);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens the new case and clears the form on success", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: true, data: { id: "c9", reference: "SUP-009" } });
    detail.mockResolvedValue({ ok: true, data: full({ id: "c9", reference: "SUP-009" }) });
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    // Exactly one write, and the thread for the new case is what comes next.
    await waitFor(() => expect(screen.getByRole("region", { name: "Обращение" })).toBeInTheDocument());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ subject: "Тема", details: "Описание" });
  });

  it("keeps what the learner typed when the server fails", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Важная тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Важное описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось связаться с поддержкой");
    // Losing the text is the one thing a failed support request must not do.
    expect(screen.getByLabelText("Тема")).toHaveValue("Важная тема");
    expect(screen.getByLabelText("Опишите подробнее")).toHaveValue("Важное описание");
    expect(screen.getByRole("button", { name: "Отправить обращение" })).toBeEnabled();
  });

  it("says what a flood-control refusal actually means", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error: makeError("CONFLICT", { status: 409 }) });
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "У вас уже есть открытые обращения",
    );
  });

  it("does not resubmit by itself when the session is gone", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error: makeError("UNAUTHENTICATED", { status: 401 }) });
    render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    await screen.findByRole("alert");
    // Waiting changes nothing: a retry needs a person to ask for it.
    await new Promise((r) => setTimeout(r, 60));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("announces a failure exactly once, and nothing on first render", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    const { container } = render(<SupportHub />);
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(0);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    await screen.findByRole("alert");
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
  });

  it("binds both labels to their controls", () => {
    render(<SupportHub />);
    expect(screen.getByLabelText("Тема").id).toBe("support-subject");
    expect(screen.getByLabelText("Опишите подробнее").id).toBe("support-details");
  });
});

/* --------------------------------------------------------- the register --- */

describe("the case register", () => {
  it("says it is loading, politely", async () => {
    list.mockReturnValue(never());
    render(<SupportHub />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Загрузка…");
  });

  it("explains an empty register instead of showing an empty box", async () => {
    render(<SupportHub />);
    expect(await screen.findByText(/Обращений пока нет/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders one case with its reference, status and last activity", async () => {
    list.mockResolvedValue({ ok: true, data: [summary()] });
    render(<SupportHub />);
    const row = await screen.findByRole("button", { name: /Не открывается урок/ });
    expect(row).toHaveTextContent("SUP-001");
    expect(row).toHaveTextContent("Получено");
  });

  it("keeps the server's order rather than sorting its own", async () => {
    const rows = [
      summary({ id: "a", reference: "SUP-003", subject: "Третье", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      summary({ id: "b", reference: "SUP-001", subject: "Первое", lastActivityAt: "2026-08-09T00:00:00.000Z" }),
      summary({ id: "c", reference: "SUP-002", subject: "Второе", lastActivityAt: "2026-08-05T00:00:00.000Z" }),
    ];
    list.mockResolvedValue({ ok: true, data: rows });
    render(<SupportHub />);
    await screen.findByRole("button", { name: /Третье/ });
    const rendered = screen.getAllByRole("button").filter((b) => /SUP-00/.test(b.textContent ?? ""));
    expect(rendered.map((b) => b.textContent?.match(/SUP-\d+/)?.[0])).toEqual([
      "SUP-003", "SUP-001", "SUP-002",
    ]);
  });

  it.each(STATUSES)("renders %s as «%s»", async (status, label) => {
    list.mockResolvedValue({ ok: true, data: [summary({ status })] });
    render(<SupportHub />);
    const row = await screen.findByRole("button", { name: /Не открывается урок/ });
    expect(row).toHaveTextContent(label);
  });

  it("renders an unmapped status as itself rather than inventing a phrase", async () => {
    list.mockResolvedValue({ ok: true, data: [summary({ status: "some_new_code" })] });
    render(<SupportHub />);
    expect(await screen.findByRole("button", { name: /some_new_code/ })).toBeInTheDocument();
  });

  it("carries a long subject and an unbroken token without a second element", async () => {
    const long = "Очень длинная тема ".repeat(12);
    const token = "A".repeat(400);
    list.mockResolvedValue({ ok: true, data: [summary({ subject: long }), summary({ id: "c2", reference: "SUP-002", subject: token })] });
    render(<SupportHub />);
    expect(await screen.findByRole("button", { name: new RegExp(token.slice(0, 40)) })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("offers a retry a person has to press when the read fails", async () => {
    const user = userEvent.setup();
    list.mockResolvedValueOnce({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    render(<SupportHub />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось связаться с поддержкой");
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue({ ok: true, data: [summary()] });
    await user.click(within(alert).getByRole("button", { name: "Повторить" }));
    await screen.findByRole("button", { name: /Не открывается урок/ });
    expect(list).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------- thread --- */

describe("a case thread", () => {
  const withMessages = full({
    messages: [
      { id: "m1", authorKind: "learner", authorName: "Ученик", body: "Мой вопрос.", createdAt: "2026-08-01T10:05:00.000Z" },
      { id: "m2", authorKind: "staff", authorName: "Мария", body: "Ответ команды.", createdAt: "2026-08-02T09:00:00.000Z" },
    ],
  });

  async function openThread(data = withMessages) {
    const user = userEvent.setup();
    list.mockResolvedValue({ ok: true, data: [summary()] });
    detail.mockResolvedValue({ ok: true, data });
    render(<SupportHub />);
    await user.click(await screen.findByRole("button", { name: /Не открывается урок/ }));
    await screen.findByRole("region", { name: "Обращение" });
    return user;
  }

  it("shows the learner's own message and the staff reply, each attributed", async () => {
    await openThread();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Вы");
    expect(items[0]).toHaveTextContent("Мой вопрос.");
    expect(items[1]).toHaveTextContent("Мария");
    expect(items[1]).toHaveTextContent("Ответ команды.");
    // Attribution is not carried by colour alone: each side is a named line.
    expect(items[1]?.className).toContain("support-hub__message--staff");
  });

  it("replies once even when the reply form itself is submitted again", async () => {
    const user = await openThread();
    reply.mockReturnValue(never());
    await user.type(screen.getByLabelText("Ваш ответ"), "Добавляю детали");
    const form = screen.getByLabelText("Ваш ответ").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(reply).toHaveBeenCalled());
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("replies once however many times the control is pressed", async () => {
    const user = await openThread();
    reply.mockReturnValue(never());
    await user.type(screen.getByLabelText("Ваш ответ"), "Добавляю детали");
    const send = screen.getByRole("button", { name: "Отправить" });
    await user.click(send);
    await user.click(send);
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("keeps the reply text when sending fails", async () => {
    const user = await openThread();
    reply.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    await user.type(screen.getByLabelText("Ваш ответ"), "Важный ответ");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Ваш ответ")).toHaveValue("Важный ответ");
  });

  it("clears the box and refreshes on a successful reply", async () => {
    const user = await openThread();
    reply.mockResolvedValue({ ok: true, data: { id: "m3" } });
    await user.type(screen.getByLabelText("Ваш ответ"), "Готово");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(screen.getByLabelText("Ваш ответ")).toHaveValue(""));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("does not resubmit a reply by itself when the session is gone", async () => {
    const user = await openThread();
    reply.mockResolvedValue({ ok: false, error: makeError("UNAUTHENTICATED", { status: 401 }) });
    await user.type(screen.getByLabelText("Ваш ответ"), "Ответ");
    await user.click(screen.getByRole("button", { name: "Отправить" }));
    await screen.findByRole("alert");
    await new Promise((r) => setTimeout(r, 60));
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it.each(["resolved", "closed"] as const)("offers no reply box on a %s case, and says why", async (status) => {
    await openThread(full({ status, messages: withMessages.messages }));
    expect(screen.queryByLabelText("Ваш ответ")).toBeNull();
    expect(screen.getByText(/Обращение закрыто/)).toBeInTheDocument();
  });

  it("carries a long conversation without losing a message", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      authorKind: (i % 2 === 0 ? "learner" : "staff") as "learner" | "staff",
      authorName: i % 2 === 0 ? "Ученик" : "Мария",
      body: `Сообщение ${i} ` + "текст ".repeat(30),
      createdAt: "2026-08-02T09:00:00.000Z",
    }));
    await openThread(full({ messages: many }));
    expect(screen.getAllByRole("listitem")).toHaveLength(40);
  });

  it("reports a read failure on the thread and keeps the way back", async () => {
    const user = userEvent.setup();
    list.mockResolvedValue({ ok: true, data: [summary()] });
    detail.mockResolvedValue({ ok: false, error: makeError("BACKEND_UNAVAILABLE") });
    render(<SupportHub />);
    await user.click(await screen.findByRole("button", { name: /Не открывается урок/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось связаться с поддержкой");
    expect(screen.getByRole("button", { name: /Ко всем обращениям/ })).toBeInTheDocument();
  });

  it("returns to the register without refetching the case", async () => {
    const user = await openThread();
    await user.click(screen.getByRole("button", { name: /Ко всем обращениям/ }));
    expect(await screen.findByRole("region", { name: "Мои обращения" })).toBeInTheDocument();
  });
});

/**
 * SUPPORT-ERROR-CATEGORY-1 — fixed.
 *
 * `errorText` read `error.code`, which is the code the SERVER put in a response
 * body: null for every client-generated failure and for most HTTP errors. The
 * field that carries the failure kind is `category`, so both specific sentences
 * were unreachable and a dropped connection was reported with the sentence
 * reserved for a failure we cannot name.
 *
 * These cases hold each branch to its own words, and hold the two fields apart
 * so the wrong one cannot quietly come back.
 */
describe("SUPPORT-ERROR-CATEGORY-1", () => {
  async function submitWith(error: ReturnType<typeof makeError>) {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error });
    const view = render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    const alert = await screen.findByRole("alert");
    return { alert, view };
  }

  it.each([
    ["NETWORK_ERROR", "Не удалось связаться с поддержкой"],
    ["BACKEND_UNAVAILABLE", "Не удалось связаться с поддержкой"],
    ["MALFORMED_RESPONSE", "Ответ сервера не распознан"],
  ] as const)("%s reaches its own sentence", async (category, text) => {
    const { alert, view } = await submitWith(makeError(category));
    expect(alert).toHaveTextContent(text);
    view.unmount();
  });

  it.each(["UNAUTHENTICATED", "FORBIDDEN", "RATE_LIMITED", "VALIDATION_ERROR", "UNKNOWN_ERROR"] as const)(
    "%s falls to the generic sentence, as it should",
    async (category) => {
      const { alert, view } = await submitWith(makeError(category));
      expect(alert).toHaveTextContent("Что-то пошло не так");
      view.unmount();
    },
  );

  it("reads the category, and a stray code cannot stand in for it", async () => {
    /* A server body could carry `code: "NETWORK_ERROR"` on an error whose real
       category is something else. The code must not decide the sentence. */
    const { alert, view } = await submitWith(
      makeError("UNKNOWN_ERROR", { code: "NETWORK_ERROR" }),
    );
    expect(alert).toHaveTextContent("Что-то пошло не так");
    view.unmount();

    // And the reverse: the right category wins even with no code at all.
    const second = await submitWith(makeError("NETWORK_ERROR"));
    expect(second.alert).toHaveTextContent("Не удалось связаться с поддержкой");
    second.view.unmount();
  });

  it("leaves the flood-control sentence to the status, not the category", async () => {
    const { alert } = await submitWith(makeError("CONFLICT", { status: 409 }));
    expect(alert).toHaveTextContent("У вас уже есть открытые обращения");
  });

  it("keeps auth loss on its own behaviour: a message, and no retry of its own", async () => {
    const user = userEvent.setup();
    open.mockResolvedValue({ ok: false, error: makeError("UNAUTHENTICATED", { status: 401 }) });
    const { container } = render(<SupportHub />);
    await user.type(screen.getByLabelText("Тема"), "Тема сессии");
    await user.type(screen.getByLabelText("Опишите подробнее"), "Описание сессии");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Что-то пошло не так");
    // Exactly one announcement, the typed text intact, and no second write.
    expect(container.querySelectorAll("[role=alert]")).toHaveLength(1);
    expect(screen.getByLabelText("Тема")).toHaveValue("Тема сессии");
    expect(screen.getByLabelText("Опишите подробнее")).toHaveValue("Описание сессии");
    await new Promise((r) => setTimeout(r, 60));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
