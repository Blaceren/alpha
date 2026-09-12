import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin();
    const cohorts = await prisma.cohort.findMany({
      include: {
        users: true,
      },
      orderBy: { id: "asc" },
    });

    await createAuditLog({
      userId: admin.id,
      action: "ADMIN_VIEWED_CRM",
      entityType: "Cohort",
      metadata: { view: "cohorts" },
      request,
    });

    return NextResponse.json({ cohorts });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
