import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  paginatedResponse,
  parseAdminListQuery,
  parseBooleanFilter,
  parseNumberFilter,
} from "@/lib/adminList";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import { validationErrorResponse, type ValidationDetail } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const parsed = parseAdminListQuery(
      request,
      ["id", "stepNumber", "title", "xpReward", "rewardType", "isCheckpoint"],
      "stepNumber",
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const details: ValidationDetail[] = [];
    const isCheckpoint = parseBooleanFilter(
      parsed.searchParams,
      "isCheckpoint",
      details,
    );
    const minXp = parseNumberFilter(parsed.searchParams, "minXp", details);
    const maxXp = parseNumberFilter(parsed.searchParams, "maxXp", details);

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const where: Prisma.TaskWhereInput = {
      ...(parsed.query.q
        ? {
            OR: [
              { title: { contains: parsed.query.q } },
              { description: { contains: parsed.query.q } },
              { rewardType: { contains: parsed.query.q } },
            ],
          }
        : {}),
      ...(isCheckpoint === undefined ? {} : { isCheckpoint }),
      ...(minXp === undefined && maxXp === undefined
        ? {}
        : {
            xpReward: {
              ...(minXp === undefined ? {} : { gte: minXp }),
              ...(maxXp === undefined ? {} : { lte: maxXp }),
            },
          }),
    };
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { [parsed.query.sort ?? "stepNumber"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.task.count({ where }),
    ]);

    return NextResponse.json(
      paginatedResponse(tasks, total, parsed.query.page, parsed.query.pageSize),
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
