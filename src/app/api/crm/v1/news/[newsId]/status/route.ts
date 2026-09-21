/**
 * NEWS — «Опубликовать» and «Снять с публикации».
 *
 *   POST /api/crm/v1/news/<id>/status  { status: "published" | "draft", expectedUpdatedAt }
 *          → { item, changed }
 *
 * Publishing makes the item a public page and a row in the learners' News
 * Calendar; unpublishing removes both, keeps the row and keeps the address.
 * Asking for the status the item already has changes nothing and says so.
 */
import { createAuditLog } from "@/lib/audit";
import {
  enforceNewsWriteLimit,
  parseExpectedUpdatedAt,
  parseNewsId,
  readNewsBody,
  requireNewsStaff,
} from "@/lib/news/crm-http";
import { assertOnlyParams, newsData, newsErrorResponse } from "@/lib/news/http";
import { NewsError, NEWS_STATUSES, toCrmNewsDto, type NewsStatus } from "@/lib/news/news";
import { setNewsStatus } from "@/lib/news/news-service";
import { publicAppOrigin } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ newsId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const gate = await requireNewsStaff(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertOnlyParams(new URL(request.url).searchParams, []);
    const id = parseNewsId((await context.params).newsId);
    enforceNewsWriteLimit(gate.actorUserId);
    const body = await readNewsBody(request);
    if (typeof body.status !== "string" || !(NEWS_STATUSES as readonly string[]).includes(body.status)) {
      throw new NewsError("NEWS_VALIDATION", "invalid_status");
    }
    const status = body.status as NewsStatus;
    const expectedUpdatedAt = parseExpectedUpdatedAt(body.expectedUpdatedAt);
    const { item, changed } = await setNewsStatus(id, status, expectedUpdatedAt, gate.actorUserId);
    if (changed) {
      await createAuditLog({
        userId: gate.actorUserId,
        action: status === "published" ? "NEWS_ITEM_PUBLISHED" : "NEWS_ITEM_UNPUBLISHED",
        entityType: "NewsItem",
        entityId: item.id,
        metadata: { slug: item.slug },
        request,
      });
    }
    return newsData({ item: toCrmNewsDto(item, publicAppOrigin()), changed });
  } catch (error) {
    return newsErrorResponse(error, "POST /api/crm/v1/news/[newsId]/status");
  }
}
