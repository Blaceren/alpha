import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserDetailOutcome } from "@/application/api/user-detail-client";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import { pristineOwnerMethods } from "./owner-provider-test-stub";
import { sessionFromDto } from "@/domain/identity/session";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { resetClientRuntimeMode, setClientRuntimeMode } from "@/config/client-runtime-mode";
import type { CrmApiUserDetail } from "@/data/contracts/api/user-detail";
import { ApiUserDetailWorkspace, formatDetailDate } from "./api-user-detail-workspace";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/users/1042",
}));

const DETAIL = {
  userId: "1042",
  displayName: "Target Learner",
  email: { value: "l***@e***.test", visibility: "masked" as const },
  status: "active" as const,
  level: 7,
  xp: 4242,
  emailConfirmed: true,
  createdAt: "2026-01-01T12:00:00.000Z",
};

function providerFor(outcomes: UserDetailOutcome[]): CrmUsersReadCapability & { calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    listUsers: () => {
      throw new Error("detail tests must not call listUsers");
    },
    listUserNotes: () => {
      throw new Error("this test must not call listUserNotes");
    },
    createUserNote: () => {
      throw new Error("this test must not call createUserNote");
    },
    ...pristineOwnerMethods(),
    async getUserDetail(userId) {
      calls.push(userId);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      if (!outcome) throw new Error("provider fixture exhausted");
      // Faithful to the backend, which selects `where id = userId` and echoes
      // that id back. The workspace relies on this to detect a stale frame
      // where the route has changed but the previous detail is still in state.
      if (outcome.status === "success") {
        return { ...outcome, detail: { ...outcome.detail, userId } };
      }
      return outcome;
    },
  };
}

const ok = (over: Partial<CrmApiUserDetail> = {}): UserDetailOutcome => ({
  status: "success",
  detail: { ...DETAIL, ...over },
});

function renderDetail(
  provider: CrmUsersReadCapability,
  userId = "1042",
  permissions: never[] = [],
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
      <ApiUserDetailWorkspace userId={userId} provider={provider} />
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
    const provider: CrmUsersReadCapability = {
      listUsers: () => { throw new Error("nope"); },
      listUserNotes: () => {
        throw new Error("this test must not call listUserNotes");
      },
      createUserNote: () => {
        throw new Error("this test must not call createUserNote");
      },
      ...pristineOwnerMethods(),
      getUserDetail: () => new Promise(() => {}),
    };
    renderDetail(provider);
    expect(await screen.findByText("Загружаем данные пользователя")).toBeInTheDocument();
  });

  it("renders a populated detail", async () => {
    renderDetail(providerFor([ok()]));
    expect(await screen.findByRole("heading", { name: "Target Learner" })).toBeInTheDocument();
    expect(screen.getByText("l***@e***.test")).toBeInTheDocument();
    expect(screen.getByText("Активен")).toBeInTheDocument();
    expect(screen.getByText("Подтверждён")).toBeInTheDocument();
    expect(screen.getByText("01.01.2026")).toBeInTheDocument();
  });

  it("no longer presents the legacy level and XP as Academy progress", async () => {
    // PHASE-1 ADMIN. This detail used to carry a section headed «Прогресс» whose
    // rows were `detail.level` and `detail.xp` — the V1 columns, which read 1 and
    // 0 for every PREPROD learner regardless of their Academy progress. The
    // heading is gone, and the pair now appears only inside «Прогресс Академии»
    // under an explicit LEGACY label, beside the canonical V2 numbers. That
    // section owns its own tests (`api-user-progression.test.tsx`); what this one
    // pins is that the misleading presentation cannot come back.
    renderDetail(providerFor([ok()]));
    await screen.findByRole("heading", { name: "Target Learner" });
    expect(screen.queryByText("Прогресс")).not.toBeInTheDocument();
    expect(await screen.findByText("Прогресс Академии")).toBeInTheDocument();
  });

  it("renders a blocked learner", async () => {
    renderDetail(providerFor([ok({ status: "blocked" })]));
    expect(await screen.findByText("Заблокирован")).toBeInTheDocument();
  });

  it("renders an unconfirmed email", async () => {
    renderDetail(providerFor([ok({ emailConfirmed: false })]));
    expect(await screen.findByText("Не подтверждён")).toBeInTheDocument();
  });

  it("does not render the legacy XP outside the labelled progression section", async () => {
    // The old assertion here was `getByText("0")` against a top-level «Прогресс»
    // row. Rendering a bare `0` as a learner's progress is precisely the defect
    // that section replaced, so the truthful assertion is now its absence.
    renderDetail(providerFor([ok({ xp: 0 })]));
    await screen.findByRole("heading", { name: "Target Learner" });
    expect(screen.queryByText("XP")).not.toBeInTheDocument();
  });

  it("formats the date deterministically", () => {
    expect(formatDetailDate("2026-01-01T12:00:00.000Z")).toBe("01.01.2026");
    expect(formatDetailDate("not-a-date")).toBe("—");
  });

  it("always offers a back link to the list", async () => {
    renderDetail(providerFor([ok()]));
    const back = await screen.findByRole("link", { name: /К списку пользователей/ });
    expect(back).toHaveAttribute("href", "/users");
  });
});

