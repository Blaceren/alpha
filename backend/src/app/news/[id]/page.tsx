"use client";

/* eslint-disable @next/next/no-img-element -- editor media URLs are intentionally runtime-configurable */

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiLoadState } from "@/components/ApiLoadState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { MockNewsItem } from "@/data/mockNews";
import { getNewsItem } from "@/lib/api";

export default function NewsDetailPage() {
  const params = useParams<{ id: string }>();
  const [newsItem, setNewsItem] = useState<MockNewsItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    getNewsItem(params.id).then((result) => {
      setNewsItem(result.data);
      setIsFallback(result.isFallback);
      setIsLoading(false);
    });
  }, [params.id]);

  return (
    <article className="space-y-6">
      <Breadcrumbs items={[{ href: "/", label: "Главная" }, { href: "/news", label: "Новости" }, { label: newsItem?.title ?? "Новость" }]} />

      <ApiLoadState isLoading={isLoading} isFallback={isFallback} />

      {!isLoading && !newsItem ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h1 className="text-2xl font-semibold text-slate-950">
            Новость не найдена
          </h1>
          <p className="mt-3 text-slate-700">
            Проверьте ссылку или вернитесь к списку новостей.
          </p>
        </section>
      ) : null}

      {newsItem ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="text-sm text-slate-500">
            {newsItem.date} · {newsItem.category} · {newsItem.author}
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-slate-950">
            {newsItem.title}
          </h1>
          {newsItem.coverImageUrl ? <img src={newsItem.coverImageUrl} alt="" className="mt-5 max-h-[30rem] w-full rounded-lg object-cover" /> : null}
          <p className="mt-5 whitespace-pre-wrap leading-7 text-slate-700">{newsItem.content}</p>
          {newsItem.mediaUrl && newsItem.mediaType === "image" ? <img src={newsItem.mediaUrl} alt="" className="mt-5 max-h-[30rem] w-full rounded-lg object-contain" /> : null}
          {newsItem.mediaUrl && newsItem.mediaType === "video" ? <video src={newsItem.mediaUrl} controls className="mt-5 w-full rounded-lg" /> : null}
        </section>
      ) : null}
    </article>
  );
}
