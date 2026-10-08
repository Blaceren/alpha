/**
 * THE SHELL SHOWS NO WAY INTO A WITHHELD SECTION.
 *
 * Community is built and answers, and is withheld from the learner product
 * (config/feature-visibility.ts). This file used to also hold the «Ещё»
 * contract «as accepted for Support and Profile»: support has since moved into
 * the profile (owner, 2026-10-03: «что бы написать в поддержку можно было
 * только из профиля, не по ссылке из хеда»), and with one destination left
 * behind it «Ещё» became the bar's «Профиль» slot. That contract is held in
 * more-menu-disclosure.test.tsx, with Community shown — the day it returns.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AppShell } from "@/components/shell/app-shell";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { DesktopRouteNavigation } from "@/components/navigation/desktop-route-navigation";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const shell = (activeId: string) =>
  render(
    <AppShell userName="Мария Ковалёва" activeId={activeId} frozenSurface>
      <div>тело</div>
    </AppShell>,
  );

describe("Community is not reachable from the shell", () => {
  it("renders no Community link and no Community label anywhere in the shell", () => {
    for (const activeId of ["home", "path", "lessons", "tools", "notifications", "profile"]) {
      const { container, unmount } = shell(activeId);
      expect(container.querySelectorAll('a[href^="/community"]')).toHaveLength(0);
      expect(container.textContent).not.toContain("Сообщество");
      unmount();
    }
  });

  it("draws no desktop secondary group: with Community withheld and support in the profile it would be empty", () => {
    const { container } = render(<DesktopRouteNavigation activeId="home" />);
    expect(container.querySelector(".rnav__group--secondary")).toBeNull();
    expect(container.querySelector(".rnav__rule")).toBeNull();
  });

  it("keeps the mobile bar to the four sections and «Профиль», with no menu of one", () => {
    const { container } = render(<MobileBottomNavigation activeId="home" />);
    expect([...container.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "/home",
      "/path",
      "/lessons",
      "/tools",
      "/profile",
    ]);
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("the current-state contract survives Community leaving", () => {
  it("never declares two currents in the bottom bar, on any route", () => {
    for (const id of ["home", "path", "lessons", "tools", "notifications", "profile"]) {
      const { container, unmount } = render(<MobileBottomNavigation activeId={id} />);
      expect(container.querySelectorAll("[aria-current]").length, id).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it("/profile: the bar's «Профиль» carries the page on mobile, and the mobile avatar does not as well", () => {
    const { container } = shell("profile");
    expect(container.querySelector('.bottomnav a[href="/profile"]')!.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector(".mtop a.avatar")!.getAttribute("aria-current")).toBeNull();
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  });
});
