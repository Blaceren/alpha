import { REQUEST_ID_HEADER } from "@/lib/api/errors";

/**
 * ACCOUNT RECOVERY — the browser's calls, and what each can answer.
 *
 * Every function returns a small closed set of outcomes the form can show, not
 * a status code: a form that receives "400" has to guess whether the link died
 * or the password was short. Passwords and tokens arrive as arguments and leave
 * as one request body; nothing here stores, logs or returns them.
 */
const PROXY_BASE = "/api/backend";

type Answer = { status: number; code: string | null; body: unknown; requestId: string | null } | null;

async function csrfToken(): Promise<string | null> {
  try {
    const response = await fetch(`${PROXY_BASE}/csrf`, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const token = ((await response.json()) as { csrfToken?: unknown })?.csrfToken;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** POST one JSON body. `null` means the request never got an answer. */
async function post(path: string, body: unknown, options: { csrf?: boolean } = {}): Promise<Answer> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (options.csrf) {
    const token = await csrfToken();
    if (!token) return null;
    headers["x-csrf-token"] = token;
  }
  let response: Response;
  try {
    response = await fetch(`${PROXY_BASE}${path}`, {
      method: "POST",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return null;
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const raw = (parsed as { error?: unknown } | null)?.error;
  const code = typeof raw === "string" && /^[A-Z0-9_]{1,64}$/.test(raw) ? raw : null;
  return { status: response.status, code, body: parsed, requestId: response.headers.get(REQUEST_ID_HEADER) };
}

const CAPTCHA_CODES = ["CAPTCHA_FAILED", "CAPTCHA_UNAVAILABLE", "CAPTCHA_CONFIGURATION_ERROR"] as const;
type CaptchaCode = (typeof CAPTCHA_CODES)[number];
function captchaCode(code: string | null): CaptchaCode | null {
  return (CAPTCHA_CODES as readonly string[]).includes(code ?? "") ? (code as CaptchaCode) : null;
}

/* ------------------------------------------------------ password reset -- */

export type ResetRequestFailure = CaptchaCode | "UNAVAILABLE" | "RATE_LIMITED" | "VALIDATION_ERROR" | "FAILED";
export type ResetRequestResult = { ok: true } | { ok: false; failure: ResetRequestFailure; requestId: string | null };

/** Ask for a reset link. A success says nothing about whether the address has an account. */
export async function requestPasswordReset(input: { email: string; captchaToken?: string }): Promise<ResetRequestResult> {
  const answer = await post("/auth/password-reset/request", {
    email: input.email,
    ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}),
  });
  if (!answer) return { ok: false, failure: "FAILED", requestId: null };
  if (answer.status === 200) return { ok: true };
  const captcha = captchaCode(answer.code);
  const failure: ResetRequestFailure = captcha
    ? captcha
    : answer.code === "RECOVERY_UNAVAILABLE"
      ? "UNAVAILABLE"
      : answer.status === 429
        ? "RATE_LIMITED"
        : answer.status === 400
          ? "VALIDATION_ERROR"
          : "FAILED";
  return { ok: false, failure, requestId: answer.requestId };
}

export type ResetConfirmFailure = "INVALID_TOKEN" | "VALIDATION_ERROR" | "RATE_LIMITED" | "FAILED";
export type ResetConfirmResult = { ok: true } | { ok: false; failure: ResetConfirmFailure };

/** Set a new password with a link's token. */
export async function confirmPasswordReset(input: { token: string; newPassword: string }): Promise<ResetConfirmResult> {
  const answer = await post("/auth/password-reset/confirm", input);
  if (!answer) return { ok: false, failure: "FAILED" };
  if (answer.status === 200) return { ok: true };
  if (answer.code === "INVALID_TOKEN") return { ok: false, failure: "INVALID_TOKEN" };
  if (answer.status === 429) return { ok: false, failure: "RATE_LIMITED" };
  if (answer.status === 400) return { ok: false, failure: "VALIDATION_ERROR" };
  return { ok: false, failure: "FAILED" };
}

/* -------------------------------------------- confirming an address ---- */

export type LinkConfirmFailure = "INVALID_TOKEN" | "EMAIL_IN_USE" | "RATE_LIMITED" | "FAILED";
export type LinkConfirmResult = { ok: true } | { ok: false; failure: LinkConfirmFailure };

async function confirmWithToken(path: string, token: string): Promise<LinkConfirmResult> {
  const answer = await post(path, { token });
  if (!answer) return { ok: false, failure: "FAILED" };
  if (answer.status === 200) return { ok: true };
  if (answer.code === "EMAIL_IN_USE") return { ok: false, failure: "EMAIL_IN_USE" };
  if (answer.status === 429) return { ok: false, failure: "RATE_LIMITED" };
  if (answer.status === 400) return { ok: false, failure: "INVALID_TOKEN" };
  return { ok: false, failure: "FAILED" };
}

/** Confirm the account's address with the token from the confirmation message. */
export function verifyEmail(token: string): Promise<LinkConfirmResult> {
  return confirmWithToken("/auth/verify-email", token);
}

/** Confirm the NEW address with the token from the change message. */
export function confirmEmailChange(token: string): Promise<LinkConfirmResult> {
  return confirmWithToken("/auth/email-change/confirm", token);
}

export type ResendResult =
  | { ok: true; alreadyVerified: boolean }
  | { ok: false; failure: "UNAVAILABLE" | "RATE_LIMITED" | "FAILED" };

/** Send the confirmation message again. Signed in. */
export async function resendVerification(): Promise<ResendResult> {
  const answer = await post("/auth/resend-verification", undefined, { csrf: true });
  if (!answer) return { ok: false, failure: "FAILED" };
  if (answer.status === 200) {
    const body = answer.body as { alreadyVerified?: unknown; sent?: unknown } | null;
    if (body?.alreadyVerified === true) return { ok: true, alreadyVerified: true };
    return body?.sent === true ? { ok: true, alreadyVerified: false } : { ok: false, failure: "FAILED" };
  }
  if (answer.code === "VERIFICATION_UNAVAILABLE") return { ok: false, failure: "UNAVAILABLE" };
  if (answer.status === 429) return { ok: false, failure: "RATE_LIMITED" };
  return { ok: false, failure: "FAILED" };
}

/* ------------------------------------------------ changing an address -- */

export type EmailChangeFailure =
  | "INVALID_PASSWORD"
  | "SAME_EMAIL"
  | "EMAIL_IN_USE"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "FAILED";
export type EmailChangeResult = { ok: true; pendingEmail: string } | { ok: false; failure: EmailChangeFailure };

/** Ask to change the address. Takes the current password; changes nothing until the new mailbox answers. */
export async function requestEmailChange(input: { newEmail: string; currentPassword: string }): Promise<EmailChangeResult> {
  const answer = await post("/profile/email-change", input, { csrf: true });
  if (!answer) return { ok: false, failure: "FAILED" };
  if (answer.status === 200) {
    const pending = (answer.body as { pendingEmail?: unknown } | null)?.pendingEmail;
    return typeof pending === "string" && pending.length > 0 ? { ok: true, pendingEmail: pending } : { ok: false, failure: "FAILED" };
  }
  switch (answer.code) {
    case "INVALID_PASSWORD":
    case "SAME_EMAIL":
    case "EMAIL_IN_USE":
      return { ok: false, failure: answer.code };
    case "MAIL_UNAVAILABLE":
      return { ok: false, failure: "UNAVAILABLE" };
  }
  if (answer.status === 429) return { ok: false, failure: "RATE_LIMITED" };
  if (answer.status === 400) return { ok: false, failure: "VALIDATION_ERROR" };
  return { ok: false, failure: "FAILED" };
}

/** Withdraw a pending change. */
export async function cancelEmailChange(): Promise<{ ok: boolean }> {
  const answer = await post("/profile/email-change/cancel", undefined, { csrf: true });
  return { ok: answer?.status === 200 };
}
