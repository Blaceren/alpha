import { NextResponse } from "next/server";
import { accountCapabilities } from "@/lib/account/capabilities";
import { apiAuthErrorResponse, requireUser, unauthorizedResponse } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

/**
 * YOUR OWN ADDRESS, AND WHAT CAN BE DONE WITH IT.
 *
 * The Academy's profile reads this and nothing wider: the address, whether it
 * is confirmed, the address waiting to replace it, and whether this deployment
 * can send the messages those actions need. `GET /api/me` carries the same
 * three fields inside a much larger learner document; the profile's email row
 * has no use for the rest and should not have to receive it.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const current = await requireUser();
    const user = await prisma.user.findUnique({
      where: { id: current.id },
      select: { email: true, emailVerifiedAt: true, pendingEmail: true },
    });
    if (!user) return unauthorizedResponse();
    return NextResponse.json(
      {
        account: {
          email: user.email,
          emailVerified: user.emailVerifiedAt !== null,
          pendingEmail: user.pendingEmail,
        },
        capabilities: accountCapabilities(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
