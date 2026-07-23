import { proxyCurriculumRead } from "@/server/proxy/curriculum-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return proxyCurriculumRead(request, { operation: "curriculum-current" });
}
