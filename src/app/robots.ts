import type { MetadataRoute } from "next";
import { searchIndexing } from "@/config/search-indexing";

/**
 * robots.txt, decided at request time so one build serves both hosts.
 *
 * Crawling is allowed on every host, PREPROD included: what keeps a page out
 * of the index is the `noindex` it carries (meta and `X-Robots-Tag`), and a
 * crawler that may not fetch a page never reads it. Only an indexing host names
 * a sitemap. `/api/` is never content.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const indexing = searchIndexing();
  if (!indexing.enabled) return { rules: { userAgent: "*", allow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${indexing.origin}/sitemap.xml`,
    host: indexing.origin,
  };
}
