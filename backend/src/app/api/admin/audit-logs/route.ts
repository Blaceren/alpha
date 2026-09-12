import { NextResponse } from "next/server";
import type { Prisma, UserRole } from "@prisma/client";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const params = new URL(request.url).searchParams;
    const limitValue = params.get("limit") ?? "100";
    const allowedLimits = ["100", "500", "1000", "all"];
    if (!allowedLimits.includes(limitValue)) return NextResponse.json({ error: "INVALID_LIMIT" }, { status: 400 });
    const userId = Number(params.get("userId") ?? 0);
    const dateFrom = params.get("dateFrom");
    const dateTo = params.get("dateTo");
    const role = params.get("role") as UserRole | null;
    const allowedRoles: UserRole[] = ["user", "admin", "support", "mentor", "moderator", "news_editor"];
    if (role && !allowedRoles.includes(role)) return NextResponse.json({ error: "INVALID_ROLE" }, { status: 400 });
    const where: Prisma.AuditLogWhereInput = {
      ...(params.get("action") ? { action: { contains: params.get("action")! } } : {}),
      ...(Number.isInteger(userId) && userId > 0 ? { userId } : {}),
      ...(role ? { user: { role } } : {}),
      ...(params.get("entityType") ? { entityType: params.get("entityType") } : {}),
      ...(params.get("entityId") ? { entityId: params.get("entityId") } : {}),
      ...((dateFrom || dateTo) ? { createdAt: { ...(dateFrom ? { gte: new Date(dateFrom) } : {}), ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}) } } : {}),
    };
    const take = limitValue === "all" ? 5000 : Number(limitValue);
    const [logs, total] = await Promise.all([prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take,
    }), prisma.auditLog.count({ where })]);

    return NextResponse.json({ logs, total, limit: take, truncated: total > take });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
