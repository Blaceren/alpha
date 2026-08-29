/**
 * NOTIFICATIONS — fidelity, state coverage and the truth rules.
 *
 * The composition tests are ordinary. The ones that matter are the truth tests:
 * the surface must never light the Signal mark, never make a page-level action
 * claim it cannot confirm, never turn a row into a click target, and never show
 * a type it has no approved representation for. Each of those is an accepted
 * ruling of the frozen design, and each is the kind of thing a later refactor
 * would restore by accident.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsFidelity } from "@/features/notifications-fidelity/notifications-fidelity";
import {
  COPY,
  consequenceOf,
  contextIdentity,
  handoffLabel,
  humanTime,
  presenceFor,
  toRecord,
  type NotificationRow,
  type NotificationTypeName,
} from "@/features/notifications-fidelity/notifications-state";

/** The Backend's deployed NotificationType enum, in full. */
const ENUM: NotificationTypeName[] = [
  "support_reply",
  "task_report_approved",
  "task_report_rejected",
  "reward_granted",
  "level_up",
  "checkpoint_frozen",
  "checkpoint_restored",
  "postback_received",
  "exchange_connected",
  "exchange_rejected",
  "exchange_blocked",
  "mentor_reply",
  "daily_reward",
  "achievement_granted",
  "promocode_redeemed",
  "referral_bonus",
  "system",
  "community_reply",
  "community_moderation",
];

const NOW = new Date("2026-08-24T15:00:00Z");

function row(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: over.id ?? 1,
    type: over.type ?? "system",
    title: over.title ?? "Изменение произошло.",
    message: over.message ?? "Подробность изменения.",
    metadata: over.metadata ?? null,
    readAt: over.readAt ?? null,
    createdAt: over.createdAt ?? "2026-08-24T14:20:00.000Z",
  };
}

function respondWith(payload: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => payload,
  } as unknown as Response);
}

