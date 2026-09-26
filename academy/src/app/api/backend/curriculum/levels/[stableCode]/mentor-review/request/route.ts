import { proxyMentorReviewRequest } from "@/server/proxy/mentor-review-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyMentorReviewRequest(request, { operation: "mentor-review-request", stableCode });
}
