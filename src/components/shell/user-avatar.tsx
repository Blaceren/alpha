"use client";

import Link from "next/link";
import { useMobileMenu } from "@/components/shell/mobile-menu-state";

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/**
 * Profile access via the learner's avatar (initials placeholder — no photo).
 *
 * IT IS A VISIBLE LINK TO A ROUTE, so on that route it says so. It used to be
 * the only control in the shell pointing at `/profile` and it carried no
 * `aria-current`: the page was current and nothing in the navigation admitted
 * it. The nav items had always marked themselves; the two utilities had been
 * left out because they are not in the nav list, which is a reason they are not
 * in a list, not a reason to say nothing.
 *
 * ON MOBILE IT YIELDS TO THE OPEN MENU. `/profile` is also a row inside «Ещё»,
 * and while that sheet is open it is the exposed navigation. Only one control
 * may claim the page. See `mobile-menu-state.tsx` for why this one steps back.
 *
 * THE ACCESSIBLE NAME IS UNCHANGED: «Профиль — {name}».
 */
export function UserAvatar({
  name,
  current = false,
  placement = "desktop",
}: {
  name: string;
  /** True on `/profile`. Decided by the shell from the same activeId the nav reads. */
  current?: boolean;
  placement?: "desktop" | "mobile";
}) {
  const { open } = useMobileMenu();
  const claims = current && !(placement === "mobile" && open);

  return (
    <Link
      href="/profile"
      className="avatar"
      aria-label={`Профиль — ${name}`}
      title="Профиль"
      aria-current={claims ? "page" : undefined}
    >
      <span aria-hidden="true">{initials(name)}</span>
    </Link>
  );
}
