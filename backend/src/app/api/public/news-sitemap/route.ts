/**
 * NEWS — every published address, for the Academy's sitemap.
 *
 *   GET /api/public/news-sitemap  → { items: [{ slug, updatedAt }] }
 *
 * ANONYMOUS AND PUBLISHED-ONLY, like the rest of `/api/public/news`. Whether a
 * sitemap is served at all is the Academy's decision (search indexing is on in
 * production only), not this route's.
 */
import { assertOnlyParams, newsData, newsErrorResponse } from "@/lib/news/http";
import { readNewsSitemap } from "@/lib/news/news-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    assertOnlyParams(new URL(request.url).searchParams, []);
    const rows = await readNewsSitemap();
    return newsData({ items: rows.map((row) => ({ slug: row.slug, updatedAt: row.updatedAt.toISOString() })) });
  } catch (error) {
    return newsErrorResponse(error, "GET /api/public/news-sitemap");
  }
}
