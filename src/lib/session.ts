import { cookies } from "next/headers";
import crypto from "node:crypto";
import type { UserRole } from "@prisma/client";
import { getSessionSecret } from "@/lib/env";

export const SESSION_COOKIE_NAME = "trading_platform_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const USER_ROLES: UserRole[] = ["user", "admin", "support", "mentor", "moderator", "news_editor"];

export type SessionPayload = {
  userId: number;
  role: UserRole;
  expiresAt: Date;
};

function sign(value: string) {
  return crypto
    .createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("hex");
}

export function createSessionToken(userId: number, role: UserRole) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${role}.${expiresAt}`;
  const signature = sign(payload);

  return `${payload}.${signature}`;
}

export function verifySessionToken(token?: string) {
  if (!token) {
    return null;
  }

  const [userIdRaw, roleRaw, expiresAtRaw, signature] = token.split(".");
  const payload = `${userIdRaw}.${roleRaw}.${expiresAtRaw}`;
  const expectedSignature = sign(payload);

  if (!signature || signature !== expectedSignature) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  const role = USER_ROLES.find((availableRole) => availableRole === roleRaw);

  if (!role || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  const userId = Number(userIdRaw);

  return Number.isInteger(userId) ? { userId, role, expiresAt: new Date(expiresAt) } : null;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return verifySessionToken(token);
}

export async function getSessionUserId() {
  const session = await getSession();

  return session?.userId ?? null;
}

export function shouldUseSecureCookies(env: NodeJS.ProcessEnv = process.env) {
  if (env.APP_URL) {
    try {
      return new URL(env.APP_URL).protocol === "https:";
    } catch {
      // Runtime env validation reports malformed APP_URL values separately.
    }
  }

  return env.NODE_ENV === "production";
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: shouldUseSecureCookies(),
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
