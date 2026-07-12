import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import { validateJsonBody } from "@/lib/validation";
const schema = z.object({ achievementId: z.number().int().positive().nullable() });
export async function POST(request: Request) { if (!validateCsrfToken(request)) return csrfFailureResponse(request); const parsed = await validateJsonBody(request, schema); if (!parsed.success) return parsed.response; try { const user = await requireUser(); if (parsed.data.achievementId) { const granted = await prisma.userAchievement.findUnique({ where: { userId_achievementId: { userId: user.id, achievementId: parsed.data.achievementId } } }); if (!granted) return NextResponse.json({ error: "ACHIEVEMENT_NOT_GRANTED" }, { status: 403 }); } await prisma.user.update({ where: { id: user.id }, data: { selectedAchievementId: parsed.data.achievementId } }); await createAuditLog({ userId: user.id, action: "ACHIEVEMENT_DISPLAY_SELECTED", entityType: "Achievement", entityId: parsed.data.achievementId, request }); return NextResponse.json({ ok: true }); } catch (error) { return apiAuthErrorResponse(error, request); } }
