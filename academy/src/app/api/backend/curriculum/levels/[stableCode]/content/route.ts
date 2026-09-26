import { proxyCurriculumRead } from "@/server/proxy/curriculum-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ stableCode: string }> },
): Promise<Response> {
  const { stableCode } = await params;
  const locale = new URL(request.url).searchParams.get("locale");
  return proxyCurriculumRead(request, { operation: "level-content", stableCode, locale });
}
