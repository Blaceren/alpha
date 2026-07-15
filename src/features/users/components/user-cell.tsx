import * as React from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import type { UserSummary } from "@/domain/users/user";

function initials(name: string | null): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/**
 * Primary identity cell. Uses the permission-aware identity projection from the
 * provider (list context = always masked; never full email). The display name
 * is a normal accessible link to the future User 360.
 */
export function UserCell({ user }: { user: UserSummary }) {
  const id = user.identity;
  const name = id?.mode === "hidden" ? null : id?.displayName ?? user.displayName;
  const email = id?.mode === "masked" ? id.email : null; // pseudonymous/hidden → no email
  const secondary =
    id?.mode === "pseudonymous"
      ? id.pseudonymId
      : email ?? (id?.mode === "hidden" ? "Identity скрыт для роли" : null);

  const geo = [user.country, user.locale].filter(Boolean).join(" · ");

  return (
    <div className="flex items-center gap-2.5">
      <Avatar initials={initials(name)} />
      <div className="min-w-0 max-w-[160px]">
        <div className="flex items-center gap-2">
          {name ? (
            <Link
              href={`/users/${user.id}`}
              className="truncate text-sm font-medium text-text-primary hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-text-muted">{user.id}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-2xs text-text-muted">
          {secondary ? <span className="truncate">{secondary}</span> : null}
          {geo ? <span className="hidden truncate sm:inline">· {geo}</span> : null}
        </div>
      </div>
    </div>
  );
}
