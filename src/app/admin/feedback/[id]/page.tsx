"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { csrfFetch } from "@/lib/api";

type Feedback = {
  id: number;
  role: string | null;
  type: string;
  severity: string;
  status: "new" | "triaged" | "in_progress" | "resolved" | "rejected" | "closed";
  pageUrl: string | null;
  title: string;
  message: string;
  browserInfo: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  adminComment: string | null;
  user: { name: string; email: string; role: string } | null;
  resolvedBy: { name: string; email: string } | null;
};

export default function AdminFeedbackDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "support"]}>
      <AdminFeedbackDetail />
    </ProtectedPage>
  );
}

function AdminFeedbackDetail() {
  const params = useParams<{ id: string }>();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [status, setStatus] = useState<Feedback["status"]>("new");
  const [adminComment, setAdminComment] = useState("");
  const [message, setMessage] = useState("Загрузка...");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [isSaving, setIsSaving] = useState(false);

  const loadFeedback = useCallback(async () => {
    const response = await fetch(`/api/admin/feedback/${params.id}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setMessage("Фидбек не найден");
      setMessageTone("error");
      return;
    }

    const result = (await response.json()) as { feedback: Feedback };
    setFeedback(result.feedback);
    setStatus(result.feedback.status);
    setAdminComment(result.feedback.adminComment ?? "");
    setMessage("");
    setMessageTone("info");
  }, [params.id]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  async function saveFeedback() {
    setIsSaving(true);
    setMessage("");
    setMessageTone("info");
    const response = await csrfFetch(`/api/admin/feedback/${params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        adminComment: adminComment.trim() || null,
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null) as { message?: string } | null;
      setMessage(result?.message ?? "Не удалось сохранить изменения");
      setMessageTone("error");
      setIsSaving(false);
      return;
    }

    await loadFeedback();
    setMessage("Изменения сохранены");
    setMessageTone("success");
    setIsSaving(false);
  }

  const messageClassName =
    messageTone === "success"
      ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
      : messageTone === "error"
        ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        : "text-sm text-slate-600";

  return (
    <section className="space-y-4">
      <Link
        href="/admin/feedback"
        className="text-sm font-medium text-slate-950 underline"
      >
        Назад к списку
      </Link>
      <h1 className="text-2xl font-semibold text-slate-950">Фидбек тестера</h1>
      {message ? <p className={messageClassName}>{message}</p> : null}

      {feedback ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <p>
            <span className="text-slate-600">Пользователь:</span>{" "}
            {feedback.user
              ? `${feedback.user.name} · ${feedback.user.email}`
              : "-"}
          </p>
          <p><span className="text-slate-600">Роль:</span> {feedback.role ?? feedback.user?.role ?? "-"}</p>
          <p><span className="text-slate-600">Тип:</span> {feedback.type}</p>
          <p><span className="text-slate-600">Severity:</span> {feedback.severity}</p>
          <p><span className="text-slate-600">Заголовок:</span> {feedback.title}</p>
          <div>
            <p className="text-slate-600">Сообщение:</p>
            <p className="mt-1 whitespace-pre-wrap">{feedback.message}</p>
          </div>
          <p>
            <span className="text-slate-600">Page URL:</span>{" "}
            {feedback.pageUrl ? (
              <a
                href={feedback.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all underline"
              >
                {feedback.pageUrl}
              </a>
            ) : "-"}
          </p>
          <div>
            <p className="text-slate-600">Browser info:</p>
            <p className="mt-1 break-all text-sm">{feedback.browserInfo ?? "-"}</p>
          </div>
          <p>
            <span className="text-slate-600">Создан:</span>{" "}
            {new Date(feedback.createdAt).toLocaleString("ru-RU")}
          </p>
          <p>
            <span className="text-slate-600">Закрыт:</span>{" "}
            {feedback.resolvedAt
              ? new Date(feedback.resolvedAt).toLocaleString("ru-RU")
              : "-"}
          </p>
          <p>
            <span className="text-slate-600">Закрыл:</span>{" "}
            {feedback.resolvedBy?.name ?? "-"}
          </p>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <p>
              <span className="text-slate-600">Текущий статус:</span>{" "}
              <span className="font-medium text-slate-950">{feedback.status}</span>
            </p>
            <div className="mt-2">
              <p className="text-slate-600">Сохранённый комментарий:</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-950">
                {feedback.adminComment?.trim() || "-"}
              </p>
            </div>
          </div>

          <label className="block text-sm text-slate-700">
            Статус
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as Feedback["status"])
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              {["new", "triaged", "in_progress", "resolved", "rejected", "closed"].map(
                (value) => <option key={value} value={value}>{value}</option>,
              )}
            </select>
          </label>

          <label className="block text-sm text-slate-700">
            Комментарий администратора
            <textarea
              rows={5}
              maxLength={5000}
              value={adminComment}
              onChange={(event) => setAdminComment(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>

          <button
            type="button"
            onClick={saveFeedback}
            disabled={isSaving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSaving ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
