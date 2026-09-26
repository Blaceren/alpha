"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";

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
  mentorId: number | null;
  referralCode: string;
  referralSummary: { invited: number; invitedByUserId: number | null };
  updatedAt: string;
  betaSummary: {
    activeStep: { stepNumber: number; title: string } | null;
    completedTasks: number;
    totalTasks: number;
    reports: Record<string, number>;
    exchange: {
      status: string;
      registrationStatus: boolean;
      emailConfirmed: boolean;
      firstDepositConfirmed: boolean;
    } | null;
    feedback: { total: number; unresolved: number; critical: number };
    support: { id: number; status: string; assignedToId: number | null } | null;
    lastActivityAt: string;
  };
};

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { cache: "no-store" });
  const result = (await response.json()) as { csrfToken: string };

  return result.csrfToken;
}

export default function AdminUserDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <AdminUserDetail />
    </ProtectedPage>
  );
}

function AdminUserDetail() {
  const params = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [message, setMessage] = useState("Загрузка...");

  useEffect(() => {
    async function loadUser() {
      const response = await fetch(`/api/admin/users/${params.id}`, { cache: "no-store" });

      if (!response.ok) {
        setMessage("Пользователь не найден");
        return;
      }

      const result = (await response.json()) as { user: AdminUser };
      setUser(result.user);
      setMessage("");
    }

    loadUser();
  }, [params.id]);

  async function saveUser() {
    if (!user) {
      return;
    }

    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        role: user.role,
        status: user.status,
        level: user.level,
        xp: user.xp,
        mentorId: user.mentorId,
      }),
    });

    setMessage(response.ok ? "Пользователь сохранен" : "Не удалось сохранить пользователя");
  }

  return (
    <section className="space-y-4">
      <Link className="text-sm font-medium text-slate-950 underline" href="/admin/users">
        Назад к списку
      </Link>
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">Пользователь</h1>
        {user ? <p className="text-sm text-slate-600">{user.email}</p> : null}
      </div>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {user ? (
        <div className="space-y-4">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 lg:grid-cols-4">
          <p className="text-sm text-slate-600">Активный шаг: {user.betaSummary.activeStep ? `${user.betaSummary.activeStep.stepNumber}. ${user.betaSummary.activeStep.title}` : "-"}</p>
          <p className="text-sm text-slate-600">Задания: {user.betaSummary.completedTasks}/{user.betaSummary.totalTasks}</p>
          <p className="text-sm text-slate-600">Отчёты: {Object.entries(user.betaSummary.reports).map(([key, value]) => `${key}: ${value}`).join(", ") || "нет"}</p>
          <p className="text-sm text-slate-600">Exchange: {user.betaSummary.exchange?.status ?? "not_connected"}</p>
          <p className="text-sm text-slate-600">Feedback: {user.betaSummary.feedback.total}, unresolved: {user.betaSummary.feedback.unresolved}, critical: {user.betaSummary.feedback.critical}</p>
          <p className="text-sm text-slate-600">Support: {user.betaSummary.support?.status ?? "нет диалога"}</p>
          <p className="text-sm text-slate-600">Последняя активность: {new Date(user.betaSummary.lastActivityAt).toLocaleString("ru-RU")}</p>
          <p className="text-sm text-slate-600">Создан: {new Date(user.createdAt).toLocaleString("ru-RU")}</p>
        </div>
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">id</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" disabled value={user.id} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">name</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" disabled value={user.name} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">role</span>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={user.role} onChange={(event) => setUser({ ...user, role: event.target.value as AdminUser["role"] })}>
              <option value="user">user</option>
              <option value="admin">admin</option>
              <option value="support">support</option>
              <option value="mentor">mentor</option>
              <option value="moderator">moderator</option>
              <option value="news_editor">news_editor</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">status</span>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={user.status} onChange={(event) => setUser({ ...user, status: event.target.value as AdminUser["status"] })}>
              <option value="active">active</option>
              <option value="blocked">blocked</option>
            </select>
          </label>
          {user.role === "user" ? <label className="text-sm"><span className="mb-1 block text-slate-600">mentorId</span><input className="w-full rounded-md border border-slate-300 px-3 py-2" min="1" type="number" value={user.mentorId ?? ""} onChange={(event) => setUser({ ...user, mentorId: event.target.value ? Number(event.target.value) : null })} /></label> : null}
          <p className="text-sm text-slate-600">referralCode: {user.referralCode}</p>
          <p className="text-sm text-slate-600">referrals: {user.referralSummary.invited}, invited by: {user.referralSummary.invitedByUserId ?? "-"}</p>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">level</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" min="1" type="number" value={user.level} onChange={(event) => setUser({ ...user, level: Number(event.target.value) })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">xp</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" min="0" type="number" value={user.xp} onChange={(event) => setUser({ ...user, xp: Number(event.target.value) })} />
          </label>
          <p className="text-sm text-slate-600">progressStatus: {user.progressStatus}</p>
          <p className="text-sm text-slate-600">createdAt: {new Date(user.createdAt).toLocaleString("ru-RU")}</p>
          <button className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={saveUser}>
            Сохранить
          </button>
        </div>
        </div>
      ) : null}
    </section>
  );
}
