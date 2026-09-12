import { proxyLevelStart } from "@/server/proxy/level-start-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyLevelStart(request, { operation: "level-start", stableCode });
}
