import type { Prisma, RewardType } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  paginatedResponse,
  parseAdminListQuery,
  parseEnumFilter,
} from "@/lib/adminList";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { validationErrorResponse, type ValidationDetail } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const parsed = parseAdminListQuery(
      request,
      ["id", "title", "type", "status", "relatedTaskId"],
      "id",
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const details: ValidationDetail[] = [];
    const type = parseEnumFilter<RewardType>(
      parsed.searchParams,
      "type",
      ["lesson", "consultation", "guide", "xp", "chat_access", "analytics_access", "other"],
      details,
    );

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const where: Prisma.RewardWhereInput = {
      ...(parsed.query.q
        ? {
            OR: [
              { title: { contains: parsed.query.q } },
              { description: { contains: parsed.query.q } },
              { status: { contains: parsed.query.q } },
            ],
          }
        : {}),
      ...(type ? { type } : {}),
    };
    const [rewards, total] = await Promise.all([
      prisma.reward.findMany({
        where,
        orderBy: { [parsed.query.sort ?? "id"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.reward.count({ where }),
    ]);

    return NextResponse.json(
      paginatedResponse(rewards, total, parsed.query.page, parsed.query.pageSize),
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
