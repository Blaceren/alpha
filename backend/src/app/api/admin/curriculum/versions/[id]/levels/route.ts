import { NextResponse } from "next/server";
import { createLevelDefinition } from "@/lib/curriculum/authoring";
import {
  createLevelBodySchema,
  curriculumErrorResponse,
  gateCurriculumAdmin,
  parseApiBody,
  parseCurriculumPathId,
  readJsonBody,
} from "@/lib/curriculum/http";
import { assertModuleInVersion } from "@/lib/curriculum/query";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "level-create" });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const body = parseApiBody(createLevelBodySchema, await readJsonBody(request));

    // The referenced module must belong to the path version; a module of
    // another version is reported as NOT_FOUND (404), never disclosed.
    await assertModuleInVersion(body.moduleId, curriculumVersionId);

    const created = await createLevelDefinition({
      actorId: gate.admin.id,
      curriculumVersionId,
      moduleId: body.moduleId,
      levelNumber: body.levelNumber,
      stableCode: body.stableCode,
      type: body.type,
      title: body.title,
      shortDescription: body.shortDescription,
      learningObjective: body.learningObjective,
      completionMethod: body.completionMethod,
      xpReward: body.xpReward,
      requiredXp: body.requiredXp,
      requiredPreviousLevel: body.requiredPreviousLevel,
      requiredCheckpointLevel: body.requiredCheckpointLevel,
      featureUnlockCode: body.featureUnlockCode,
      status: body.status,
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
