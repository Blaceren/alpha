import { proxyReport } from "@/server/proxy/report-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyReport(request, { operation: "report-draft", stableCode });
}
