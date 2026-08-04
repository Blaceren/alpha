/**
 * AFD-5C1/5C2/5D2 — the Аффилейты sub-navigation.
 *
 * The management and analytics routes must survive AFD-5C2 untouched, and the
 * new Лиды tab must advertise a lead surface WITHOUT advertising an export, a
 * bulk PII surface or a count nobody computed.
 *
 * AFD-5D2 adds Curie Atlas between Аналитика and Лиды. The tab list is a
 * deliberate tripwire: a new sub-section must be a visible change to this
 * assertion, never a side effect of editing the component.
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AffiliateSectionTabs } from "./affiliate-section-tabs";

describe("affiliate section tabs", () => {
  it("offers exactly Управление, Аналитика, Curie Atlas and Лиды", () => {
    render(<AffiliateSectionTabs active="management" />);
    const nav = screen.getByRole("navigation", { name: "Разделы аффилейтов" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Управление",
      "Аналитика",
      "Curie Atlas",
      "Лиды",
    ]);
  });

  it("nests Curie Atlas under the analytics path", () => {
    // The URL states the information architecture: Atlas reads the analytics
    // this section already publishes and owns no data of its own.
    render(<AffiliateSectionTabs active="management" />);
    expect(screen.getByRole("link", { name: "Curie Atlas" })).toHaveAttribute(
      "href",
      "/affiliates/analytics/atlas",
    );
  });

  it("marks the atlas tab current without marking analytics current", () => {
    render(<AffiliateSectionTabs active="atlas" />);
    expect(screen.getByRole("link", { name: "Curie Atlas" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Аналитика" })).not.toHaveAttribute("aria-current");
  });

  it("carries NO badge or count on the Curie Atlas tab", () => {
    // Atlas holds no queue and no unread state, and it runs only when asked.
    render(<AffiliateSectionTabs active="atlas" />);
    expect(screen.getByRole("link", { name: "Curie Atlas" }).textContent).toBe("Curie Atlas");
  });

  it("does not advertise Atlas as AI, a forecast or a recommendation engine", () => {
    render(<AffiliateSectionTabs active="atlas" />);
    const nav = screen.getByRole("navigation", { name: "Разделы аффилейтов" });
    const text = (nav.textContent ?? "").toLowerCase();
    for (const forbidden of ["ai", "ии", "нейро", "прогноз", "рекоменд", "gpt"]) {
      expect(text).not.toContain(forbidden);
    }
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
