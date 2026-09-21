import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewsListScreen } from "@/features/public-news/public-news-screens";
import { NEWS_LIST_PATH, parseNewsPage } from "@/features/public-news/public-news-model";
import { indexableRobots, searchIndexing } from "@/config/search-indexing";
import { getServerViewer } from "@/server/auth/server-session";
import { readPublicNewsList } from "@/server/news/public-news-read";
import "@/features/public-home/public-home.css";
import "@/features/public-news/public-news.css";

/**
 * NEWS — the public list, `/news` and `/news?page=N`.
 *
 * Outside `(app)`, like Public Home: anyone may read it, and in production
 * search engines index it (see `config/search-indexing.ts`). The first page
 * holds what is coming and the latest releases; older pages hold the rest.
 */
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const DESCRIPTION =
  "Экономический календарь Alfa Trade Academy: выходы данных по валютам — время, прогноз, факт и что это значит для трейдера.";

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const indexing = searchIndexing();
  const page = parseNewsPage((await searchParams).page) ?? 1;
  const path = page === 1 ? NEWS_LIST_PATH : `${NEWS_LIST_PATH}?page=${page}`;
  const title = page === 1 ? "Новости рынка и экономический календарь — Alfa Trade Academy" : `Новости рынка — страница ${page} — Alfa Trade Academy`;
  return {
    title,
    description: DESCRIPTION,
    robots: indexableRobots(indexing),
    ...(indexing.enabled
      ? {
          alternates: { canonical: `${indexing.origin}${path}` },
          openGraph: {
            type: "website",
            url: `${indexing.origin}${path}`,
            title,
            description: DESCRIPTION,
            siteName: "Alfa Trade Academy",
            locale: "ru_RU",
          },
        }
      : {}),
  };
}

export default async function NewsListPage({ searchParams }: Props) {
  const page = parseNewsPage((await searchParams).page);
  if (page === null) notFound();
  const [viewer, read] = await Promise.all([getServerViewer(), readPublicNewsList(page)]);
  if (read.status === "not_found") notFound();
  // Temporary, not absent: a 5xx that search engines retry, never a page that says "no news".
  if (read.status === "unavailable") throw new Error("news: the Backend could not be read");
  return <NewsListScreen answer={read.data} authenticated={viewer !== null} />;
}
