import { proxyToBackend } from "@/server/proxy/backend-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The one bounded registration proxy (AFD-3A).
 *
 *     POST /api/backend/auth/register  →  POST /api/auth/register
 *
 * POST is the only exported method, so Next.js answers 405 for GET, PUT, PATCH
 * and DELETE before `proxyToBackend` runs and before Backend is contacted. The
 * Backend path is a constant in the allow-list, never caller-derived.
 */
export async function POST(request: Request): Promise<Response> {
  return proxyToBackend(request, "register");
}
