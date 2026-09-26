"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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

const rewardTypes: RewardType[] = ["lesson", "consultation", "guide", "xp", "chat_access", "analytics_access", "other"];

async function getCsrfToken() {
  const response = await fetch("/api/csrf", { cache: "no-store" });
  const result = (await response.json()) as { csrfToken: string };

  return result.csrfToken;
}

export default function AdminRewardDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin"]}>
      <AdminRewardDetail />
    </ProtectedPage>
  );
}

function AdminRewardDetail() {
  const params = useParams<{ id: string }>();
  const [reward, setReward] = useState<AdminReward | null>(null);
  const [message, setMessage] = useState("Загрузка...");

  useEffect(() => {
    async function loadReward() {
      const response = await fetch(`/api/admin/rewards/${params.id}`, { cache: "no-store" });

      if (!response.ok) {
        setMessage("Награда не найдена");
        return;
      }

      const result = (await response.json()) as { reward: AdminReward };
      setReward(result.reward);
      setMessage("");
    }

    loadReward();
  }, [params.id]);

  async function saveReward() {
    if (!reward) {
      return;
    }

    const csrfToken = await getCsrfToken();
    const response = await fetch(`/api/admin/rewards/${reward.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        title: reward.title,
        description: reward.description,
        type: reward.type,
        status: reward.status,
      }),
    });

    setMessage(response.ok ? "Награда сохранена" : "Не удалось сохранить награду");
  }

  return (
    <section className="space-y-4">
      <Link className="text-sm font-medium text-slate-950 underline" href="/admin/rewards">
        Назад к списку
      </Link>
      <h1 className="text-2xl font-semibold text-slate-950">Награда</h1>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {reward ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
          <p className="text-sm text-slate-600">id: {reward.id}</p>
          <p className="text-sm text-slate-600">linked task: {reward.relatedTaskId ?? "-"}</p>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">title</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={reward.title} onChange={(event) => setReward({ ...reward, title: event.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">type</span>
            <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={reward.type} onChange={(event) => setReward({ ...reward, type: event.target.value as RewardType })}>
              {rewardTypes.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-slate-600">description</span>
            <textarea className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2" value={reward.description} onChange={(event) => setReward({ ...reward, description: event.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">status</span>
            <input className="w-full rounded-md border border-slate-300 px-3 py-2" value={reward.status} onChange={(event) => setReward({ ...reward, status: event.target.value })} />
          </label>
          <button className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm font-medium" type="button" onClick={saveReward}>
            Сохранить
          </button>
        </div>
      ) : null}
    </section>
  );
}
