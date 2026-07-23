import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmUsersReadCapability } from "@/data/api/api-crm-data-provider";
import type { OwnerHistoryListOutcome } from "@/application/api/user-owner-history-client";
import type { CrmApiOwnerHistoryItem } from "@/data/contracts/api/user-owner-history";
import type { Permission } from "@/domain/identity/roles";
import { pristineOwnerMethods } from "./owner-provider-test-stub";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import { ApiUserDetailWorkspace } from "./api-user-detail-workspace";

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

const actor = (over: Record<string, unknown> = {}): { employeeId: string; displayName: string } => ({
  employeeId: "emp_actor",
  displayName: "Ирина С.",
  ...over,
});

const row = (over: Partial<CrmApiOwnerHistoryItem> = {}): CrmApiOwnerHistoryItem => ({
  historyId: "h_1",
  transition: "assigned",
  ownerVersion: 1,
  createdAt: "2026-07-20T18:42:00.000Z",
  actor: actor(),
  previousOwner: null,
  nextOwner: actor({ employeeId: "emp_alpha", displayName: "Пётр Альфа" }),
  ...over,
});

interface Harness {
  provider: CrmUsersReadCapability;
  historyCalls: { userId: string; cursor?: string; limit?: number }[];
}

function harness(outcomes: OwnerHistoryListOutcome[]): Harness {
  const historyCalls: { userId: string; cursor?: string; limit?: number }[] = [];
  let i = 0;
  return {
    historyCalls,
    provider: {
      ...pristineOwnerMethods(),
      listUsers: () => {
        throw new Error("history tests must not call listUsers");
      },
      async getUserDetail(userId) {
        return { status: "success", detail: { ...DETAIL, userId } };
      },
      listUserNotes: () => {
        throw new Error("history tests must not call listUserNotes");
      },
      createUserNote: () => {
        throw new Error("history tests must not call createUserNote");
      },
      async listUserOwnerHistory(userId, input) {
        historyCalls.push({ userId, cursor: input?.cursor, limit: input?.limit });
        const outcome = outcomes[Math.min(i, outcomes.length - 1)] ?? { status: "malformed_response" as const };
        i += 1;
        return outcome;
      },
    },
  };
}

function renderWith(provider: CrmUsersReadCapability, permissions: Permission[]) {
  const session = sessionFromDto({
    employeeId: "emp_viewer",
    displayName: "Просмотр",
    role: permissions.includes("view_audit") ? "crm_admin" : "support",
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2099-12-31T23:59:59.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <ApiUserDetailWorkspace userId="1042" provider={provider} />
    </AuthenticatedSessionProvider>,
  );
}

const ok = (items: CrmApiOwnerHistoryItem[], nextCursor: string | null = null): OwnerHistoryListOutcome => ({
  status: "success",
  page: { items, nextCursor },
});

beforeEach(() => {
  replace.mockClear();
});

describe("Owner History section — permission gating", () => {
  it("is hidden and never requested without view_audit", async () => {
    const h = harness([ok([row()])]);
    renderWith(h.provider, []);
    // The detail must render first.
    expect(await screen.findByRole("heading", { name: "Тестовый Ученик" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "История ответственного" })).not.toBeInTheDocument();
    expect(h.historyCalls).toHaveLength(0);
  });

  it("is visible and fetched with view_audit", async () => {
    const h = harness([ok([row()])]);
    renderWith(h.provider, ["view_audit"]);
    expect(await screen.findByRole("heading", { name: "История ответственного" })).toBeInTheDocument();
    await waitFor(() => expect(h.historyCalls.length).toBeGreaterThan(0));
    expect(h.historyCalls[0]?.userId).toBe("1042");
    expect(h.historyCalls[0]?.limit).toBe(20);
  });
});

describe("Owner History section — states", () => {
  it("renders assign / reassign / unassign rows with owner names", async () => {
    const items = [
      row({ historyId: "h3", transition: "unassigned", ownerVersion: 3, previousOwner: actor({ employeeId: "emp_beta", displayName: "Пётр Альфа" }), nextOwner: null }),
      row({ historyId: "h2", transition: "reassigned", ownerVersion: 2, previousOwner: actor({ employeeId: "emp_alpha", displayName: "Пётр Альфа" }), nextOwner: actor({ employeeId: "emp_beta", displayName: "Мария Бета" }) }),
      row({ historyId: "h1", transition: "assigned", ownerVersion: 1, previousOwner: null, nextOwner: actor({ employeeId: "emp_alpha", displayName: "Пётр Альфа" }) }),
    ];
    const h = harness([ok(items)]);
    renderWith(h.provider, ["view_audit"]);

    const heading = await screen.findByRole("heading", { name: "История ответственного" });
    const section = heading.closest("section")!;
    // Rows render in server order (newest first) as a list, once the fetch lands.
    const list = await within(section).findByRole("list");
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(3);
    expect(within(section).getByText("Снят")).toBeInTheDocument();
    expect(within(section).getByText("Изменён")).toBeInTheDocument();
    expect(within(section).getByText("Назначен")).toBeInTheDocument();
    expect(within(section).getByText("Мария Бета")).toBeInTheDocument();
    // The actor is shown on each row.
    expect(within(section).getAllByText(/Ирина С\./).length).toBeGreaterThan(0);
  });

  it("shows an honest empty state that does not claim a complete history", async () => {
    const h = harness([ok([])]);
    renderWith(h.provider, ["view_audit"]);
    const heading = await screen.findByRole("heading", { name: "История ответственного" });
    const section = heading.closest("section")!;
    await waitFor(() => expect(within(section).getByText(/Записей пока нет/)).toBeInTheDocument());
    expect(within(section).getByText(/после включения этой функции/)).toBeInTheDocument();
    expect(within(section).getByText(/недоступны/)).toBeInTheDocument();
    // No "complete history" claim.
    expect(within(section).queryByText(/полная история/i)).not.toBeInTheDocument();
  });

  it("loads the next page and appends, passing the cursor", async () => {
    const first = [row({ historyId: "h2", ownerVersion: 2, transition: "reassigned", previousOwner: actor(), nextOwner: actor({ employeeId: "b", displayName: "Мария Бета" }) })];
    const second = [row({ historyId: "h1", ownerVersion: 1, transition: "assigned", nextOwner: actor({ employeeId: "a", displayName: "Пётр Альфа" }) })];
    const h = harness([ok(first, "cursor-1"), ok(second, null)]);
    renderWith(h.provider, ["view_audit"]);

    const heading = await screen.findByRole("heading", { name: "История ответственного" });
    const section = heading.closest("section")!;
    const more = await within(section).findByRole("button", { name: "Показать ещё" });
    await userEvent.click(more);

    await waitFor(() => expect(within(section).getByText("Пётр Альфа")).toBeInTheDocument());
    expect(within(section).getByText("Мария Бета")).toBeInTheDocument();
    expect(h.historyCalls[1]?.cursor).toBe("cursor-1");
    // Both rows present, none dropped.
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
  });

  it("offers a keyboard-accessible retry after an upstream failure", async () => {
    const h = harness([{ status: "upstream_unavailable" }, ok([row()])]);
    renderWith(h.provider, ["view_audit"]);
    const heading = await screen.findByRole("heading", { name: "История ответственного" });
    const section = heading.closest("section")!;
    const retry = await within(section).findByRole("button", { name: "Повторить" });
    retry.focus();
    expect(retry).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(within(section).getByText("Назначен")).toBeInTheDocument());
    expect(h.historyCalls.length).toBeGreaterThanOrEqual(2);
  });
});
