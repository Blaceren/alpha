/**
 * NEWS — one item in the CRM.
 *
 *   GET   /api/crm/v1/news/<id>  → { item, reference }
 *   PATCH /api/crm/v1/news/<id>  { item, expectedUpdatedAt } → { item }
 *
 * The change is applied only if the item still carries the `updatedAt` the
 * editor loaded; otherwise 409 `NEWS_STALE` and nothing is written. A
 * published item stays published through an edit, with its address unchanged.
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
import { parseNewsInput, toCrmNewsDto } from "@/lib/news/news";
import { readCrmNews, updateNews } from "@/lib/news/news-service";
import { newsReference } from "@/lib/news/reference";
import { publicAppOrigin } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ newsId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const gate = await requireNewsStaff(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    assertOnlyParams(new URL(request.url).searchParams, []);
    const id = parseNewsId((await context.params).newsId);
    const item = await readCrmNews(id);
    return newsData({ item: toCrmNewsDto(item, publicAppOrigin()), reference: newsReference() });
  } catch (error) {
    return newsErrorResponse(error, "GET /api/crm/v1/news/[newsId]");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireNewsStaff(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertOnlyParams(new URL(request.url).searchParams, []);
    const id = parseNewsId((await context.params).newsId);
    enforceNewsWriteLimit(gate.actorUserId);
    const body = await readNewsBody(request);
    const input = parseNewsInput(body.item);
    const expectedUpdatedAt = parseExpectedUpdatedAt(body.expectedUpdatedAt);
    const updated = await updateNews(id, input, expectedUpdatedAt, gate.actorUserId);
    await createAuditLog({
      userId: gate.actorUserId,
      action: "NEWS_ITEM_UPDATED",
      entityType: "NewsItem",
      entityId: updated.id,
      metadata: { slug: updated.slug, status: updated.status },
      request,
    });
    return newsData({ item: toCrmNewsDto(updated, publicAppOrigin()) });
  } catch (error) {
    return newsErrorResponse(error, "PATCH /api/crm/v1/news/[newsId]");
  }
}
