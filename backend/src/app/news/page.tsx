"use client";

/* eslint-disable @next/next/no-img-element -- editor media URLs are intentionally runtime-configurable */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import type { MockNewsItem } from "@/data/mockNews";
import { getNews } from "@/lib/api";

export default function NewsPage() {
  const [news, setNews] = useState<MockNewsItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getNews().then((result) => {
      setNews(result.data);
      setIsFallback(result.isFallback);
      setIsLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-medium uppercase text-slate-500">Новости</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">Новости</h1>
        <p className="mt-3 max-w-3xl text-slate-700">
          Лента публикаций из мира трейдинга. На старте публикации создаются
          вручную через админку и публикуются из базы данных.
        </p>
      </section>

      <ApiLoadState isLoading={isLoading} isFallback={isFallback} />
      <div className="space-y-4">
        {news.map((newsItem) => (
          <article
            key={newsItem.id}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            {newsItem.coverImageUrl ? <img src={newsItem.coverImageUrl} alt="" className="mb-4 max-h-56 w-full rounded-lg object-cover" /> : null}
            <div className="text-sm text-slate-500">
              {newsItem.date} · {newsItem.category} · {newsItem.author}
            </div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              <Link href={`/news/${newsItem.id}`}>{newsItem.title}</Link>
            </h2>
            <p className="mt-2 text-slate-700">{newsItem.excerpt}</p>
            <Link
              href={`/news/${newsItem.id}`}
              className="mt-4 inline-flex rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900"
            >
              Читать полностью
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
