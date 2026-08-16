import { proxyCommunity } from "@/server/proxy/community-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceCode: string }> },
): Promise<Response> {
  const { spaceCode } = await params;
  return proxyCommunity(request, { operation: "community-space", spaceCode });
}
