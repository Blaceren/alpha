/**
 * Same-origin list of the learner's own sessions (owner 2026-10-07).
 *
 * One method, one named proxy operation, one constant Backend path. The Backend
 * answers only with the caller's own live sessions — ids, times and a coarse
 * device name — and never with a token.
 */
import { proxyListSessions } from "@/server/proxy/sessions-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return proxyListSessions(request);
}
