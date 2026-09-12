import { proxySupport } from "@/server/proxy/support-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return proxySupport(request, { operation: "support-list" });
}

export async function POST(request: Request): Promise<Response> {
  return proxySupport(request, { operation: "support-open" });
}
