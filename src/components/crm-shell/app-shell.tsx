"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePathname } from "next/navigation";
import { MockSessionProvider, useSession } from "./session-context";
import { SessionBoundary } from "./session-boundary";
import {
  ApiShell,
  ApiRouteDeferred,
  API_USERS_PATH,
  AFFILIATES_PATH,
  AFFILIATE_ANALYTICS_PATH,
  AFFILIATE_ATLAS_PATH,
  AFFILIATE_COMMERCIAL_PATH,
  AFFILIATE_LEADS_PATH,
  AFFILIATE_POSTBACKS_PATH,
} from "./api-shell";
import { ReportReviewWorkspace, REPORT_REVIEW_PATH } from "@/features/report-review/report-review-workspace";
import { MentorReviewWorkspace, MENTOR_REVIEW_PATH } from "@/features/mentor-review/mentor-review-workspace";
import {
  LearnerOpsWorkspace,
  LEARNER_OPS_PATH,
  LEARNER_OPS_SUPPORT_PATH,
} from "@/features/learner-ops/inbox-workspace";
import { CaseDetailWorkspace } from "@/features/learner-ops/case-detail-workspace";
import { CommunityModerationWorkspace } from "@/features/community-moderation/moderation-workspace";
import { COMMUNITY_MODERATION_PATH } from "./api-shell";
import { ApiUsersWorkspace } from "@/features/users-api/api-users-workspace";
import { ApiUserDetailWorkspace } from "@/features/users-api/api-user-detail-workspace";
import { AffiliatesWorkspace } from "@/features/affiliates/affiliates-workspace";
import { AffiliateDetailWorkspace } from "@/features/affiliates/affiliate-detail-workspace";
import { TrackingLinkDetailWorkspace } from "@/features/affiliates/tracking-link-detail-workspace";
import { AffiliateAnalyticsWorkspace } from "@/features/affiliate-analytics/analytics-workspace";
import { CurieAtlasWorkspace } from "@/features/curie-atlas/atlas-workspace";
import { CommissionsWorkspace } from "@/features/affiliate-commercial/commissions-workspace";
import { PostbackDeliveriesWorkspace } from "@/features/affiliate-commercial/postbacks-workspace";
import { AffiliateLeadsWorkspace } from "@/features/affiliate-leads/leads-workspace";
import { AffiliateLeadDetailWorkspace } from "@/features/affiliate-leads/lead-detail-workspace";
import { GrowthWorkspace } from "@/features/growth/growth-workspace";
import { resolveGrowthSurface } from "@/features/growth/growth-routes";
import type { CrmRuntimeMode } from "@/config/runtime-mode";
import { setClientRuntimeMode } from "@/config/client-runtime-mode";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { Brand } from "./brand";
import { DemoBadge } from "./demo-badge";
import { SidebarNav } from "@/components/navigation/sidebar-nav";

const COLLAPSE_KEY = "ata-crm.sidebar-collapsed.v1";

/**
 * Root CRM shell.
 *
 * `mode` is resolved on the server and passed down as a plain prop — the browser
 * receives only "mock" or "api", never the backend origin.
 *
 *   mock → the Phase 1A behaviour, unchanged: an immediate synthetic session and
 *          the full mock workspace.
 *   api  → nothing renders until the session boundary has a validated backend
 *          session, and even then the feature routes stay unmounted because no
 *          API data provider exists yet.
 */
export function AppShell({
  mode,
  children,
}: {
  mode: CrmRuntimeMode;
  children: React.ReactNode;
}) {
  // Publish the mode for client modules that sit below React and cannot take a
  // prop — specifically the data-provider accessors, which must refuse to build
  // the mock provider in api mode. Set synchronously so it is in place before
  // any child renders.
  setClientRuntimeMode(mode);

  if (mode === "api") {
    return (
      <SessionBoundary>
        <ApiModeLanding />
      </SessionBoundary>
    );
  }

  return (
    <MockSessionProvider>
      <MockShell>{children}</MockShell>
    </MockSessionProvider>
  );
}

