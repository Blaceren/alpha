import { proxyToBackend } from "@/server/proxy/backend-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return proxyToBackend(request, "login");
}
