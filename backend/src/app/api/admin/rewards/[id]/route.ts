import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  adminRewardUpdateSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type AdminRewardRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, { params }: AdminRewardRouteProps) {
  try {
    await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const rewardId = validateNumericParam(id, "id");

  if (!rewardId.success) {
    return rewardId.response;
  }

  const reward = await prisma.reward.findUnique({
    where: { id: rewardId.id },
  });

  if (!reward) {
    return notFoundResponse("Награда не найдена");
  }

  return NextResponse.json({ reward });
}

export async function PATCH(request: Request, { params }: AdminRewardRouteProps) {
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
  const rewardId = validateNumericParam(id, "id");

  if (!rewardId.success) {
    return rewardId.response;
  }

  const parsed = await validateJsonBody(request, adminRewardUpdateSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const existingReward = await prisma.reward.findUnique({
    where: { id: rewardId.id },
  });

  if (!existingReward) {
    return notFoundResponse("Награда не найдена");
  }

  const reward = await prisma.reward.update({
    where: { id: rewardId.id },
    data: parsed.data,
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_REWARD_UPDATED",
    entityType: "Reward",
    entityId: reward.id,
    metadata: {
      before: {
        title: existingReward.title,
        description: existingReward.description,
        type: existingReward.type,
        status: existingReward.status,
      },
      after: parsed.data,
    },
    request,
  });

  return NextResponse.json({ reward });
}
