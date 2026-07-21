import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsersOutcome } from "@/application/api/users-client";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import { throwingOwnerMethods } from "./owner-provider-test-stub";
import type { Permission } from "@/domain/identity/roles";
import { sessionFromDto } from "@/domain/identity/session";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { resetClientRuntimeMode, setClientRuntimeMode } from "@/config/client-runtime-mode";
import { ApiUsersWorkspace, formatRegisteredAt } from "./api-users-workspace";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push, refresh: vi.fn() }),
  usePathname: () => "/users",
}));

function user(index: number, over: Partial<Record<string, unknown>> = {}) {
  const n = String(index).padStart(2, "0");
  return {
    userId: String(1000 + index),
    displayName: `Пользователь ${n}`,
    email: { value: `l***@e***.test`, visibility: "masked" as const },
    status: "active" as const,
    level: index + 1,
    emailConfirmed: index % 2 === 0,
    createdAt: `2026-01-0${(index % 9) + 1}T09:15:00.000Z`,
    // Owner is a required part of the strict DTO; default to unassigned so
    // existing rows render «Не назначен» unless a test overrides it.
    owner: null as { displayName: string } | null,
    ...over,
  };
}

function providerFor(outcomes: UsersOutcome[]): CrmUsersReadCapability & { calls: unknown[] } {
  const calls: unknown[] = [];
  let index = 0;
  return {
    calls,
    ...throwingOwnerMethods(),
    // The list workspace must never call the detail capability.
    getUserDetail: () => {
      throw new Error("listUsers tests must not call getUserDetail");
    },
    listUserNotes: () => {
      throw new Error("this test must not call listUserNotes");
    },
    createUserNote: () => {
      throw new Error("this test must not call createUserNote");
    },
    async listUsers(input) {
      calls.push(input);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      // The fixture list is never empty, so this is a type narrowing only.
      if (!outcome) throw new Error("provider fixture exhausted");
      return outcome;
    },
  };
}

const ok = (items: ReturnType<typeof user>[], nextCursor: string | null = null): UsersOutcome => ({
  status: "success",
  page: { items, nextCursor },
});

