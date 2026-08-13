/**
 * G4-R1 — route availability under EVERY supported CRM mode.
 *
 * WHY THIS FILE EXISTS. The CRM has two shells. `MockShell` renders the Next.js
 * page tree; `ApiShell` — which is what `CRM_MODE=api` selects, and therefore
 * what PREPROD and PROD run — renders a pathname-driven route table instead and
 * discards `children` entirely. G4 shipped the Growth workspace, its page and a
 * mock navigation entry, and added nothing to the api-mode table. The result
 * passed 2927 CRM tests and 115 backend tests while being completely unreachable
 * for every deployed staff member.
 *
 * The suite could not notice, because `api-route-composition.test.ts` asserts
 * that an UNMOUNTED route renders the deferred placeholder — so the defect was
 * encoded as correct behaviour. These tests assert the opposite for the five
 * Growth paths: the workspace renders, and the placeholder does NOT.
 */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { GROWTH_ROUTES, GROWTH_ROOT_PATH, resolveGrowthSurface } from "@/features/growth/growth-routes";
import { API_NAV_ITEMS } from "./api-shell";

const DEFERRED = "Раздел ещё не подключён";

let pathname = "/growth";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/**
 * The session boundary would otherwise make a network request. The subject here
 * is ROUTE COMPOSITION, and authorization is asserted separately (and, for real,
 * by the backend on every request).
 */
const session = {
  employeeId: "cmtestemployee0000000000",
  displayName: "Analyst",
  role: "analyst" as const,
  effectivePermissions: ["view_affiliate_analytics"] as const,
  permissionVersion: 1,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

vi.mock("./session-boundary", () => ({
  SessionBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("./session-context", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./session-context");
  return {
    ...actual,
    useSession: () => ({ session, refresh: vi.fn() }),
  };
});

/** The workspace fetches on mount; the route test only needs it to render. */
vi.mock("@/application/api/growth-client", () => ({
  fetchGrowthOverview: () => new Promise(() => {}),
  fetchGrowthFunnel: () => new Promise(() => {}),
  fetchGrowthAcquisition: () => new Promise(() => {}),
  fetchGrowthPocketConversions: () => new Promise(() => {}),
  fetchGrowthIngressHealth: () => new Promise(() => {}),
}));

describe("G4-R1 — Growth routes in CRM_MODE=api", () => {
  beforeEach(() => {
    pathname = GROWTH_ROOT_PATH;
  });

  for (const route of GROWTH_ROUTES) {
    it(`renders the Growth workspace at ${route.path}, not the deferred placeholder`, async () => {
      pathname = route.path;
      render(
        <AppShell mode="api">
          <div>mock children that api mode must ignore</div>
        </AppShell>,
      );

      // The workspace's own heading, which the placeholder does not have.
      expect(await screen.findByRole("heading", { name: "Growth" })).toBeInTheDocument();
      expect(screen.queryByText(DEFERRED)).not.toBeInTheDocument();

      // The tab strip is a set of real links to the canonical paths.
      for (const other of GROWTH_ROUTES) {
        const link = screen.getByRole("link", { name: other.label });
        expect(link).toHaveAttribute("href", other.path);
      }

      // The current surface is marked, so the URL and the view agree.
      expect(screen.getByRole("link", { name: route.label })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  }

  it("still defers a nested path nobody has built", () => {
    pathname = "/growth/funnel/extra";
    render(
      <AppShell mode="api">
        <div />
      </AppShell>,
    );
    expect(screen.getByText(DEFERRED)).toBeInTheDocument();
  });

  it("exposes Growth in the api-mode navigation for a permitted principal", () => {
    pathname = GROWTH_ROOT_PATH;
    render(
      <AppShell mode="api">
        <div />
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    expect(nav).toHaveTextContent("Growth");
  });

  it("hides Growth from a principal the backend would refuse", () => {
    // `read_only` holds neither `view_affiliate_analytics` nor `manage_settings`,
    // so the backend answers 403 — and navigation canon must not offer a section
    // that answers 403.
    const item = API_NAV_ITEMS.find((entry) => entry.label === "Growth");
    expect(item).toBeDefined();
    expect(item!.permissions).toContain("view_affiliate_analytics");
    expect(item!.permissions).toContain("manage_settings");
    expect(item!.permissions).not.toContain("curriculum_read");
  });
});

describe("G4-R1 — the route registry is the single definition", () => {
  it("resolves exactly the five canonical paths and nothing else", () => {
    expect(GROWTH_ROUTES.map((r) => r.path)).toEqual([
      "/growth",
      "/growth/funnel",
      "/growth/acquisition",
      "/growth/pocket-conversions",
      "/growth/ingress-health",
    ]);
    for (const route of GROWTH_ROUTES) {
      expect(resolveGrowthSurface(route.path)).toBe(route.surface);
    }
    for (const notGrowth of ["/growth/", "/growth/x", "/growthy", "/users", null]) {
      expect(resolveGrowthSurface(notGrowth)).toBeNull();
    }
  });

  it("is the same href the api-mode navigation offers", () => {
    const item = API_NAV_ITEMS.find((entry) => entry.label === "Growth");
    expect(item?.href).toBe(GROWTH_ROOT_PATH);
    expect(GROWTH_ROUTES[0]?.path).toBe(GROWTH_ROOT_PATH);
  });
});
