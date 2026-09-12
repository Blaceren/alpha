import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  paginatedResponse,
  parseAdminListQuery,
  parseEnumFilter,
} from "@/lib/adminList";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { serializeExchangeAccount } from "@/lib/exchange/account";
import { prisma } from "@/lib/prisma";
import { validationErrorResponse, type ValidationDetail } from "@/lib/validation";
import { resolveFirstDepositConfirmations } from "@/lib/exchange/first-deposit-truth";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const parsed = parseAdminListQuery(
      request,
      ["id", "provider", "status", "balance", "depositAmount", "tradesCount", "updatedAt"],
      "id",
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const details: ValidationDetail[] = [];
    const status = parseEnumFilter(
      parsed.searchParams,
      "status",
      ["not_connected", "pending", "connected", "rejected", "blocked"],
      details,
    );
    const provider = parseEnumFilter(
      parsed.searchParams,
      "provider",
      ["sandbox", "manual", "real_placeholder"],
      details,
    );
    const userIdRaw = parsed.searchParams.get("userId");
    const userId = userIdRaw ? Number(userIdRaw) : null;

    if (userIdRaw && (!Number.isInteger(userId) || Number(userId) <= 0)) {
      details.push({ field: "userId", message: "userId must be a positive integer" });
    }

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const where: Prisma.ExchangeAccountWhereInput = {
      ...(status ? { status } : {}),
      ...(provider ? { provider } : {}),
      ...(userId ? { userId } : {}),
      ...(parsed.query.q
        ? {
            OR: [
              { exchangeAccountId: { contains: parsed.query.q } },
              { externalAccountId: { contains: parsed.query.q } },
              { user: { email: { contains: parsed.query.q } } },
              { user: { name: { contains: parsed.query.q } } },
            ],
          }
        : {}),
    };

    const [accounts, total] = await Promise.all([
      prisma.exchangeAccount.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { [parsed.query.sort ?? "id"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.exchangeAccount.count({ where }),
    ]);

    // FDCONF-1: one batched resolve for the whole page, so the correct answer
    // is also the cheap one and no future edit is tempted back to the column.
    const confirmations = await resolveFirstDepositConfirmations(
      prisma,
      accounts.map((account) => account.userId),
    );

    return NextResponse.json(
      paginatedResponse(
        accounts.map((account) =>
          serializeExchangeAccount(
            account,
            confirmations.get(account.userId) ?? {
              confirmed: false,
              source: "none" as const,
              occurredAt: null,
            },
          ),
        ),
        total,
        parsed.query.page,
        parsed.query.pageSize,
      ),
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
