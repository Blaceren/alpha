/**
 * Today workspace component tests (Phase 1B3 §27).
 *
 * These assert what the operator can READ and DO — never CSS classes. The
 * provider is a real MockCrmDataProvider on a fixed clock, so the tests exercise
 * the same projection the app ships with.
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixedMockClock } from "@/lib/clock";
import { MockCrmDataProvider } from "@/data/mock/MockCrmDataProvider";
import { RECOMMENDATION_CATALOG } from "@/domain/recommendations/catalog";
import { MockSessionProvider } from "@/components/crm-shell/session-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TodayWorkspace } from "./today-workspace";

const clock = new FixedMockClock();
const provider = () => new MockCrmDataProvider({ clock, delayMs: 0 });

/** Mirrors the shell: MockSessionProvider + TooltipProvider wrap every CRM page. */
/**
 * The search box debounces on a real 300 ms timer and this suite's assertions
 * must sit through it before the work they actually test begins. Measured: 782
 * ms idle against `waitFor`'s 1000 ms budget, 1152 ms under parallel workers —
 * i.e. the assertion was failing on machine speed, not on behaviour. Nothing
 * here is a test OF the debounce, so it is driven to 0 and the assertions
 * measure what they are named after.
 */
function renderToday(p = provider()) {
  return render(
    <MockSessionProvider>
      <TooltipProvider>
        <TodayWorkspace providerOverride={p} searchDebounceMs={0} />
      </TooltipProvider>
    </MockSessionProvider>,
  );
}

/**
 * The reason paragraph reads "Причина: Открыт support-блокер." — the label is
 * sr-only, so a screen reader hears what the field IS. RTL matches on the whole
 * element text, hence the regex.
 */
const REASON_NINA = /Открыт support-блокер/;

/**
 * Radix sets `pointer-events: none` on <body> while a menu is open, and
 * userEvent refuses to click through it. The filters here ARE dropdowns, so the
 * pointer check is disabled — the real browser has no such restriction, and the
 * E2E suite covers the same flows for real.
 */
const setupUser = () => userEvent.setup({ pointerEventsCheck: 0 });

const queueReady = async () => {
  await waitFor(() => expect(screen.getAllByText(REASON_NINA).length).toBeGreaterThan(0));
};

describe("TodayWorkspace — the page answers «what needs me now»", () => {
  it("has exactly one h1, and it is the page subject", async () => {
    renderToday();
    await queueReady();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("Сегодня");
  });

  it("states the working day from the provider clock, not the wall clock", async () => {
    renderToday();
    await queueReady();
    expect(screen.getByText(/13 июля 2026/)).toBeInTheDocument();
  });

  it("leads with the most urgent section", async () => {
    renderToday();
    await queueReady();
    const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(sections[0]).toBe("Просрочено");
    // Watching comes last, never above real work.
    expect(sections[sections.length - 1]).toBe("Наблюдение");
  });

  it("shows the reason for the first critical user, not a bare «требует внимания»", async () => {
    renderToday();
    await queueReady();
    expect(screen.getAllByText(REASON_NINA).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Требует внимания$/)).not.toBeInTheDocument();
  });

  it("shows the recommendation and the owner", async () => {
    renderToday();
    await queueReady();
    expect(screen.getAllByText("Follow-up поддержки").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Support 1").length).toBeGreaterThan(0);
  });

  it("links each user to their profile, naming them in the accessible name", async () => {
    renderToday();
    await queueReady();
    const link = screen.getAllByRole("link", { name: "Открыть профиль: Nina Chmiel" })[0]!;
    expect(link).toHaveAttribute("href", "/users/usr_mock_026");
  });

  it("summarises the queue as a few operational counts, not a dashboard", async () => {
    renderToday();
    await queueReady();
    const strip = screen.getByText("Требуют внимания").closest("dl")!;
    for (const label of ["Требуют внимания", "Критичных", "Нарушен SLA", "Без ответственного"]) {
      expect(within(strip).getByText(label)).toBeInTheDocument();
    }
    // The counts describe the queue on screen: 22 users, 2 of them critical.
    expect(within(strip).getByText("22")).toBeInTheDocument();
    expect(within(strip).getByText("2")).toBeInTheDocument();
  });
});

describe("TodayWorkspace — read-only", () => {
  it("offers navigation and query controls, and no mutation", async () => {
    renderToday();
    await queueReady();

    // Every link goes to a profile. Nothing posts, assigns, closes or creates.
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").toMatch(/^\/users\//);
    }
    const buttonNames = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    for (const name of buttonNames) {
      expect(name).not.toMatch(/назначить|закрыть|создать|выполнить|отправить|решить/i);
    }
    expect(screen.getByText("Только просмотр")).toBeInTheDocument();
  });
});

