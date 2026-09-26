import { proxyLessonProgress } from "@/server/proxy/lesson-progress-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  return proxyLessonProgress(request, { operation: "lesson-progress", stableCode });
}
