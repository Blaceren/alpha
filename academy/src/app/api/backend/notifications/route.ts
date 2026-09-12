/**
 * Same-origin read of the learner's own notifications.
 *
 * Bounded like every other Academy proxy: one method, one constant Backend
 * path, nothing derived from caller input. The Backend scopes the query to the
 * authenticated user, so this cannot read anybody else's list, and Learner
 * Operations internal notes are not in this model at all — they live in a
 * physically separate table the Backend never joins here.
 */
import { proxyBackendJson } from "@/server/proxy/notifications-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return proxyBackendJson(request);
}
