import { proxySupport } from "@/server/proxy/support-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
): Promise<Response> {
  const { caseId } = await params;
  return proxySupport(request, { operation: "support-reply", caseId });
}
