import { proxyReferralLink } from "@/server/proxy/referral-link-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST only. No other method is exported, so Next.js answers 405 for GET, PUT,
 * PATCH and DELETE without any of them reaching the proxy or the Backend.
 */
export async function POST(request: Request): Promise<Response> {
  return proxyReferralLink(request, { operation: "referral-link" });
}
