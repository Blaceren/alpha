/**
 * AFD-5C1/5C2 — the Аффилейты sub-navigation.
 *
 * The management and analytics routes must survive AFD-5C2 untouched, and the
 * new Лиды tab must advertise a lead surface WITHOUT advertising an export, a
 * bulk PII surface or a count nobody computed.
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AffiliateSectionTabs } from "./affiliate-section-tabs";

describe("affiliate section tabs", () => {
  it("offers exactly Управление, Аналитика and Лиды", () => {
    render(<AffiliateSectionTabs active="management" />);
    const nav = screen.getByRole("navigation", { name: "Разделы аффилейтов" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Управление", "Аналитика", "Лиды"]);
  });

  it("points leads at /affiliates/leads", () => {
    render(<AffiliateSectionTabs active="management" />);
    expect(screen.getByRole("link", { name: "Лиды" })).toHaveAttribute(
      "href",
      "/affiliates/leads",
    );
  });

  it("marks the leads tab current with aria-current", () => {
    render(<AffiliateSectionTabs active="leads" />);
    expect(screen.getByRole("link", { name: "Лиды" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Аналитика" })).not.toHaveAttribute("aria-current");
  });

  it("carries NO lead count in the tab", () => {
    // A badge would need either a request this component does not make, or a
    // number invented from one page of a keyset list.
    render(<AffiliateSectionTabs active="leads" />);
    expect(screen.getByRole("link", { name: "Лиды" }).textContent).toBe("Лиды");
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

  it("advertises no PII or export surface", () => {
    // AFD-5C2 adds Лиды and nothing else. A tab promising a user-data view or a
    // download would be advertising a capability that deliberately does not
    // exist: PII is reachable only per lead, behind a confirmation, and there is
    // no export anywhere in this product.
    const { container } = render(<AffiliateSectionTabs active="leads" />);
    const text = container.textContent!.toLowerCase();
    for (const forbidden of ["пользовател", "экспорт", "csv", "выгруз", "данные"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
