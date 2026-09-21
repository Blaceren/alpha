import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsItemScreen } from "@/features/public-news/public-news-screens";
import { NEWS_SLUG_RE, newsArticleJsonLd, newsPath, releaseDayWords } from "@/features/public-news/public-news-model";
import { indexableRobots, searchIndexing } from "@/config/search-indexing";
import { getServerViewer } from "@/server/auth/server-session";
import { readPublicNewsItem } from "@/server/news/public-news-read";
import "@/features/public-home/public-home.css";
import "@/features/public-news/public-news.css";

/**
 * NEWS — one public news page, `/news/<slug>`.
 *
 * Each published item is its own page (owner, 2026-09-21), indexed by search
 * engines in production. A draft, an unpublished item and an unknown address
 * are the same 404. The address is checked for its shape before anything is
 * asked of the Backend.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/** One read per request, shared by the metadata and the page. */
const readItem = cache(async (slug: string) => (NEWS_SLUG_RE.test(slug) && slug.length <= 120 ? readPublicNewsItem(slug) : null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const read = await readItem(slug);
  if (!read || read.status !== "ok") return { robots: { index: false, follow: false } };
  const { item } = read.data;
  const indexing = searchIndexing();
  const title = `${item.title} — ${item.countryLabel}, ${releaseDayWords(item.releaseAt)} — Alfa Trade Academy`;
  const url = indexing.enabled ? `${indexing.origin}${newsPath(item.slug)}` : null;
  return {
    title,
    description: item.summary,
    robots: indexableRobots(indexing),
    ...(url
      ? {
          alternates: { canonical: url },
          openGraph: {
            type: "article",
            url,
            title: `${item.countryLabel}: ${item.title}`,
            description: item.summary,
            siteName: "Alfa Trade Academy",
            locale: "ru_RU",
            publishedTime: item.publishedAt,
            modifiedTime: item.updatedAt,
          },
        }
      : {}),
  };
}

export default async function NewsItemPage({ params }: Props) {
  const { slug } = await params;
  const read = await readItem(slug);
  if (!read || read.status === "not_found") notFound();
  if (read.status === "unavailable") throw new Error("news: the Backend could not be read");
  const viewer = await getServerViewer();
  const indexing = searchIndexing();
  const jsonLd = indexing.enabled
    ? newsArticleJsonLd(read.data.item, `${indexing.origin}${newsPath(read.data.item.slug)}`, indexing.origin)
    : null;
  return <NewsItemScreen answer={read.data} authenticated={viewer !== null} jsonLd={jsonLd} />;
}
