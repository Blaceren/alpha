import { proxyTools } from "@/server/proxy/tools-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ cardId: string }> },
): Promise<Response> {
  const { cardId } = await params;
  return proxyTools(request, { operation: "trade-card-change", cardId });
}
