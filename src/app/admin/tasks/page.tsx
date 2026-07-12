"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

type AdminTask = {
  id: number;
  stepNumber: number;
  title: string;
  description: string;
  xpReward: number;
  rewardType: string;
  isCheckpoint: boolean;
};

type ListResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const emptyResponse: ListResponse<AdminTask> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

export default function AdminTasksPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <AdminTasksContent />
      </Suspense>
    </ProtectedPage>
  );
}

function AdminTasksContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse<AdminTask>>(emptyResponse);
  const [status, setStatus] = useState("Загрузка...");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [isCheckpoint, setIsCheckpoint] = useState(searchParams.get("isCheckpoint") ?? "");
  const [minXp, setMinXp] = useState(searchParams.get("minXp") ?? "");
  const [maxXp, setMaxXp] = useState(searchParams.get("maxXp") ?? "");

  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setIsCheckpoint(searchParams.get("isCheckpoint") ?? "");
    setMinXp(searchParams.get("minXp") ?? "");
    setMaxXp(searchParams.get("maxXp") ?? "");
  }, [searchParams]);

  useEffect(() => {
    async function loadTasks() {
      setStatus("Загрузка...");
      const query = searchParams.toString();
      const response = await fetch(`/api/admin/tasks${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        setStatus("Не удалось загрузить задания");
        return;
      }

      setData((await response.json()) as ListResponse<AdminTask>);
      setStatus("");
    }

    loadTasks();
  }, [searchParams]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    setOrDelete(next, "q", q);
    setOrDelete(next, "isCheckpoint", isCheckpoint);
    setOrDelete(next, "minXp", minXp);
    setOrDelete(next, "maxXp", maxXp);
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
        <h1 className="text-2xl font-semibold text-slate-950">Задания</h1>
        <p className="text-sm text-slate-600">Поиск, фильтры и переход к редактированию.</p>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-5">
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Поиск" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={isCheckpoint} onChange={(event) => setIsCheckpoint(event.target.value)}>
          <option value="">Все типы</option>
          <option value="true">checkpoint</option>
          <option value="false">regular</option>
        </select>
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" min="0" placeholder="minXp" type="number" value={minXp} onChange={(event) => setMinXp(event.target.value)} />
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" min="0" placeholder="maxXp" type="number" value={maxXp} onChange={(event) => setMaxXp(event.target.value)} />
        <div className="flex gap-2">
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={applyFilters}>Найти</button>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm" type="button" onClick={() => router.push(pathname)}>Сбросить фильтры</button>
        </div>
      </div>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">stepNumber</th>
              <th className="py-2 pr-3">title</th>
              <th className="py-2 pr-3">description</th>
              <th className="py-2 pr-3">xpReward</th>
              <th className="py-2 pr-3">rewardType</th>
              <th className="py-2 pr-3">isCheckpoint</th>
              <th className="py-2 pr-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((task) => (
              <tr key={task.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">{task.stepNumber}</td>
                <td className="py-2 pr-3">{task.title}</td>
                <td className="py-2 pr-3">{task.description}</td>
                <td className="py-2 pr-3">{task.xpReward}</td>
                <td className="py-2 pr-3">{task.rewardType}</td>
                <td className="py-2 pr-3">{String(task.isCheckpoint)}</td>
                <td className="py-2 pr-3">
                  <Link className="font-medium text-slate-950 underline" href={`/admin/tasks/${task.id}`}>Открыть</Link>
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
