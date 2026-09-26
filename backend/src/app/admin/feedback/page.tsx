"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

type FeedbackItem = {
  id: number;
  type: string;
  severity: string;
  status: string;
  title: string;
  createdAt: string;
  role: string | null;
  user: { name: string; email: string } | null;
};

type ListResponse = {
  items: FeedbackItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const emptyResponse: ListResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

export default function AdminFeedbackPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "support"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <AdminFeedbackContent />
      </Suspense>
    </ProtectedPage>
  );
}

function AdminFeedbackContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse>(emptyResponse);
  const [type, setType] = useState(searchParams.get("type") ?? "");
  const [severity, setSeverity] = useState(searchParams.get("severity") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [message, setMessage] = useState("Загрузка...");

  useEffect(() => {
    setType(searchParams.get("type") ?? "");
    setSeverity(searchParams.get("severity") ?? "");
    setStatus(searchParams.get("status") ?? "");

    async function loadFeedback() {
      const next = new URLSearchParams(searchParams.toString());
      if (!next.has("order")) next.set("order", "desc");
      const response = await fetch(`/api/admin/feedback?${next.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        setMessage("Не удалось загрузить фидбек");
        return;
      }

      setData((await response.json()) as ListResponse);
      setMessage("");
    }

    loadFeedback();
  }, [searchParams]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    next.set("order", "desc");

    for (const [key, value] of [
      ["type", type],
      ["severity", severity],
      ["status", status],
    ]) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    router.push(`${pathname}?${next.toString()}`);
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    next.set("order", "desc");
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Проблемы пользователей</h1>
        <p className="text-sm text-slate-600">Полный текст, контекст, severity и рабочий статус обращения.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/feedback?unresolved=true&order=desc" className="btn btn-secondary">Нерешённые</Link>
        <Link href="/admin/feedback?unresolved=true&critical=true&order=desc" className="btn btn-secondary">Критичные нерешённые</Link>
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <select
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Все типы</option>
          {["bug", "ux", "question", "idea", "other"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Все severity</option>
          {["low", "medium", "high", "blocker"].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Все статусы</option>
          {["new", "triaged", "in_progress", "resolved", "rejected", "closed"].map(
            (value) => <option key={value} value={value}>{value}</option>,
          )}
        </select>
        <button
          type="button"
          onClick={applyFilters}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
        >
          Применить
        </button>
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          Сбросить
        </button>
      </div>

      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">user</th>
              <th className="py-2 pr-3">type</th>
              <th className="py-2 pr-3">severity</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">title</th>
              <th className="py-2 pr-3">createdAt</th>
              <th className="py-2 pr-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((feedback) => (
              <tr key={feedback.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  {feedback.user?.name ?? "-"}
                  <div className="text-xs text-slate-500">
                    {feedback.user?.email ?? "-"} · {feedback.role ?? "-"}
                  </div>
                </td>
                <td className="py-2 pr-3">{feedback.type}</td>
                <td className="py-2 pr-3">{feedback.severity}</td>
                <td className="py-2 pr-3">{feedback.status}</td>
                <td className="max-w-64 py-2 pr-3">{feedback.title}</td>
                <td className="py-2 pr-3">
                  {new Date(feedback.createdAt).toLocaleString("ru-RU")}
                </td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/admin/feedback/${feedback.id}`}
                    className="font-medium text-slate-950 underline"
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-sm text-slate-600">
        <button
          type="button"
          disabled={data.page <= 1}
          onClick={() => goToPage(data.page - 1)}
          className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50"
        >
          Назад
        </button>
        <span>Страница {data.page} из {data.totalPages}, всего {data.total}</span>
        <button
          type="button"
          disabled={data.page >= data.totalPages}
          onClick={() => goToPage(data.page + 1)}
          className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50"
        >
          Вперёд
        </button>
      </div>
    </section>
  );
}
