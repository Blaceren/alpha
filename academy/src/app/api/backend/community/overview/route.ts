import { proxyCommunity } from "@/server/proxy/community-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return proxyCommunity(request, { operation: "community-overview" });
}
