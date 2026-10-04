import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NewsListScreen } from "@/features/public-news/public-news-screens";
import { NEWS_LIST_PATH, parseNewsPage } from "@/features/public-news/public-news-model";
import { getServerViewer } from "@/server/auth/server-session";
import { readPublicNewsList } from "@/server/news/public-news-read";
import "@/features/public-home/public-home.css";
import "@/features/public-news/public-news.css";

/**
 * NEWS — the public list, `/news` and `/news?page=N`.
 *
 * Outside `(app)` and in Public Home's visual system, but product content
 * since 2026-09-22 (DD-326): a signed-in learner reads it — the middleware
 * bounces anonymous visitors to /login, and this page checks the session
 * itself as well — and search engines never index it. The first page holds
 * what is coming and the latest releases; older pages hold the rest.
 */
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const DESCRIPTION =
  "Экономический календарь Alpha Trade Academy: выходы данных по валютам — время, прогноз, факт и что это значит для трейдера.";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parseNewsPage((await searchParams).page) ?? 1;
  return {
    title: page === 1 ? "Новости рынка и экономический календарь — Alpha Trade Academy" : `Новости рынка — страница ${page} — Alpha Trade Academy`,
    description: DESCRIPTION,
    robots: { index: false, follow: false },
  };
}

export default async function NewsListPage({ searchParams }: Props) {
  const page = parseNewsPage((await searchParams).page);
  if (page === null) notFound();
  const viewer = await getServerViewer();
  if (viewer === null) redirect(`/login?next=${encodeURIComponent(page === 1 ? NEWS_LIST_PATH : `${NEWS_LIST_PATH}?page=${page}`)}`);
  const read = await readPublicNewsList(page);
  if (read.status === "not_found") notFound();
  // Temporary, not absent: a 5xx that search engines retry, never a page that says "no news".
  if (read.status === "unavailable") throw new Error("news: the Backend could not be read");
  return <NewsListScreen answer={read.data} authenticated={viewer !== null} />;
}
