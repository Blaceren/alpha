import { hasUnreadNotifications } from "@/server/notifications/unread-presence";

/**
 * The shell's unread mark — SERVER ONLY, and passed into the shell rather than
 * imported by it.
 *
 * IT STATES EXISTENCE AND NOTHING ELSE. Shown when at least one unread
 * notification exists. It is not a count, not a ranking, and not a claim that
 * anything is urgent, important or required — unread is consumption, and
 * current action is a separate authority the shell deliberately does not carry.
 *
 * IT IS REACHABLE AS TEXT. The old dot was `aria-hidden` with nothing beside it,
 * so unread was not conveyed to assistive technology at all. The mark stays
 * decorative and a text equivalent sits next to it.
 *
 * IT FAILS CLOSED. Unknown — no session, an unreachable Backend, a malformed
 * payload — renders no mark, because a withheld claim is honest and a false one
 * is not.
 */
export async function UnreadPresence() {
  const unread = await hasUnreadNotifications();
  if (unread !== true) return null;
  return (
    <>
      <span className="dot" aria-hidden="true" />
      <span className="sr-only">есть непрочитанные уведомления</span>
    </>
  );
}
