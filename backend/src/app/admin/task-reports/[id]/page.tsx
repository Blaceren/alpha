"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ProtectedPage } from "@/components/ProtectedPage";
import { csrfFetch } from "@/lib/api";

type TaskReport = {
  id: number;
  status: "pending" | "approved" | "rejected";
  reportText: string | null;
  reportUrl: string | null;
  fileName: string | null;
  fileAssetId: number | null;
  fileAsset: { id: number; originalName: string } | null;
  reviewComment: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  user: { name: string; email: string };
  task: { stepNumber: number; title: string };
  reviewer: { name: string; role: string } | null;
};

export default function TaskReportDetailPage() {
  return (
    <ProtectedPage allowedRoles={["admin", "mentor"]}>
      <TaskReportDetail />
    </ProtectedPage>
  );
}

function TaskReportDetail() {
  const params = useParams<{ id: string }>();
  const [report, setReport] = useState<TaskReport | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [message, setMessage] = useState("Загрузка...");

  const loadReport = useCallback(async () => {
    const response = await fetch(`/api/admin/task-reports/${params.id}`, { cache: "no-store" });
    if (!response.ok) {
      setMessage("Отчёт не найден");
      return;
    }
    const result = (await response.json()) as { report: TaskReport };
    setReport(result.report);
    setReviewComment(result.report.reviewComment ?? "");
    setMessage("");
  }, [params.id]);

  useEffect(() => { loadReport(); }, [loadReport]);

  async function review(status: "approved" | "rejected") {
    const response = await csrfFetch(`/api/admin/task-reports/${params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, reviewComment: reviewComment.trim() || undefined }),
    });
    if (!response.ok) {
      setMessage("Не удалось сохранить решение");
      return;
    }
    await loadReport();
    setMessage(status === "approved" ? "Отчёт одобрен" : "Отчёт отклонён");
  }

  return (
    <section className="space-y-4">
      <Link href="/admin/task-reports" className="text-sm font-medium text-slate-950 underline">Назад к списку</Link>
      <h1 className="text-2xl font-semibold text-slate-950">Отчёт по заданию</h1>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      {report ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <p><span className="text-slate-600">Пользователь:</span> {report.user.name} · {report.user.email}</p>
          <p><span className="text-slate-600">Задание:</span> шаг {report.task.stepNumber} · {report.task.title}</p>
          <p><span className="text-slate-600">Статус:</span> {report.status}</p>
          <p><span className="text-slate-600">Текст:</span> {report.reportText ?? "-"}</p>
          <p><span className="text-slate-600">Ссылка:</span> {report.reportUrl ? <a href={report.reportUrl} target="_blank" rel="noreferrer" className="underline">{report.reportUrl}</a> : "-"}</p>
          <p><span className="text-slate-600">Файл:</span> {report.fileAsset ? <a href={`/api/files/${report.fileAsset.id}`} className="underline">Скачать файл отчёта</a> : report.fileName ?? "-"}</p>
          <p><span className="text-slate-600">Отправлен:</span> {new Date(report.submittedAt).toLocaleString("ru-RU")}</p>
          <p><span className="text-slate-600">Проверил:</span> {report.reviewer ? `${report.reviewer.name} · ${report.reviewer.role}` : "-"}</p>
          <label className="block text-sm text-slate-700">Комментарий проверки<textarea rows={4} maxLength={2000} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => review("approved")} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">Одобрить</button>
            <button type="button" onClick={() => review("rejected")} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">Отклонить</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
