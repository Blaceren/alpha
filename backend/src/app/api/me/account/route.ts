import { NextResponse } from "next/server";
import { accountCapabilities } from "@/lib/account/capabilities";
import { livePendingEmail } from "@/lib/account/lifecycle";
import { apiAuthErrorResponse, requireUser, unauthorizedResponse } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

/**
 * YOUR OWN ADDRESS, AND WHAT CAN BE DONE WITH IT.
 *
 * The Academy's profile reads this and nothing wider: the address, whether it
 * is confirmed, the address waiting to replace it, the day the account was made
 * (2026-10-03, the profile's «в Академии с …»), and whether this deployment
 * can send the messages those actions need. `GET /api/me` carries the same
 * three fields inside a much larger learner document; the profile's email row
 * has no use for the rest and should not have to receive it.
 *
 * An address is "waiting" only while its link can still be opened: a request
 * nobody confirmed in time is reported as no request at all.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const current = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: current.id },
      select: { email: true, emailVerifiedAt: true, pendingEmail: true, pendingEmailRequestedAt: true, createdAt: true },
    });
    if (!user) return unauthorizedResponse();
    return NextResponse.json(
      {
        account: {
          email: user.email,
          emailVerified: user.emailVerifiedAt !== null,
          pendingEmail: livePendingEmail(user),
          // The day the account was made: the profile's «в Академии с …».
          memberSince: user.createdAt.toISOString(),
        },
        capabilities: accountCapabilities(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
