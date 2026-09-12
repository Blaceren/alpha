import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

/**
 * Notification access, and the slot where the shell's one honest claim about
 * unread goes.
 *
 * THIS FILE IMPORTS NOTHING SERVER-ONLY, AND THAT IS THE POINT. The shell is
 * rendered by server pages AND by the client error boundary at
 * `(app)/home/error.tsx`. A `next/headers` import anywhere in this module's
 * graph therefore lands in the client bundle and the build refuses it — which
 * is exactly what happened when the unread read lived here. The read is a
 * SERVER concern, so it is passed IN as an element and the shell stays neutral
 * about where it came from.
 *
 * AN ABSENT SLOT IS A WITHHELD CLAIM, NOT A FALSE ONE. The mark used to render
 * from `unread = true` — a literal default, so it was permanently lit on every
 * page for every learner, including the notifications page when it said there
 * was nothing. The frozen Notifications design records a hard-coded indicator
 * as INVALID PRODUCT TRUTH. Nothing is now shown unless something knew.
 */
export function NotificationButton({
  presence,
  current = false,
}: {
  presence?: ReactNode;
  /**
   * True on `/notifications`. It is a visible link to a route, so on that route
   * it says so — the same thing every nav item has always done. It is decided by
   * the shell from the same `activeId` the navigation reads, so the bell and the
   * bar can never disagree about where the learner is.
   *
   * INDEPENDENT OF UNREAD. Being the current page and having unread
   * notifications are two different facts about two different things; the mark
   * below still says only what `hasUnreadNotifications` answered, and this says
   * only where the learner is.
   */
  current?: boolean;
}) {
  return (
    <Link
      href="/notifications"
      className="iconbtn"
      aria-label="Уведомления"
      aria-current={current ? "page" : undefined}
    >
      <Icon name="bell" className="h-5 w-5" />
      {/* Streamed, so the bell is interactive whether or not the answer has
          arrived, and the page never waits on it. */}
      {presence ? <Suspense fallback={null}>{presence}</Suspense> : null}
    </Link>
  );
}