const SRC = (f: string) =>
  readFileSync(join(process.cwd(), "src/features/notifications-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

beforeEach(() => {
  vi.stubGlobal("fetch", respondWith({ items: [] }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------- semantic layer */

describe("Notifications — the semantic mapping", () => {
  it("gives every deployed type an approved context identity", () => {
    for (const type of ENUM) {
      const context = contextIdentity(type);
      expect(context, type).toBeTruthy();
      expect(context, type).not.toContain("_");
    }
  });

  it("suppresses a type it has no approved representation for", () => {
    expect(contextIdentity("some_future_type")).toBeNull();
    expect(toRecord(row({ type: "some_future_type" }), NOW)).toBeNull();
  });

  it("never lets a raw enum value reach the learner", () => {
    for (const type of ENUM) {
      expect(contextIdentity(type)).not.toBe(type);
    }
  });

  it("classifies the event's consequence from the event, not from progression", () => {
    expect(consequenceOf("task_report_rejected")).toBe("ACTION-RELEVANT");
    expect(consequenceOf("level_up")).toBe("AWARENESS-ONLY");
  });

  it("keeps actionability unknown for every row, because nothing can confirm it", () => {
    for (const type of ENUM) {
      const record = toRecord(row({ type }), NOW);
      expect(record?.actionability, type).toBe("ACTION_UNKNOWN");
    }
  });

  it("offers a destination only where one really exists", () => {
    const community = toRecord(
      row({ type: "community_reply", metadata: { discussionId: "abcd1234efgh" } }),
      NOW,
    );
    expect(community?.destination).toBe("AVAILABLE");
    expect(community?.handoff).toEqual({ label: "Открыть обсуждение", href: "/community/d/abcd1234efgh" });

    expect(toRecord(row({ type: "system" }), NOW)?.destination).toBe("NO_DESTINATION_NEEDED");
    expect(toRecord(row({ type: "system" }), NOW)?.handoff).toBeNull();
  });

  it("refuses a destination the metadata cannot support", () => {
    const bad = toRecord(row({ type: "community_reply", metadata: { discussionId: "../etc" } }), NOW);
    expect(bad?.handoff).toBeNull();
    expect(bad?.destination).toBe("NO_DESTINATION_NEEDED");
  });

  it("labels the return without manufacturing urgency", () => {
    for (const type of ENUM) {
      const label = handoffLabel(type);
      if (!label) continue;
      expect(label).not.toMatch(/срочн|немедленн|не пропуст/i);
    }
  });

  it("reads consumption from the real readAt and nothing else", () => {
    expect(toRecord(row({ readAt: null }), NOW)?.consumption).toBe("UNREAD");
    expect(toRecord(row({ readAt: "2026-08-24T14:30:00.000Z" }), NOW)?.consumption).toBe("READ");
  });

  it("does not repeat the statement as its own reason", () => {
    const same = toRecord(row({ title: "Одно и то же.", message: "Одно и то же." }), NOW);
    expect(same?.reason).toBeNull();
    const different = toRecord(row({ title: "Заголовок.", message: "Причина." }), NOW);
    expect(different?.reason).toBe("Причина.");
  });

  it("carries a machine instant beside the human time", () => {
    const record = toRecord(row({ createdAt: "2026-08-24T14:20:00.000Z" }), NOW);
    expect(record?.timeMachine).toBe("2026-08-24T14:20:00.000Z");
    expect(new Date(record!.timeMachine).getTime()).not.toBeNaN();
  });

  it("writes today, yesterday and a date, in the frozen shape", () => {
    const now = new Date(2026, 7, 24, 15, 0);
    expect(humanTime(new Date(2026, 7, 24, 14, 20), now)).toBe("Сегодня, 14:20");
    expect(humanTime(new Date(2026, 7, 23, 18, 10), now)).toBe("Вчера, 18:10");
    expect(humanTime(new Date(2026, 7, 12, 10, 15), now)).toBe("12 авг, 10:15");
    /* Midnight is today, not yesterday — the boundary is the day, not 24 hours. */
    expect(humanTime(new Date(2026, 7, 24, 0, 0), now)).toBe("Сегодня, 00:00");
  });

  it("withholds the page-level action claim in every state but the empty one", () => {
    expect(presenceFor("SUCCESS", 5)).toBe("WITHHELD");
    expect(presenceFor("LOADING", 0)).toBe("WITHHELD");
    expect(presenceFor("FAILURE", 3)).toBe("WITHHELD");
    /* Scope-limited and true: there is nothing here, so nothing here is asking. */
    expect(presenceFor("SUCCESS", 0)).toBe("NONE_SCOPED");
  });
});

/* ------------------------------------------------------------- composition */

describe("Notifications — the frozen composition", () => {
  it("keeps the page title in every state, and only one h1", async () => {
    const { container } = render(<NotificationsFidelity />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector(".n-page__title")?.textContent).toBe(COPY.title);
    await waitFor(() => expect(container.querySelector(".n-state--empty")).not.toBeNull());
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("shows placeholders shaped like the content that is coming, announced not shown", () => {
    const { container } = render(<NotificationsFidelity />);
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy!.getAttribute("role")).toBe("status");
    expect(within(busy as HTMLElement).getByText(COPY.loadingAnnouncement)).toBeTruthy();
    expect(container.querySelectorAll(".n-skeleton__row")).toHaveLength(3);
    for (const bone of Array.from(container.querySelectorAll(".n-skeleton__row"))) {
      expect(bone.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("renders the register as a semantic collection with the frozen record anatomy", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        items: [
          row({ id: 1, type: "task_report_rejected", title: "Отчёт возвращён.", message: "Есть замечания." }),
          row({ id: 2, type: "level_up", title: "Уровень пройден.", message: "Уровень пройден.", readAt: "2026-08-24T10:00:00.000Z" }),
        ],
      }),
    );
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelectorAll(".n-record")).toHaveLength(2));

    const register = container.querySelector(".n-register")!;
    expect(register.tagName).toBe("UL");
    expect(register.getAttribute("aria-label")).toBe(COPY.registerLabel);
    expect(register.hasAttribute("data-confidence")).toBe(false);

    const first = container.querySelector(".n-record")!;
    expect(first.classList.contains("n-grid")).toBe(true);
    expect(first.getAttribute("data-consumption")).toBe("UNREAD");
    expect(first.querySelector(".n-time")?.getAttribute("datetime")).toBe("2026-08-24T14:20:00.000Z");
    expect(first.querySelector(".n-record__statement")?.textContent).toContain("Отчёт возвращён.");
    expect(first.querySelector(".n-record__support")?.textContent).toBe("Есть замечания.");
    expect(first.querySelector(".n-record__meta")?.textContent).toBe("Отчёт · Проверка");

    /* The read record drops the support line only because it repeated itself. */
    const second = container.querySelectorAll(".n-record")[1]!;
    expect(second.getAttribute("data-consumption")).toBe("READ");
    expect(second.querySelector(".n-record__support")).toBeNull();
  });

  it("never renders the Signal mark, because nothing can confirm a current action", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ items: ENUM.map((type, i) => row({ id: i, type })) }),
    );
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelectorAll(".n-record").length).toBe(ENUM.length));
    expect(container.querySelectorAll(".n-mark--action")).toHaveLength(0);
    expect(container.querySelectorAll(".n-presence")).toHaveLength(0);
    for (const record of Array.from(container.querySelectorAll(".n-record"))) {
      expect(record.getAttribute("data-action-confirmed")).toBe("0");
      expect(record.getAttribute("data-actionability")).toBe("ACTION_UNKNOWN");
    }
  });

  it("states unread with a mark AND with words, never with the mark alone", async () => {
    vi.stubGlobal("fetch", respondWith({ items: [row({ id: 1 })] }));
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelector(".n-record")).not.toBeNull());
    const marks = container.querySelector(".n-marks")!;
    expect(marks.querySelector(".n-mark--unread")?.getAttribute("aria-hidden")).toBe("true");
    expect(marks.textContent).toContain("не прочитано");
    expect(container.querySelector(".n-record__statement")?.textContent).toContain("Не прочитано");
  });

  it("makes the handoff an explicit control and never the whole row", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        items: [row({ id: 1, type: "community_reply", metadata: { discussionId: "abcd1234efgh" } })],
      }),
    );
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelector(".n-action")).not.toBeNull());
    const record = container.querySelector(".n-record")!;
    expect(record.querySelectorAll("a")).toHaveLength(1);
    expect(record.querySelector("a")!.className).toBe("n-action");
    expect(record.querySelector("a")!.getAttribute("href")).toBe("/community/d/abcd1234efgh");
    /* At most one handoff per record — Notifications hosts no mini-workflows. */
    expect(record.querySelectorAll(".n-action")).toHaveLength(1);
  });

  it("says the register is empty without inventing anything to put in it", async () => {
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelector(".n-state--empty")).not.toBeNull());
    expect(container.querySelector(".n-state__lead")?.textContent).toBe(COPY.emptyLead);
    expect(container.querySelectorAll(".n-record")).toHaveLength(0);
    /* The empty state is the one place a NONE claim is both scoped and true. */
    expect(container.querySelector('[data-presence="none"]')).not.toBeNull();
    expect(container.querySelector(".n-presence__text")?.textContent).toBe(COPY.presenceNone);
  });

  it("suppresses an unrepresentable type without telling the learner it did", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({
        items: [row({ id: 1, type: "system" }), row({ id: 2, type: "not_a_known_type" })],
      }),
    );
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelectorAll(".n-record")).toHaveLength(1));
    expect(container.textContent).not.toContain("not_a_known_type");
    expect(container.textContent).not.toMatch(/не удалось отобразить|скрыт/i);
  });

  it("fails as an alert with a real recovery control", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelector(".n-state--failure")).not.toBeNull());
    const block = container.querySelector(".n-state--failure")!;
    expect(block.getAttribute("role")).toBe("alert");
    expect(block.querySelector(".n-state__lead")?.textContent).toBe(COPY.failureLead);
    expect(block.querySelector(".n-state__bar")).not.toBeNull();
    expect(screen.getByRole("button", { name: COPY.failureRecovery })).toBeTruthy();
  });

  it("keeps the last-known register on a failed refresh, and says so once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [row({ id: 1, type: "system", title: "Первое." })] }),
      } as unknown as Response)
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelectorAll(".n-record")).toHaveLength(1));

    await userEvent.click(container.querySelector(".n-recover") ?? document.body);
    await waitFor(() => expect(container.querySelector(".n-state--failure")).not.toBeNull());
    /* Nothing was deleted: the register is still there, and the whole of it —
       not any single record — is marked unconfirmed, exactly once. */
    expect(container.querySelectorAll(".n-record")).toHaveLength(1);
    const marked = container.querySelectorAll('[data-confidence="last-known"]');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.classList.contains("n-register")).toBe(true);
    expect(container.querySelector(".n-state__support")?.textContent).toBe(
      COPY.failureReasonStale,
    );
    /* Still no action claim over a last-known register. */
    expect(container.querySelectorAll(".n-mark--action")).toHaveLength(0);
    expect(container.querySelectorAll(".n-presence")).toHaveLength(0);
  });

  it("says a cold failure differently, because there is nothing to keep", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelector(".n-state--failure")).not.toBeNull());
    expect(container.querySelector(".n-state__support")?.textContent).toBe(COPY.failureReasonCold);
    expect(container.querySelectorAll("[data-confidence]")).toHaveLength(0);
  });

  it("recovers when the retry succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [row({ id: 9, type: "system", title: "Пришло." })] }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<NotificationsFidelity />);
    await waitFor(() => expect(container.querySelector(".n-recover")).not.toBeNull());
    await userEvent.click(container.querySelector(".n-recover") as HTMLElement);
    await waitFor(() => expect(container.querySelectorAll(".n-record")).toHaveLength(1));
    expect(container.querySelector(".n-state--failure")).toBeNull();
    expect(container.querySelector(".n-record__statement")?.textContent).toContain("Пришло.");
  });
});

