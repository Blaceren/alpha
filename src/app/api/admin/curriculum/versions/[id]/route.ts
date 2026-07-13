import { NextResponse } from "next/server";
import {
  deleteEmptyCurriculumDraft,
  updateCurriculumDraft,
} from "@/lib/curriculum/authoring";
import {
  curriculumErrorResponse,
  gateCurriculumAdmin,
  NO_STORE_HEADERS,
  parseApiBody,
  parseCurriculumPathId,
  patchVersionBodySchema,
  readJsonBody,
  toEffectiveFromDate,
} from "@/lib/curriculum/http";
import { getCurriculumVersionDetail } from "@/lib/curriculum/query";

type RouteProps = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: false });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const detail = await getCurriculumVersionDetail(curriculumVersionId);

    return NextResponse.json({ data: detail }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "update" });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);
    const body = parseApiBody(patchVersionBodySchema, await readJsonBody(request));

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.effectiveFrom !== undefined) {
      patch.effectiveFrom = toEffectiveFromDate(body.effectiveFrom);
    }
    if (body.changeNotes !== undefined) patch.changeNotes = body.changeNotes;

    const updated = await updateCurriculumDraft({
      actorId: gate.admin.id,
      curriculumVersionId,
      patch,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "delete" });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await params;
    const curriculumVersionId = parseCurriculumPathId(id);

    await deleteEmptyCurriculumDraft({
      actorId: gate.admin.id,
      curriculumVersionId,
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
