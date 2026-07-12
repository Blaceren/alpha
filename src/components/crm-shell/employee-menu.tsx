"use client";

import * as React from "react";
import { LogOut, UserRound } from "lucide-react";
import { useSession } from "./session-context";
import { CRM_ROLE_LABEL } from "@/domain/identity/roles";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Employee menu. Sign-out is a disabled placeholder (no real auth in Phase 1A). */
export function EmployeeMenu() {
  const { session } = useSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Меню сотрудника"
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar initials={session.avatarInitials} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="px-2 py-1">
          <p className="text-sm font-medium text-text-primary">{session.displayName}</p>
          <p className="text-2xs text-text-muted">
            {CRM_ROLE_LABEL[session.role]} · {session.timezone}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-text-secondary">
          <UserRound className="h-4 w-4" aria-hidden />
          Профиль (скоро)
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-text-muted"
          disabled
          title="Аутентификация появится позже — в Phase 1A её нет"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Выйти (недоступно в demo)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
