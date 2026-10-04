/**
 * LO-ACADEMY-SUPPORT-UNREACHABLE-1 — the support surface must be reachable.
 *
 * These fail against the pre-fix navigation, where both bars rendered
 * `MOBILE_NAV` gated on a hardcoded `BUILT_ROUTES` that omitted `support`, and
 * the "Ещё" item that would have surfaced `MORE_MENU` was itself disabled — so
 * `/support` rendered perfectly and nothing in the product could reach it.
 *
 * 2026-10-03 — THE PROPERTY STANDS, THE PATH MOVED. The owner: «что бы написать
 * в поддержку можно было только из профиля, не по ссылке из хеда». Support is
 * a part of the profile now (`/profile/support`), so neither bar links it; the
 * learner reaches it through the profile — the avatar on a wide screen, the
 * bar's «Профиль» on a phone — and the profile's «Поддержка». `/support` still
 * answers, with a redirect there.
 */
import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesktopRouteNavigation } from "./desktop-route-navigation";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ProfileTabs } from "@/features/profile-fidelity/profile-tabs";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute, BUILT_ROUTE_IDS } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

describe("support is reachable — through the profile", () => {
  it("desktop: the avatar leads to the profile, and the profile's «Поддержка» to the desk", () => {
    const { container, unmount } = render(
      <AppShell userName="Мария Ковалёва" activeId="home">
        <p>тело</p>
      </AppShell>,
    );
    expect(container.querySelector('.appbar a.avatar')).toHaveAttribute("href", "/profile");
    unmount();
    render(<ProfileTabs current="account" />);
    const parts = screen.getByRole("navigation", { name: "Разделы профиля" });
    expect(within(parts).getByRole("link", { name: "Поддержка" })).toHaveAttribute("href", "/profile/support");
  });

  it("mobile: «Профиль» is a slot of the bar, one tap from the desk's part", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const nav = screen.getByRole("navigation", { name: "Мобильная навигация" });
    expect(within(nav).getByRole("link", { name: /Профиль/ })).toHaveAttribute("href", "/profile");
  });

  it("neither bar links support itself", () => {
    const { container } = render(
      <AppShell userName="Мария Ковалёва" activeId="profile">
        <p>тело</p>
      </AppShell>,
    );
    expect(container.querySelector('a[href="/support"]')).toBeNull();
    expect(container.querySelector('a[href="/profile/support"]')).toBeNull();
    expect(container.textContent).not.toContain("Поддержка");
  });

  it("renders NO disabled section control in either bar", () => {
    // A control that advertises a section which does not exist is a promise the
    // product cannot keep — and it is what hid /support after it shipped. The
    // assertion is about DISABLED, not about the absence of buttons: «Ещё» is a
    // button now, and an enabled one that opens a real menu is the fix, not the
    // defect.
    const { unmount } = render(<DesktopRouteNavigation />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    unmount();
    render(<MobileBottomNavigation />);
    for (const button of screen.queryAllByRole("button")) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("marks the active section with aria-current, not colour alone", () => {
    render(<DesktopRouteNavigation activeId="tools" />);
    expect(screen.getByRole("link", { name: "Инструменты" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks the support part as the profile's current part on its page", () => {
    render(<ProfileTabs current="support" />);
    expect(screen.getByRole("link", { name: "Поддержка" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Аккаунт" })).not.toHaveAttribute("aria-current");
  });

  it("renders every built section and nothing that is not built", () => {
    render(<DesktopRouteNavigation />);
    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    const rendered = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    const expected = PRIMARY_NAV.filter((i) => isBuiltRoute(i.id) && isVisibleSection(i.id)).map((i) => i.href);
    expect(rendered).toEqual(expected);
    // COMMUNITY-V1 built /community and it still answers, but the section is
    // withheld from the learner product, so the bar must NOT advertise it. The
    // route is still built - that is a separate question, asserted below.
    // property this guards is "the advertised list matches reality", and
    // reality moved. /news is still unbuilt and still carries the assertion:
    // an unbuilt section is genuinely absent rather than disabled.
    expect(rendered).not.toContain("/community");
    expect(rendered).not.toContain("/news");
  });

  it("keeps the built list as ONE source both bars read", () => {
    // `/support` still answers — with a redirect into the profile — so it stays
    // built; it is simply no longer a section of either bar.
    expect(BUILT_ROUTE_IDS.has("support")).toBe(true);
    for (const id of ["home", "path", "lessons", "tools"]) {
      expect(BUILT_ROUTE_IDS.has(id)).toBe(true);
    }
    // ACADEMY-EXPERIENCE-COMPLETION-1 built notifications and profile, so the
      // list has to say so. Updated rather than deleted: what this protects is
      // "the advertised list matches reality", and reality moved.
      for (const id of ["notifications", "profile"]) {
        expect(BUILT_ROUTE_IDS.has(id), `${id} is built and must be reachable`).toBe(true);
      }
      // COMMUNITY-V1. The route was advertised in the navigation model from the
      // start and existed nowhere, which is the exact failure this file was
      // created for. It answers now.
      // Built, and deliberately not shown: the two questions stay separate.
      expect(BUILT_ROUTE_IDS.has("community"), "community is still built").toBe(true);
      expect(isVisibleSection("community"), "community is withheld from the product").toBe(false);
      for (const id of ["news", "referrals", "mentor", "settings"]) {
      expect(BUILT_ROUTE_IDS.has(id), `${id} is not a built route`).toBe(false);
    }
  });
});