function renderWorkspace(
  provider: CrmUsersReadCapability,
  permissions: Permission[] = [],
  role: "crm_admin" | "support" = "support",
) {
  const session = sessionFromDto({
    employeeId: "emp_stub_1",
    displayName: "Ирина Соколова",
    role,
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2099-12-31T23:59:59.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <ApiUsersWorkspace provider={provider} />
    </AuthenticatedSessionProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  setClientRuntimeMode("api");
  window.localStorage.clear();
  // Each test starts from the canonical /users URL (no owner parameter).
  window.history.replaceState(null, "", "/users");
});
afterEach(() => {
  resetClientRuntimeMode();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/users");
});

describe("states", () => {
  it("shows a loading status first", async () => {
    const provider: CrmUsersReadCapability = {
      ...throwingOwnerMethods(),
      listUsers: () => new Promise(() => {}),
      getUserDetail: () => {
        throw new Error("listUsers tests must not call getUserDetail");
      },
      listUserNotes: () => {
        throw new Error("this test must not call listUserNotes");
      },
      createUserNote: () => {
        throw new Error("this test must not call createUserNote");
      },
    };
    renderWorkspace(provider);
    expect(await screen.findByText("Загружаем список пользователей")).toBeInTheDocument();
  });

  it("renders a populated list", async () => {
    renderWorkspace(providerFor([ok([user(0), user(1)])]));
    expect(await screen.findByText("Пользователь 00")).toBeInTheDocument();
    expect(screen.getByText("Пользователь 01")).toBeInTheDocument();
  });

  it("renders an empty state", async () => {
    renderWorkspace(providerFor([ok([])]));
    expect(await screen.findByText("Пользователи не найдены.")).toBeInTheDocument();
  });

  it("renders status labels in Russian", async () => {
    renderWorkspace(providerFor([ok([user(0), user(1, { status: "blocked" })])]));
    expect(await screen.findByText("Активен")).toBeInTheDocument();
    expect(screen.getByText("Заблокирован")).toBeInTheDocument();
  });

  it("renders email confirmation labels", async () => {
    renderWorkspace(providerFor([ok([user(0, { emailConfirmed: true }), user(1, { emailConfirmed: false })])]));
    expect(await screen.findByText("Подтверждён")).toBeInTheDocument();
    expect(screen.getByText("Не подтверждён")).toBeInTheDocument();
  });

  it("renders a masked email as given, and a full email when the backend sent one", async () => {
    renderWorkspace(
      providerFor([ok([user(0), user(1, { email: { value: "lena@example.test", visibility: "full" } })])]),
    );
    expect(await screen.findByText("l***@e***.test")).toBeInTheDocument();
    expect(screen.getByText("lena@example.test")).toBeInTheDocument();
  });

  it("formats the registration date deterministically", () => {
    expect(formatRegisteredAt("2026-01-04T09:15:00.000Z")).toBe("04.01.2026");
    expect(formatRegisteredAt("not-a-date")).toBe("—");
  });
});

describe("columns are limited to what the backend can prove", () => {
  it("shows exactly the seven contract columns, with Ответственный before Регистрация", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Имя",
      "Email",
      "Статус",
      "Уровень",
      "Email подтверждён",
      "Ответственный",
      "Регистрация",
    ]);
  });

  it("shows no mock owner label, notes, financial, activity or recommendation column", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    const html = document.body.innerHTML;
    // «Владелец» is the mock owner label; the production column is «Ответственный».
    for (const banned of ["Владелец", "Заметки", "Баланс", "Депозит", "Активность", "Рекомендация", "Приоритет", "Сегмент", "$"]) {
      expect(html, `must not render ${banned}`).not.toContain(banned);
    }
  });

  it("never displays the opaque userId as content", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    // It appears in the detail link's href (navigation), never as visible text.
    expect(document.body.textContent ?? "").not.toContain("1000");
  });

  it("gives each row exactly one accessible link to the production detail route", async () => {
    renderWorkspace(providerFor([ok([user(0), user(1)])]));
    await screen.findByText("Пользователь 00");
    const table = screen.getByRole("table");

    // One link per row, named for the learner, pointing at the production
    // detail route — not a click-only div, and not the mock User 360 shell.
    const links = within(table).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAccessibleName("Пользователь 00");
    expect(links[0]).toHaveAttribute("href", "/users/1000");
    expect(links[1]).toHaveAttribute("href", "/users/1001");
  });

  it("uses the backend id verbatim as a string, never a parsed number", async () => {
    renderWorkspace(providerFor([ok([user(0, { userId: "0071" })])]));
    await screen.findByText("Пользователь 00");
    const link = within(screen.getByRole("table")).getAllByRole("link")[0];
    // "0071" must survive intact — a Number() round-trip would yield "71".
    expect(link).toHaveAttribute("href", "/users/0071");
  });

  it("shows no fake total and no 'страница X из Y'", async () => {
    renderWorkspace(providerFor([ok([user(0)], "c2")]));
    await screen.findByText("Пользователь 00");
    expect(screen.getByText("Страница 1")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/из\s+\d/);
    expect(document.body.innerHTML).not.toContain("Всего");
  });

  it("offers no sorting control and no mock filters", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    const html = document.body.innerHTML;
    for (const banned of ["Сортировка", "Фильтры", "Колонки", "Сбросить фильтры"]) {
      expect(html).not.toContain(banned);
    }
  });
});

