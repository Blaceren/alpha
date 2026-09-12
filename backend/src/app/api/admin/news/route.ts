import type { NewsStatus, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  paginatedResponse,
  parseAdminListQuery,
  parseEnumFilter,
} from "@/lib/adminList";
import { apiAuthErrorResponse, requireNewsEditorAccess } from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import { prisma } from "@/lib/prisma";
import {
  adminNewsCreateSchema,
  validateJsonBody,
  validationErrorResponse,
  type ValidationDetail,
} from "@/lib/validation";

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `news-${Date.now()}`;
}

async function getUniqueSlug(title: string) {
  const baseSlug = slugify(title);
  let slug = baseSlug;
  let index = 2;

  while (await prisma.newsPost.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${index}`;
    index += 1;
  }

  return slug;
}

export async function GET(request: Request) {
  try {
    await requireNewsEditorAccess();
    const parsed = parseAdminListQuery(
      request,
      ["id", "title", "category", "author", "status", "publishedAt", "createdAt"],
      "publishedAt",
    );

    if (!parsed.success) {
      return parsed.response;
    }

    const details: ValidationDetail[] = [];
    const status = parseEnumFilter<NewsStatus>(
      parsed.searchParams,
      "status",
      ["draft", "published"],
      details,
    );
    const category = parsed.searchParams.get("category")?.trim();

    if (details.length > 0) {
      return validationErrorResponse(details);
    }

    const where: Prisma.NewsPostWhereInput = {
      ...(parsed.query.q
        ? {
            OR: [
              { title: { contains: parsed.query.q } },
              { excerpt: { contains: parsed.query.q } },
              { content: { contains: parsed.query.q } },
              { author: { contains: parsed.query.q } },
              { category: { contains: parsed.query.q } },
            ],
          }
        : {}),
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
    };
    const [news, total] = await Promise.all([
      prisma.newsPost.findMany({
        where,
        orderBy: { [parsed.query.sort ?? "publishedAt"]: parsed.query.order },
        skip: parsed.query.skip,
        take: parsed.query.pageSize,
      }),
      prisma.newsPost.count({ where }),
    ]);

    return NextResponse.json(
      paginatedResponse(news, total, parsed.query.page, parsed.query.pageSize),
    );
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  let adminUser;

  try {
    adminUser = await requireNewsEditorAccess();
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }

  const parsed = await validateJsonBody(request, adminNewsCreateSchema);

  if (!parsed.success) {
    return parsed.response;
  }

  const newsItem = await prisma.newsPost.create({
    data: {
      slug: await getUniqueSlug(parsed.data.title),
      title: parsed.data.title,
      excerpt: parsed.data.excerpt,
      content: parsed.data.content,
      category: parsed.data.category,
      author: parsed.data.author,
      coverImageUrl: parsed.data.coverImageUrl,
      mediaUrl: parsed.data.mediaUrl,
      mediaType: parsed.data.mediaType,
      status: parsed.data.status,
      publishedAt: parsed.data.publishedAt
        ? new Date(parsed.data.publishedAt)
        : new Date(),
    },
  });

  await createAuditLog({
    userId: adminUser.id,
    action: "ADMIN_NEWS_CREATED",
    entityType: "NewsPost",
    entityId: newsItem.id,
    metadata: {
      title: newsItem.title,
      slug: newsItem.slug,
    },
    request,
  });

  return NextResponse.json({ newsItem }, { status: 201 });
}
