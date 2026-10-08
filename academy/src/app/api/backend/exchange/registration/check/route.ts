import { proxyReferralLink } from "@/server/proxy/referral-link-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST only, no body. Asks the Backend whether this learner's Pocket
 * registration is already confirmed, and lets it complete the registration
 * level if it is. No other method is exported, so Next.js answers 405 for
 * anything else without reaching the proxy.
 */
export async function POST(request: Request): Promise<Response> {
  return proxyReferralLink(request, { operation: "registration-check" });
}