describe("cursor pagination", () => {
  it("moves to the next page using nextCursor", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)], "cursor-2"), ok([user(1)], null)]);
    renderWorkspace(provider);

    await screen.findByText("Пользователь 00");
    await u.click(screen.getByRole("button", { name: "Следующая" }));

    expect(await screen.findByText("Пользователь 01")).toBeInTheDocument();
    expect((provider.calls[1] as { cursor?: string }).cursor).toBe("cursor-2");
  });

  it("goes back through client cursor history", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)], "cursor-2"), ok([user(1)], null), ok([user(0)], "cursor-2")]);
    renderWorkspace(provider);

    await screen.findByText("Пользователь 00");
    await u.click(screen.getByRole("button", { name: "Следующая" }));
    await screen.findByText("Пользователь 01");
    await u.click(screen.getByRole("button", { name: "Предыдущая" }));

    expect(await screen.findByText("Пользователь 00")).toBeInTheDocument();
    // Back to the first page means no cursor at all, not a decoded one.
    expect((provider.calls[2] as { cursor?: string | null }).cursor).toBeFalsy();
  });

  it("disables Previous on the first page and Next on the last", async () => {
    renderWorkspace(providerFor([ok([user(0)], null)]));
    await screen.findByText("Пользователь 00");
    expect(screen.getByRole("button", { name: "Предыдущая" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Следующая" })).toBeDisabled();
  });

  it("never decodes or displays a cursor", async () => {
    renderWorkspace(providerFor([ok([user(0)], "eyJ2IjoxfQ")]));
    await screen.findByText("Пользователь 00");
    expect(document.body.innerHTML).not.toContain("eyJ2IjoxfQ");
  });
});

describe("search", () => {
  it("submits a trimmed search and resets pagination", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)], "cursor-2"), ok([user(1)], null), ok([user(2)], null)]);
    renderWorkspace(provider);

    await screen.findByText("Пользователь 00");
    await u.click(screen.getByRole("button", { name: "Следующая" }));
    await screen.findByText("Пользователь 01");

    await u.type(screen.getByLabelText("Имя"), "  Лена  ");
    await u.click(screen.getByRole("button", { name: "Найти" }));

    await waitFor(() => expect(provider.calls.length).toBe(3));
    const last = provider.calls[2] as { search?: string; cursor?: string | null };
    expect(last.search).toBe("Лена");
    // A new search invalidates the cursor history.
    expect(last.cursor).toBeFalsy();
  });

  it("clearing the search returns to the unfiltered first page", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)]), ok([user(1)]), ok([user(0)])]);
    renderWorkspace(provider);

    await screen.findByText("Пользователь 00");
    await u.type(screen.getByLabelText("Имя"), "Лена");
    await u.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(provider.calls.length).toBe(2));

    await u.click(screen.getByRole("button", { name: "Сбросить" }));
    await waitFor(() => expect(provider.calls.length).toBe(3));
    expect((provider.calls[2] as { search?: string }).search).toBeUndefined();
  });
});

describe("email-search permission", () => {
  it("labels the field 'Имя' without view_identity_full_email", async () => {
    renderWorkspace(providerFor([ok([user(0)])]), []);
    await screen.findByText("Пользователь 00");
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя или email")).not.toBeInTheDocument();
  });

  it("labels the field 'Имя или email' with the permission", async () => {
    renderWorkspace(providerFor([ok([user(0)])]), ["view_identity_full_email"]);
    await screen.findByText("Пользователь 00");
    expect(screen.getByLabelText("Имя или email")).toBeInTheDocument();
  });

  it("does not send an email-shaped query without the permission", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)])]);
    renderWorkspace(provider, []);

    await screen.findByText("Пользователь 00");
    await u.type(screen.getByLabelText("Имя"), "lena@example.test");
    await u.click(screen.getByRole("button", { name: "Найти" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Поиск по email недоступен для вашей роли",
    );
    // Exactly the initial load — the request was never made.
    expect(provider.calls).toHaveLength(1);
  });

  it("sends an email query when the permission is present", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)]), ok([user(1)])]);
    renderWorkspace(provider, ["view_identity_full_email"]);

    await screen.findByText("Пользователь 00");
    await u.type(screen.getByLabelText("Имя или email"), "lena@example.test");
    await u.click(screen.getByRole("button", { name: "Найти" }));

    await waitFor(() => expect(provider.calls.length).toBe(2));
    expect((provider.calls[1] as { search?: string }).search).toBe("lena@example.test");
  });

  it("role crm_admin with empty effectivePermissions gets no email-search affordance", async () => {
    // The backend's answer wins; the role never re-grants it locally.
    renderWorkspace(providerFor([ok([user(0)])]), [], "crm_admin");
    await screen.findByText("Пользователь 00");
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
    expect(screen.queryByLabelText("Имя или email")).not.toBeInTheDocument();
  });

  it("a stored mock crm_admin role cannot unlock email search", async () => {
    window.localStorage.setItem("ata-crm.mock-role.v1", "crm_admin");
    renderWorkspace(providerFor([ok([user(0)])]), [], "support");
    await screen.findByText("Пользователь 00");
    expect(screen.getByLabelText("Имя")).toBeInTheDocument();
  });
});

