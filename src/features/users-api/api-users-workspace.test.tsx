import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsersOutcome } from "@/application/api/users-client";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import type { Permission } from "@/domain/identity/roles";
import { sessionFromDto } from "@/domain/identity/session";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { resetClientRuntimeMode, setClientRuntimeMode } from "@/config/client-runtime-mode";
import { ApiUsersWorkspace, formatRegisteredAt } from "./api-users-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
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
    ...over,
  };
}

function providerFor(outcomes: UsersOutcome[]): CrmUsersReadCapability & { calls: unknown[] } {
  const calls: unknown[] = [];
  let index = 0;
  return {
    calls,
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
  setClientRuntimeMode("api");
  window.localStorage.clear();
});
afterEach(() => {
  resetClientRuntimeMode();
  window.localStorage.clear();
});

describe("states", () => {
  it("shows a loading status first", async () => {
    const provider: CrmUsersReadCapability = { listUsers: () => new Promise(() => {}) };
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
  it("shows exactly the six contract columns", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Имя", "Email", "Статус", "Уровень", "Email подтверждён", "Регистрация"]);
  });

  it("shows no owner, notes, financial, activity or recommendation column", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    const html = document.body.innerHTML;
    for (const banned of ["Владелец", "Заметки", "Баланс", "Депозит", "Активность", "Рекомендация", "Приоритет", "Сегмент", "$"]) {
      expect(html, `must not render ${banned}`).not.toContain(banned);
    }
  });

  it("never renders the opaque userId", async () => {
    renderWorkspace(providerFor([ok([user(0)])]));
    await screen.findByText("Пользователь 00");
    expect(document.body.innerHTML).not.toContain("1000");
  });

  it("shows no row link and no User 360 navigation", async () => {
    renderWorkspace(providerFor([ok([user(0), user(1)])]));
    await screen.findByText("Пользователь 00");
    const table = screen.getByRole("table");
    expect(within(table).queryAllByRole("link")).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain("/users/1000");
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
