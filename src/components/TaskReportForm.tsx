"use client";

import { useEffect, useState } from "react";
import { csrfFetch, uploadFile } from "@/lib/api";

type TaskReportStatus = "pending" | "approved" | "rejected";

type FileAssetSummary = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

type TaskReport = {
  id: number;
  status: TaskReportStatus;
  reportText: string | null;
  reportUrl: string | null;
  fileName: string | null;
  fileAssetId: number | null;
  fileAsset?: FileAssetSummary | null;
  reviewComment: string | null;
};

const statusLabels: Record<TaskReportStatus, string> = {
  pending: "ожидает проверки",
  approved: "одобрен",
  rejected: "отклонён",
};

const statusClasses: Record<TaskReportStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

export function TaskReportForm({
  taskId,
  reportStatus,
  onStatusChange,
}: {
  taskId: number;
  reportStatus: TaskReportStatus | null;
  onStatusChange: (taskId: number, status: TaskReportStatus | null) => void;
}) {
  const [reportText, setReportText] = useState("");
  const [reportUrl, setReportUrl] = useState("");
  const [fileAssetId, setFileAssetId] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [message, setMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    async function loadReport() {
      const response = await fetch(`/api/tasks/${taskId}/report`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = (await response.json()) as { report: TaskReport | null };
      if (!result.report) {
        onStatusChange(taskId, null);
        return;
      }
      setReportText(result.report.reportText ?? "");
      setReportUrl(result.report.reportUrl ?? "");
      setFileAssetId(result.report.fileAssetId ?? null);
      setFileName(
        result.report.fileAsset?.originalName ?? result.report.fileName ?? "",
      );
      setReviewComment(result.report.reviewComment ?? "");
      onStatusChange(taskId, result.report.status);
    }
    loadReport();
  }, [onStatusChange, taskId]);

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setIsUploading(true);
    setMessage("Загрузка файла...");
    const result = await uploadFile(file, "task_report");
    setIsUploading(false);

    if (result.isFallback || !result.data) {
      setMessage(result.error ?? "Не удалось загрузить файл");
      return;
    }

    setFileAssetId(result.data.file.id);
    setFileName(result.data.file.originalName);
    setMessage("Файл загружен");
  }

  async function submitReport() {
    const response = await csrfFetch(`/api/tasks/${taskId}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportText: reportText.trim() || undefined,
        reportUrl: reportUrl.trim() || undefined,
        fileAssetId: fileAssetId ?? undefined,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      report?: TaskReport;
      error?: string;
      message?: string;
    };
    if (!response.ok || !result.report) {
      setMessage(result.error ?? result.message ?? "Не удалось отправить отчёт");
      return;
    }
    onStatusChange(taskId, result.report.status);
    setMessage("Отчёт отправлен на проверку");
  }

  const canSubmit = reportStatus === null || reportStatus === "rejected";

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-[var(--text-primary)]">Отчёт по заданию</p>
        {reportStatus ? (
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClasses[reportStatus]}`}>
            {statusLabels[reportStatus]}
          </span>
        ) : (
          <span className="status-pill">отчёт не отправлен</span>
        )}
      </div>
      {reviewComment ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text-secondary)]">
          Комментарий наставника: {reviewComment}
        </div>
      ) : null}
      <textarea
        rows={3}
        maxLength={5000}
        value={reportText}
        onChange={(event) => setReportText(event.target.value)}
        disabled={!canSubmit}
        placeholder="Кратко опишите сделки и выводы"
        className="form-input min-h-24 disabled:opacity-60"
      />
      <input
        value={reportUrl}
        onChange={(event) => setReportUrl(event.target.value)}
        disabled={!canSubmit}
        placeholder="Ссылка на отчёт или таблицу"
        className="form-input disabled:opacity-60"
      />
      <label className="block text-sm font-semibold text-[var(--text-secondary)]">
        Файл отчёта
        <input
          type="file"
          disabled={!canSubmit || isUploading}
          onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
          className="mt-2 block w-full text-sm text-[var(--text-secondary)]"
        />
      </label>
      {fileName ? <p className="text-sm text-[var(--text-secondary)]">Загружен файл: {fileName}</p> : null}
      <button
        type="button"
        onClick={submitReport}
        disabled={!canSubmit || isUploading}
        className="btn btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        Отправить отчёт
      </button>
      {message ? <p className="text-sm text-[var(--text-secondary)]">{message}</p> : null}
    </div>
  );
}
