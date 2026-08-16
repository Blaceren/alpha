import { proxyCommunity } from "@/server/proxy/community-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ discussionId: string }> },
): Promise<Response> {
  const { discussionId } = await params;
  return proxyCommunity(request, { operation: "community-thread", discussionId });
}