/* ------------------------------------------------ the prototype stays behind */

describe("Notifications — what did not cross over", () => {
  const surface = codeOnly(SRC("notifications-fidelity.tsx"));
  const state = codeOnly(SRC("notifications-state.ts"));

  it("carries no Phase-4 fixture copy", () => {
    for (const fixture of [
      "Отчёт по уровню 3 возвращён на доработку",
      "Наставник оставил замечания к расчёту риска",
      "Уровень 40 · Контрольная точка",
      "Показать более ранние",
      "Есть изменение, которое сейчас требует вашего действия",
    ]) {
      expect(surface, fixture).not.toContain(fixture);
      expect(state, fixture).not.toContain(fixture);
    }
  });

  it("offers no retrieval control, because there is no retrieval behind it", () => {
    expect(surface).not.toContain("n-retrieve");
  });

  it("never writes: consumption is rendered, never changed from here", () => {
    expect(surface).not.toContain("/read");
    expect(surface).not.toContain("read-all");
    expect(surface).not.toMatch(/method:\s*"POST"/);
  });

  it("does not re-create the prototype's shell", () => {
    expect(surface).not.toContain("<main");
    expect(surface).not.toContain("AcademyShell");
    expect(surface).not.toContain("nav-unread");
  });
});

/* ------------------------------------------------------------------ styles */

