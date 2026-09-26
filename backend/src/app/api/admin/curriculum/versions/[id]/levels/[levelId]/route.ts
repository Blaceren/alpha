import { NextResponse } from "next/server";
import {
  deleteLevelDefinition,
  updateLevelDefinition,
} from "@/lib/curriculum/authoring";
import {
  curriculumErrorResponse,
  gateCurriculumAdmin,
  parseApiBody,
  parseCurriculumPathId,
  patchLevelBodySchema,
  readJsonBody,
} from "@/lib/curriculum/http";
import { assertLevelInVersion, assertModuleInVersion } from "@/lib/curriculum/query";

type RouteProps = {
  params: Promise<{ id: string; levelId: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "level-update" });
  if (!gate.ok) return gate.response;

  try {
    const { id, levelId } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const levelDefinitionId = parseCurriculumPathId(levelId);
    await assertLevelInVersion(levelDefinitionId, curriculumVersionId);

    const patch = parseApiBody(patchLevelBodySchema, await readJsonBody(request));

    // A move target module must belong to the same version (else 404).
    if (patch.moduleId !== undefined) {
      await assertModuleInVersion(patch.moduleId, curriculumVersionId);
    }

    const updated = await updateLevelDefinition({
      actorId: gate.admin.id,
      levelDefinitionId,
      patch,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "level-delete" });
  if (!gate.ok) return gate.response;

  try {
    const { id, levelId } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const levelDefinitionId = parseCurriculumPathId(levelId);
    await assertLevelInVersion(levelDefinitionId, curriculumVersionId);

    await deleteLevelDefinition({
      actorId: gate.admin.id,
      levelDefinitionId,
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
