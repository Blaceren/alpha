"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { Brand } from "./brand";
import { SidebarNav } from "@/components/navigation/sidebar-nav";
import { IconButton } from "@/components/ui/icon-button";
import { DemoBadge } from "./demo-badge";

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/** Desktop sidebar. Hidden below `lg` (mobile uses the drawer instead). */
export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      aria-label="Боковая навигация"
      className={cn(
        "hidden shrink-0 flex-col bg-sidebar lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-1 border-b border-white/10 px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        <Brand collapsed={collapsed} />
        {!collapsed ? (
          <IconButton
            label="Свернуть меню"
            onClick={onToggle}
            className="text-sidebar-foreground hover:bg-white/10 hover:text-white"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </IconButton>
        ) : null}
      </div>

      <SidebarNav collapsed={collapsed} />

      <div className="border-t border-white/10 p-2">
        {collapsed ? (
          <IconButton
            label="Развернуть меню"
            onClick={onToggle}
            className="mx-auto text-sidebar-foreground hover:bg-white/10 hover:text-white"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          </IconButton>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <DemoBadge />
            <span className="text-2xs text-sidebar-foreground/50">v0.1 · mock</span>
          </div>
        )}
      </div>
    </aside>
  );
}
