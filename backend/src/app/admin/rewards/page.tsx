"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

type RewardType = "lesson" | "consultation" | "guide" | "xp" | "chat_access" | "analytics_access" | "other";

type AdminReward = {
  id: number;
  title: string;
  description: string;
  type: RewardType;
  status: string;
  relatedTaskId: number | null;
};

type ListResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const rewardTypes: RewardType[] = ["lesson", "consultation", "guide", "xp", "chat_access", "analytics_access", "other"];

const emptyResponse: ListResponse<AdminReward> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

export default function AdminRewardsPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <AdminRewardsContent />
      </Suspense>
    </ProtectedPage>
  );
}

function AdminRewardsContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse<AdminReward>>(emptyResponse);
  const [status, setStatus] = useState("Загрузка...");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [type, setType] = useState(searchParams.get("type") ?? "");

  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setType(searchParams.get("type") ?? "");
  }, [searchParams]);

  useEffect(() => {
    async function loadRewards() {
      setStatus("Загрузка...");
      const query = searchParams.toString();
      const response = await fetch(`/api/admin/rewards${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        setStatus("Не удалось загрузить награды");
        return;
      }

      setData((await response.json()) as ListResponse<AdminReward>);
      setStatus("");
    }

    loadRewards();
  }, [searchParams]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    setOrDelete(next, "q", q);
    setOrDelete(next, "type", type);
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
        <h1 className="text-2xl font-semibold text-slate-950">Награды</h1>
        <p className="text-sm text-slate-600">Поиск, фильтры и переход к редактированию.</p>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Поиск" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">Все типы</option>
          {rewardTypes.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={applyFilters}>Найти</button>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm" type="button" onClick={() => router.push(pathname)}>Сбросить фильтры</button>
        </div>
      </div>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">title</th>
              <th className="py-2 pr-3">description</th>
              <th className="py-2 pr-3">type</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">linked task</th>
              <th className="py-2 pr-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((reward) => (
              <tr key={reward.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">{reward.title}</td>
                <td className="py-2 pr-3">{reward.description}</td>
                <td className="py-2 pr-3">{reward.type}</td>
                <td className="py-2 pr-3">{reward.status}</td>
                <td className="py-2 pr-3">{reward.relatedTaskId ?? "-"}</td>
                <td className="py-2 pr-3">
                  <Link className="font-medium text-slate-950 underline" href={`/admin/rewards/${reward.id}`}>Открыть</Link>
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
