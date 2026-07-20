import * as React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { resetClientRuntimeMode } from "@/config/client-runtime-mode";
import { AppShell } from "./app-shell";

// The pathname is what decides api-mode composition, so each case drives it.
let pathname = "/users";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}));

// Keep the boundary deterministic: a validated session, no network.
vi.mock("@/application/session-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/application/session-client")>();
  return {
    ...actual,
    fetchSession: async () => ({
      status: "authenticated" as const,
      dto: {
        employeeId: "emp_stub_1",
        displayName: "Ирина Соколова",
        role: "support" as const,
        effectivePermissions: [],
        permissionVersion: 1,
        expiresAt: "2099-12-31T23:59:59.000Z",
      },
    }),
  };
});

// The production list would otherwise fetch; stub it to a stable empty page.
vi.mock("@/data/api/api-crm-data-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/api/api-crm-data-provider")>();
  return {
    ...actual,
    createApiCrmDataProvider: () => ({
      listUsers: async () => ({ status: "success" as const, page: { items: [], nextCursor: null } }),
    }),
  };
});

beforeEach(() => resetClientRuntimeMode());
afterEach(() => resetClientRuntimeMode());

const FEATURE_CHILD = "MOCK FEATURE CHILD";

function renderAt(path: string, mode: "api" | "mock") {
  pathname = path;
  return render(
    <AppShell mode={mode}>
      <p>{FEATURE_CHILD}</p>
    </AppShell>,
  );
}

describe("api mode — /users is the one mountable route", () => {
  it("mounts the production users list at exactly /users", async () => {
    renderAt("/users", "api");
    expect(await screen.findByRole("heading", { name: "Пользователи", level: 1 })).toBeInTheDocument();
    // The mock feature child is never rendered.
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
  });

  it("shows the bounded shell with only the Users navigation item", async () => {
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });

    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    expect(within(nav).getAllByRole("link")).toHaveLength(1);

    const html = document.body.innerHTML;
    for (const section of ["Сегодня", "Аудит", "Финанс", "Задачи", "Кейсы", "Настройки", "Ментор", "Аналитика"]) {
      expect(html, `must not offer ${section}`).not.toContain(section);
    }
  });

  it("never renders the role switch or mock chrome in api mode", async () => {
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });
    const html = document.body.innerHTML;
    expect(html).not.toContain("Демо-роль");
    expect(html).not.toContain("Роль:");
    expect(html).not.toContain("DEMO");
  });

  it("does not leak employeeId, permissions or environment details", async () => {
    renderAt("/users", "api");
    await screen.findByRole("heading", { name: "Пользователи", level: 1 });
    const html = document.body.innerHTML;
    for (const secret of ["emp_stub_1", "effectivePermissions", "permissionVersion", "2099-12-31", "CRM_BACKEND_ORIGIN", "127.0.0.1"]) {
      expect(html, `leaked ${secret}`).not.toContain(secret);
    }
  });
});

describe("api mode — every other route stays deferred", () => {
  it.each(["/today", "/audit", "/financial", "/settings", "/support", "/tasks", "/cases", "/"])(
    "%s renders the deferred state and no feature child",
    async (path) => {
      renderAt(path, "api");
      expect(await screen.findByText("Раздел ещё не подключён")).toBeInTheDocument();
      expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    },
  );

  it("/users/[id] stays deferred and never mounts User 360", async () => {
    renderAt("/users/1000", "api");
    expect(await screen.findByText("Раздел ещё не подключён")).toBeInTheDocument();
    expect(screen.queryByText(FEATURE_CHILD)).not.toBeInTheDocument();
    // No User 360 heading, no notes, no owner affordance.
    const html = document.body.innerHTML;
    for (const banned of ["Заметки", "Владелец", "Баланс", "User 360"]) {
      expect(html).not.toContain(banned);
    }
  });

  it("the deferred state offers a safe way to the one working section", async () => {
    renderAt("/today", "api");
    await screen.findByText("Раздел ещё не подключён");
    const link = screen.getByRole("link", { name: "Перейти к пользователям" });
    expect(link).toHaveAttribute("href", "/users");
  });
});

describe("mock mode is untouched", () => {
  it("renders the mock feature child at /users", async () => {
    renderAt("/users", "mock");
    expect(await screen.findByText(FEATURE_CHILD)).toBeInTheDocument();
  });

  it("renders the mock feature child at /users/[id]", async () => {
    renderAt("/users/1000", "mock");
    expect(await screen.findByText(FEATURE_CHILD)).toBeInTheDocument();
  });

  it("never shows the api-mode deferred state", async () => {
    renderAt("/today", "mock");
    await screen.findByText(FEATURE_CHILD);
    expect(screen.queryByText("Раздел ещё не подключён")).not.toBeInTheDocument();
  });
});
