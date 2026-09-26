/**
 * NEWS — the public list, for the Academy's `/news` page.
 *
 *   GET /api/public/news?page=N
 *     → { upcoming (first page only, earliest first), past (newest first),
 *         page, pageCount }
 *
 * ANONYMOUS AND PUBLISHED-ONLY. It answers anyone, because every item it can
 * return is already a public page; a draft, a staff id or a staff name is never
 * in the answer. A page past the last answers 404.
 */
import { toNewsEventDto, type NewsRow } from "@/lib/news/news";
import { assertOnlyParams, newsData, newsErrorResponse, parsePage } from "@/lib/news/http";
import { readPublicNewsPage } from "@/lib/news/news-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function listItem(row: NewsRow) {
  return { ...toNewsEventDto(row), summary: row.summary };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    assertOnlyParams(params, ["page"]);
    const page = await readPublicNewsPage(parsePage(params));
    return newsData({
      upcoming: page.upcoming.map(listItem),
      past: page.past.map(listItem),
      page: page.page,
      pageCount: page.pageCount,
    });
  } catch (error) {
    return newsErrorResponse(error, "GET /api/public/news");
  }
}
