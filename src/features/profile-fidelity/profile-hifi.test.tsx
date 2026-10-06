/**
 * PROFILE, A NORMAL ONE, HI-FI (owner, 2026-10-03: «наполни как нормальный
 * профиль на платформе, поддержку тоже сюда переноси, что бы написать в
 * поддержку можно было только из профиля … как наполнишь так же сделай хай
 * фай»; DD-337).
 *
 * The passport says who the learner is and how far they have come — counts the
 * Backend already gave, nothing of another product. Support is a part of the
 * profile. Signing out is where a person looks for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { programPosition } from "@/lib/curriculum/program-points";
import { resolveToolWindows } from "@/features/tool-windows/model/access";
import { initials, profileFacts, ringModel } from "@/features/profile-fidelity/profile-record";
import { ProfilePassport } from "@/features/profile-fidelity/profile-passport";
import { ProfileTabs, PROFILE_PARTS } from "@/features/profile-fidelity/profile-tabs";
import { isAccountView } from "@/lib/account/account-types";
import { levelFourProgram, program } from "@/test/program-fixture";

const listSupportCases = vi.fn();
vi.mock("@/lib/support/support-client", () => ({ listSupportCases: () => listSupportCases() }));
const logout = vi.fn(async () => {});
let session: unknown = null;
vi.mock("@/features/auth/use-session", () => ({ useOptionalSession: () => session }));

import { ProfileExit, EXIT_COPY } from "@/features/profile-fidelity/profile-exit";

const ROOT = process.cwd();
const SRC = (f: string) => readFileSync(join(ROOT, "src/features/profile-fidelity", f), "utf8");
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TOOLS = { total: 6, unlockedCount: 2, tools: [
  { code: "tool.trade_card", unlocked: true, unlockLevel: 5 },
  { code: "tool.trading_journal", unlocked: true, unlockLevel: 9 },
] };

beforeEach(() => {
  listSupportCases.mockReset();
  logout.mockClear();
  session = null;
});

describe("the record", () => {
  it("says where the learner is, how far they came, their XP and their tools", () => {
    const position = programPosition(levelFourProgram());
    expect(profileFacts(position, resolveToolWindows(TOOLS)).map((f) => `${f.label}: ${f.value}`)).toEqual([
      "Сейчас: уровень 4 из 30",
      "Пройдено: 3 из 30",
      "Опыт: 300 XP",
      "Инструменты: 2 из 6",
    ]);
  });

  it("says so when every open level is done, and says nothing without a program", () => {
    const resting = programPosition(program([{ levels: "dd" }, { levels: "pp" }]));
    expect(profileFacts(resting, null)[0]!.value).toBe("открытые уровни пройдены");
    expect(profileFacts(null, null)).toEqual([]);
  });

  it("takes the shell avatar's initials", () => {
    expect(initials("Вера Четвёртая")).toBe("ВЧ");
    expect(initials("Анна")).toBe("А");
    expect(initials("Анна Мария Петровна")).toBe("АМ");
  });
});

describe("the ring", () => {
  const onCircle = (x: number, y: number) => Math.hypot(x - 60, y - 60);
  const ends = (d: string) => {
    const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    return [[n[0]!, n[1]!], [n[n.length - 2]!, n[n.length - 1]!]] as const;
  };

  it("draws a stretch per module, lit as far as the learner has come", () => {
    const ring = ringModel(programPosition(levelFourProgram()));
    expect(ring.modules).toHaveLength(6);
    expect(ring.modules.map((m) => m.lit !== null)).toEqual([true, false, false, false, false, false]);
    expect(ring.modules.map((m) => m.preparing)).toEqual([false, false, false, true, true, true]);
  });

  it("puts the current level on the ring as one point, and no point when none is in front", () => {
    const ring = ringModel(programPosition(levelFourProgram()));
    expect(onCircle(ring.current!.x, ring.current!.y)).toBeCloseTo(54, 1);
    // Level 4 of 30 sits in the first quarter, right of the top.
    expect(ring.current!.x).toBeGreaterThan(60);
    expect(ring.current!.y).toBeLessThan(60);
    expect(ringModel(programPosition(program([{ levels: "dd" }, { levels: "pp" }]))).current).toBeNull();
  });

  it("keeps every stretch on the circle and inside the picture", () => {
    for (const stretch of ringModel(programPosition(levelFourProgram())).modules) {
      for (const d of [stretch.track, stretch.lit].filter((x): x is string => x !== null)) {
        for (const [x, y] of ends(d)) {
          expect(onCircle(x, y)).toBeCloseTo(54, 1);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(120);
        }
      }
    }
  });

  it("lights a finished module whole", () => {
    const ring = ringModel(programPosition(program([{ levels: "ddd" }, { levels: "ca" }])));
    expect(ring.modules[0]!.lit).toBe(ring.modules[0]!.track);
  });

  it("is empty for a learner without a program", () => {
    expect(ringModel(programPosition(program([])))).toEqual({ modules: [], current: null });
  });
});

describe("the passport", () => {
  const account = { email: "vera@example.invalid", verified: true, memberSince: "2026-10-02T09:15:00.000Z" };

  it("names the learner and their address, the day they joined, and their record", () => {
    const { container } = render(
      <ProfilePassport name="Вера Четвёртая" account={account} position={programPosition(levelFourProgram())} tools={resolveToolWindows(TOOLS)} />,
    );
    expect(container.querySelector('[data-role="passport-name"]')!.textContent).toBe("Вера Четвёртая");
    expect(container.querySelector(".pp-mail")!.textContent).toBe("vera@example.invalid · подтверждён");
    expect(container.querySelector(".pp-since")!.textContent).toBe("В Академии с 2 октября 2026");
    expect(container.querySelector(".pp-since time")!.getAttribute("datetime")).toBe(account.memberSince);
    expect(container.querySelectorAll(".pp-fact")).toHaveLength(4);
    expect(screen.getByRole("link", { name: "Открыть путь" })).toHaveAttribute("href", "/path");
    expect(container.querySelector(".pp-ring")!.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".pp-ring__point")).toHaveLength(1);
    expect(container.querySelectorAll(".pp-ring__track")).toHaveLength(6);
  });

  it("does not state confirmation where the Backend cannot confirm, and drops what it does not know", () => {
    const { container } = render(
      <ProfilePassport name="Вера" account={{ email: "vera@example.invalid", verified: null, memberSince: null }} position={null} tools={null} />,
    );
    expect(container.querySelector(".pp-mail")!.textContent).toBe("vera@example.invalid");
    expect(container.querySelector(".pp-since")).toBeNull();
    expect(container.querySelector(".pp-record")).toBeNull();
    expect(container.querySelector(".pp-ring__empty")).not.toBeNull();
  });

  it("is not a heading: the page keeps its one h1", () => {
    const { container } = render(<ProfilePassport name="Вера" account={account} position={null} tools={null} />);
    expect(container.querySelectorAll("h1, h2, h3")).toHaveLength(0);
  });
});

describe("the parts", () => {
  it("are two links between two addresses, and the current one says so", () => {
    expect(PROFILE_PARTS.map((p) => [p.label, p.href])).toEqual([
      ["Аккаунт", "/profile"],
      ["Поддержка", "/profile/support"],
    ]);
    render(<ProfileTabs current="account" />);
    expect(screen.getByRole("navigation", { name: "Разделы профиля" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Аккаунт" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Поддержка" })).not.toHaveAttribute("aria-current");
  });
});

describe("the account tab has no support card beside its rows (owner, 2026-10-06, DD-349)", () => {
  it("is not rendered, and the component is gone", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(app)/profile/page.tsx"), "utf8");
    expect(page).not.toContain("ProfileSupportCard");
    expect(page).not.toMatch(/aside=\{/);
    expect(existsSync(join(process.cwd(), "src/features/profile-fidelity/profile-support-card.tsx"))).toBe(false);
    // The way into support stays: the «Поддержка» tab, and the email row's own link.
    expect(page).toContain('<ProfileTabs current="account" />');
  });
});

describe("signing out", () => {
  it("is drawn only for a real session, and runs the session's own logout", async () => {
    const nobody = render(<ProfileExit />);
    expect(nobody.container.innerHTML).toBe("");
    nobody.unmount();

    session = { viewer: { synthetic: true }, logout };
    const fixture = render(<ProfileExit />);
    expect(fixture.container.innerHTML).toBe("");
    fixture.unmount();

    session = { viewer: { synthetic: false, name: "Вера" }, logout };
    render(<ProfileExit />);
    expect(screen.getByRole("heading", { level: 2, name: EXIT_COPY.section })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: EXIT_COPY.action }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe("the day the account was made", () => {
  const base = { account: { email: "a@example.invalid", emailVerified: true, pendingEmail: null }, capabilities: { passwordRecovery: false, emailVerification: false, emailChange: false } };

  it("is read when the Backend sends it, and not required from one that does not", () => {
    expect(isAccountView(base)).toBe(true);
    expect(isAccountView({ ...base, account: { ...base.account, memberSince: "2026-10-02T09:15:00.000Z" } })).toBe(true);
    expect(isAccountView({ ...base, account: { ...base.account, memberSince: null } })).toBe(true);
    expect(isAccountView({ ...base, account: { ...base.account, memberSince: 42 } })).toBe(false);
  });
});

describe("what the profile never shows", () => {
  const code = ["profile-passport.tsx", "profile-record.ts", "profile-tabs.tsx", "profile-exit.tsx"]
    .map((f) => codeOnly(SRC(f)))
    .join("\n");

  it("nothing of another product, and no amount", () => {
    for (const word of ["balance", "баланс", "deposit", "депозит", "Pocket", "affiliate", "партнёр", "телефон", "phone"]) {
      expect(code, word).not.toContain(word);
    }
    expect(code).not.toMatch(/\$\s?\d/);
  });
});

describe("the stylesheet is scoped", () => {
  it("lets no selector escape the profile or its support desk", () => {
    const css = SRC("profile-hifi.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const heads = [...css.matchAll(/([^{}]+)\{/g)].map((m) => (m[1] ?? "").trim()).filter((h) => h && !h.startsWith("@"));
    for (const head of heads) {
      for (const part of head.split(",").map((p) => p.trim()).filter(Boolean)) {
        expect(part.startsWith(".pf.pf--hifi") || part.startsWith(".pp-support"), part).toBe(true);
      }
    }
  });
});
