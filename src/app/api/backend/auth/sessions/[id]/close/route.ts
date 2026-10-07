/**
 * Same-origin «close this session» — from the account's other session (owner
 * 2026-10-07: «возможность закрыть сеанс с другого сеанса»).
 *
 * One method, one named proxy operation, one constant Backend path template
 * whose only variable segment is validated and encoded by the proxy before any
 * request is built. The Backend checks the CSRF pair and scopes the close to the
 * caller's own sessions, so nobody else's can be closed from here.
 */
import { proxyCloseSession } from "@/server/proxy/sessions-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return proxyCloseSession(request, id);
}
