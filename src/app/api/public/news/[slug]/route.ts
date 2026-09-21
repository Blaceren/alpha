/**
 * NEWS — one public news page, for the Academy's `/news/<slug>`.
 *
 *   GET /api/public/news/<slug>  → { item, others }
 *
 * ANONYMOUS AND PUBLISHED-ONLY. A draft, an unpublished item and an unknown
 * address all answer the same 404, so the answer never tells a draft exists.
 */
import { NewsError, toNewsEventDto, toPublicNewsDto } from "@/lib/news/news";
import { assertOnlyParams, newsData, newsErrorResponse } from "@/lib/news/http";
import { readPublicNews } from "@/lib/news/news-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertOnlyParams(new URL(request.url).searchParams, []);
    const { slug } = await context.params;
    const found = await readPublicNews(slug);
    if (!found) throw new NewsError("NEWS_NOT_FOUND");
    return newsData({ item: toPublicNewsDto(found.item), others: found.others.map(toNewsEventDto) });
  } catch (error) {
    return newsErrorResponse(error, "GET /api/public/news/[slug]");
  }
}
