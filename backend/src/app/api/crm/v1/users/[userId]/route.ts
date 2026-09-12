import { NextResponse } from "next/server";
import { CrmAuthError, crmRequestId, resolveCrmSession } from "@/lib/crm/session";
import { crmUserDetailResponseSchema } from "@/lib/crm/schemas";
import {
  assertNoQueryParams,
  CrmUserDetailInputError,
  CrmUserDetailNotFoundError,
  parseCrmUserId,
  resolveCrmUserDetail,
} from "@/lib/crm/user-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Next 15 async route params — no synchronous compatibility path.
type RouteContext = {
  params: Promise<{ userId: string }>;
};

// GET /api/crm/v1/users/[userId]
//
// Learner account detail FOUNDATION — not a complete User 360. Authorization
// reuses the accepted CRM session resolver (no second cookie or token path) and
// the email projection reuses the accepted Users v1 masking, so there is only
// ever one masking algorithm.
//
// Contract: docs/CRM_USER_DETAIL_V1.md
export async function GET(request: Request, context: RouteContext) {
  const requestId = crmRequestId();
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };

  try {
    // 401/403 resolved before the path parameter is even parsed.
    const session = await resolveCrmSession();

    assertNoQueryParams(new URL(request.url).searchParams);
    const { userId } = await context.params;
    const detail = await resolveCrmUserDetail(parseCrmUserId(userId), session.effectivePermissions);

    // Validate the exact shape before it leaves the process.
    return NextResponse.json(crmUserDetailResponseSchema.parse(detail), { headers });
  } catch (error) {
    if (error instanceof CrmAuthError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: error.status, headers },
      );
    }

    if (error instanceof CrmUserDetailInputError) {
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: 400, headers },
      );
    }

    if (error instanceof CrmUserDetailNotFoundError) {
      // One envelope for every miss: nonexistent id, staff account, system
      // account. The response must not tell a caller which it was.
      return NextResponse.json(
        { code: error.code, messageKey: error.messageKey, requestId },
        { status: 404, headers },
      );
    }

    // Prisma errors, Zod issues and anything else collapse to a safe envelope.
    // No SQL, stack, database path or internal role ever escapes.
    return NextResponse.json(
      { code: "internal", messageKey: "crm.users.detail.internal", requestId },
      { status: 500, headers },
    );
  }
}
