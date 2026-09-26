import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import type { CrmDataProvider } from "@/data/contracts/CrmDataProvider";
import { empty, fail, ok, stale } from "@/data/contracts/result";
import type { Result } from "@/data/contracts/result";
import type { User360 } from "@/domain/users/user-360";
import { PRIMARY_OWNER_CANDIDATES } from "@/domain/identity/employees";
import { USER_360_LABEL } from "@/config/labels";
import { RECOMMENDATION_CATALOG } from "@/domain/recommendations/catalog";
import { mockSessionForRole } from "@/domain/identity/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { User360Workspace } from "./user-360-workspace";

vi.mock("next/navigation", () => ({
  usePathname: () => "/users/usr_mock_026",
  useRouter: () => ({ push: vi.fn() }),
}));

// The session object must be STABLE: the query effect depends on its identity
// (the real MockSessionProvider memoizes it), so returning a fresh object per render
// would re-fire the provider read forever.
const ADMIN_SESSION = mockSessionForRole("crm_admin");
vi.mock("@/components/crm-shell/session-context", () => ({
  useSession: () => ({ session: ADMIN_SESSION, setRole: vi.fn() }),
}));

const clock = new FixedMockClock();
const provider = new MockCrmDataProvider({ clock, delayMs: 0 });

const HIGH_PRIORITY = "usr_mock_026";
const CALM = "usr_mock_005";

/** Raw enum codes must never reach the screen — labels only. */
const RAW_CODES = [
  "at_risk",
  "support_blocked",
  "critical_support_issue",
  "checkpoint_approaching",
  "registered",
  "not_available",
  "funded",
];

function renderWorkspace(userId = HIGH_PRIORITY, providerOverride: CrmDataProvider = provider) {
  return render(
    <TooltipProvider>
      <User360Workspace userId={userId} providerOverride={providerOverride} />
    </TooltipProvider>,
  );
}

/**
 * Stub provider returning one canned result for getUser360.
 *
 * Since Phase 1B4-B the screen also reads notes independently, so a stub of "the
 * provider this screen uses" has to answer that read too. It returns an empty
 * page: these cases are about the aggregate's states, not about notes.
 *
 * Phase 1B4-C added a second independent read for the same reason — the owner
 * candidate list. It answers with the real candidates rather than an empty list,
 * because an empty list would mean "there is nobody to assign" and these cases are
 * not about that either.
 */
function stubProvider(result: Result<User360>): CrmDataProvider {
  return {
    getUser360: () => Promise.resolve(result),
    getUserNotes: () =>
      Promise.resolve(
        empty({ items: [], page: { cursor: null, nextCursor: null, total: 0, pageSize: 50 } }),
      ),
    // The notes section reads the capability view (Phase 1B4-E). Same empty page:
    // these cases are about the aggregate's states, not about notes.
    getUserNotesView: () =>
      Promise.resolve(
        empty({ items: [], page: { cursor: null, nextCursor: null, total: 0, pageSize: 50 } }),
      ),
    getPrimaryOwnerCandidates: () =>
      Promise.resolve(
        ok(
          PRIMARY_OWNER_CANDIDATES.map((e) => ({
            employeeId: e.employeeId,
            displayName: e.displayName,
          })),
        ),
      ),
  } as unknown as CrmDataProvider;
}

