"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
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

type ListResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const emptyNews: Omit<AdminNewsItem, "id" | "publishedAt"> = {
  title: "",
  excerpt: "",
  content: "",
  category: "",
  author: "",
  status: "published",
  coverImageUrl: null,
  mediaUrl: null,
  mediaType: null,
};

const emptyResponse: ListResponse<AdminNewsItem> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { cache: "no-store" });
  const result = (await response.json()) as { csrfToken: string };

  return result.csrfToken;
}

export default function AdminNewsPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "news_editor"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <AdminNewsContent />
      </Suspense>
    </ProtectedPage>
  );
}

function AdminNewsContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse<AdminNewsItem>>(emptyResponse);
  const [draft, setDraft] = useState(emptyNews);
  const [message, setMessage] = useState("Загрузка...");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [category, setCategory] = useState(searchParams.get("category") ?? "");

  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setStatus(searchParams.get("status") ?? "");
    setCategory(searchParams.get("category") ?? "");
  }, [searchParams]);

  const loadNews = useCallback(async () => {
    setMessage("Загрузка...");
    const query = searchParams.toString();
    const response = await fetch(`/api/admin/news${query ? `?${query}` : ""}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setMessage("Не удалось загрузить новости");
      return;
    }

    setData((await response.json()) as ListResponse<AdminNewsItem>);
    setMessage("");
  }, [searchParams]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  async function createNews() {
    const csrfToken = await getCsrfToken();
    const response = await fetch("/api/admin/news", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(draft),
    });

    setMessage(response.ok ? "Новость создана" : "Не удалось создать новость");

    if (response.ok) {
      setDraft(emptyNews);
      await loadNews();
    }
  }

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    setOrDelete(next, "q", q);
    setOrDelete(next, "status", status);
    setOrDelete(next, "category", category);
    router.push(`${pathname}?${next.toString()}`);
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Новости</h1>
        <p className="text-sm text-slate-600">Создание, поиск и переход к редактированию.</p>
      </div>

      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-slate-950">Новая новость</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(["title", "category", "author", "excerpt"] as const).map((field) => (
            <label key={field} className="text-sm">
              <span className="mb-1 block text-slate-600">{field}</span>
              <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={draft[field]} onChange={(event) => setDraft((value) => ({ ...value, [field]: event.target.value }))} />
            </label>
          ))}
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">status</span>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value as AdminNewsItem["status"] }))}>
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">content</span>
            <textarea className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2" value={draft.content} onChange={(event) => setDraft((value) => ({ ...value, content: event.target.value }))} />
          </label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">cover image URL</span><input className="form-input" value={draft.coverImageUrl ?? ""} onChange={(event) => setDraft((value) => ({ ...value, coverImageUrl: event.target.value || null }))} /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">media URL</span><input className="form-input" value={draft.mediaUrl ?? ""} onChange={(event) => setDraft((value) => ({ ...value, mediaUrl: event.target.value || null }))} /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-600">media type</span><select className="form-input" value={draft.mediaType ?? ""} onChange={(event) => setDraft((value) => ({ ...value, mediaType: (event.target.value || null) as "image" | "video" | null }))}><option value="">нет</option><option value="image">image</option><option value="video">video</option></select></label>
        </div>
        <button className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={createNews}>
          Создать
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Поиск" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Все статусы</option>
          <option value="draft">draft</option>
          <option value="published">published</option>
        </select>
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="category" value={category} onChange={(event) => setCategory(event.target.value)} />
        <div className="flex gap-2">
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={applyFilters}>Найти</button>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm" type="button" onClick={() => router.push(pathname)}>Сбросить фильтры</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">title</th>
              <th className="py-2 pr-3">category</th>
              <th className="py-2 pr-3">author</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">publishedAt</th>
              <th className="py-2 pr-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">{item.title}</td>
                <td className="py-2 pr-3">{item.category}</td>
                <td className="py-2 pr-3">{item.author}</td>
                <td className="py-2 pr-3">{item.status}</td>
                <td className="py-2 pr-3">{new Date(item.publishedAt).toLocaleString("ru-RU")}</td>
                <td className="py-2 pr-3">
                  <Link className="font-medium text-slate-950 underline" href={`/admin/news/${item.id}`}>Открыть</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination data={data} onPage={goToPage} />
    </section>
  );
}

function setOrDelete(params: URLSearchParams, key: string, value: string) {
  if (value.trim()) {
    params.set(key, value.trim());
  } else {
    params.delete(key);
  }
}

function Pagination<T>({ data, onPage }: { data: ListResponse<T>; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600">
      <button className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50" type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>Назад</button>
      <span>Страница {data.page} из {data.totalPages}, всего {data.total}</span>
      <button className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50" type="button" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}>Вперед</button>
    </div>
  );
}
