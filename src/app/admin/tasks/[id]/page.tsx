"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { cache: "no-store" });
  const result = (await response.json()) as { csrfToken: string };

  return result.csrfToken;
}

export default function AdminTaskDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <AdminTaskDetail />
    </ProtectedPage>
  );
}

function AdminTaskDetail() {
  const params = useParams<{ id: string }>();
  const [task, setTask] = useState<AdminTask | null>(null);
  const [message, setMessage] = useState("Загрузка...");

  useEffect(() => {
    async function loadTask() {
      const response = await fetch(`/api/admin/tasks/${params.id}`, { cache: "no-store" });

      if (!response.ok) {
        setMessage("Задание не найдено");
        return;
      }

      const result = (await response.json()) as { task: AdminTask };
      setTask(result.task);
      setMessage("");
    }

    loadTask();
  }, [params.id]);

  async function saveTask() {
    if (!task) {
      return;
    }

    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/admin/tasks/${task.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        title: task.title,
        description: task.description,
        xpReward: task.xpReward,
        rewardType: task.rewardType,
        isCheckpoint: task.isCheckpoint,
      }),
    });

    setMessage(response.ok ? "Задание сохранено" : "Не удалось сохранить задание");
  }

  return (
    <section className="space-y-4">
      <Link className="text-sm font-medium text-slate-950 underline" href="/admin/tasks">
        Назад к списку
      </Link>
      <h1 className="text-2xl font-semibold text-slate-950">Задание</h1>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {task ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
          <p className="text-sm text-slate-600">id: {task.id}</p>
          <p className="text-sm text-slate-600">stepNumber: {task.stepNumber}</p>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">title</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={task.title} onChange={(event) => setTask({ ...task, title: event.target.value })} />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">description</span>
            <textarea className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2" value={task.description} onChange={(event) => setTask({ ...task, description: event.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">xpReward</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" min="0" type="number" value={task.xpReward} onChange={(event) => setTask({ ...task, xpReward: Number(event.target.value) })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">rewardType</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={task.rewardType} onChange={(event) => setTask({ ...task, rewardType: event.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={task.isCheckpoint} onChange={(event) => setTask({ ...task, isCheckpoint: event.target.checked })} />
            <span>isCheckpoint</span>
          </label>
          <button className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={saveTask}>
            Сохранить
          </button>
        </div>
      ) : null}
    </section>
  );
}
