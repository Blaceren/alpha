import { NextResponse } from "next/server";
import {
  archiveBodySchema,
  curriculumErrorResponse,
  gateCurriculumAdmin,
  parseApiBody,
  parseCurriculumPathId,
  readJsonBody,
} from "@/lib/curriculum/http";
import { archiveCurriculumVersion } from "@/lib/curriculum/service";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "archive" });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    parseApiBody(archiveBodySchema, await readJsonBody(request));

    const archived = await archiveCurriculumVersion({
      curriculumVersionId,
      actorId: gate.admin.id,
    });

    return NextResponse.json({ data: archived });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
