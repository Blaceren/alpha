import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { validateJsonBody } from "@/lib/validation";

const schema = z.object({ slug: z.string().trim().min(2).max(80), title: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(500), rarity: z.string().trim().min(1).max(30), iconKey: z.string().trim().min(1).max(50), isActive: z.boolean().default(true) });

export async function GET(request: Request) {
  try { await requireAdmin(); return NextResponse.json({ items: await prisma.achievement.findMany({ include: { users: { include: { user: { select: { id: true, email: true, name: true } } } } }, orderBy: { id: "asc" } }) }); }
  catch (error) { return apiAuthErrorResponse(error, request); }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  let admin; try { admin = await requireAdmin(); } catch (error) { return apiAuthErrorResponse(error, request); }
  const parsed = await validateJsonBody(request, schema); if (!parsed.success) return parsed.response;
  const item = await prisma.achievement.create({ data: parsed.data });
  await createAuditLog({ userId: admin.id, action: "ADMIN_ACHIEVEMENT_CREATED", entityType: "Achievement", entityId: item.id, request });
  return NextResponse.json({ item }, { status: 201 });
}
