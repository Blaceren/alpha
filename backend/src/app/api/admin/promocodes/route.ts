import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { validateJsonBody } from "@/lib/validation";

const schema = z.object({
  code: z.string().trim().min(2).max(50).transform((value) => value.toUpperCase()),
  type: z.enum(["xp_bonus", "unlock_reward", "grant_achievement"]),
  value: z.record(z.string(), z.unknown()),
  maxUses: z.number().int().positive().nullable().optional(),
  perUserLimit: z.literal(1).default(1),
  startsAt: z.string().datetime().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const items = await prisma.promocode.findMany({ include: { redemptions: { include: { user: { select: { id: true, email: true, name: true } } }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ items });
  } catch (error) { return apiAuthErrorResponse(error, request); }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  let admin;
  try { admin = await requireAdmin(); } catch (error) { return apiAuthErrorResponse(error, request); }
  const parsed = await validateJsonBody(request, schema);
  if (!parsed.success) return parsed.response;
  const item = await prisma.promocode.create({ data: { ...parsed.data, value: parsed.data.value as Prisma.InputJsonValue, startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null, expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, createdById: admin.id } });
  await createAuditLog({ userId: admin.id, action: "ADMIN_PROMOCODE_CREATED", entityType: "Promocode", entityId: item.id, metadata: { code: item.code, type: item.type }, request });
  return NextResponse.json({ item }, { status: 201 });
}
