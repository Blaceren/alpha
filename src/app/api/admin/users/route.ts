import type { Prisma, UserRole, UserStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  paginatedResponse,
  parseAdminListQuery,
  parseEnumFilter,
} from "@/lib/adminList";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { getTrainingLevelFromProgress } from "@/lib/trainingLevel";
import {
  validateJsonBody,
  validationErrorResponse,
  type ValidationDetail,
} from "@/lib/validation";

const adminUserCreateSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  name: z.string().trim().min(1),
  password: z.string().min(6).default("password123"),
  role: z.enum(["user", "admin", "support", "mentor", "moderator", "news_editor"]),
});

function getProgressStatus(checkpointStatus?: string) {
  return checkpointStatus === "frozen" ? "frozen" : "active";
}

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const parsed = parseAdminListQuery(
      request,
      ["id", "name", "email", "role", "status", "level", "xp", "createdAt"],
      "id",
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const details: ValidationDetail[] = [];
    const role = parseEnumFilter<UserRole>(
      parsed.searchParams,
      "role",
      ["user", "admin", "support", "mentor", "moderator", "news_editor"],
      details,
    );
    const status = parseEnumFilter<UserStatus>(
      parsed.searchParams,
      "status",
      ["active", "blocked"],
      details,
    );

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const where: Prisma.UserWhereInput = {
      ...(parsed.query.q
        ? {
            OR: [
              { name: { contains: parsed.query.q } },
              { email: { contains: parsed.query.q } },
            ],
          }
        : {}),
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
    };
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          checkpoint: true,
          taskProgress: {
            select: { status: true, task: { select: { stepNumber: true } } },
            orderBy: { task: { stepNumber: "asc" } },
          },
        },
        orderBy: { [parsed.query.sort ?? "id"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json(
      paginatedResponse(
        users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          level: getTrainingLevelFromProgress(user.taskProgress),
          storedLevel: user.level,
          xp: user.xp,
          progressStatus: getProgressStatus(user.checkpoint?.status),
          createdAt: user.createdAt,
        })),
        total,
        parsed.query.page,
        parsed.query.pageSize,
      ),
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  let adminUser;
  try {
    adminUser = await requireAdmin();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const parsed = await validateJsonBody(request, adminUserCreateSchema);
  if (!parsed.success) return parsed.response;

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json(
      { error: "EMAIL_EXISTS", message: "Email уже занят" },
      { status: 400 },
    );
  }

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      status: "active",
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      emailVerifiedAt: new Date(),
    },
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_SERVICE_ACCOUNT_CREATED",
    entityType: "User",
    entityId: user.id,
    metadata: { email: user.email, role: user.role },
    request,
  });

  return NextResponse.json({ user }, { status: 201 });
}
