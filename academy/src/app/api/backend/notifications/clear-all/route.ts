/**
 * Same-origin «Очистить всё» for the learner's notifications (DD-349).
 *
 * One method, one named proxy operation, one constant Backend path with no
 * caller input at all — the same shape as read-all beside it. The Backend
 * scopes the change to the authenticated learner and hides their notifications
 * from their own list; it deletes nothing.
 *
 * Static segment, so Next.js resolves it before the dynamic `[id]` route.
 */
import { proxyClearAllNotifications } from "@/server/proxy/notifications-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return proxyClearAllNotifications(request);
}
