import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  notFoundResponse,
  openQuestionStatusSchema,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type OpenQuestionRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, { params }: OpenQuestionRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let adminUser;

  try {
    adminUser = await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const questionId = validateNumericParam(id, "id");

  if (!questionId.success) {
    return questionId.response;
  }

  const parsed = await validateJsonBody(request, openQuestionStatusSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const existingQuestion = await prisma.openQuestion.findUnique({
    where: { id: questionId.id },
  });

  if (!existingQuestion) {
    return notFoundResponse();
  }

  const question = await prisma.openQuestion.update({
    where: { id: questionId.id },
    data: { status: parsed.data.status },
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "OPEN_QUESTION_UPDATED",
    entityType: "OpenQuestion",
    entityId: question.id,
    metadata: {
      status: question.status,
    },
    request,
  });

  return NextResponse.json({ question });
}