/**
 * api-mode route composition.
 *
 * `children` — the mock feature routes — are NEVER rendered here. Every mock
 * page reads through `getCrmDataProvider`, which refuses to hand back the mock
 * provider in api mode, so mounting one could only fail or lie. Instead this
 * decides what to show from the pathname alone:
 *
 *   /report-review    -> the mentor report review workspace (queue + detail)
 *   /users            -> the production Users v1 list
 *   /users/{id}       -> the production learner detail foundation. `{id}` is a
 *                        single segment; the workspace itself validates it and
 *                        renders a local invalid-id state without a request.
 *                        This is NOT the mock User360Workspace — that aggregate
 *                        has no backend and is never mounted in api mode.
 *   /affiliates       -> the AFD-5A affiliate inventory workspace
 *   /affiliates/analytics       -> the AFD-5C1 analytics workspace
 *   /affiliates/links/{linkId}  -> the AFD-5A tracking-link detail
 *   /affiliates/{partnerId}     -> the AFD-5A partner detail
 *   anything else     -> the truthful deferred state, including any nested
 *                        route under a learner (notes, owner, …), which has no
 *                        backend and must not appear to exist.
 *
 * Matching exactly (not by prefix) is what keeps `/users/123/notes` deferred.
 */
function ApiModeLanding() {
  const { session } = useSession();
  const pathname = usePathname();

  // Mentor report review. A staff route: it renders for any authenticated CRM
  // employee, and the REVIEWER boundary is decided by the Backend queue response
  // inside the workspace — a valid staff member who is not a reviewer gets a
  // bounded forbidden panel here, never an authentication loop.
  // LEARNER-OPERATIONS-V1 — the department's own routes.
  //
  // The CASE DETAIL is matched BEFORE the queue, because `/cases` is a strict
  // prefix of `/cases/{id}`. Testing the list first with a prefix match would
  // swallow every detail route; testing it first with an exact match would work
  // but leaves the ordering load-bearing for a reason nobody could see later,
  // so the detail is simply matched first — the same discipline the affiliate
  // lead/detail routes already follow.
  const learnerOpsCase = pathname.match(/^\/cases\/([^/]+)$/);
  if (learnerOpsCase) {
    return (
      <ApiShell session={session}>
        <CaseDetailWorkspace caseId={decodeURIComponent(learnerOpsCase[1] ?? "")} />
      </ApiShell>
    );
  }

  // The unified operational inbox. It renders for any authenticated CRM
  // employee and decides its own tabs from the session's permissions; every
  // route behind those tabs is independently re-checked by the backend, so a
  // staff member without the department's permissions gets a bounded panel
  // rather than an authentication loop.
  if (pathname === LEARNER_OPS_PATH) {
    return (
      <ApiShell session={session}>
        <LearnerOpsWorkspace />
      </ApiShell>
    );
  }

  // `/support` is the SAME queue filtered to learner requests, not a second
  // product. Keeping the existing route meaningful beats minting a new one.
  if (pathname === LEARNER_OPS_SUPPORT_PATH) {
    return (
      <ApiShell session={session}>
        <LearnerOpsWorkspace surface="support" />
      </ApiShell>
    );
  }

  // COMMUNITY-V1 — the Community moderation workspace.
  //
  // In api mode `children` are never rendered, so an App Router page under
  // `(crm)/community-moderation/` is not enough on its own: without this the
  // section answered the truthful deferred placeholder and the workspace was
  // unreachable in the only mode PREPROD runs. A 200 from that path is not
  // evidence the surface exists, which is how this survived a curl check.
  //
  // Exact match, like every staff route above it: a nested path nobody has
  // built stays deferred rather than appearing to exist. Authorization is NOT
  // decided here — `requireCommunityModerator` re-checks `community_moderate`
  // on every request behind this, and a staff member without it meets the
  // workspace's own bounded permission-denied state, never a blank screen.
  if (pathname === COMMUNITY_MODERATION_PATH) {
    return (
      <ApiShell session={session}>
        <CommunityModerationWorkspace />
      </ApiShell>
    );
  }

  if (pathname === REPORT_REVIEW_PATH) {
    return (
      <ApiShell session={session}>
        <ReportReviewWorkspace />
      </ApiShell>
    );
  }

  // G3 — mentor practice review. A staff route on the same terms as
  // `/report-review`: it renders for any authenticated CRM employee, and the
  // REVIEWER boundary is decided by the Backend queue response inside the
  // workspace, so a valid staff member who is not a reviewer gets a bounded
  // forbidden panel rather than an authentication loop.
  if (pathname === MENTOR_REVIEW_PATH) {
    return (
      <ApiShell session={session}>
        <MentorReviewWorkspace />
      </ApiShell>
    );
  }

  if (pathname === API_USERS_PATH) {
    return (
      <ApiShell session={session}>
        <ApiUsersWorkspace />
      </ApiShell>
    );
  }

  // Exactly one segment after /users/ — `/users/123/notes` does not match.
  const detail = /^\/users\/([^/]+)$/.exec(pathname ?? "");
  if (detail) {
    return (
      <ApiShell session={session}>
        <ApiUserDetailWorkspace userId={decodeURIComponent(detail[1] ?? "")} />
      </ApiShell>
    );
  }

  /* ------------------------------------------------ affiliates (AFD-5A/5C1)
   *
   * AFD-5A shipped four fully API-backed affiliate workspaces but never mounted
   * them here, so in api mode the whole Аффилейты section answered with the
   * deferred placeholder — the workspaces existed and were unreachable. AFD-5C1
   * needs `/affiliates/analytics` to be reachable at all, and its sub-navigation
   * links back to `/affiliates`, so both are wired up together with the two
   * detail routes the list links to. Nothing about the workspaces themselves
   * changes; only the route composition does.
   *
   * Matching is EXACT, in the same style as the learner routes above: a nested
   * path nobody has built stays deferred rather than appearing to exist.
   */
  if (pathname === AFFILIATES_PATH) {
    return (
      <ApiShell session={session}>
        <AffiliatesWorkspace />
      </ApiShell>
    );
  }

  if (pathname === AFFILIATE_ANALYTICS_PATH) {
    return (
      <ApiShell session={session}>
        <React.Suspense fallback={null}>
          <AffiliateAnalyticsWorkspace />
        </React.Suspense>
      </ApiShell>
    );
  }

  /* --------------------------------------------------- Curie Atlas (AFD-5D2)
   *
   * A CHILD of the analytics path, matched exactly. It needs no Suspense
   * boundary: unlike the analytics workspace it reads no search params, because
   * an Atlas result is not addressable by URL and its draft selection is local
   * state.
   */
  if (pathname === AFFILIATE_ATLAS_PATH) {
    return (
      <ApiShell session={session}>
        <CurieAtlasWorkspace />
      </ApiShell>
    );
  }

  /* --------------------------------------------------------- leads (AFD-5C2)
   *
   * The DETAIL is tested before the LIST. `/affiliates/leads` is an exact match
   * and `/affiliates/leads/{leadId}` is a pattern, so order between those two is
   * not strictly load-bearing — but both must be tested before
   * `/affiliates/{partnerId}`, or "leads" is read as a partner id.
   *
   * `{leadId}` is passed through unvalidated: the workspace itself rejects a
   * malformed reference locally without a request, and the backend owns the real
   * parse. Nothing here decodes the reference or derives anything from it.
   */
  const lead = /^\/affiliates\/leads\/([^/]+)$/.exec(pathname ?? "");
  if (lead) {
    return (
      <ApiShell session={session}>
        <AffiliateLeadDetailWorkspace leadId={decodeURIComponent(lead[1] ?? "")} />
      </ApiShell>
    );
  }

  if (pathname === AFFILIATE_LEADS_PATH) {
    return (
      <ApiShell session={session}>
        <React.Suspense fallback={null}>
          <AffiliateLeadsWorkspace />
        </React.Suspense>
      </ApiShell>
    );
  }

  /* ------------------------------- AFFILIATE-PLATFORM-V1: commercial + postbacks
   *
   * TWO MORE EXACT SIBLINGS, matched BEFORE `/affiliates/{partnerId}` for the
   * same reason analytics, leads and links are. Registering the Next route is
   * not enough: THIS component decides what renders, and an unregistered
   * sibling is read as a partner id.
   */
  if (pathname === AFFILIATE_COMMERCIAL_PATH) {
    return (
      <ApiShell session={session}>
        <CommissionsWorkspace />
      </ApiShell>
    );
  }

  if (pathname === AFFILIATE_POSTBACKS_PATH) {
    return (
      <ApiShell session={session}>
        <PostbackDeliveriesWorkspace />
      </ApiShell>
    );
  }

  // `/affiliates/links/{linkId}` is matched BEFORE `/affiliates/{partnerId}`,
  // because `links` would otherwise be read as a partner id.
  const link = /^\/affiliates\/links\/([^/]+)$/.exec(pathname ?? "");
  if (link) {
    return (
      <ApiShell session={session}>
        <TrackingLinkDetailWorkspace linkId={decodeURIComponent(link[1] ?? "")} />
      </ApiShell>
    );
  }

  const partner = /^\/affiliates\/([^/]+)$/.exec(pathname ?? "");
  if (partner) {
    return (
      <ApiShell session={session}>
        <AffiliateDetailWorkspace partnerId={decodeURIComponent(partner[1] ?? "")} />
      </ApiShell>
    );
  }

  /* ------------------------------------------------------------ Growth (G4)
   *
   * G4-R1 — THE FIVE GROWTH SURFACES, MOUNTED FROM THE SHARED REGISTRY.
   *
   * G4 shipped the workspace and its Next.js page but never mounted it here, so
   * in api mode — which is what every deployed environment runs — all five
   * Growth URLs answered with the deferred placeholder while the backend served
   * correct data behind them. That is the same omission this file records for
   * the AFD-5A affiliate workspaces, and this is the same repair.
   *
   * `resolveGrowthSurface` matches EXACTLY against `GROWTH_ROUTES`, so it keeps
   * the property the rest of this router has: a nested path nobody has built —
   * `/growth/funnel/x` — stays deferred rather than appearing to exist. Because
   * both shells and the navigation read that one registry, a sixth surface
   * cannot appear in one mode and be missing from the other again.
   *
   * Authorization is UNCHANGED and is not weakened by becoming reachable: the
   * whole branch sits inside `SessionBoundary`, so an unauthenticated visitor
   * never reaches it, and each backend route independently enforces the CRM
   * affiliate-reader gate before any read. A staff member without the permission
   * sees the workspace's own bounded forbidden panel, exactly as they would on
   * any other section.
   */
  const growthSurface = resolveGrowthSurface(pathname);
  if (growthSurface) {
    return (
      <ApiShell session={session}>
        <React.Suspense fallback={null}>
          <GrowthWorkspace surface={growthSurface} />
        </React.Suspense>
      </ApiShell>
    );
  }

  return <ApiRouteDeferred session={session} />;
}

/** Sidebar + topbar + content region. Mock mode only, unchanged from Phase 1A. */
function MockShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
      <TooltipProvider>
        <a href="#crm-content" className="skip-link">
          Перейти к содержимому
        </a>
        <div className="flex h-dvh w-full overflow-hidden">
          <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />

          {/* Mobile drawer */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" title="Навигация CRM">
              <div className="flex h-14 items-center border-b border-white/10 px-3">
                <Brand />
              </div>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
              <div className="border-t border-white/10 p-3">
                <DemoBadge />
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar onOpenMobileNav={() => setMobileOpen(true)} />
            <main
              id="crm-content"
              tabIndex={-1}
              className="flex-1 overflow-y-auto bg-background p-4 focus:outline-none"
            >
              <div className="mx-auto max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
    </TooltipProvider>
  );
}
