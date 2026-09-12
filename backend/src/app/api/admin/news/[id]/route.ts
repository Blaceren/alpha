import { NextResponse } from "next/server";
import { apiAuthErrorResponse, requireNewsEditorAccess } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  adminNewsUpdateSchema,
  notFoundResponse,
  validateJsonBody,
  validateNumericParam,
} from "@/lib/validation";

type AdminNewsRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, { params }: AdminNewsRouteProps) {
  try {
    await requireNewsEditorAccess();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const newsId = validateNumericParam(id, "id");

  if (!newsId.success) {
    return newsId.response;
  }

  const newsItem = await prisma.newsPost.findUnique({
    where: { id: newsId.id },
  });

  if (!newsItem) {
    return notFoundResponse("Новость не найдена");
  }

  return NextResponse.json({ newsItem });
}

export async function PATCH(request: Request, { params }: AdminNewsRouteProps) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let adminUser;

  try {
    adminUser = await requireNewsEditorAccess();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const { id } = await params;
  const newsId = validateNumericParam(id, "id");

  if (!newsId.success) {
    return newsId.response;
  }

  const parsed = await validateJsonBody(request, adminNewsUpdateSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const existingNews = await prisma.newsPost.findUnique({
    where: { id: newsId.id },
  });

  if (!existingNews) {
    return notFoundResponse("Новость не найдена");
  }

  const newsItem = await prisma.newsPost.update({
    where: { id: newsId.id },
    data: {
      ...parsed.data,
      publishedAt: parsed.data.publishedAt
        ? new Date(parsed.data.publishedAt)
        : undefined,
    },
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_NEWS_UPDATED",
    entityType: "NewsPost",
    entityId: newsItem.id,
    metadata: {
      before: {
        title: existingNews.title,
        excerpt: existingNews.excerpt,
        content: existingNews.content,
        category: existingNews.category,
        author: existingNews.author,
        status: existingNews.status,
      },
      after: parsed.data,
    },
    request,
  });

  return NextResponse.json({ newsItem });
}
