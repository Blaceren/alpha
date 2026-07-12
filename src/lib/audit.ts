import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type CreateAuditLogInput = {
  userId?: number | null;
  action: string;
  entityType?: string | null;
  entityId?: string | number | null;
  metadata?: Prisma.InputJsonValue | null;
  request?: Request;
};

function getRequestIp(request?: Request) {
  if (!request) {
    return null;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    null
  );
}

export async function createAuditLog({
  userId,
  action,
  entityType,
  entityId,
  metadata,
  request,
}: CreateAuditLogInput) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        entityType: entityType ?? null,
        entityId: entityId == null ? null : String(entityId),
        metadata: metadata === null ? undefined : metadata,
        ip: getRequestIp(request),
        userAgent: request?.headers.get("user-agent") ?? null,
      },
    });
  } catch (error) {
    console.warn("Audit log failed", error);
  }
}
