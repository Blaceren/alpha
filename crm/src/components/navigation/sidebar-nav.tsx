"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV_GROUPS } from "@/config/navigation";
import { canViewSection } from "@/domain/identity/access";
import { useSession } from "@/components/crm-shell/session-context";
import { NavIcon } from "./nav-icon";
import { Tooltip } from "@/components/ui/tooltip";

/** Returns true when `href` is the active route (exact or nested). */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/today") return pathname === "/today" || pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

/** Shared nav list used by the desktop sidebar and the mobile drawer. */
export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const { session } = useSession();

  return (
    <nav aria-label="Разделы CRM" className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => canViewSection(session.role, i.key));
        if (items.length === 0) return null;
        return (
          <div key={group.id}>
            {group.label && !collapsed ? (
              <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-sidebar-foreground/50">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                const link = (
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      collapsed && "justify-center",
                      active
                        ? "bg-white/10 font-medium text-white"
                        : "text-sidebar-foreground hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                    {collapsed ? <span className="sr-only">{item.label}</span> : null}
                  </Link>
                );
                return (
                  <li key={item.key}>
                    {collapsed ? (
                      <Tooltip content={item.label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
