import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmEmailChange } from "@/lib/account/emailChange";
import { rateLimitedResponse } from "@/lib/apiAuth";
import { getRequestIp, rateLimit } from "@/lib/rateLimit";
import { validateJsonBody } from "@/lib/validation";

/**
 * CONFIRM A NEW ADDRESS WITH A LINK'S TOKEN.
 *
 * No session is required: the link is opened from the new mailbox, which may be
 * on another device. The token is the proof, and it arrives in the body.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const confirmSchema = z.object({ token: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  if (!rateLimit(`auth:email-change-confirm:${ip}`, { limit: 10, windowMs: 15 * 60 * 1000 }).allowed) {
    return rateLimitedResponse();
  }

  const parsed = await validateJsonBody(request, confirmSchema);
  if (!parsed.success) return parsed.response;

  const result = await confirmEmailChange(parsed.data.token, request);
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.code === "EMAIL_IN_USE") {
    return NextResponse.json(
      { error: "EMAIL_IN_USE", message: "Этот адрес уже используется другим аккаунтом." },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: "INVALID_TOKEN", message: "Ссылка недействительна или устарела. Запросите смену почты заново." },
    { status: 400 },
  );
}
