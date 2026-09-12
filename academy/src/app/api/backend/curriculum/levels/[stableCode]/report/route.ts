import { proxyReport } from "@/server/proxy/report-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  const locale = new URL(request.url).searchParams.get("locale");
  return proxyReport(request, { operation: "report-definition", stableCode, locale });
}
