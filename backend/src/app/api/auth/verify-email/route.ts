import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { verifyEmailToken } from "@/lib/emailVerification";
import { z } from "zod";
import { validateJsonBody } from "@/lib/validation";

const verifyEmailSchema = z.object({
  token: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const parsed = await validateJsonBody(request, verifyEmailSchema);
  if (!parsed.success) return parsed.response;

  const userId = await verifyEmailToken(parsed.data.token);

  if (!userId) {
    return NextResponse.json(
      { error: "INVALID_TOKEN", message: "Ссылка подтверждения недействительна" },
      { status: 400 },
    );
  }

  await createAuditLog({
    userId,
    action: "EMAIL_VERIFIED",
    request,
  });

  return NextResponse.json({ ok: true });
}