describe("TodayWorkspace — no raw codes reach the screen", () => {
  it("renders no snake_case enum anywhere in the queue", async () => {
    const { container } = renderToday();
    await queueReady();
    const text = container.textContent ?? "";
    for (const code of [
      "support_blocked",
      "registration_pending",
      "checkpoint_approaching",
      "critical_attention",
      "sla_breached",
      "mentor_review",
      "data_quality_issues",
      "no_action_required",
      "not_permitted",
    ]) {
      expect(text, `raw code ${code} rendered`).not.toContain(code);
    }
    // The user id is a platform identifier and is expected; nothing else
    // snake_case should survive.
    const snake = text.match(/\b[a-z]+_[a-z_]+\b/g)?.filter((m) => !m.startsWith("usr_mock")) ?? [];
    expect(snake).toEqual([]);
  });
});

describe("TodayWorkspace — filters and sort", () => {
  it("filters the queue and shows the active filter, then clears it", async () => {
    const user = setupUser();
    renderToday();
    await queueReady();

    await user.click(screen.getByRole("button", { name: /Приоритет/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Критический" }));

    // The queue really narrows — the watch section goes away.
    await waitFor(() => {
      expect(screen.queryByRole("heading", { level: 2, name: "Наблюдение" })).not.toBeInTheDocument();
    });

    // The active filter is visible and removable.
    const chipClear = screen.getByLabelText("Убрать фильтр Критический");
    expect(chipClear).toBeInTheDocument();
    await user.click(chipClear);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Наблюдение" })).toBeInTheDocument();
    });
  });

  it("resets every filter at once", async () => {
    const user = setupUser();
    renderToday();
    await queueReady();

    await user.click(screen.getByRole("button", { name: /Приоритет/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Критический" }));
    await waitFor(() => expect(screen.getByText("Сбросить всё")).toBeInTheDocument());

    await user.click(screen.getByText("Сбросить всё"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Наблюдение" })).toBeInTheDocument();
    });
  });

  it("names the active sort, so a reordered queue never looks like the urgent one", async () => {
    const user = setupUser();
    renderToday();
    await queueReady();

    expect(screen.getByRole("button", { name: "Сортировка: По срочности" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Сортировка/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Сначала неактивные" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Сортировка: Сначала неактивные" })).toBeInTheDocument();
    });
  });
});

describe("TodayWorkspace — empty states are different facts", () => {
  it("«no results» when filters exclude everything, with a reset", async () => {
    const user = setupUser();
    renderToday();
    await queueReady();

    await user.type(screen.getByLabelText("Поиск по очереди"), "zzz-nobody");
    expect(await screen.findByText("По выбранным фильтрам ничего не найдено")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
    await queueReady();
  });

  it("«no users at all» never claims the role lacks access", async () => {
    renderToday(new MockCrmDataProvider({ clock, emptyMode: true }));
    expect(await screen.findByText("В базе пока нет пользователей")).toBeInTheDocument();
    // REGRESSION: an empty dataset used to render "Очередь недоступна для вашей
    // роли" to a crm_admin — a permission claim about a database that is simply
    // empty. /today is visible to every role.
    expect(screen.queryByText(/недоступна для вашей роли/)).not.toBeInTheDocument();
  });
});

describe("TodayWorkspace — loading, error, stale", () => {
  it("shows a skeleton before the first result", () => {
    renderToday(new MockCrmDataProvider({ clock, delayMs: 50 }));
    expect(screen.getByRole("status", { name: "Загрузка очереди" })).toBeInTheDocument();
  });

  it("explains an error and offers retry when the read is retriable", async () => {
    renderToday(new MockCrmDataProvider({ clock, errorMode: true }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Источник данных недоступен. Повторите попытку.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
    // The page keeps its single h1 even when the read failed.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("marks stale data without withholding the queue", async () => {
    renderToday(new MockCrmDataProvider({ clock, staleMode: true }));
    await queueReady();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(/Данные обновлены 75 мин назад/);
    // The work is still there to do.
    expect(screen.getAllByRole("link", { name: /Открыть профиль/ }).length).toBeGreaterThan(0);
  });
});

/**
 * D-52: Today words an action from the code through the shared label map. The
 * expectation comes from the catalog, so this asserts agreement with the
 * canonical source rather than with a pasted string.
 */
describe("TodayWorkspace — recommendation wording (D-52)", () => {
  it("prints the canonical catalog wording for every queued recommendation", async () => {
    const p = provider();
    const res = await p.getTodayWorkspace(
      { actorId: "emp_mock_admin", role: "crm_admin", now: clock.nowIso() },
      {},
    );
    const codes = [
      ...new Set(
        res
          .data!.sections.flatMap((s) => s.items)
          .map((i) => i.recommendation?.code)
          .filter((c): c is NonNullable<typeof c> => Boolean(c)),
      ),
    ];
    expect(codes.length).toBeGreaterThan(0);

    const { container } = renderToday(p);
    await queueReady();
    const text = container.textContent ?? "";

    for (const code of codes) {
      expect(text, `Today must word ${code} as the catalog does`).toContain(
        RECOMMENDATION_CATALOG[code].title,
      );
      expect(text).not.toContain(code);
    }
  });
});
