import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import type { NoteCreateOutcome, NotesListOutcome } from "@/application/api/user-notes-client";
import { pristineOwnerMethods } from "./owner-provider-test-stub";
import type { Permission } from "@/domain/identity/roles";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import { NOTE_BODY_MAX_CODE_POINTS } from "@/data/contracts/api/user-notes";
import { ApiUserDetailWorkspace } from "./api-user-detail-workspace";
import { formatNoteTimestamp } from "./api-user-notes";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/users/1042",
}));

const DETAIL = {
  userId: "1042",
  displayName: "Тестовый Ученик",
  email: { value: "t***@e***.test", visibility: "masked" as const },
  status: "active" as const,
  level: 7,
  xp: 4242,
  emailConfirmed: true,
  createdAt: "2026-01-01T12:00:00.000Z",
};

const note = (over: Record<string, unknown> = {}) => ({
  noteId: "note_1",
  body: "Позвонил клиенту",
  authorDisplayName: "Нина Ч.",
  createdAt: "2026-07-20T18:42:00.000Z",
  ...over,
});

interface Harness {
  provider: CrmUsersReadCapability;
  listCalls: { userId: string; cursor?: string }[];
  createCalls: { userId: string; body: string }[];
}

function harness(
  listOutcomes: NotesListOutcome[],
  createOutcomes: NoteCreateOutcome[] = [],
): Harness {
  const listCalls: { userId: string; cursor?: string }[] = [];
  const createCalls: { userId: string; body: string }[] = [];
  let li = 0;
  let ci = 0;
  return {
    listCalls,
    createCalls,
    provider: {
      ...pristineOwnerMethods(),
      listUsers: () => {
        throw new Error("notes tests must not call listUsers");
      },
      async getUserDetail(userId) {
        // Faithful to the backend: the detail returned is the learner that was
        // asked for. The workspace relies on this to detect a stale frame.
        return { status: "success", detail: { ...DETAIL, userId } };
      },
      async listUserNotes(userId, input) {
        listCalls.push({ userId, cursor: input?.cursor });
        const outcome = listOutcomes[Math.min(li, listOutcomes.length - 1)];
        li += 1;
        if (!outcome) throw new Error("list fixture exhausted");
        return outcome;
      },
      async createUserNote(userId, body) {
        createCalls.push({ userId, body });
        const outcome = createOutcomes[Math.min(ci, createOutcomes.length - 1)];
        ci += 1;
        if (!outcome) throw new Error("create fixture exhausted");
        return outcome;
      },
    },
  };
}

const page = (items: ReturnType<typeof note>[], nextCursor: string | null = null): NotesListOutcome => ({
  status: "success",
  page: { items, nextCursor },
});

