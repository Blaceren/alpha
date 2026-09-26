import { proxyAssessmentWrite } from "@/server/proxy/assessment-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
): Promise<Response> {
  const { attemptId } = await params;
  return proxyAssessmentWrite(request, { operation: "assessment-submit", attemptId });
}
