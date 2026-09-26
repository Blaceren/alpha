import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { validateJsonBody, validateNumericParam } from "@/lib/validation";
const schema = z.object({ title: z.string().trim().min(1).max(120).optional(), description: z.string().trim().min(1).max(500).optional(), rarity: z.string().trim().min(1).max(30).optional(), iconKey: z.string().trim().min(1).max(50).optional(), isActive: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0);
type Props = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Props) { if (!validateCsrfToken(request)) return csrfFailureResponse(request); let admin; try { admin = await requireAdmin(); } catch (error) { return apiAuthErrorResponse(error, request); } const id = validateNumericParam((await params).id); if (!id.success) return id.response; const parsed = await validateJsonBody(request, schema); if (!parsed.success) return parsed.response; const item = await prisma.achievement.update({ where: { id: id.id }, data: parsed.data }); await createAuditLog({ userId: admin.id, action: "ADMIN_ACHIEVEMENT_UPDATED", entityType: "Achievement", entityId: item.id, metadata: parsed.data, request }); return NextResponse.json({ item }); }
export async function DELETE(request: Request, { params }: Props) { if (!validateCsrfToken(request)) return csrfFailureResponse(request); let admin; try { admin = await requireAdmin(); } catch (error) { return apiAuthErrorResponse(error, request); } const id = validateNumericParam((await params).id); if (!id.success) return id.response; await prisma.achievement.update({ where: { id: id.id }, data: { isActive: false } }); await createAuditLog({ userId: admin.id, action: "ADMIN_ACHIEVEMENT_DISABLED", entityType: "Achievement", entityId: id.id, request }); return NextResponse.json({ ok: true }); }
