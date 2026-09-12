import { describe, expect, it } from "vitest";
import { isActiveRoute } from "./sidebar-nav";
import { buildCrumbs } from "./breadcrumbs";

describe("isActiveRoute (sidebar active state)", () => {
  it("marks Today active on both / and /today", () => {
    expect(isActiveRoute("/", "/today")).toBe(true);
    expect(isActiveRoute("/today", "/today")).toBe(true);
  });

  it("matches nested routes for a section", () => {
    expect(isActiveRoute("/users", "/users")).toBe(true);
    expect(isActiveRoute("/users/usr_mock_001", "/users")).toBe(true);
    expect(isActiveRoute("/cases", "/users")).toBe(false);
  });

  it("does not treat Today as active on other routes", () => {
    expect(isActiveRoute("/users", "/today")).toBe(false);
  });
});

describe("buildCrumbs", () => {
  it("builds a trail rooted at CRM", () => {
    const crumbs = buildCrumbs("/users/usr_mock_001");
    expect(crumbs[0]).toEqual({ label: "CRM", href: "/today" });
    expect(crumbs.map((c) => c.label)).toContain("Пользователи");
    expect(crumbs[crumbs.length - 1]?.label).toBe("usr_mock_001");
  });

  it("labels known sections", () => {
    const crumbs = buildCrumbs("/financial");
    expect(crumbs[crumbs.length - 1]?.label).toBe("Финансы");
  });
});
