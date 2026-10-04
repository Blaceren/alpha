import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { MORE_MENU, PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { isVisibleSection } from "@/config/feature-visibility";

/**
 * The bottom bar is the mobile primary navigation.
 *
 * LEARNER-OPERATIONS-V1 fixed two defects here. `/support` shipped and the
 * hardcoded built-list still said it had not, so the surface was unreachable.
 * And «Ещё» was rendered as a DISABLED button because its own id was not in
 * that list — an overflow control that could never open the menu it existed
 * for, hiding every section inside it. It was removed with a note: when a sixth
 * section ships, it comes back as a real control.
 *
 * COMMUNITY-V1 shipped the sixth section. The bar rendered all six flat, its
 * content measured 366px, and at a 320px layout viewport «Поддержка» ran from
 * x=307 to x=366 — off the right edge, clipped and untappable. So «Ещё» is back,
 * as a real disclosure control.
 *
 * WHAT THESE TESTS HOLD. Not "five links" — that was a fact, not a property.
 * The properties are: every built section is REACHABLE from this bar in at most
 * one extra tap, nothing unbuilt is advertised, no control is disabled, and no
 * section is both in the bar and in the sheet or in neither.
 *
 * 2026-10-03 — SUPPORT MOVED INTO THE PROFILE (owner: «что бы написать в
 * поддержку можно было только из профиля, не по ссылке из хеда»). With Community
 * withheld, «Ещё» would have opened a sheet with one row, «Профиль»; a menu of
 * one is a detour, so the row takes the fifth slot itself (`mobile-slots.ts`).
 * The same properties hold. «Ещё» and its sheet are still the bar's answer the
 * day two destinations are behind it again — more-menu-disclosure.test.tsx
 * holds that bar, with Community shown.
 */
/* Built AND shown. Community is built and answers, but is withheld from the
   learner product today, so the bar is not expected to advertise it -
   see config/feature-visibility.ts. */
const BUILT = PRIMARY_NAV.filter((item) => isBuiltRoute(item.id) && isVisibleSection(item.id));
/**
 * Everything the bar is responsible for delivering: the built primary sections
 * plus the built entries of `MORE_MENU`. Профиль is in the second set and not
 * the first — it lives on the top-bar avatar, which is a small target on a
 * phone, so the sheet carries it too.
 */
const DELIVERABLE = new Set(
  [...PRIMARY_NAV, ...MORE_MENU]
    .filter((item) => isBuiltRoute(item.id) && isVisibleSection(item.id))
    .map((item) => item.href),
);

describe("MobileBottomNavigation", () => {
  it("keeps the bar to five slots, the fifth being «Профиль» while it is all «Ещё» would hold", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const bar = screen.getByRole("navigation", { name: "Мобильная навигация" });
    expect(within(bar).getAllByRole("link")).toHaveLength(5);
    for (const label of ["Главная", "Путь", "Уроки", "Инструменты", "Профиль"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(within(bar).getByRole("link", { name: /Профиль/ })).toHaveAttribute("href", "/profile");
    // No menu of one.
    expect(screen.queryByRole("button", { name: /Ещё/ })).toBeNull();
  });

  it("reaches EVERY built section in one tap", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const reachable = new Set(screen.getAllByRole("link").map((a) => a.getAttribute("href")));
    for (const item of BUILT) {
      expect(reachable.has(item.href), `${item.label} (${item.href}) must be reachable`).toBe(true);
    }
  });

  it("carries no way into support: support is a part of the profile", () => {
    render(<MobileBottomNavigation activeId="home" />);
    expect(screen.queryByRole("link", { name: /Поддержка/ })).toBeNull();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/support");
    expect(hrefs).not.toContain("/profile/support");
  });

  it("never puts a section in two places, and never in neither", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const inBar = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(new Set(inBar).size).toBe(inBar.length);
    expect(new Set(inBar)).toEqual(DELIVERABLE);
  });

  it("advertises no unbuilt destination", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const unbuilt of ["/news", "/referrals", "/mentor", "/settings"]) {
      expect(hrefs, unbuilt).not.toContain(unbuilt);
    }
  });

  it("renders no disabled control — the defect that once hid Поддержка", () => {
    render(<MobileBottomNavigation activeId="home" />);
    for (const button of screen.queryAllByRole("button")) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("marks «Профиль» as the page on the profile, its support part included", () => {
    // Both parts pass `profile`: the learner is in the profile either way.
    render(<MobileBottomNavigation activeId="profile" />);
    expect(screen.getByRole("link", { name: /Профиль/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Главная/ })).not.toHaveAttribute("aria-current");
  });

  it("marks Главная active with aria-current (not colour only)", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const home = screen.getByRole("link", { name: /Главная/ });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home).toHaveAttribute("href", "/home");
  });

  it("marks Инструменты active with aria-current on the tools page", () => {
    render(<MobileBottomNavigation activeId="tools" />);
    expect(screen.getByRole("link", { name: /Инструменты/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Главная/ })).not.toHaveAttribute("aria-current");
  });

  it("marks Уроки active with aria-current on the library page", () => {
    render(<MobileBottomNavigation activeId="lessons" />);
    expect(screen.getByRole("link", { name: /Уроки/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Главная/ })).not.toHaveAttribute("aria-current");
  });

  it("marks Путь active with aria-current on the path page", () => {
    render(<MobileBottomNavigation activeId="path" />);
    expect(screen.getByRole("link", { name: /Путь/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Главная/ })).not.toHaveAttribute("aria-current");
  });
});
