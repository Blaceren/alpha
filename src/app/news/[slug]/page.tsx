import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NewsItemScreen } from "@/features/public-news/public-news-screens";
import { NEWS_SLUG_RE, newsPath, releaseDayWords } from "@/features/public-news/public-news-model";
import { SessionUnavailable } from "@/features/auth/session-unavailable";
import { readServerSession } from "@/server/auth/server-session";
import { readPublicNewsItem } from "@/server/news/public-news-read";
import "@/features/public-home/public-home.css";
import "@/features/public-news/public-news.css";

/**
 * NEWS — one public news page, `/news/<slug>`.
 *
 * Each published item is its own page (owner, 2026-09-21) — for signed-in
 * learners and never for search engines since 2026-09-22 (DD-326): the
 * middleware bounces anonymous visitors to /login, and this page checks the
 * session itself as well. A draft, an unpublished item and an unknown address
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
  return {
    title: `${item.title} — ${item.countryLabel}, ${releaseDayWords(item.releaseAt)} — Alpha Trade Academy`,
    description: item.summary,
    robots: { index: false, follow: false },
  };
}

export default async function NewsItemPage({ params }: Props) {
  const { slug } = await params;
  /* A Backend that cannot say who is here is not «signed out» (2026-10-07
     audit) — see /news. */
  const session = await readServerSession();
  if (session.kind === "unavailable") return <SessionUnavailable retryHref={newsPath(slug)} />;
  if (session.kind !== "viewer") redirect(`/login?next=${encodeURIComponent(newsPath(slug))}`);
  const read = await readItem(slug);
  if (!read || read.status === "not_found") notFound();
  if (read.status === "unavailable") throw new Error("news: the Backend could not be read");
  return <NewsItemScreen answer={read.data} authenticated />;
}
