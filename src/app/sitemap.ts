import type { MetadataRoute } from "next";
import { searchIndexing } from "@/config/search-indexing";
import { newsPath } from "@/features/public-news/public-news-model";
import { readNewsSitemap } from "@/server/news/public-news-read";

/**
 * sitemap.xml — the indexable pages and nothing else: the public home, the
 * news list and every published news page. Empty where indexing is off.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const indexing = searchIndexing();
  if (!indexing.enabled) return [];
  const items = await readNewsSitemap();
  return [
    { url: `${indexing.origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${indexing.origin}/news`, changeFrequency: "daily", priority: 0.8 },
    ...items.map((item) => ({
      url: `${indexing.origin}${newsPath(item.slug)}`,
      lastModified: item.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
