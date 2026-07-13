import { NextResponse } from "next/server";
import {
  curriculumErrorResponse,
  gateCurriculumAdmin,
  parseApiBody,
  parseCurriculumPathId,
  publishBodySchema,
  readJsonBody,
} from "@/lib/curriculum/http";
import { publishCurriculumVersion } from "@/lib/curriculum/service";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "publish" });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const body = parseApiBody(publishBodySchema, await readJsonBody(request));

    const result = await publishCurriculumVersion({
      curriculumVersionId,
      actorId: gate.admin.id,
      expectedPublishedVersionId: body.expectedPublishedVersionId ?? null,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
