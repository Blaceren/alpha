"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { RoleSwitch } from "./role-switch";
import { EmployeeMenu } from "./employee-menu";
import { DemoBadge } from "./demo-badge";
import { GlobalSearchTrigger, NotificationsTrigger } from "./topbar-actions";
import { isRoleSwitchEnabled } from "@/config/env";

export interface TopbarProps {
  onOpenMobileNav: () => void;
}

export function Topbar({ onOpenMobileNav }: TopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <IconButton label="Открыть меню" className="lg:hidden" onClick={onOpenMobileNav}>
        <Menu className="h-5 w-5" aria-hidden />
      </IconButton>

      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <GlobalSearchTrigger />
        <DemoBadge className="hidden md:inline-flex" />
        {isRoleSwitchEnabled ? <RoleSwitch /> : null}
        <NotificationsTrigger />
        <EmployeeMenu />
      </div>
    </header>
  );
}
