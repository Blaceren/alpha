import { proxyManualCompletion } from "@/server/proxy/manual-completion-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyManualCompletion(request, { operation: "manual-complete", stableCode });
}
