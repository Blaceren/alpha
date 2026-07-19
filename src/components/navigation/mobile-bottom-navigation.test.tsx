import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";

/**
 * The bottom bar is the mobile primary navigation. Built destinations are real
 * links; everything not built yet must be focusable-disabled (no 404) — verified
 * structurally. Built as of D4-B: Главная, Путь, Уроки, Инструменты.
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
    // Four real links (Главная + Путь + Уроки + Инструменты since D4-B); only
    // «Ещё» remains a disabled button.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(screen.getByRole("link", { name: /Путь/ })).toHaveAttribute("href", "/path");
    expect(screen.getByRole("link", { name: /Уроки/ })).toHaveAttribute("href", "/lessons");
    expect(screen.getByRole("link", { name: /Инструменты/ })).toHaveAttribute("href", "/tools");
    const disabled = screen.getAllByRole("button");
    expect(disabled).toHaveLength(1);
    for (const b of disabled) expect(b).toHaveAttribute("aria-disabled", "true");
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
