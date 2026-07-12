"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupportChatMessage } from "@/data/mockSupportChat";
import { csrfFetch, uploadFile } from "@/lib/api";
import type { SupportDialog, SupportMessage } from "@/types/support";

type WidgetMessage = SupportChatMessage & {
  fileAsset?: {
    id: number;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
};

const roleLabels: Record<SupportChatMessage["role"], string> = {
  user: "Пользователь",
  admin: "Администратор",
  support: "Саппорт",
  mentor: "Ментор",
};

function toWidgetMessage(message: SupportMessage): WidgetMessage {
  return {
    id: message.id,
    sender: message.senderName,
    role: message.senderRole,
    message: message.message,
    fileAsset: message.fileAsset ?? null,
    time: new Date(message.createdAt).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

export function SupportChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnreadMessage, setHasUnreadMessage] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [fileAssetId, setFileAssetId] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch("/api/support/my-dialog", {
        cache: "no-store",
      });

      if (response.status >= 500) {
        throw new Error(`Support API returned ${response.status}`);
      }

      if (!response.ok) {
        setMessages([]);
        return;
      }

      const result = (await response.json()) as { dialog: SupportDialog | null };
      setMessages((result.dialog?.messages ?? []).map(toWidgetMessage));
    } catch {
      setMessages([]);
      setStatusMessage("Не удалось загрузить диалог поддержки");
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadMessages();
    }
  }, [isOpen, loadMessages]);

  function openWidget() {
    setIsOpen(true);
    setHasUnreadMessage(false);
  }

  async function handleFileChange(file: File | null) {
    if (!file) return;

    setStatusMessage("Загрузка файла...");
    const result = await uploadFile(file, "support_attachment");

    if (result.isFallback || !result.data) {
      setStatusMessage(result.error ?? "Не удалось загрузить файл");
      return;
    }

    setFileAssetId(result.data.file.id);
    setFileName(result.data.file.originalName);
    setStatusMessage("Файл загружен");
  }

  async function sendMessage() {
    const trimmedMessage = draft.trim();

    if (!trimmedMessage && !fileAssetId) {
      return;
    }

    try {
      const response = await csrfFetch("/api/support/my-dialog/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage || undefined,
          fileAssetId: fileAssetId ?? undefined,
        }),
      });

      if (response.status >= 500) {
        throw new Error(`Support API returned ${response.status}`);
      }

      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        setStatusMessage(result.message ?? result.error ?? "Не удалось отправить сообщение");
        return;
      }

      setDraft("");
      setFileAssetId(null);
      setFileName("");
      setStatusMessage("");
      await loadMessages();
    } catch {
      setStatusMessage("Не удалось отправить сообщение. Черновик сохранён в форме.");
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={openWidget}
        className="support-fab btn btn-primary fixed bottom-3 right-3 z-40 min-h-12 px-5 text-xs shadow-[var(--shadow-strong)] sm:bottom-4 sm:right-4 sm:text-sm"
      >
        Саппорт
        {hasUnreadMessage ? <span className="badge bg-white text-[var(--primary)]">1</span> : null}
      </button>
    );
  }

  return (
    <section className="support-widget fixed bottom-3 right-3 z-40 w-[calc(100%-1.5rem)] max-w-md rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-strong)] sm:bottom-4 sm:right-4 sm:w-[calc(100%-2rem)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="font-black text-[var(--text-primary)]">Чат с ментором</h2>
          <p className="mt-1 text-sm text-[var(--success)]">online - ответим в этом окне</p>
        </div>
        <button type="button" onClick={() => setIsOpen(false)} className="btn btn-secondary min-h-9 px-3 py-1.5 text-xs">
          Закрыть
        </button>
      </div>

      <div className="max-h-72 space-y-3 overflow-y-auto p-4 sm:max-h-80">
        {messages.map((message) => (
          <article
            key={message.id}
            className="chat-message rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span className="font-bold text-[var(--text-primary)]">{message.sender}</span>
              <span>{roleLabels[message.role]}</span>
              <span>{message.time}</span>
            </div>
            <p className="mt-2 break-words text-sm text-[var(--text-secondary)]">{message.message}</p>
            {message.fileAsset ? (
              <a href={`/api/files/${message.fileAsset.id}`} className="mt-2 block text-sm underline">
                Файл
              </a>
            ) : null}
          </article>
        ))}
      </div>

      <div className="border-t border-[var(--border)] p-4">
        <label className="flex flex-col gap-2 text-sm text-[var(--text-secondary)]">
          Сообщение
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            className="form-input"
            placeholder="Напишите вопрос ментору или саппорту"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={sendMessage} className="btn btn-primary">
            Отправить
          </button>
          <label className="btn btn-secondary cursor-pointer">
            Прикрепить файл
            <input
              type="file"
              className="hidden"
              onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        {fileName ? <p className="mt-2 text-xs text-[var(--text-secondary)]">Файл: {fileName}</p> : null}
        {statusMessage ? <p className="mt-2 text-xs text-[var(--text-secondary)]">{statusMessage}</p> : null}
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Личные сообщения между пользователями не реализованы. Пользователь общается только с командой платформы.
        </p>
      </div>
    </section>
  );
}
