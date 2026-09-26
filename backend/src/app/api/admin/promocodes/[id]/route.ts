import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { validateJsonBody, validateNumericParam } from "@/lib/validation";

const updateSchema = z.object({ isActive: z.boolean().optional(), maxUses: z.number().int().positive().nullable().optional(), perUserLimit: z.number().int().positive().max(100).optional(), startsAt: z.string().datetime().nullable().optional(), expiresAt: z.string().datetime().nullable().optional() }).refine((value) => Object.keys(value).length > 0);
type Props = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Props) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  let admin;
  try { admin = await requireAdmin(); } catch (error) { return apiAuthErrorResponse(error, request); }
  const id = validateNumericParam((await params).id); if (!id.success) return id.response;
  const parsed = await validateJsonBody(request, updateSchema); if (!parsed.success) return parsed.response;
  const item = await prisma.promocode.update({ where: { id: id.id }, data: { ...parsed.data, startsAt: parsed.data.startsAt === undefined ? undefined : parsed.data.startsAt ? new Date(parsed.data.startsAt) : null, expiresAt: parsed.data.expiresAt === undefined ? undefined : parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null } });
  await createAuditLog({ userId: admin.id, action: "ADMIN_PROMOCODE_UPDATED", entityType: "Promocode", entityId: item.id, metadata: parsed.data, request });
  return NextResponse.json({ item });
}

export async function DELETE(request: Request, { params }: Props) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  let admin;
  try { admin = await requireAdmin(); } catch (error) { return apiAuthErrorResponse(error, request); }
  const id = validateNumericParam((await params).id); if (!id.success) return id.response;
  await prisma.promocode.delete({ where: { id: id.id } });
  await createAuditLog({ userId: admin.id, action: "ADMIN_PROMOCODE_DELETED", entityType: "Promocode", entityId: id.id, request });
  return NextResponse.json({ ok: true });
}