describe("error behaviour", () => {
  it("401 redirects to the exact login URL and shows no rows", async () => {
    renderWorkspace(providerFor([{ status: "unauthenticated" }]));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reason=session_required"));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not render cached rows after a later 401", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)], "c2"), { status: "unauthenticated" }]);
    renderWorkspace(provider);

    await screen.findByText("Пользователь 00");
    await u.click(screen.getByRole("button", { name: "Следующая" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reason=session_required"));
    expect(screen.queryByText("Пользователь 00")).not.toBeInTheDocument();
  });

  it("403 renders a safe state with an optional requestId", async () => {
    renderWorkspace(providerFor([{ status: "forbidden", requestId: "req_403" }]));
    expect(await screen.findByText("Нет доступа к данным CRM")).toBeInTheDocument();
    expect(screen.getByText("req_403")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("400 renders a safe input error and keeps the search form", async () => {
    renderWorkspace(providerFor([{ status: "invalid_input", requestId: "req_400" }]));
    expect(await screen.findByText("Некорректный запрос")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Найти" })).toBeInTheDocument();
  });

  it("500 renders a retry state and retry recovers", async () => {
    const u = userEvent.setup();
    renderWorkspace(providerFor([{ status: "upstream_unavailable" }, ok([user(0)])]));

    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Пользователь 00")).toBeInTheDocument();
  });

  it("malformed 200 fails closed with no partial rendering", async () => {
    renderWorkspace(providerFor([{ status: "malformed_response" }]));
    expect(await screen.findByText("Некорректный ответ сервиса")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows no raw diagnostics in any error state", async () => {
    renderWorkspace(providerFor([{ status: "upstream_unavailable" }]));
    await screen.findByText("Сервис недоступен");
    const html = document.body.innerHTML;
    for (const leak of ["ECONNREFUSED", "TypeError", "Failed to fetch", "127.0.0.1", "crm.users.", "prisma", "SELECT"]) {
      expect(html).not.toContain(leak);
    }
  });

  it("prevents a duplicate concurrent retry", async () => {
    const u = userEvent.setup();
    let calls = 0;
    const provider: CrmUsersReadCapability = {
      ...throwingOwnerMethods(),
      getUserDetail: () => {
        throw new Error("listUsers tests must not call getUserDetail");
      },
      listUserNotes: () => {
        throw new Error("this test must not call listUserNotes");
      },
      createUserNote: () => {
        throw new Error("this test must not call createUserNote");
      },
      async listUsers() {
        calls += 1;
        if (calls === 1) return { status: "upstream_unavailable" };
        return new Promise(() => {});
      },
    };
    renderWorkspace(provider);

    const button = await screen.findByRole("button", { name: "Повторить" });
    await u.click(button);
    await u.click(button).catch(() => {});
    await u.click(button).catch(() => {});

    expect(calls).toBe(2);
  });
});

const ownerSelect = () => screen.getByLabelText("Ответственный") as HTMLSelectElement;

describe("owner column", () => {
  it("renders the owner displayName for an assigned learner", async () => {
    renderWorkspace(providerFor([ok([user(0, { owner: { displayName: "Мария Куратор" } })])]));
    expect(await screen.findByText("Мария Куратор")).toBeInTheDocument();
  });

  it("renders «Не назначен» for a null owner", async () => {
    renderWorkspace(providerFor([ok([user(0, { owner: null })])]));
    await screen.findByText("Пользователь 00");
    expect(screen.getByText("Не назначен")).toBeInTheDocument();
  });

  it("keeps a long owner name fully available through title", async () => {
    const long = "Александра-Валентина Оператор-Куратор Длинноимённая-Двойная";
    renderWorkspace(providerFor([ok([user(0, { owner: { displayName: long } })])]));
    const cell = await screen.findByText(long);
    expect(cell).toHaveAttribute("title", long);
  });

  it("shows no owner employeeId, ownerVersion, StaffRole, email or timestamp in the cell", async () => {
    renderWorkspace(
      providerFor([
        ok([
          // A hostile row: extra keys the component must never read or render.
          user(0, {
            owner: {
              displayName: "Мария Куратор",
              employeeId: "emp_leak",
              ownerVersion: 4,
              staffRole: "support",
              email: "leak@example.test",
            } as never,
          }),
        ]),
      ]),
    );
    await screen.findByText("Мария Куратор");
    const html = document.body.innerHTML;
    for (const secret of ["emp_leak", "ownerVersion", "staffRole", "leak@example.test", "support"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });
});

describe("owner filter control", () => {
  it("offers exactly the three labels and no assigned option", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    const options = within(ownerSelect()).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Все", "Мои", "Без ответственного"]);
    expect(document.body.innerHTML).not.toContain("Назначен"); // no «Назначенные»/assigned
  });

  it("is shown to a session with no permissions (no assign_owner gate)", async () => {
    renderWorkspace(providerFor([ok([user(0)])]), []);
    await screen.findByText("Пользователь 00");
    expect(ownerSelect()).toBeInTheDocument();
  });

  it("is shown regardless of unrelated permissions and never branches on role", async () => {
    renderWorkspace(providerFor([ok([user(0)])]), ["reveal_pii", "view_identity_full_email"], "crm_admin");
    await screen.findByText("Пользователь 00");
    expect(ownerSelect()).toBeInTheDocument();
  });

  it("defaults to all and requests without an owner filter", async () => {
    const provider = providerFor([ok([user(0)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");
    expect(ownerSelect().value).toBe("all");
    expect((provider.calls[0] as { owner?: string }).owner).toBe("all");
  });

  it("selecting mine threads owner=mine, resets the cursor, and pushes the URL", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)], "c2"), ok([user(1)], "c2"), ok([user(2)], null)]);
    renderWorkspace(provider);

    await screen.findByText("Пользователь 00");
    // Move to page 2 first, so we can prove the filter change resets pagination.
    await u.click(screen.getByRole("button", { name: "Следующая" }));
    await screen.findByText("Пользователь 01");
    await screen.findByText("Страница 2");

    await u.selectOptions(ownerSelect(), "mine");

    await waitFor(() => expect(provider.calls.length).toBe(3));
    const last = provider.calls[2] as { owner?: string; cursor?: string | null };
    expect(last.owner).toBe("mine");
    expect(last.cursor).toBeFalsy();
    expect(await screen.findByText("Страница 1")).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/users?owner=mine");
  });

  it("selecting unassigned threads owner=unassigned", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)]), ok([user(1)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");

    await u.selectOptions(ownerSelect(), "unassigned");
    await waitFor(() => expect(provider.calls.length).toBe(2));
    expect((provider.calls[1] as { owner?: string }).owner).toBe("unassigned");
    expect(push).toHaveBeenCalledWith("/users?owner=unassigned");
  });

  it("preserves the owner filter when the search changes", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)]), ok([user(1)]), ok([user(2)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");

    await u.selectOptions(ownerSelect(), "mine");
    await waitFor(() => expect(provider.calls.length).toBe(2));

    await u.type(screen.getByLabelText("Имя"), "Лена");
    await u.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(provider.calls.length).toBe(3));

    const last = provider.calls[2] as { owner?: string; search?: string; cursor?: string | null };
    expect(last.owner).toBe("mine");
    expect(last.search).toBe("Лена");
    expect(last.cursor).toBeFalsy();
  });

  it("never sends an employee id and never renders the session employeeId", async () => {
    const provider = providerFor([ok([user(0, { owner: { displayName: "Мария Куратор" } })])]);
    renderWorkspace(provider);
    await screen.findByText("Мария Куратор");
    // The request carries only limit/cursor/search/owner — never an employee id.
    expect(JSON.stringify(provider.calls)).not.toContain("emp_stub_1");
    expect(document.body.innerHTML).not.toContain("emp_stub_1");
  });

  it("never calls the owner-candidates capability from the list", async () => {
    const u = userEvent.setup();
    // providerFor uses throwingOwnerMethods(): any owner-candidate call throws.
    const provider = providerFor([ok([user(0)]), ok([user(1)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");
    await u.selectOptions(ownerSelect(), "mine");
    // No throw ⇒ the list never reached for candidates.
    expect(await screen.findByText("Пользователь 01")).toBeInTheDocument();
  });
});

describe("owner filter — URL state", () => {
  it("restores mine from a refreshed/shared ?owner=mine URL", async () => {
    window.history.replaceState(null, "", "/users?owner=mine");
    const provider = providerFor([ok([user(0)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");
    expect(ownerSelect().value).toBe("mine");
    expect((provider.calls[0] as { owner?: string }).owner).toBe("mine");
    // A clean single value is already canonical — no rewrite.
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("/users"));
  });

  it("canonicalizes an explicit owner=all away with replace (no owner sent to backend as all)", async () => {
    window.history.replaceState(null, "", "/users?owner=all");
    const provider = providerFor([ok([user(0)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");
    expect(ownerSelect().value).toBe("all");
    expect(replace).toHaveBeenCalledWith("/users");
  });

  it("canonicalizes an invalid owner value away and falls back to all", async () => {
    window.history.replaceState(null, "", "/users?owner=assigned");
    const provider = providerFor([ok([user(0)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");
    expect(ownerSelect().value).toBe("all");
    expect(replace).toHaveBeenCalledWith("/users");
  });

  it("canonicalizes a repeated owner key away", async () => {
    window.history.replaceState(null, "", "/users?owner=mine&owner=all");
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    expect(ownerSelect().value).toBe("all");
    expect(replace).toHaveBeenCalledWith("/users");
  });

  it("restores the filter on browser back/forward via popstate", async () => {
    const provider = providerFor([ok([user(0)]), ok([user(1)]), ok([user(2)])]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");

    // Simulate a back/forward that lands on ?owner=unassigned.
    await act(async () => {
      window.history.pushState(null, "", "/users?owner=unassigned");
      window.dispatchEvent(new Event("popstate"));
    });
    await waitFor(() => expect(ownerSelect().value).toBe("unassigned"));
    await waitFor(() =>
      expect((provider.calls[provider.calls.length - 1] as { owner?: string }).owner).toBe("unassigned"),
    );

    // And forward back to the canonical (all) URL.
    await act(async () => {
      window.history.pushState(null, "", "/users");
      window.dispatchEvent(new Event("popstate"));
    });
    await waitFor(() => expect(ownerSelect().value).toBe("all"));
  });

  it("uses no localStorage or sessionStorage for the filter", async () => {
    const u = userEvent.setup();
    renderWorkspace(providerFor([ok([user(0)]), ok([user(1)])]));
    await screen.findByText("Пользователь 00");
    await u.selectOptions(ownerSelect(), "mine");
    await screen.findByText("Пользователь 01");
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("owner-aware empty states", () => {
  it("mine + zero rows shows the mine empty copy", async () => {
    window.history.replaceState(null, "", "/users?owner=mine");
    renderWorkspace(providerFor([ok([])]));
    expect(await screen.findByText("За вами пока не закреплены пользователи.")).toBeInTheDocument();
  });

  it("unassigned + zero rows shows the unassigned empty copy", async () => {
    window.history.replaceState(null, "", "/users?owner=unassigned");
    renderWorkspace(providerFor([ok([])]));
    expect(
      await screen.findByText("Все пользователи закреплены за ответственными."),
    ).toBeInTheDocument();
  });

  it("a non-empty search takes precedence over the owner empty copy", async () => {
    const u = userEvent.setup();
    window.history.replaceState(null, "", "/users?owner=mine");
    renderWorkspace(providerFor([ok([user(0)]), ok([])]));
    await screen.findByText("Пользователь 00");

    await u.type(screen.getByLabelText("Имя"), "Лена");
    await u.click(screen.getByRole("button", { name: "Найти" }));

    expect(
      await screen.findByText("По этому запросу пользователей нет. Измените запрос или сбросьте поиск."),
    ).toBeInTheDocument();
    expect(screen.queryByText("За вами пока не закреплены пользователи.")).not.toBeInTheDocument();
  });

  it("all + zero rows keeps the existing neutral empty copy", async () => {
    renderWorkspace(providerFor([ok([])]));
    expect(await screen.findByText("Пользователи не найдены.")).toBeInTheDocument();
  });
});

describe("owner filter — visible across states", () => {
  it("keeps the filter visible and selectable in the 500 error state", async () => {
    window.history.replaceState(null, "", "/users?owner=mine");
    renderWorkspace(providerFor([{ status: "upstream_unavailable" }]));
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    expect(ownerSelect()).toBeInTheDocument();
    expect(ownerSelect().value).toBe("mine");
  });

  it("clears stale rows while a new filter loads (no rows from the previous filter)", async () => {
    const u = userEvent.setup();
    const provider = providerFor([ok([user(0)]), new Promise<UsersOutcome>(() => {}) as never]);
    renderWorkspace(provider);
    await screen.findByText("Пользователь 00");

    await u.selectOptions(ownerSelect(), "mine");
    // The second request never resolves; the previous row must be gone.
    await waitFor(() => expect(screen.queryByText("Пользователь 00")).not.toBeInTheDocument());
    expect(screen.getByText("Загружаем список пользователей")).toBeInTheDocument();
  });
});
