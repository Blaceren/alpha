/**
 * LO-ACADEMY-SUPPORT-UNREACHABLE-1 — the support surface must be reachable.
 *
 * These fail against the pre-fix navigation, where both bars rendered
 * `MOBILE_NAV` gated on a hardcoded `BUILT_ROUTES` that omitted `support`, and
 * the "Ещё" item that would have surfaced `MORE_MENU` was itself disabled — so
 * `/support` rendered perfectly and nothing in the product could reach it.
 */
import * as React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesktopRouteNavigation } from "./desktop-route-navigation";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute, BUILT_ROUTE_IDS } from "@/config/built-routes";

describe("support is reachable from the learner navigation", () => {
  it("desktop nav offers Поддержка as a real link to /support", () => {
    render(<DesktopRouteNavigation activeId="home" />);
    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    const link = within(nav).getByRole("link", { name: "Поддержка" });
    expect(link).toHaveAttribute("href", "/support");
  });

  it("mobile bar offers Поддержка as a real link to /support", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const nav = screen.getByRole("navigation", { name: "Мобильная навигация" });
    const link = within(nav).getByRole("link", { name: /Поддержка/ });
    expect(link).toHaveAttribute("href", "/support");
  });

  it("renders NO disabled section buttons in either bar", () => {
    // A control that advertises a section which does not exist is a promise the
    // product cannot keep — and it is what hid /support after it shipped.
    const { unmount } = render(<DesktopRouteNavigation />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    unmount();
    render(<MobileBottomNavigation />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("marks the active section with aria-current, not colour alone", () => {
    render(<DesktopRouteNavigation activeId="support" />);
    expect(screen.getByRole("link", { name: "Поддержка" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders every built section and nothing that is not built", () => {
    render(<DesktopRouteNavigation />);
    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    const rendered = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    const expected = PRIMARY_NAV.filter((i) => isBuiltRoute(i.id)).map((i) => i.href);
    expect(rendered).toEqual(expected);
    // And an unbuilt section is genuinely absent rather than disabled.
    expect(rendered).not.toContain("/community");
    expect(rendered).not.toContain("/news");
  });

  it("keeps the built list as ONE source both bars read", () => {
    expect(BUILT_ROUTE_IDS.has("support")).toBe(true);
    for (const id of ["home", "path", "lessons", "tools"]) {
      expect(BUILT_ROUTE_IDS.has(id)).toBe(true);
    }
    for (const id of ["community", "news", "referrals", "mentor", "profile", "settings"]) {
      expect(BUILT_ROUTE_IDS.has(id), `${id} is not a built route`).toBe(false);
    }
  });
});
