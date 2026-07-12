import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notFoundResponse, validationErrorResponse } from "@/lib/validation";

type NewsDetailRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, { params }: NewsDetailRouteProps) {
  const { id } = await params;

  if (!id || id.trim().length === 0) {
    return validationErrorResponse([
      { field: "id", message: "ID новости обязателен" },
    ]);
  }

  const newsItem = await prisma.newsPost.findFirst({
    where: { slug: id, status: "published" },
  });

  if (!newsItem) {
    return notFoundResponse("Новость не найдена");
  }

  return NextResponse.json({ newsItem });
}
