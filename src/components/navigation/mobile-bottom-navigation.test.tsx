import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";

/**
 * The bottom bar is the mobile primary navigation. In D1B only Главная is a real
 * route; the rest must be focusable-disabled (no 404) — verified structurally.
 */
describe("MobileBottomNavigation", () => {
  it("renders 5 items with the canonical RU labels", () => {
    render(<MobileBottomNavigation activeId="home" />);
    for (const label of ["Главная", "Путь", "Уроки", "Инструменты", "Ещё"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks Главная active with aria-current (not colour only)", () => {
    render(<MobileBottomNavigation activeId="home" />);
    const home = screen.getByRole("link", { name: /Главная/ });
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home).toHaveAttribute("href", "/");
  });

  it("keeps unbuilt destinations as focusable-disabled controls (no dead links)", () => {
    render(<MobileBottomNavigation activeId="home" />);
    // Two real links (Главная + Путь since D2A); the three others are disabled buttons.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Путь/ })).toHaveAttribute("href", "/path");
    const disabled = screen.getAllByRole("button");
    expect(disabled).toHaveLength(3);
    for (const b of disabled) expect(b).toHaveAttribute("aria-disabled", "true");
  });

  it("marks Путь active with aria-current on the path page", () => {
    render(<MobileBottomNavigation activeId="path" />);
    expect(screen.getByRole("link", { name: /Путь/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Главная/ })).not.toHaveAttribute("aria-current");
  });
});
