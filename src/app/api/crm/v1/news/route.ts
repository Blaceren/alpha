/**
 * NEWS — the CRM's list and «Новая новость».
 *
 *   GET  /api/crm/v1/news?status=all|draft|published&page=N
 *          → { items, total, page, pageCount, reference }
 *   POST /api/crm/v1/news  { item }  → 201 { item }, always a draft
 *
 * Gate: CRM session with `news_publish` (the copywriter, `crm_admin`) → for the
 * write, CSRF → per-staff write limit → input. Every write is audited.
 */
import { createAuditLog } from "@/lib/audit";
import { enforceNewsWriteLimit, readNewsBody, requireNewsStaff } from "@/lib/news/crm-http";
import { assertOnlyParams, newsData, newsErrorResponse, parsePage } from "@/lib/news/http";
import { NewsError, NEWS_STATUSES, parseNewsInput, toCrmNewsDto } from "@/lib/news/news";
import { createNews, listCrmNews, type CrmNewsFilter } from "@/lib/news/news-service";
import { newsReference } from "@/lib/news/reference";
import { publicAppOrigin } from "@/lib/publicUrl";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseFilter(params: URLSearchParams): CrmNewsFilter {
  const raw = params.get("status") ?? "all";
  if (raw !== "all" && !(NEWS_STATUSES as readonly string[]).includes(raw)) {
    throw new NewsError("NEWS_VALIDATION", "invalid_status");
  }
  return raw as CrmNewsFilter;
}

export async function GET(request: Request) {
  const gate = await requireNewsStaff(request, { mutation: false });
  if ("response" in gate) return gate.response;
  try {
    const params = new URL(request.url).searchParams;
    assertOnlyParams(params, ["status", "page"]);
    const list = await listCrmNews(parseFilter(params), parsePage(params));
    const origin = publicAppOrigin();
    return newsData({
      items: list.items.map((row) => toCrmNewsDto(row, origin)),
      total: list.total,
      page: list.page,
      pageCount: list.pageCount,
      reference: newsReference(),
    });
  } catch (error) {
    return newsErrorResponse(error, "GET /api/crm/v1/news");
  }
}

export async function POST(request: Request) {
  const gate = await requireNewsStaff(request, { mutation: true });
  if ("response" in gate) return gate.response;
  try {
    assertOnlyParams(new URL(request.url).searchParams, []);
    enforceNewsWriteLimit(gate.actorUserId);
    const body = await readNewsBody(request);
    const input = parseNewsInput(body.item);
    const created = await createNews(input, gate.actorUserId);
    await createAuditLog({
      userId: gate.actorUserId,
      action: "NEWS_ITEM_CREATED",
      entityType: "NewsItem",
      entityId: created.id,
      metadata: { slug: created.slug, country: created.country, importance: created.importance },
      request,
    });
    return newsData({ item: toCrmNewsDto(created, publicAppOrigin()) }, 201);
  } catch (error) {
    return newsErrorResponse(error, "POST /api/crm/v1/news");
  }
}
