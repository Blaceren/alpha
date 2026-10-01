import { NextResponse } from "next/server";
import { accountCapabilities } from "@/lib/account/capabilities";

/**
 * WHAT THIS DEPLOYMENT CAN DO FOR AN ACCOUNT — public, and it names no account.
 *
 * The Academy reads it before it draws «Забыли пароль?» or the email actions in
 * the profile: a flow that ends in an email is offered only where an email can
 * be sent. Three booleans, no configuration detail.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    { capabilities: accountCapabilities() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
