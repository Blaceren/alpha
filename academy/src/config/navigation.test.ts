import { describe, it, expect } from "vitest";
import { PRIMARY_NAV, MOBILE_NAV, MORE_MENU } from "@/config/navigation";

describe("navigation model", () => {
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
      "Поддержка",
    ]);
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
