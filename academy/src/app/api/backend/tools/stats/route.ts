import { proxyTools } from "@/server/proxy/tools-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return proxyTools(request, { operation: "stats-page" });
}
