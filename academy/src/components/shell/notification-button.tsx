import type { ReactNode } from "react";
import { Suspense } from "react";
import { NotificationsBell } from "@/components/shell/notifications-bell";

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
  placement = "desktop",
}: {
  presence?: ReactNode;
  /**
   * True on `/notifications`, decided by the shell from the same `activeId` the
   * navigation reads, so the bell and the bar can never disagree about where
   * the learner is. INDEPENDENT OF UNREAD — being the current page and having
   * unread notifications are two different facts.
   */
  current?: boolean;
  /** Which bar this bell sits in (desktop band or phone top bar). */
  placement?: "desktop" | "mobile";
}) {
  /* Since 2026-10-06 (DD-349) the bell opens a small window in place instead
     of leading to `/notifications`; the page stays, one press away inside it.
     The presence is streamed, so the bell is interactive whether or not the
     answer has arrived, and the page never waits on it. */
  return (
    <NotificationsBell
      current={current}
      placement={placement}
      presence={presence ? <Suspense fallback={null}>{presence}</Suspense> : null}
    />
  );
}
