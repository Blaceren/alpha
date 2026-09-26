"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

type AdminNewsItem = {
  id: number;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  author: string;
  status: "draft" | "published";
  publishedAt: string;
  coverImageUrl: string | null;
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
};

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { cache: "no-store" });
  const result = (await response.json()) as { csrfToken: string };

  return result.csrfToken;
}

export default function AdminNewsDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "news_editor"]}>
      <AdminNewsDetail />
    </ProtectedPage>
  );
}

function AdminNewsDetail() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<AdminNewsItem | null>(null);
  const [message, setMessage] = useState("Загрузка...");

  useEffect(() => {
    async function loadNews() {
      const response = await fetch(`/api/admin/news/${params.id}`, { cache: "no-store" });

      if (!response.ok) {
        setMessage("Новость не найдена");
        return;
      }

      const result = (await response.json()) as { newsItem: AdminNewsItem };
      setItem(result.newsItem);
      setMessage("");
    }

    loadNews();
  }, [params.id]);

  async function saveNews() {
    if (!item) {
      return;
    }

    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/admin/news/${item.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        title: item.title,
        excerpt: item.excerpt,
        content: item.content,
        category: item.category,
        author: item.author,
        status: item.status,
        coverImageUrl: item.coverImageUrl,
        mediaUrl: item.mediaUrl,
        mediaType: item.mediaType,
      }),
    });

    setMessage(response.ok ? "Новость сохранена" : "Не удалось сохранить новость");
  }

  return (
    <section className="space-y-4">
      <Link className="text-sm font-medium text-slate-950 underline" href="/admin/news">
        Назад к списку
      </Link>
      <h1 className="text-2xl font-semibold text-slate-950">Новость</h1>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {item ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
          <p className="text-sm text-slate-600">id: {item.id}</p>
          <p className="text-sm text-slate-600">publishedAt: {new Date(item.publishedAt).toLocaleString("ru-RU")}</p>
          {(["title", "category", "author", "excerpt"] as const).map((field) => (
            <label key={field} className="text-sm">
              <span className="mb-1 block text-slate-600">{field}</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={item[field]} onChange={(event) => setItem({ ...item, [field]: event.target.value })} />
            </label>
          ))}
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">status</span>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={item.status} onChange={(event) => setItem({ ...item, status: event.target.value as AdminNewsItem["status"] })}>
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">content</span>
            <textarea className="min-h-32 w-full rounded-md border border-slate-300 px-3 py-2" value={item.content} onChange={(event) => setItem({ ...item, content: event.target.value })} />
          </label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">cover image URL</span><input className="form-input" value={item.coverImageUrl ?? ""} onChange={(event) => setItem({ ...item, coverImageUrl: event.target.value || null })} /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">media URL</span><input className="form-input" value={item.mediaUrl ?? ""} onChange={(event) => setItem({ ...item, mediaUrl: event.target.value || null })} /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">media type</span><select className="form-input" value={item.mediaType ?? ""} onChange={(event) => setItem({ ...item, mediaType: (event.target.value || null) as AdminNewsItem["mediaType"] })}><option value="">нет</option><option value="image">image</option><option value="video">video</option></select></label>
          <button className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={saveNews}>
            Сохранить
          </button>
        </div>
      ) : null}
    </section>
  );
}
