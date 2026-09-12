import { proxyCheckpointVerify } from "@/server/proxy/checkpoint-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyCheckpointVerify(request, { operation: "checkpoint-verify", stableCode });
}
