import { describe, it, expect } from "vitest";
import { PRIMARY_NAV, MOBILE_NAV, MORE_MENU } from "@/config/navigation";

describe("navigation model", () => {
  /* «Поддержка» left the list on 2026-10-03: support is a part of the profile
     (owner: «что бы написать в поддержку можно было только из профиля, не по
     ссылке из хеда»), reached at /profile/support. */
  it("desktop nav uses the canonical RU labels in order", () => {
    expect(PRIMARY_NAV.map((n) => n.label)).toEqual([
      "Главная",
      "Путь",
      "Уроки",
      "Инструменты",
      "Сообщество",
      "Новости",
      "Рефералы",
      "Ментор",
    ]);
  });

  it("carries no support entry in either list", () => {
    for (const item of [...PRIMARY_NAV, ...MORE_MENU]) {
      expect(item.id).not.toBe("support");
      expect(item.href).not.toMatch(/support/);
    }
  });

  it("mobile nav is 5 items ending with Ещё", () => {
    expect(MOBILE_NAV).toHaveLength(5);
    expect(MOBILE_NAV.map((n) => n.label)).toEqual([
      "Главная",
      "Путь",
      "Уроки",
      "Инструменты",
      "Ещё",
    ]);
  });

  /* The canonical lists. What the bar DRAWS is mobile-slots.ts: with one
     destination left behind «Ещё», «Профиль» takes the fifth slot itself. */
  it("Профиль lives in the More menu (reachable via avatar), not the bottom bar", () => {
    expect(MOBILE_NAV.map((n) => n.id)).not.toContain("profile");
    expect(MORE_MENU.map((n) => n.label)).toContain("Профиль");
    expect(MORE_MENU.map((n) => n.label)).toContain("Настройки");
  });

  it("has no English user-facing nav labels", () => {
    const labels = [...PRIMARY_NAV, ...MOBILE_NAV, ...MORE_MENU].map((n) => n.label);
    for (const l of labels) {
      expect(l).not.toMatch(/community|mentor|support|tools|referral/i);
    }
  });
});
