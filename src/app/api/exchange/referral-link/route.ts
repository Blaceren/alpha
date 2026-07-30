import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireUser } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { buildPocketReferralUrl } from "@/lib/exchange/pocket";
import { describePocketReferralUrlShape } from "@/lib/exchange/pocketAffiliateUrl";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) return csrfFailureResponse(request);

  try {
    const user = await requireUser();
    const existing = await prisma.exchangeAccount.findUnique({ where: { userId: user.id } });
    const clickId = existing?.clickId ?? `tq-${crypto.randomUUID()}`;
    const referralUrl = buildPocketReferralUrl(clickId);

    const account = await prisma.exchangeAccount.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        provider: "real_placeholder",
        referralLink: referralUrl.toString(),
        exchangeAccountId: `pocket-pending-${user.id}`,
        clickId,
        attribution: { click_id: clickId },
        status: "pending",
      },
      update: {
        clickId,
        referralLink: referralUrl.toString(),
        attribution: {
          ...((existing?.attribution as Record<string, string> | null) ?? {}),
          click_id: clickId,
        },
      },
    });

    await createAuditLog({
      userId: user.id,
      action: "POCKET_REFERRAL_OPENED",
      entityType: "ExchangeAccount",
      entityId: account.id,
      // STRUCTURE ONLY. The generated URL carries the learner's clickid, so it
      // is never written to an audit record; what is recorded is the shape that
      // proves the contract held — the operator's parameters survived, the
      // learner's tracking parameters were added, and the counts add up.
      metadata: {
        clickIdCreated: !existing?.clickId,
        referralUrlShape: describePocketReferralUrlShape(referralUrl),
      },
      request,
    });

    return NextResponse.json({ referralUrl: referralUrl.toString() });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
