"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { csrfFetch } from "@/lib/api";

type AdminUser = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin" | "support" | "mentor" | "moderator" | "news_editor";
  status: "active" | "blocked";
  level: number;
  xp: number;
  progressStatus: string;
  createdAt: string;
};

type ListResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const emptyResponse: ListResponse<AdminUser> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

export default function AdminUsersPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <Suspense fallback={<p className="text-sm text-slate-600">Загрузка...</p>}>
        <AdminUsersContent />
      </Suspense>
    </ProtectedPage>
  );
}

function AdminUsersContent() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ListResponse<AdminUser>>(emptyResponse);
  const [status, setStatus] = useState("Загрузка...");
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [role, setRole] = useState(searchParams.get("role") ?? "");
  const [userStatus, setUserStatus] = useState(searchParams.get("status") ?? "");
  const [serviceEmail, setServiceEmail] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [serviceRole, setServiceRole] = useState<AdminUser["role"]>("support");
  const [createStatus, setCreateStatus] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    setQ(searchParams.get("q") ?? "");
    setRole(searchParams.get("role") ?? "");
    setUserStatus(searchParams.get("status") ?? "");
  }, [reloadVersion, searchParams]);

  useEffect(() => {
    async function loadUsers() {
      setStatus("Загрузка...");
      const query = searchParams.toString();
      const response = await fetch(`/api/admin/users${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        setStatus("Не удалось загрузить пользователей");
        return;
      }

      const result = (await response.json()) as ListResponse<AdminUser>;
      setData(result);
      setStatus("");
    }

    loadUsers();
  }, [searchParams]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", "1");
    setOrDelete(next, "q", q);
    setOrDelete(next, "role", role);
    setOrDelete(next, "status", userStatus);
    router.push(`${pathname}?${next.toString()}`);
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams.toString());
    next.set("page", String(page));
    router.push(`${pathname}?${next.toString()}`);
  }

  async function createServiceAccount() {
    setCreateStatus("Создание...");
    const response = await csrfFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: serviceEmail, name: serviceName, role: serviceRole, password: "Service123" }),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      setCreateStatus(result.message ?? "Не удалось создать service account");
      return;
    }
    setServiceEmail("");
    setServiceName("");
    setCreateStatus("Service account создан. Временный пароль: Service123");
    setReloadVersion((current) => current + 1);
  }

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Пользователи</h1>
        <p className="text-sm text-slate-600">Поиск, фильтры и переход к редактированию.</p>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
        <input className="form-input" type="email" placeholder="service@example.com" value={serviceEmail} onChange={(event) => setServiceEmail(event.target.value)} />
        <input className="form-input" placeholder="Имя service account" value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
        <select className="form-input" value={serviceRole} onChange={(event) => setServiceRole(event.target.value as AdminUser["role"])}>
          <option value="support">support</option>
          <option value="mentor">mentor</option>
          <option value="moderator">moderator</option>
          <option value="news_editor">news_editor</option>
          <option value="admin">admin</option>
        </select>
        <button className="btn btn-primary" type="button" disabled={!serviceEmail || !serviceName} onClick={createServiceAccount}>Создать service account</button>
        {createStatus ? <p className="text-sm text-[var(--text-secondary)] md:col-span-4">{createStatus}</p> : null}
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-4">
        <input
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Поиск"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">Все роли</option>
          <option value="user">user</option>
          <option value="admin">admin</option>
          <option value="support">support</option>
          <option value="mentor">mentor</option>
          <option value="moderator">moderator</option>
          <option value="news_editor">news_editor</option>
        </select>
        <select
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={userStatus}
          onChange={(event) => setUserStatus(event.target.value)}
        >
          <option value="">Все статусы</option>
          <option value="active">active</option>
          <option value="blocked">blocked</option>
        </select>
        <div className="flex gap-2">
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={applyFilters}>
            Найти
          </button>
          <button className="rounded-md border border-slate-300 px-3 py-2 text-sm" type="button" onClick={() => router.push(pathname)}>
            Сбросить фильтры
          </button>
        </div>
      </div>

      {status ? <p className="text-sm text-slate-600">{status}</p> : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-3">id</th>
              <th className="py-2 pr-3">name</th>
              <th className="py-2 pr-3">email</th>
              <th className="py-2 pr-3">role</th>
              <th className="py-2 pr-3">status</th>
              <th className="py-2 pr-3">level</th>
              <th className="py-2 pr-3">xp</th>
              <th className="py-2 pr-3">progressStatus</th>
              <th className="py-2 pr-3">createdAt</th>
              <th className="py-2 pr-3">Действие</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((user) => (
              <tr key={user.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">{user.id}</td>
                <td className="py-2 pr-3">{user.name}</td>
                <td className="py-2 pr-3">{user.email}</td>
                <td className="py-2 pr-3">{user.role}</td>
                <td className="py-2 pr-3">{user.status}</td>
                <td className="py-2 pr-3">{user.level}</td>
                <td className="py-2 pr-3">{user.xp}</td>
                <td className="py-2 pr-3">{user.progressStatus}</td>
                <td className="py-2 pr-3">{new Date(user.createdAt).toLocaleString("ru-RU")}</td>
                <td className="py-2 pr-3">
                  <Link className="font-medium text-slate-950 underline" href={`/admin/users/${user.id}`}>
                    Открыть
                  </Link>
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
      <button className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50" type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
        Назад
      </button>
      <span>
        Страница {data.page} из {data.totalPages}, всего {data.total}
      </span>
      <button className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50" type="button" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}>
        Вперед
      </button>
    </div>
  );
}