describe("email projection is rendered exactly as received", () => {
  it("renders a masked email and labels it", async () => {
    renderDetail(providerFor([ok()]));
    expect(await screen.findByText("l***@e***.test")).toBeInTheDocument();
    expect(screen.getByText("Скрытый email")).toBeInTheDocument();
  });

  it("renders a full email when the backend sent one", async () => {
    renderDetail(providerFor([ok({ email: { value: "lena@example.test", visibility: "full" } })]));
    expect(await screen.findByText("lena@example.test")).toBeInTheDocument();
    expect(screen.getByText("Полный email")).toBeInTheDocument();
  });

  it("crm_admin with empty effectivePermissions still sees only the masked value", async () => {
    // The backend's projection is authoritative; the role never re-grants it.
    renderDetail(providerFor([ok()]), "1042", [], "crm_admin");
    await screen.findByRole("heading", { name: "Target Learner" });
    expect(screen.getByText("l***@e***.test")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("lena@example.test");
    expect(document.body.innerHTML).not.toContain("target-learner@");
  });

  it("a planted mock role cannot change the projection", async () => {
    window.localStorage.setItem("ata-crm.mock-role.v1", "crm_admin");
    renderDetail(providerFor([ok()]));
    await screen.findByRole("heading", { name: "Target Learner" });
    expect(screen.getByText("Скрытый email")).toBeInTheDocument();
  });
});

describe("only truthful sections are rendered", () => {
  it("shows no owner, notes, financial, activity, timeline or recommendation section", async () => {
    renderDetail(providerFor([ok()]));
    await screen.findByRole("heading", { name: "Target Learner" });
    const html = document.body.innerHTML;
    for (const banned of [
      "Владелец", "Заметки", "Баланс", "Депозит", "Активность", "История",
      "Рекомендаци", "Приоритет", "Сегмент", "Задачи", "Кейсы", "Достижени", "360",
    ]) {
      expect(html, `must not render ${banned}`).not.toContain(banned);
    }
  });

  it("offers no mutation control", async () => {
    renderDetail(providerFor([ok()]));
    await screen.findByRole("heading", { name: "Target Learner" });
    const html = document.body.innerHTML;
    for (const banned of ["Заблокировать", "Разблокировать", "Редактировать", "Удалить", "Сбросить пароль", "Сохранить"]) {
      expect(html, `must not offer ${banned}`).not.toContain(banned);
    }
    // The only button in a healthy detail is none at all.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows no employeeId, permissions or session internals", async () => {
    renderDetail(providerFor([ok()]));
    await screen.findByRole("heading", { name: "Target Learner" });
    const html = document.body.innerHTML;
    for (const secret of ["emp_stub_1", "effectivePermissions", "permissionVersion", "2099-12-31"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it("does not display the opaque userId as content", async () => {
    renderDetail(providerFor([ok()]));
    await screen.findByRole("heading", { name: "Target Learner" });
    expect(document.body.textContent ?? "").not.toContain("1042");
  });
});

describe("invalid id is answered locally", () => {
  it.each(["0", "01", "-1", "+1", "1.5", "1e3", "mock_user_1", "emp_backend_001", "2147483648", ""])(
    "renders the invalid-id state and sends no request for %j",
    async (bad) => {
      const provider = providerFor([ok()]);
      renderDetail(provider, bad);
      expect(await screen.findByText("Некорректный идентификатор пользователя")).toBeInTheDocument();
      expect(provider.calls).toHaveLength(0);
    },
  );

  it("keeps the back link available on the invalid-id state", async () => {
    renderDetail(providerFor([ok()]), "mock_user_1");
    await screen.findByText("Некорректный идентификатор пользователя");
    expect(screen.getByRole("link", { name: /К списку пользователей/ })).toHaveAttribute("href", "/users");
  });

  it("passes a valid id through verbatim", async () => {
    const provider = providerFor([ok()]);
    renderDetail(provider, "2147483647");
    await screen.findByRole("heading", { name: "Target Learner" });
    expect(provider.calls).toEqual(["2147483647"]);
  });
});

describe("error behaviour", () => {
  it("401 redirects to the exact login URL and shows no learner data", async () => {
    renderDetail(providerFor([{ status: "unauthenticated" }]));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reason=session_required"));
    expect(screen.queryByRole("heading", { name: "Target Learner" })).not.toBeInTheDocument();
  });

  it("does not keep stale learner data after a later 401", async () => {
    const u = userEvent.setup();
    const provider = providerFor([{ status: "upstream_unavailable" }, { status: "unauthenticated" }]);
    renderDetail(provider);
    await u.click(await screen.findByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reason=session_required"));
    expect(screen.queryByRole("heading", { name: "Target Learner" })).not.toBeInTheDocument();
  });

  it("403 renders a safe state with an optional requestId", async () => {
    renderDetail(providerFor([{ status: "forbidden", requestId: "req_403" }]));
    expect(await screen.findByText("Нет доступа к данным CRM")).toBeInTheDocument();
    expect(screen.getByText("req_403")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Target Learner" })).not.toBeInTheDocument();
  });

  it("404 renders one neutral state that cannot reveal the hidden record type", async () => {
    renderDetail(providerFor([{ status: "not_found" }]));
    expect(await screen.findByText("Пользователь не найден")).toBeInTheDocument();
    const html = document.body.innerHTML;
    for (const leak of ["сотрудник", "staff", "админ", "системн"]) {
      expect(html.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it("400 from the backend renders the safe invalid-id state", async () => {
    renderDetail(providerFor([{ status: "invalid_input", requestId: "req_400" }]));
    expect(await screen.findByText("Некорректный идентификатор пользователя")).toBeInTheDocument();
  });

  it("500 renders a retry state and retry recovers", async () => {
    const u = userEvent.setup();
    renderDetail(providerFor([{ status: "upstream_unavailable" }, ok()]));
    expect(await screen.findByText("Сервис недоступен")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("heading", { name: "Target Learner" })).toBeInTheDocument();
  });

  it("malformed 200 fails closed with no partial render", async () => {
    renderDetail(providerFor([{ status: "malformed_response" }]));
    expect(await screen.findByText("Некорректный ответ сервиса")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Target Learner" })).not.toBeInTheDocument();
  });

  it("shows no raw diagnostics in any error state", async () => {
    renderDetail(providerFor([{ status: "upstream_unavailable" }]));
    await screen.findByText("Сервис недоступен");
    const html = document.body.innerHTML;
    for (const leak of ["ECONNREFUSED", "TypeError", "Failed to fetch", "127.0.0.1", "crm.users.detail", "prisma"]) {
      expect(html).not.toContain(leak);
    }
  });

  it("retry preserves the userId and prevents duplicate concurrent requests", async () => {
    const u = userEvent.setup();
    const calls: string[] = [];
    let n = 0;
    const provider: CrmUsersReadCapability = {
      listUsers: () => { throw new Error("nope"); },
      listUserNotes: () => {
        throw new Error("this test must not call listUserNotes");
      },
      createUserNote: () => {
        throw new Error("this test must not call createUserNote");
      },
      ...pristineOwnerMethods(),
      async getUserDetail(userId) {
        calls.push(userId);
        n += 1;
        if (n === 1) return { status: "upstream_unavailable" };
        return new Promise(() => {});
      },
    };
    renderDetail(provider, "1042");

    const button = await screen.findByRole("button", { name: "Повторить" });
    await u.click(button);
    await u.click(button).catch(() => {});
    await u.click(button).catch(() => {});

    expect(calls).toEqual(["1042", "1042"]);
  });
});
