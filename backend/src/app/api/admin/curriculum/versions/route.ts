import { NextResponse } from "next/server";
import { createCurriculumDraft } from "@/lib/curriculum/authoring";
import {
  createVersionBodySchema,
  curriculumErrorResponse,
  gateCurriculumAdmin,
  NO_STORE_HEADERS,
  parseApiBody,
  readJsonBody,
  toEffectiveFromDate,
} from "@/lib/curriculum/http";
import { listCurriculumVersions } from "@/lib/curriculum/query";

export async function GET(request: Request) {
  const gate = await gateCurriculumAdmin(request, { write: false });
  if (!gate.ok) return gate.response;

  try {
    const params = new URL(request.url).searchParams;
    const result = await listCurriculumVersions({
      status: params.get("status") ?? undefined,
      code: params.get("code") ?? undefined,
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });

    return NextResponse.json({ data: result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const gate = await gateCurriculumAdmin(request, { write: true, rateKey: "create" });
  if (!gate.ok) return gate.response;

  try {
    const body = parseApiBody(createVersionBodySchema, await readJsonBody(request));

    const created = await createCurriculumDraft({
      actorId: gate.admin.id,
      code: body.code,
      name: body.name,
      versionNumber: body.versionNumber,
      effectiveFrom: toEffectiveFromDate(body.effectiveFrom),
      changeNotes: body.changeNotes ?? undefined,
    });

    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    return curriculumErrorResponse(error);
  }
}
