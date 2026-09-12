import { proxyReport } from "@/server/proxy/report-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  const query = new URL(request.url).searchParams;
  return proxyReport(request, {
    operation: "report-revisions",
    stableCode,
    locale: query.get("locale"),
    limit: query.get("limit"),
    cursor: query.get("cursor"),
  });
}