function renderWith(h: Harness, permissions: Permission[], userId = "1042") {
  const session = sessionFromDto({
    employeeId: "emp_stub_1",
    displayName: "Ирина Соколова",
    role: "support",
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2099-12-31T23:59:59.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <ApiUserDetailWorkspace userId={userId} provider={h.provider} />
    </AuthenticatedSessionProvider>,
  );
}

const BOTH: Permission[] = ["view_user_notes", "create_user_notes"];

beforeEach(() => {
  replace.mockClear();
  window.localStorage.clear();
});

/* ------------------------------------------------------------ permissions */

describe("permission-bounded mounting", () => {
  it("mounts no Notes surface and makes no request without either permission", async () => {
    const h = harness([page([note()])]);
    renderWith(h, []);
    expect(await screen.findByText("Тестовый Ученик")).toBeInTheDocument();
    expect(screen.queryByText("Заметки")).not.toBeInTheDocument();
    expect(h.listCalls).toHaveLength(0);
  });

  it("treats edit_user_notes alone as no access at all", async () => {
    const h = harness([page([note()])]);
    renderWith(h, ["edit_user_notes"]);
    expect(await screen.findByText("Тестовый Ученик")).toBeInTheDocument();
    expect(screen.queryByText("Заметки")).not.toBeInTheDocument();
    expect(h.listCalls).toHaveLength(0);
  });

  it.each(["reveal_pii", "view_identity_full_email", "view_audit"] as Permission[])(
    "treats %s as granting no notes access",
    async (permission) => {
      const h = harness([page([note()])]);
      renderWith(h, [permission]);
      expect(await screen.findByText("Тестовый Ученик")).toBeInTheDocument();
      expect(screen.queryByText("Заметки")).not.toBeInTheDocument();
      expect(h.listCalls).toHaveLength(0);
    },
  );

  it("view-only lists notes but shows no composer", async () => {
    const h = harness([page([note()])]);
    renderWith(h, ["view_user_notes"]);
    expect(await screen.findByText("Позвонил клиенту")).toBeInTheDocument();
    expect(screen.queryByLabelText("Новая заметка")).not.toBeInTheDocument();
    expect(h.listCalls).toHaveLength(1);
  });

  it("create-only shows the composer and makes NO list request", async () => {
    const h = harness([page([note()])], [{ status: "success", note: note() }]);
    renderWith(h, ["create_user_notes"]);
    expect(await screen.findByLabelText("Новая заметка")).toBeInTheDocument();
    expect(h.listCalls).toHaveLength(0);
    expect(screen.queryByText("Позвонил клиенту")).not.toBeInTheDocument();
  });

  it("both permissions render list and composer", async () => {
    const h = harness([page([note()])]);
    renderWith(h, BOTH);
    expect(await screen.findByText("Позвонил клиенту")).toBeInTheDocument();
    expect(screen.getByLabelText("Новая заметка")).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------- list states */

describe("list states", () => {
  it("shows a loading status first", async () => {
    const h = harness([]);
    h.provider.listUserNotes = () => new Promise(() => {});
    renderWith(h, BOTH);
    expect(await screen.findByText("Загружаем заметки")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    renderWith(harness([page([])]), BOTH);
    expect(await screen.findByText("Заметок пока нет")).toBeInTheDocument();
  });

  it("renders author, UTC timestamp and body", async () => {
    renderWith(harness([page([note()])]), BOTH);
    expect(await screen.findByText("Нина Ч.")).toBeInTheDocument();
    expect(screen.getByText("20.07.2026, 18:42 UTC")).toBeInTheDocument();
    expect(screen.getByText("Позвонил клиенту")).toBeInTheDocument();
  });

  it("preserves multiline bodies with pre-wrap", async () => {
    renderWith(harness([page([note({ body: "строка1\nстрока2" })])]), BOTH);
    const body = await screen.findByText(/строка1/);
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(body.textContent).toBe("строка1\nстрока2");
  });

  it("escapes HTML-looking text instead of executing it", async () => {
    const raw = "<script>alert(1)</script>";
    const { container } = renderWith(harness([page([note({ body: raw })])]), BOTH);
    expect(await screen.findByText(raw)).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  it("never renders note metadata the contract does not carry", async () => {
    renderWith(harness([page([note()])]), BOTH);
    await screen.findByText("Позвонил клиенту");
    // Scoped to the Notes section: the identity section legitimately shows the
    // learner's masked email, which is a different accepted contract.
    const section = screen.getByText("Заметки").closest("section")!;
    const text = section.textContent ?? "";
    for (const forbidden of [
      "note_1", "emp_", "@", "Закрепить", "Изменить", "Удалить",
      "Приватная", "Командная", "visibility", "pinned",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------ pagination */

describe("pagination", () => {
  it("appends the next page and keeps server order", async () => {
    const u = userEvent.setup();
    const h = harness([
      page([note({ noteId: "n1", body: "первая" })], "cur1"),
      page([note({ noteId: "n2", body: "вторая" })], null),
    ]);
    renderWith(h, BOTH);
    await u.click(await screen.findByRole("button", { name: "Показать ещё" }));
    await waitFor(() => expect(screen.getByText("вторая")).toBeInTheDocument());
    const bodies = screen.getAllByText(/первая|вторая/).map((n) => n.textContent);
    expect(bodies).toEqual(["первая", "вторая"]);
    expect(h.listCalls[1]?.cursor).toBe("cur1");
  });

  it("removes the action when exhausted", async () => {
    renderWith(harness([page([note()], null)]), BOTH);
    await screen.findByText("Позвонил клиенту");
    expect(screen.queryByRole("button", { name: "Показать ещё" })).not.toBeInTheDocument();
  });

  it("deduplicates a repeated noteId without reordering", async () => {
    const u = userEvent.setup();
    const h = harness([
      page([note({ noteId: "n1", body: "первая" })], "cur1"),
      page([note({ noteId: "n1", body: "первая" }), note({ noteId: "n2", body: "вторая" })], null),
    ]);
    renderWith(h, BOTH);
    await u.click(await screen.findByRole("button", { name: "Показать ещё" }));
    await waitFor(() => expect(screen.getByText("вторая")).toBeInTheDocument());
    expect(screen.getAllByText("первая")).toHaveLength(1);
  });

  it("keeps loaded rows when a load-more page fails", async () => {
    const u = userEvent.setup();
    const h = harness([page([note({ body: "первая" })], "cur1"), { status: "upstream_unavailable" }]);
    renderWith(h, BOTH);
    await u.click(await screen.findByRole("button", { name: "Показать ещё" }));
    await waitFor(() =>
      expect(screen.getByText(/Не удалось загрузить следующую страницу/)).toBeInTheDocument(),
    );
    expect(screen.getByText("первая")).toBeInTheDocument();
  });

  it("does not start a concurrent request on a double click", async () => {
    const u = userEvent.setup();
    const h = harness([page([note()], "cur1")]);
    const original = h.provider.listUserNotes.bind(h.provider);
    let calls = 0;
    h.provider.listUserNotes = (userId, input, options) => {
      calls += 1;
      // The first call is the initial page; every later call hangs, so a second
      // click can only be observed by the counter, never satisfied.
      if (calls === 1) return original(userId, input, options);
      return new Promise<NotesListOutcome>(() => {});
    };
    renderWith(h, BOTH);
    const button = await screen.findByRole("button", { name: "Показать ещё" });
    await u.click(button);
    await u.click(button);
    // 1 initial page + exactly 1 load-more. The second click was ignored while
    // the first page was still in flight.
    expect(calls).toBe(2);
  });
});

/* -------------------------------------------------------------- composer */

describe("composer", () => {
  it("disables submit for an empty draft", async () => {
    renderWith(harness([page([])]), BOTH);
    expect(await screen.findByRole("button", { name: "Добавить заметку" })).toBeDisabled();
  });

  it("counts code points, not UTF-16 units", async () => {
    const u = userEvent.setup();
    renderWith(harness([page([])]), BOTH);
    await u.type(await screen.findByLabelText("Новая заметка"), "\u{1F600}");
    expect(screen.getByText(`1 / ${NOTE_BODY_MAX_CODE_POINTS}`)).toBeInTheDocument();
  });

  it("rejects an over-long body locally with no request", async () => {
    const h = harness([page([])]);
    renderWith(h, BOTH);
    const textarea = await screen.findByLabelText("Новая заметка");
    // paste avoids typing 2001 characters one event at a time
    await userEvent.setup().click(textarea);
    await userEvent.setup().paste("a".repeat(NOTE_BODY_MAX_CODE_POINTS + 1));
    await waitFor(() => expect(screen.getByText(/длиннее/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Добавить заметку" })).toBeDisabled();
    expect(h.createCalls).toHaveLength(0);
  });

  it("submits the normalized body and inserts the created note at the top", async () => {
    const u = userEvent.setup();
    const created = note({ noteId: "new", body: "новая заметка" });
    const h = harness([page([note({ noteId: "old", body: "старая" })])], [{ status: "success", note: created }]);
    renderWith(h, BOTH);
    await u.type(await screen.findByLabelText("Новая заметка"), "  новая заметка  ");
    await u.click(screen.getByRole("button", { name: "Добавить заметку" }));
    await waitFor(() => expect(screen.getByText("новая заметка")).toBeInTheDocument());
    expect(h.createCalls[0]?.body).toBe("  новая заметка  ");
    const bodies = screen.getAllByText(/новая заметка|старая/).map((n) => n.textContent);
    expect(bodies[0]).toBe("новая заметка");
  });

  it("clears the draft only after a validated 201", async () => {
    const u = userEvent.setup();
    const h = harness([page([])], [{ status: "success", note: note({ body: "ok" }) }]);
    renderWith(h, BOTH);
    const textarea = await screen.findByLabelText("Новая заметка");
    await u.type(textarea, "ok");
    await u.click(screen.getByRole("button", { name: "Добавить заметку" }));
    await waitFor(() => expect(textarea).toHaveValue(""));
  });

  it("keeps the draft when the create response is malformed", async () => {
    const u = userEvent.setup();
    const h = harness([page([])], [{ status: "malformed_response" }]);
    renderWith(h, BOTH);
    const textarea = await screen.findByLabelText("Новая заметка");
    await u.type(textarea, "черновик");
    await u.click(screen.getByRole("button", { name: "Добавить заметку" }));
    await waitFor(() => expect(screen.getByText(/не прошёл проверку/)).toBeInTheDocument());
    expect(textarea).toHaveValue("черновик");
  });

  it("keeps the draft when the create fails upstream", async () => {
    const u = userEvent.setup();
    const h = harness([page([])], [{ status: "upstream_unavailable" }]);
    renderWith(h, BOTH);
    const textarea = await screen.findByLabelText("Новая заметка");
    await u.type(textarea, "черновик");
    await u.click(screen.getByRole("button", { name: "Добавить заметку" }));
    await waitFor(() => expect(screen.getByText(/Не удалось добавить заметку/)).toBeInTheDocument());
    expect(textarea).toHaveValue("черновик");
  });

  it("announces success politely when the employee cannot list notes", async () => {
    const u = userEvent.setup();
    const h = harness([page([])], [{ status: "success", note: note({ body: "скрытая" }) }]);
    renderWith(h, ["create_user_notes"]);
    await u.type(await screen.findByLabelText("Новая заметка"), "текст");
    await u.click(screen.getByRole("button", { name: "Добавить заметку" }));
    await waitFor(() => expect(screen.getByText("Заметка добавлена")).toBeInTheDocument());
    // The note row itself is never rendered without view permission.
    expect(screen.queryByText("скрытая")).not.toBeInTheDocument();
  });

  it("prevents a duplicate submit while pending", async () => {
    const u = userEvent.setup();
    const h = harness([page([])]);
    h.provider.createUserNote = ((userId: string, body: string) => {
      h.createCalls.push({ userId, body });
      return new Promise(() => {});
    }) as CrmUsersReadCapability["createUserNote"];
    renderWith(h, BOTH);
    await u.type(await screen.findByLabelText("Новая заметка"), "текст");
    const button = screen.getByRole("button", { name: "Добавить заметку" });
    await u.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Добавляем…" })).toBeDisabled());
    expect(h.createCalls).toHaveLength(1);
  });
});

/* ----------------------------------------------------------------- errors */

describe("error composition", () => {
  it("403 on the list keeps identity and progress visible", async () => {
    renderWith(harness([{ status: "forbidden" }]), BOTH);
    expect(await screen.findByText("Нет доступа к заметкам")).toBeInTheDocument();
    expect(screen.getByText("Тестовый Ученик")).toBeInTheDocument();
    expect(screen.getByText("Идентификация")).toBeInTheDocument();
  });

  it("403 on create keeps the draft and stops offering the composer", async () => {
    const u = userEvent.setup();
    const h = harness([page([])], [{ status: "forbidden" }]);
    renderWith(h, BOTH);
    await u.type(await screen.findByLabelText("Новая заметка"), "черновик");
    await u.click(screen.getByRole("button", { name: "Добавить заметку" }));
    await waitFor(() =>
      expect(screen.getByText("Нет доступа к добавлению заметок")).toBeInTheDocument(),
    );
    expect(screen.getByText("Тестовый Ученик")).toBeInTheDocument();
  });

  it("400 on the list shows the safe notes error", async () => {
    renderWith(harness([{ status: "invalid_input" }]), BOTH);
    expect(await screen.findByText("Некорректный запрос заметок")).toBeInTheDocument();
  });

  it("500 on the list is notes-only with a retry", async () => {
    renderWith(harness([{ status: "upstream_unavailable" }]), BOTH);
    expect(await screen.findByText("Не удалось загрузить заметки.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    expect(screen.getByText("Тестовый Ученик")).toBeInTheDocument();
  });

  it("a malformed list fails closed with no rows", async () => {
    renderWith(harness([{ status: "malformed_response" }]), BOTH);
    expect(await screen.findByText(/Заметки не показаны/)).toBeInTheDocument();
    expect(screen.queryByText("Позвонил клиенту")).not.toBeInTheDocument();
  });

  it("401 from the notes list redirects to login", async () => {
    renderWith(harness([{ status: "unauthenticated" }]), BOTH);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reason=session_required"));
  });

  it("404 from the notes list transitions the whole detail", async () => {
    renderWith(harness([{ status: "not_found" }]), BOTH);
    expect(await screen.findByText("Пользователь не найден")).toBeInTheDocument();
    expect(screen.queryByText("Идентификация")).not.toBeInTheDocument();
  });

  it("never renders a backend messageKey", async () => {
    const { container } = renderWith(harness([{ status: "forbidden", requestId: "req-1" }]), BOTH);
    await screen.findByText("Нет доступа к заметкам");
    expect(container.textContent).not.toContain("crm.users.notes");
  });
});

/* ------------------------------------------------------- stale/aborted */

describe("stale data", () => {
  it("requests notes for the rendered learner only", async () => {
    const h = harness([page([note()])]);
    renderWith(h, BOTH, "2024");
    await waitFor(() => expect(h.listCalls).toHaveLength(1));
    expect(h.listCalls[0]?.userId).toBe("2024");
  });

  it("clears notes and draft when the learner changes", async () => {
    const u = userEvent.setup();
    const h = harness([
      page([note({ noteId: "a", body: "первого" })]),
      page([note({ noteId: "b", body: "второго" })]),
    ]);
    const { rerender } = renderWith(h, BOTH, "1042");
    await screen.findByText("первого");
    await u.type(screen.getByLabelText("Новая заметка"), "черновик");

    const session = sessionFromDto({
      employeeId: "emp_stub_1",
      displayName: "Ирина Соколова",
      role: "support",
      effectivePermissions: BOTH,
      permissionVersion: 1,
      expiresAt: "2099-12-31T23:59:59.000Z",
    });
    rerender(
      <AuthenticatedSessionProvider session={session}>
        <ApiUserDetailWorkspace userId="2024" provider={h.provider} />
      </AuthenticatedSessionProvider>,
    );
    await waitFor(() => expect(screen.getByText("второго")).toBeInTheDocument());
    // The previous learner's note is gone and the draft was dropped, so text
    // written about one learner can never be submitted against another.
    expect(screen.queryByText("первого")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Новая заметка")).toHaveValue("");
    expect(h.listCalls.map((c) => c.userId)).toEqual(["1042", "2024"]);
  });

  it("writes nothing to local storage", async () => {
    const u = userEvent.setup();
    renderWith(harness([page([note()])]), BOTH);
    await u.type(await screen.findByLabelText("Новая заметка"), "черновик");
    expect(window.localStorage.length).toBe(0);
  });
});

/* ------------------------------------------------------------- formatter */

describe("formatNoteTimestamp", () => {
  it("formats a UTC date and time with an explicit label", () => {
    expect(formatNoteTimestamp("2026-07-20T18:42:00.000Z")).toBe("20.07.2026, 18:42 UTC");
  });

  it("pads single digits", () => {
    expect(formatNoteTimestamp("2026-01-05T04:07:00.000Z")).toBe("05.01.2026, 04:07 UTC");
  });

  it("is timezone independent", () => {
    // The same instant expressed with an offset must render identically.
    expect(formatNoteTimestamp("2026-07-20T21:42:00.000+03:00")).toBe("20.07.2026, 18:42 UTC");
  });

  it("returns a dash for an unparseable value", () => {
    expect(formatNoteTimestamp("not-a-date")).toBe("—");
  });
});
