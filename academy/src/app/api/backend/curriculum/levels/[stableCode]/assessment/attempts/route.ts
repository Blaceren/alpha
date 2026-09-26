import { proxyAssessmentWrite } from "@/server/proxy/assessment-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyAssessmentWrite(request, { operation: "assessment-start", stableCode });
}
