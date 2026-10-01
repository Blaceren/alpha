import { proxyTools } from "@/server/proxy/tools-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ entryId: string }> }): Promise<Response> {
  const { entryId } = await params;
  return proxyTools(request, { operation: "journal-change", entryId });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ entryId: string }> }): Promise<Response> {
  const { entryId } = await params;
  return proxyTools(request, { operation: "journal-delete", entryId });
}
