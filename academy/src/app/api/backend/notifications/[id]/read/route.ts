/**
 * Same-origin mark-one-notification-read.
 *
 * One method, one named proxy operation, one constant Backend path template
 * whose only variable segment is validated and encoded by the proxy before any
 * request is built. The Backend scopes the mutation to the authenticated user,
 * so this cannot mark anybody else's notification read.
 *
 * The Backend route it forwards to already existed; this phase added no Backend
 * behaviour, only the same-origin handler the browser needs to reach it.
 */
import { proxyMarkNotificationRead } from "@/server/proxy/notifications-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return proxyMarkNotificationRead(request, id);
}
