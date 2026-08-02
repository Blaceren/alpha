/**
 * AFD-5C1 — the Аффилейты sub-navigation.
 *
 * The management route must survive this phase untouched, and no lead surface
 * may be advertised before AFD-5C2 ships one.
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AffiliateSectionTabs } from "./affiliate-section-tabs";

describe("affiliate section tabs", () => {
  it("offers exactly Управление and Аналитика", () => {
    render(<AffiliateSectionTabs active="management" />);
    const nav = screen.getByRole("navigation", { name: "Разделы аффилейтов" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Управление", "Аналитика"]);
  });

  it("keeps the management route pointing at /affiliates", () => {
    render(<AffiliateSectionTabs active="analytics" />);
    expect(screen.getByRole("link", { name: "Управление" })).toHaveAttribute("href", "/affiliates");
  });

  it("points analytics at /affiliates/analytics", () => {
    render(<AffiliateSectionTabs active="management" />);
    expect(screen.getByRole("link", { name: "Аналитика" })).toHaveAttribute(
      "href",
      "/affiliates/analytics",
    );
  });

  it("marks the current tab with aria-current, not colour alone", () => {
    render(<AffiliateSectionTabs active="analytics" />);
    expect(screen.getByRole("link", { name: "Аналитика" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Управление" })).not.toHaveAttribute("aria-current");
  });

  it("advertises no lead, PII or export surface", () => {
    const { container } = render(<AffiliateSectionTabs active="analytics" />);
    const text = container.textContent!.toLowerCase();
    for (const forbidden of ["лид", "пользовател", "экспорт", "csv"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
