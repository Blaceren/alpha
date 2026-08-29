import { Suspense } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { hasUnreadNotifications } from "@/server/notifications/unread-presence";

/**
 * Notification access, and the one honest thing the shell says about unread.
 *
 * WHAT CHANGED AND WHY. This used to render its dot from `unread = true` — a
 * literal default, so the mark was permanently lit on every page for every
 * learner, including the notifications page itself when it said there was
 * nothing. The frozen Notifications design records a hard-coded indicator as
 * INVALID PRODUCT TRUTH, and requires any indicator to derive from real
 * authoritative notification state. It now does.
 *
 * IT STATES EXISTENCE AND NOTHING ELSE. Shown when at least one unread
 * notification exists. It is not a count, not a ranking, and not a claim that
 * anything is urgent, important or required — unread is consumption, and
 * current action is a separate authority the shell deliberately does not carry.
 *
 * IT IS REACHABLE AS TEXT. The old dot was `aria-hidden` with nothing beside
 * it, so unread was not conveyed to assistive technology at all. The mark stays
 * decorative and a text equivalent sits next to it.
 *
 * IT FAILS CLOSED, AND IT NEVER DELAYS THE PAGE. Unknown — no session, an
 * unreachable Backend, a malformed payload — renders no mark, because a
 * withheld claim is honest and a false one is not. The read streams inside
 * Suspense, so the bell is interactive immediately whether or not the answer
 * has arrived.
 */
export function NotificationButton() {
  return (
    <Link href="/notifications" className="iconbtn" aria-label="Уведомления">
      <Icon name="bell" className="h-5 w-5" />
      <Suspense fallback={null}>
        <UnreadPresence />
      </Suspense>
    </Link>
  );
}

async function UnreadPresence() {
  const unread = await hasUnreadNotifications();
  if (unread !== true) return null;
  return (
    <>
      <span className="dot" aria-hidden="true" />
      <span className="sr-only">есть непрочитанные уведомления</span>
    </>
  );
}