describe("Notifications — the stylesheet is scoped and local", () => {
  const css = readFileSync(
    join(process.cwd(), "src/features/notifications-fidelity/notifications-fidelity.css"),
    "utf8",
  );
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("makes no remote request", () => {
    expect(bare).not.toContain("@import");
    expect(bare).not.toMatch(/https?:\/\//);
  });

  it("binds both families to the product's local faces", () => {
    expect(bare).toContain('"ATA Manrope"');
    expect(bare).toContain('"ATA IBM Plex Mono"');
    expect(bare).not.toMatch(/"Manrope"/);
    expect(bare).not.toMatch(/"IBM Plex Mono"/);
  });

  it("lets no selector escape the .nt namespace", () => {
    const escapees: string[] = [];
    const walk = (block: string) => {
      let i = 0;
      while (i < block.length) {
        const open = block.indexOf("{", i);
        if (open === -1) break;
        const prelude = block.slice(i, open).trim();
        let depth = 1;
        let k = open + 1;
        while (k < block.length && depth > 0) {
          if (block[k] === "{") depth++;
          else if (block[k] === "}") depth--;
          k++;
        }
        const inner = block.slice(open + 1, k - 1);
        if (prelude.startsWith("@")) {
          if (/^@(media|supports)/.test(prelude)) walk(inner);
        } else {
          for (const part of prelude.split(",")) {
            const s = part.trim();
            if (s && !s.startsWith(".nt") && !s.startsWith("html.nt-root-scope")) escapees.push(s);
          }
        }
        i = k;
      }
    };
    walk(bare);
    expect(escapees).toEqual([]);
  });

  it("keeps the one grid that makes the notation strip continuous", () => {
    expect(bare).toMatch(/\.nt \.n-grid\{[^}]*grid-template-columns:var\(--note-col\) minmax\(0,1fr\)/);
  });

  it("gives the record no border, no background and no container", () => {
    const record = bare.match(/\.nt \.n-record\{([^}]*)\}/)?.[1] ?? "";
    expect(record).not.toContain("border");
    expect(record).not.toContain("background");
  });
});
