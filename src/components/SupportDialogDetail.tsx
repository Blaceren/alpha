"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/api";
import {
  supportDialogStatuses,
  supportStatusLabels,
  type SupportAssignee,
  type SupportDialog,
  type SupportDialogStatus,
} from "@/types/support";

export function SupportDialogDetail() {
  const params = useParams<{ id: string }>();
  const [dialog, setDialog] = useState<SupportDialog | null>(null);
  const [assignees, setAssignees] = useState<SupportAssignee[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<SupportDialogStatus>("new");
  const [assignedToId, setAssignedToId] = useState("");
  const [message, setMessage] = useState("Загрузка...");

  const loadDialog = useCallback(async () => {
    const response = await fetch(`/api/support/dialogs/${params.id}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      setMessage("Диалог не найден.");
      return;
    }

    const result = (await response.json()) as {
      dialog: SupportDialog;
      assignees: SupportAssignee[];
    };
    setDialog(result.dialog);
    setAssignees(result.assignees);
    setStatus(result.dialog.status);
    setAssignedToId(result.dialog.assignedToId?.toString() ?? "");
    setMessage("");
  }, [params.id]);

  useEffect(() => {
    loadDialog();
  }, [loadDialog]);

  async function sendMessage(internalNote: boolean) {
    const text = draft.trim();
    if (!text) return;

    const response = await csrfFetch(`/api/support/dialogs/${params.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, internalNote }),
    });
    setMessage(
      response.ok
        ? internalNote
          ? "Внутренняя заметка добавлена."
          : "Ответ отправлен."
        : "Не удалось отправить сообщение.",
    );
    if (response.ok) {
      setDraft("");
      await loadDialog();
    }
  }

  async function updateDialog(payload: {
    status?: SupportDialogStatus;
    assignedToId?: number | null;
  }) {
    const response = await csrfFetch(`/api/support/dialogs/${params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setMessage(response.ok ? "Диалог обновлён." : "Не удалось обновить диалог.");
    if (response.ok) await loadDialog();
  }

  return (
    <section className="space-y-5">
      <Link href="/support" className="text-sm font-medium text-slate-950 underline">
        Назад к списку
      </Link>
      <h1 className="text-2xl font-semibold text-slate-950">Диалог саппорта</h1>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}

      {dialog ? (
        <>
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
            <p className="text-sm text-slate-700">Пользователь: {dialog.userName}</p>
            <p className="text-sm text-slate-700">Текущий шаг: {dialog.currentStep}</p>
            <label className="text-sm text-slate-700">
              Статус
              <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={status} onChange={(event) => setStatus(event.target.value as SupportDialogStatus)}>
                {supportDialogStatuses.map((item) => <option key={item} value={item}>{supportStatusLabels[item]}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Менеджер / ментор
              <select className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)}>
                <option value="">Не назначен</option>
                {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name} · {assignee.role}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button type="button" onClick={() => updateDialog({ status })} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">Изменить статус</button>
              <button type="button" onClick={() => updateDialog({ assignedToId: assignedToId ? Number(assignedToId) : null })} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">Назначить</button>
              <button type="button" onClick={() => updateDialog({ status: "closed" })} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium">Закрыть диалог</button>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
            {(dialog.messages ?? []).map((item) => (
              <article key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="font-medium text-slate-900">{item.senderName}</span>
                  <span>{item.senderRole}</span>
                  {item.internalNote ? <span>внутренняя заметка</span> : null}
                  <span>{new Date(item.createdAt).toLocaleString("ru-RU")}</span>
                </div>
                <p className="mt-2 text-sm text-slate-800">{item.message}</p>
                {item.fileAsset ? (
                  <a
                    href={`/api/files/${item.fileAsset.id}`}
                    className="mt-2 block text-sm underline"
                  >
                    Файл
                  </a>
                ) : null}
              </article>
            ))}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <label className="flex flex-col gap-2 text-sm text-slate-700">
              Сообщение
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={2000} className="rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => sendMessage(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">Ответить</button>
              <button type="button" onClick={() => sendMessage(true)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium">Добавить внутреннюю заметку</button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
