"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SessionProvider } from "./session-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { Brand } from "./brand";
import { DemoBadge } from "./demo-badge";
import { SidebarNav } from "@/components/navigation/sidebar-nav";

const COLLAPSE_KEY = "ata-crm.sidebar-collapsed.v1";

/**
 * Root CRM shell: sidebar + topbar + content region. Client component because it
 * owns local UI state (collapse + mobile drawer), persisted only in localStorage.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
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
    <SessionProvider>
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
    </SessionProvider>
  );
}
