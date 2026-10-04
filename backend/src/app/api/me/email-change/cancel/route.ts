import { NextResponse } from "next/server";
import { cancelEmailChange } from "@/lib/account/emailChange";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";

/**
 * WITHDRAW A PENDING EMAIL CHANGE.
 *
 * The pending address is forgotten and the link sent to it stops working. No
 * password is asked: this only ever moves the account back towards the address
 * it already has. Idempotent — withdrawing nothing is a success.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);
  try {
    const user = await requireUser();
    await cancelEmailChange(user.id, request);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
