/**
 * Same-origin update of the learner's own display name.
 *
 * One method, one constant Backend path, one field. The Backend scopes the
 * update to the authenticated user, so this cannot rename anybody else, and the
 * proxy constructs the outgoing body itself so no adjacent profile field —
 * `email` in particular, which would start a verification flow — can be reached
 * through this route.
 */
import { proxyUpdateProfileName } from "@/server/proxy/profile-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request): Promise<Response> {
  return proxyUpdateProfileName(request);
}
