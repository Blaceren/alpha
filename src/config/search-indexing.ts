/**
 * SEARCH INDEXING — which pages search engines may index, and where.
 *
 * THE OWNER'S DECISION (2026-09-21). In production, search engines index the
 * news pages and the public home page — the Academy's story, with the way to
 * login and registration — and nothing else. On PREPROD nothing at all is
 * indexed: «на пред проде мы ничего не индексируем».
 *
 * WHY THIS IS AN ENVIRONMENT VARIABLE, when `feature-visibility.ts` refuses
 * one. That file decides what the PRODUCT is, and two deployments of one commit
 * must agree about it. Indexing is the opposite kind of fact: the same release
 * must be indexable on the production host and invisible on the pre-production
 * one, so the deployment is exactly what has to decide.
 *
 * OFF UNLESS BOTH ARE RIGHT. `ACADEMY_SEARCH_INDEXING=on` alone indexes nothing:
 * the canonical origin (`ACADEMY_PUBLIC_ORIGIN`, https, no path) must be valid
 * too, because an indexed page must name its one canonical address. Absent,
 * misspelled or half-configured means off — forgetting is the safe direction,
 * and PREPROD needs no setting at all.
 *
 * WHAT "OFF" MEANS. Every page answers with `X-Robots-Tag: noindex, nofollow`
 * (the middleware sets it on every response but an indexable page on an
 * indexing host), the two indexable pages also say `noindex` in their own
 * metadata, and there is no sitemap. robots.txt still lets crawlers in: a page
 * they may not fetch is a page whose `noindex` they never read, and an address
 * known from elsewhere would stay in the index.
 */

export type SearchIndexing =
  | { readonly enabled: true; readonly origin: string }
  | { readonly enabled: false; readonly origin: null };

type EnvSource = Readonly<Record<string, string | undefined>>;

const OFF: SearchIndexing = { enabled: false, origin: null };

/** An https origin with nothing after it, normalised, or null. */
export function parsePublicOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export function resolveSearchIndexing(env: EnvSource): SearchIndexing {
  if (env.ACADEMY_SEARCH_INDEXING?.trim() !== "on") return OFF;
  const origin = parsePublicOrigin(env.ACADEMY_PUBLIC_ORIGIN);
  return origin ? { enabled: true, origin } : OFF;
}

/** Read at request time, so one build serves both hosts. */
export function searchIndexing(): SearchIndexing {
  return resolveSearchIndexing(process.env as EnvSource);
}

/** The public home, the news list and a news page — the only indexable paths. */
export function isIndexablePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/news" || /^\/news\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname);
}

export const NOINDEX_HEADER_VALUE = "noindex, nofollow";

/** The robots metadata for an indexable page: index it only where indexing is on. */
export function indexableRobots(indexing: SearchIndexing) {
  return indexing.enabled ? { index: true, follow: true } : { index: false, follow: false };
}
