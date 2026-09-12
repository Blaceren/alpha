import type { UserRole, UserStatus } from "@prisma/client";
import { getSessionUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export type PublicUser = {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  status?: UserStatus;
  level: number;
  xp: number;
};

export function toPublicUser(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    level: user.level,
    xp: user.xp,
  };
}

export async function getCurrentUser() {
  const userId = await getSessionUserId();

  if (!userId) {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
  });
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("UNAUTHORIZED");
  }

  return user;
}

export function hasRole(userRole: UserRole, allowedRoles: UserRole[]) {
  return allowedRoles.includes(userRole);
}

export async function requireRole(allowedRoles: UserRole[]) {
  const user = await requireCurrentUser();

  if (!hasRole(user.role, allowedRoles)) {
    throw new Error("FORBIDDEN");
  }

  return user;
}
