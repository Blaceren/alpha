import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireAdmin } from "@/lib/apiAuth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const questions = await prisma.openQuestion.findMany({
      orderBy: { id: "asc" },
    });

    return NextResponse.json({ questions });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
