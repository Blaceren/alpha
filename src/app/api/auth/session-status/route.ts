import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/**
 * The middleware's view of the session (H-7).
 *
 * The middleware used to verify the session itself, because the old token was a
 * self-contained HMAC that Edge could check with WebCrypto. The token is opaque
 * now — it means nothing without the database — so the check has to happen
 * somewhere with Prisma, and this route already was that place: the middleware
 * has always called it, on every private route, for the `blocked` decision.
 *
 * So it answers the whole question instead of a third of it. No extra round
 * trip, no new endpoint, and one authority for "who is this" rather than two
 * that must agree.
 *
 * IT RETURNS NO TOKEN AND NO SECRET — a boolean, a role and a blocked flag.
 */
export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ authenticated: false, blocked: false, role: null });
  }

  return NextResponse.json({
    authenticated: true,
    blocked: user.status === "blocked",
    role: user.role,
  });
}
