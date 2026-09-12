"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

type ReportStatus = "pending" | "approved" | "rejected";
type TaskReportItem = {
  id: number;
  status: ReportStatus;
  submittedAt: string;
  user: { id: number; name: string; email: string };
  task: { id: number; stepNumber: number; title: string };
};
type ListResponse = {
  items: TaskReportItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const emptyResponse: ListResponse = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };

export default function TaskReportsPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "mentor"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <TaskReportsContent />
      </Suspense>
    </ProtectedPage>
  );
}

function TaskReportsContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse>(emptyResponse);
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [message, setMessage] = useState("Загрузка...");

  useEffect(() => {
    setStatus(searchParams.get("status") ?? "");
    async function loadReports() {
      const query = searchParams.toString();
      const response = await fetch(`/api/admin/task-reports${query ? `?${query}` : ""}`, { cache: "no-store" });
      if (!response.ok) {
        setMessage("Не удалось загрузить отчёты");
        return;
      }
      setData((await response.json()) as ListResponse);
      setMessage("");
    }
    loadReports();
  }, [searchParams]);

  function applyFilter() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    if (status) next.set("status", status);
    else next.delete("status");
    router.push(`${pathname}?${next.toString()}`);
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Отчёты по заданиям</h1>
        <p className="text-sm text-slate-600">Проверка отчётов пользователей.</p>
      </div>
      <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">Все статусы</option>
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
        <button type="button" onClick={applyFilter} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">Применить</button>
        <button type="button" onClick={() => router.push(pathname)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">Сбросить</button>
      </div>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead><tr className="border-b border-slate-200"><th className="py-2 pr-3">user</th><th className="py-2 pr-3">task</th><th className="py-2 pr-3">submittedAt</th><th className="py-2 pr-3">status</th><th className="py-2 pr-3">Действие</th></tr></thead>
          <tbody>
            {data.items.map((report) => (
              <tr key={report.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{report.user.name}<div className="text-xs text-slate-500">{report.user.email}</div></td>
                <td className="py-2 pr-3">Шаг {report.task.stepNumber}: {report.task.title}</td>
                <td className="py-2 pr-3">{new Date(report.submittedAt).toLocaleString("ru-RU")}</td>
                <td className="py-2 pr-3">{report.status}</td>
                <td className="py-2 pr-3"><Link href={`/admin/task-reports/${report.id}`} className="font-medium text-slate-950 underline">Открыть</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 text-sm text-slate-600">
        <button type="button" disabled={data.page <= 1} onClick={() => goToPage(data.page - 1)} className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50">Назад</button>
        <span>Страница {data.page} из {data.totalPages}, всего {data.total}</span>
        <button type="button" disabled={data.page >= data.totalPages} onClick={() => goToPage(data.page + 1)} className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50">Вперед</button>
      </div>
    </section>
  );
}
