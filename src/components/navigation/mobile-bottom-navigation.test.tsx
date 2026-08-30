import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("keeps the bar to five slots, the fifth being «Ещё»", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const bar = screen.getByRole("navigation", { name: "Мобильная навигация" });
    // Four links plus the disclosure, bounded regardless of how many sections
    // ship. That bound is the whole point of the change.
    expect(within(bar).getAllByRole("link")).toHaveLength(4);
    for (const label of ["Главная", "Путь", "Уроки", "Инструменты"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Ещё/ })).toBeInTheDocument();
  });

  it("reaches EVERY built section, in the bar or one tap inside «Ещё»", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);

    const reachable = new Set(screen.getAllByRole("link").map((a) => a.getAttribute("href")));
    await user.click(screen.getByRole("button", { name: /Ещё/ }));
    for (const a of screen.getAllByRole("link")) reachable.add(a.getAttribute("href"));

    for (const item of BUILT) {
      expect(reachable.has(item.href), `${item.label} (${item.href}) must be reachable`).toBe(true);
    }
  });

  it("puts Поддержка and Профиль behind «Ещё», and they are real links", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    // The regression that started all of this: Поддержка must never be a
    // section the bar knows about and cannot deliver.
    expect(screen.queryByRole("link", { name: /Поддержка/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Ещё/ }));
    expect(screen.getByRole("link", { name: /Поддержка/ })).toHaveAttribute("href", "/support");
    expect(screen.getByRole("link", { name: /Профиль/ })).toHaveAttribute("href", "/profile");
  });

  it("never puts a section in both places, and never in neither", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    const inBar = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    await user.click(screen.getByRole("button", { name: /Ещё/ }));
    const all = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    const inSheet = all.filter((href) => !inBar.includes(href));

    expect(inBar.filter((href) => inSheet.includes(href))).toEqual([]);
    expect(new Set([...inBar, ...inSheet])).toEqual(DELIVERABLE);
  });

  it("advertises no unbuilt destination", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    await user.click(screen.getByRole("button", { name: /Ещё/ }));
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const unbuilt of ["/news", "/referrals", "/mentor", "/settings"]) {
      expect(hrefs, unbuilt).not.toContain(unbuilt);
    }
  });

  it("renders no disabled control — the defect that hid Поддержка", () => {
    render(<MobileBottomNavigation activeId="home" />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  it("the disclosure reports its own state to assistive technology", async () => {
    const user = userEvent.setup();
    render(<MobileBottomNavigation activeId="home" />);
    const more = screen.getByRole("button", { name: /Ещё/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Ещё" })).toBeInTheDocument();
  });

  it("marks «Ещё» active when the open section lives inside it", () => {
    // Otherwise the bar shows every slot inactive while the learner is plainly
    // somewhere, which reads as "you are nowhere".
    render(<MobileBottomNavigation activeId="support" />);
    expect(screen.getByRole("button", { name: /Ещё/ })).toHaveClass("is-active");
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
