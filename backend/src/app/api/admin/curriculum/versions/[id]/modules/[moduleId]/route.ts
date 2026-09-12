import { NextResponse } from "next/server";
import {
  deleteEmptyModuleDefinition,
  updateModuleDefinition,
} from "@/lib/curriculum/authoring";
import {
  curriculumErrorResponse,
  gateCurriculumAdmin,
  parseApiBody,
  parseCurriculumPathId,
  patchModuleBodySchema,
  readJsonBody,
} from "@/lib/curriculum/http";
import { assertModuleInVersion } from "@/lib/curriculum/query";

type RouteProps = {
  params: Promise<{ id: string; moduleId: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "module-update" });
  if (!gate.ok) return gate.response;

  try {
    const { id, moduleId } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const moduleDefinitionId = parseCurriculumPathId(moduleId);
    await assertModuleInVersion(moduleDefinitionId, curriculumVersionId);

    const patch = parseApiBody(patchModuleBodySchema, await readJsonBody(request));

    const updated = await updateModuleDefinition({
      actorId: gate.admin.id,
      moduleDefinitionId,
      patch,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "module-delete" });
  if (!gate.ok) return gate.response;

  try {
    const { id, moduleId } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const moduleDefinitionId = parseCurriculumPathId(moduleId);
    await assertModuleInVersion(moduleDefinitionId, curriculumVersionId);

    await deleteEmptyModuleDefinition({
      actorId: gate.admin.id,
      moduleDefinitionId,
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
