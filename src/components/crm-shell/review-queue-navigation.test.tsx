/**
 * OPS-NAV-REVIEW-QUEUES (POCKET-REG-INGRESS-1) — the review queues are LISTED
 * where they are ROUTED, and the two canons cannot drift apart again.
 *
 * WHY THIS FILE EXISTS. `/report-review` and `/mentor-review` (`/mentor`) were
 * routed, authorised and fully working in api mode — and appeared in no menu,
 * reachable only by typing the URL. That is the THIRD occurrence of the defect
 * `growth-routes.ts` was written to prevent: `api-route-composition.test.ts`
 * asserts that an unmounted route defers, so a workspace missing from
 * navigation is encoded as correct behaviour and no suite notices.
 *
 * These tests bind the two canons together for the review queues, in both
 * directions: the path must MOUNT the workspace (not the deferred placeholder),
 * and the navigation registry must LIST the path — for every authenticated
 * employee, because the reviewer boundary is the Backend's user-role rule,
 * which no CRM session permission can express (see the API_NAV_ITEMS comment).
 */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { API_NAV_ITEMS } from "./api-shell";
import { REPORT_REVIEW_PATH } from "@/features/report-review/report-review-workspace";
import { MENTOR_REVIEW_PATH } from "@/features/mentor-review/mentor-review-workspace";

const DEFERRED = "Раздел ещё не подключён";

let pathname = REPORT_REVIEW_PATH;
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

/**
 * A deliberately permissionless session: `support` holds no reviewer-shaped
 * permission, and the review queues must still be OFFERED to it — the Backend
 * decides reviewership per request, and the workspace renders the designed
 * bounded forbidden panel for a non-reviewer. Navigation hiding here would
 * also hide the queue from real reviewers, because reviewer-ship is a
 * user-role fact the session does not carry.
 */
const session = {
  employeeId: "cmtestemployee0000000000",
  displayName: "Support",
  role: "support" as const,
  effectivePermissions: ["view_user_notes"] as const,
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

/** The workspaces fetch on mount; composition only needs them to render. */
vi.mock("@/application/api/report-review-client", () => ({
  fetchReviewQueue: () => new Promise(() => {}),
}));
vi.mock("@/application/api/mentor-review-client", () => ({
  fetchMentorQueue: () => new Promise(() => {}),
  approveMentorReview: () => new Promise(() => {}),
}));

describe("OPS-NAV-REVIEW-QUEUES — review queues in CRM_MODE=api", () => {
  it("mounts the report review workspace at its path, not the placeholder", async () => {
    pathname = REPORT_REVIEW_PATH;
    render(
      <AppShell mode="api">
        <div>mock children that api mode must ignore</div>
      </AppShell>,
    );
    expect(
      await screen.findByRole("heading", { name: "Отчёты на проверке" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(DEFERRED)).not.toBeInTheDocument();
  });

  it("mounts the mentor review workspace at its path, not the placeholder", async () => {
    pathname = MENTOR_REVIEW_PATH;
    render(
      <AppShell mode="api">
        <div />
      </AppShell>,
    );
    expect(
      await screen.findByRole("heading", { name: "Проверка практики ментором" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(DEFERRED)).not.toBeInTheDocument();
  });

  it("lists BOTH review queues in the api-mode navigation for every employee", () => {
    pathname = REPORT_REVIEW_PATH;
    render(
      <AppShell mode="api">
        <div />
      </AppShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Разделы CRM" });
    const report = screen.getByRole("link", { name: "Проверка отчётов" });
    const mentor = screen.getByRole("link", { name: "Проверка практики" });
    expect(nav).toContainElement(report);
    expect(nav).toContainElement(mentor);
    expect(report).toHaveAttribute("href", REPORT_REVIEW_PATH);
    expect(mentor).toHaveAttribute("href", MENTOR_REVIEW_PATH);
  });

  it("keeps the registry and the route table on the same path constants", () => {
    // The registry entries carry the SAME constants the api-mode route table
    // matches on, so a moved route moves its menu entry in the same edit — a
    // re-spelled string here would resurrect the drift this file closes.
    const hrefs = API_NAV_ITEMS.map((item) => item.href);
    expect(hrefs).toContain(REPORT_REVIEW_PATH);
    expect(hrefs).toContain(MENTOR_REVIEW_PATH);
    // And their visibility rule is the routing rule: open to every
    // authenticated employee, reviewer-ship decided by the Backend.
    for (const href of [REPORT_REVIEW_PATH, MENTOR_REVIEW_PATH]) {
      const item = API_NAV_ITEMS.find((entry) => entry.href === href);
      expect(item).toBeDefined();
      expect(item!.permissions).toEqual([]);
    }
  });
});
