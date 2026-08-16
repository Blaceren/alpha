import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";

/**
 * The bottom bar is the mobile primary navigation. It renders the BUILT
 * sections of the canonical `PRIMARY_NAV`, all of them real links.
 *
 * LEARNER-OPERATIONS-V1 changed two things here, and both were defects rather
 * than preferences. `/support` shipped and the hardcoded built-list still said
 * it had not, so the surface was unreachable. And «Ещё» was rendered as a
 * DISABLED button because its own id was not in that list — an overflow control
 * that could never open the menu it existed for, hiding every section inside it.
 * Built as of LEARNER-OPERATIONS-V1: Главная, Путь, Уроки, Инструменты, Поддержка.
 */
describe("MobileBottomNavigation", () => {
  it("renders 5 items with the canonical RU labels", () => {
    render(<MobileBottomNavigation activeId="home" />);
    for (const label of ["Главная", "Путь", "Уроки", "Инструменты", "Поддержка"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks Главная active with aria-current (not colour only)", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const home = screen.getByRole("link", { name: /Главная/ });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home).toHaveAttribute("href", "/");
  });

  it("offers only real links, and no unbuilt destination at all", () => {
    render(<MobileBottomNavigation activeId="home" />);
    // Six real links since COMMUNITY-V1 built Сообщество. The previous shape
    // kept «Ещё» as a disabled button; that control opened nothing and was what
    // hid Поддержка, so an unbuilt section is simply absent rather than
    // advertised. The count is derived from the built list rather than typed as
    // a literal, so the next section to ship moves it without editing a number.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(PRIMARY_NAV.filter((i) => isBuiltRoute(i.id)).length);
    expect(screen.getByRole("link", { name: /Сообщество/ })).toHaveAttribute("href", "/community");
    expect(screen.getByRole("link", { name: /Путь/ })).toHaveAttribute("href", "/path");
    expect(screen.getByRole("link", { name: /Уроки/ })).toHaveAttribute("href", "/lessons");
    expect(screen.getByRole("link", { name: /Инструменты/ })).toHaveAttribute("href", "/tools");
    expect(screen.getByRole("link", { name: /Поддержка/ })).toHaveAttribute("href", "/support");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
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
