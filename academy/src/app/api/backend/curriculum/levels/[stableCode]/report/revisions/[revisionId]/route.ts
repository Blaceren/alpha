import { proxyReport } from "@/server/proxy/report-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ stableCode: string; revisionId: string }> },
): Promise<Response> {
  const { stableCode, revisionId } = await params;
  const locale = new URL(request.url).searchParams.get("locale");
  return proxyReport(request, { operation: "report-revision", stableCode, revisionId, locale });
}
