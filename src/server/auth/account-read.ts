/**
 * ACCOUNT RECOVERY — what the server reads before it renders (SERVER-ONLY).
 *
 * Two reads, both fail-closed. `readAccountCapabilities` is anonymous: the
 * login and registration pages ask whether this deployment can send mail
 * before they offer anything that ends in an email. `readServerAccount`
 * forwards the session cookie and returns the learner's own address and its
 * state for the profile.
 *
 * An unreachable Backend, a timeout or a body of the wrong shape all mean the
 * same thing here: offer nothing. A «Забыли пароль?» that appears because a
 * read failed open would promise a message nobody is going to send.
 */
import { cookies } from "next/headers";
import { getAcademyConfig } from "@/config/academy-config";
import { sessionCookieHeader } from "@/lib/auth/constants";
import {
  NO_ACCOUNT_CAPABILITIES,
  isAccountCapabilities,
  isAccountView,
  type AccountCapabilities,
  type AccountView,
} from "@/lib/account/account-types";

async function readJson(path: string, cookie: string | null): Promise<unknown | null> {
  const config = getAcademyConfig();
  if (config.mode !== "api" || !config.backendOrigin) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.backendOrigin}${path}`, {
      headers: { accept: "application/json", ...(cookie ? { cookie } : {}) },
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readAccountCapabilities(): Promise<AccountCapabilities> {
  const body = await readJson("/api/auth/capabilities", null);
  const capabilities = (body as { capabilities?: unknown } | null)?.capabilities;
  return isAccountCapabilities(capabilities) ? capabilities : NO_ACCOUNT_CAPABILITIES;
}

export async function readServerAccount(): Promise<AccountView | null> {
  const cookieStore = await cookies();
  const cookie = sessionCookieHeader((name) => cookieStore.get(name));
  if (!cookie) return null;
  const body = await readJson("/api/me/account", cookie);
  return isAccountView(body) ? body : null;
}
