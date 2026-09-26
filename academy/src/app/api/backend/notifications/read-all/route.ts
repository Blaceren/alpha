/**
 * Same-origin mark-all-notifications-read.
 *
 * One method, one named proxy operation, one constant Backend path with no
 * caller input at all. The Backend scopes the mutation to the authenticated
 * user, so this cannot clear anybody else's list.
 *
 * NOTE ON ROUTE PRECEDENCE. This sits beside the dynamic `[id]` segment, and
 * Next.js resolves the STATIC segment first — so `/read-all` can never be
 * captured by `[id]` and interpreted as a notification whose id is the literal
 * string "read-all". The proxy's id charset would have accepted that string, so
 * this ordering guarantee is what keeps the two operations genuinely distinct.
 *
 * The Backend route it forwards to already existed; this phase added no Backend
 * behaviour.
 */
import { proxyMarkAllNotificationsRead } from "@/server/proxy/notifications-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return proxyMarkAllNotificationsRead(request);
}