describe("User360Workspace — structure", () => {
  it("has exactly one h1, naming the user", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1, name: "Nina Chmiel" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("renders each block as a section labelled by its own heading", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    for (const title of [
      "Почему требует внимания",
      "Состояния",
      "Активные блокеры",
      "Системные сигналы",
      "Обучение",
      "Недавние события",
      "Финансы",
      "Ответственный и работа",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it("offers a back link to the register", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    const back = screen.getAllByRole("link", { name: "Пользователи" })[0]!;
    expect(back).toHaveAttribute("href", "/users");
  });

  it("shows no raw enum codes anywhere", async () => {
    const { container } = renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    for (const code of RAW_CODES) {
      expect(container.textContent).not.toContain(code);
    }
  });
});

describe("User360Workspace — attention and recommendation", () => {
  it("shows the human priority reason, not a code or a score", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Критический support-блокер")).toBeInTheDocument();
    expect(screen.getAllByText("Критический").length).toBeGreaterThan(0);
  });

  it("shows the recommended action with rationale, urgency and addressee", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Follow-up поддержки")).toBeInTheDocument();
    // The rationale text is shared with the signal that produced it.
    expect(screen.getAllByText("Открыт support-блокер.").length).toBeGreaterThan(0);
    expect(screen.getByText("Срочно")).toBeInTheDocument();
    expect(screen.getByText("Кому: Поддержка")).toBeInTheDocument();
  });

  it("marks recommendations read-only and offers no action control", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getAllByText("Только просмотр").length).toBeGreaterThan(0);

    // Scoped to the block that holds the recommendations (Phase 1B4-C). This was a
    // page-wide sweep, which was the same statement only while nothing on the screen
    // mutated at all: owner assignment now owns a «Сохранить» in the operational
    // context column, and banning the word page-wide would fail on a control that
    // has nothing to do with recommendations. What is being asserted is unchanged —
    // a recommendation still offers nothing to press, so nothing can fake a success.
    const attention = screen.getByRole("region", { name: USER_360_LABEL.attention });
    for (const name of [/Выполнить/i, /Применить/i, /Назначить/i, /Сохранить/i, /Закрыть сигнал/i]) {
      expect(within(attention).queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("User360Workspace — states are independent and not duplicated", () => {
  it("shows the five axes as separate labelled tiles", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    for (const label of ["Этап", "Регистрация Pocket", "Финансовый статус", "Активность", "Прогресс"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("В зоне риска")).toBeInTheDocument();
    expect(screen.getByText("Фондирован")).toBeInTheDocument();
  });

  it("links the priority to its source signal instead of repeating a badge", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    // The same underlying fact appears exactly twice and as two different
    // things: once as a state chip (blocker) and once as a derived signal.
    // The priority interpretation points at the signal via this marker rather
    // than badging the fact a third time.
    expect(screen.getByText("Основание приоритета")).toBeInTheDocument();
    expect(screen.getAllByText("Заблокирован поддержкой")).toHaveLength(2);
  });

  it("renders the activity timeline as a semantic list", async () => {
    const { container } = renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    const timeline = container.querySelector("ol");
    expect(timeline).not.toBeNull();
    expect(timeline!.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(screen.getByText("Регистрация в академии")).toBeInTheDocument();
  });

  it("shows learning progress from real data only", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("Advanced setups")).toBeInTheDocument();
    expect(screen.getByText("Статус контрольной точки")).toBeInTheDocument();
    expect(screen.getByText("Следующая контрольная точка")).toBeInTheDocument();
  });
});

describe("User360Workspace — calm user", () => {
  it("does not invent urgency", async () => {
    renderWorkspace(CALM);
    await screen.findByRole("heading", { level: 1, name: "Lena Mazur" });
    expect(screen.getByText("Активных причин для внимания нет")).toBeInTheDocument();
    expect(screen.getByText("Действие не требуется")).toBeInTheDocument();
    expect(screen.getByText("Активных блокеров нет.")).toBeInTheDocument();
    expect(screen.getByText("Активных сигналов нет.")).toBeInTheDocument();
  });
});

describe("User360Workspace — states", () => {
  it("shows a stable skeleton while loading", async () => {
    const slow = new MockCrmDataProvider({ clock, delayMs: 50 });
    renderWorkspace(HIGH_PRIORITY, slow);
    expect(screen.getByRole("status", { name: "Загрузка профиля пользователя" })).toBeInTheDocument();
    await screen.findByRole("heading", { level: 1 });
  });

  it("shows a real not-found for an unknown id, with a way back", async () => {
    renderWorkspace("usr_does_not_exist");
    await screen.findByRole("heading", { level: 1, name: "Пользователь не найден" });
    expect(screen.getByText(/usr_does_not_exist/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Пользователи" })).toHaveAttribute("href", "/users");
    // No fabricated profile.
    expect(screen.queryByText("Финансы")).not.toBeInTheDocument();
  });

  it("shows an access-restricted state without naming the sensitive data", async () => {
    const p = stubProvider(
      fail<User360>({ code: "unauthorized", message: "no", retriable: false }),
    );
    renderWorkspace(HIGH_PRIORITY, p);
    await screen.findByRole("heading", { level: 1, name: "Доступ ограничен" });
    expect(screen.getByRole("link", { name: "Пользователи" })).toBeInTheDocument();
    expect(screen.queryByText(/Баланс/)).not.toBeInTheDocument();
  });

  it("offers retry only when the provider says the error is retriable", async () => {
    const retriable = stubProvider(
      fail<User360>({ code: "upstream_unavailable", message: "down", retriable: true }),
    );
    const { unmount } = renderWorkspace(HIGH_PRIORITY, retriable);
    expect(await screen.findByRole("button", { name: "Повторить" })).toBeInTheDocument();
    unmount();

    const permanent = stubProvider(
      fail<User360>({ code: "invalid_input", message: "bad", retriable: false }),
    );
    renderWorkspace(HIGH_PRIORITY, permanent);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Повторить" })).not.toBeInTheDocument();
  });

  it("retry re-reads through the provider", async () => {
    const getUser360 = vi
      .fn()
      .mockResolvedValue(fail<User360>({ code: "upstream_unavailable", message: "down", retriable: true }));
    renderWorkspace(HIGH_PRIORITY, { getUser360 } as unknown as CrmDataProvider);
    const retry = await screen.findByRole("button", { name: "Повторить" });
    await userEvent.click(retry);
    await waitFor(() => expect(getUser360).toHaveBeenCalledTimes(2));
  });

  it("shows stale data with a banner instead of hiding it", async () => {
    const view = (await provider.getUser360(
      { actorId: "e", role: "crm_admin", now: clock.nowIso() },
      { userId: HIGH_PRIORITY },
    )).data!;
    const p = stubProvider(stale(view, { asOf: clock.nowIso(), isStale: true }));
    renderWorkspace(HIGH_PRIORITY, p);
    await screen.findByRole("heading", { level: 1, name: "Nina Chmiel" });
    expect(screen.getByText(/Данные могли устареть/)).toBeInTheDocument();
    // The data itself stays visible.
    expect(screen.getByText("Критический support-блокер")).toBeInTheDocument();
  });
});

describe("User360Workspace — keyboard", () => {
  it("reaches the back link by keyboard", async () => {
    renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    const back = screen.getAllByRole("link", { name: "Пользователи" })[0]!;
    back.focus();
    expect(back).toHaveFocus();
  });
});

/**
 * D-52: User 360 used to render the read model's own `title`, which is how it
 * came to word three actions differently from Users/Today. It now resolves the
 * wording from the code through the shared label map, like every other screen.
 */
describe("User360Workspace — recommendation wording (D-52)", () => {
  it("prints the canonical catalog wording for every recommendation", async () => {
    const res = await provider.getUser360(
      { actorId: "emp_mock_admin", role: "crm_admin", now: clock.nowIso() },
      { userId: HIGH_PRIORITY },
    );
    const codes = res.data!.recommendations.map((r) => r.code);
    expect(codes.length).toBeGreaterThan(0);

    const { container } = renderWorkspace();
    await screen.findByRole("heading", { level: 1 });
    const text = container.textContent ?? "";

    for (const code of codes) {
      expect(text, `User 360 must word ${code} as the catalog does`).toContain(
        RECOMMENDATION_CATALOG[code].title,
      );
      expect(text).not.toContain(code);
    }
  });
});
