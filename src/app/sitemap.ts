import type { MetadataRoute } from "next";
import { searchIndexing } from "@/config/search-indexing";

/**
 * sitemap.xml — the indexable page and nothing else: the public home. Empty
 * where indexing is off. The news are product content since 2026-09-22
 * (DD-326) and are never listed.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const indexing = searchIndexing();
  if (!indexing.enabled) return [];
  return [{ url: `${indexing.origin}/`, changeFrequency: "weekly", priority: 1 }];
}
