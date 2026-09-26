import { NextResponse } from "next/server";
import { createModuleDefinition } from "@/lib/curriculum/authoring";
import {
  createModuleBodySchema,
  curriculumErrorResponse,
  gateCurriculumAdmin,
  parseApiBody,
  parseCurriculumPathId,
  readJsonBody,
} from "@/lib/curriculum/http";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "module-create" });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const body = parseApiBody(createModuleBodySchema, await readJsonBody(request));

    const created = await createModuleDefinition({
      actorId: gate.admin.id,
      curriculumVersionId,
      moduleNumber: body.moduleNumber,
      code: body.code,
      title: body.title,
      description: body.description,
      firstLevel: body.firstLevel,
      lastLevel: body.lastLevel,
      checkpointLevel: body.checkpointLevel,
      learningObjective: body.learningObjective,
      status: body.status,
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
