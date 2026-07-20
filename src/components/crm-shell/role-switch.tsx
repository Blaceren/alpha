"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { CRM_ROLES, CRM_ROLE_LABEL, type CrmRole } from "@/domain/identity/roles";
import { useSession } from "./session-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Development-only role switcher. Changes frontend visibility only.
 * This is NOT production RBAC (DECISIONS D-12); always shown with DEMO MODE.
 */
export function RoleSwitch() {
  const { session, setRole } = useSession();

  // No local role to switch (api mode): render nothing rather than a control
  // that would imply the browser can change authority.
  if (!setRole) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary hover:bg-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-text-muted">Роль:</span>
        <span className="font-medium text-text-primary">{CRM_ROLE_LABEL[session.role]}</span>
        <ChevronDown className="h-3 w-3" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="px-2 py-1 text-2xs uppercase tracking-wide text-text-muted">
          Демо-роль (только dev)
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={session.role}
          onValueChange={(v) => setRole(v as CrmRole)}
        >
          {CRM_ROLES.map((role) => (
            <DropdownMenuRadioItem key={role} value={role}>
              {CRM_ROLE_LABEL[role]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-2xs text-text-muted">
          Влияет только на видимость интерфейса. Не является production-безопасностью.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
