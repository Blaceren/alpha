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

async function writeAuditLog({
  userId,
  action,
  entityType,
  entityId,
  metadata,
  request,
}: CreateAuditLogInput) {
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
}

/**
 * Best-effort audit write. A persistence failure is logged and swallowed:
 * the caller's primary action has already happened and must not be undone or
 * blocked by an audit-trail failure. This is the right default for the vast
 * majority of call sites in this codebase.
 *
 * Do NOT use this for an action that must be provably recorded before
 * something sensitive is released to the caller (e.g. a PII reveal) — use
 * `createAuditLogStrict` for that instead.
 */
export async function createAuditLog(input: CreateAuditLogInput) {
  try {
    await writeAuditLog(input);
  } catch (error) {
    console.warn("Audit log failed", error);
  }
}

/**
 * Strict audit write: a persistence failure is NOT swallowed, it is
 * rethrown. Use this only where the caller must fail closed — where a
 * security-sensitive response may not be sent unless the audit row is
 * confirmed persisted first. Callers should let the rejection propagate to
 * their route's existing error handler rather than catching it locally and
 * reconstructing a success response.
 */
export async function createAuditLogStrict(input: CreateAuditLogInput) {
  await writeAuditLog(input);
}
