"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePathname } from "next/navigation";
import { MockSessionProvider, useSession } from "./session-context";
import { SessionBoundary } from "./session-boundary";
import { ApiShell, ApiRouteDeferred, API_USERS_PATH } from "./api-shell";
import { ApiUsersWorkspace } from "@/features/users-api/api-users-workspace";
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
 *   /users            -> the production Users v1 list, the one connected capability
 *   anything else     -> the truthful deferred state, including /users/[id],
 *                        which must not mount User360Workspace or fetch a
 *                        User 360 endpoint that does not exist.
 *
 * Matching `/users` exactly (not a prefix) is what keeps `/users/123` deferred.
 */
function ApiModeLanding() {
  const { session } = useSession();
  const pathname = usePathname();

  if (pathname === API_USERS_PATH) {
    return (
      <ApiShell session={session}>
        <ApiUsersWorkspace />
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
