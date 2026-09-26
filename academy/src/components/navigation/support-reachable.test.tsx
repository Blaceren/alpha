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
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DesktopRouteNavigation } from "./desktop-route-navigation";
import { MobileBottomNavigation } from "./mobile-bottom-navigation";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute, BUILT_ROUTE_IDS } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";

describe("support is reachable from the learner navigation", () => {
  it("desktop nav offers Поддержка as a real link to /support", () => {
    render(<DesktopRouteNavigation activeId="home" />);
    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    const link = within(nav).getByRole("link", { name: "Поддержка" });
    expect(link).toHaveAttribute("href", "/support");
  });

  it("mobile bar reaches Поддержка — in the bar or one tap inside «Ещё»", async () => {
    // COMMUNITY-V1 made this a six-section product, and six flat slots clipped
    // Поддержка off a 320px screen. It now lives behind a REAL «Ещё», so the
    // property this test protects — Поддержка is reachable from the mobile
    // navigation — is unchanged while the shape that delivers it is not.
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    const nav = screen.getByRole("navigation", { name: "Мобильная навигация" });
    await user.click(within(nav).getByRole("button", { name: /Ещё/ }));
    expect(within(nav).getByRole("link", { name: /Поддержка/ })).toHaveAttribute(
      "href",
      "/support",
    );
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
