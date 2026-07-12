"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { chatRoleLabels, type MockChatMessage } from "@/data/mockChat";
import { csrfFetch, sendChatMessage } from "@/lib/api";

type ChatRoomProps = {
  initialMessages: MockChatMessage[];
};

type ChatChannel = {
  id: number;
  title: string;
  description: string;
  requiredLevel: number | null;
  retentionDays: number;
  unlocked: boolean;
};

export function ChatRoom({ initialMessages }: ChatRoomProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [messageText, setMessageText] = useState("");
  const [error, setError] = useState("");
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [channelId, setChannelId] = useState<number | undefined>();
  const [currentRole, setCurrentRole] = useState<string>("user");

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result: { user?: { role?: string } } | null) => setCurrentRole(result?.user?.role ?? "user"))
      .catch(() => setCurrentRole("user"));
    fetch("/api/chat/channels", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { items?: ChatChannel[] }) => {
        const items = result.items ?? [];
        setChannels(items);
        setChannelId(items.find((item) => item.unlocked)?.id);
      })
      .catch(() => setChannels([]));
  }, []);

  async function selectChannel(channel: ChatChannel) {
    if (!channel.unlocked) return;
    setError("");
    const response = await fetch(`/api/chat?channelId=${channel.id}`, { cache: "no-store" });
    if (!response.ok) {
      setError("Канал пока недоступен.");
      return;
    }
    const result = (await response.json()) as { messages: Array<MockChatMessage & { createdAt?: string }> };
    setChannelId(channel.id);
    setMessages(result.messages.map((message) => ({
      ...message,
      time: message.time ?? (message.createdAt ? new Date(message.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : ""),
    })));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedMessage = messageText.trim();
    if (!trimmedMessage) return;

    const result = await sendChatMessage(trimmedMessage, channelId);

    if (result.isFallback || !result.data) {
      setError(result.error ?? "Не удалось отправить сообщение.");
      return;
    }

    setMessages((currentMessages) => [...currentMessages, result.data]);
    setMessageText("");
  }

  const canModerate = currentRole === "admin" || currentRole === "moderator";

  async function moderate(payload: Record<string, unknown>, removeMessageId?: number) {
    setError("");
    const response = await csrfFetch("/api/admin/chat-moderation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(result.message ?? result.error ?? "Действие модерации не выполнено");
      return;
    }
    if (removeMessageId) setMessages((current) => current.filter((item) => item.id !== removeMessageId));
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <aside className="app-card-flat p-4 lg:sticky lg:top-32 lg:self-start">
        <p className="text-sm font-black text-[var(--text-primary)]">Каналы</p>
        <div className="mt-4 space-y-2">
          {channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              disabled={!channel.unlocked}
              onClick={() => selectChannel(channel)}
              className={channel.id === channelId
                ? "w-full rounded-2xl border border-[color-mix(in_srgb,var(--primary)_28%,var(--border))] bg-[var(--primary-soft)] p-3 text-left text-sm font-bold text-[var(--primary)] shadow-[var(--shadow-sm)]"
                : "w-full rounded-2xl border border-[var(--border)] p-3 text-left text-sm text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-65"}
            >
              <span className="block">{channel.title}</span>
              <span className="mt-1 block text-xs font-normal">{channel.unlocked ? `retention ${channel.retentionDays} days` : `locked${channel.requiredLevel ? ` until level ${channel.requiredLevel}` : ""}`}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
          Ссылки и запрещённые слова проходят модерацию. Личные сообщения между пользователями не реализованы.
        </div>
        <Link href="/mentor-chat" className="mt-3 block rounded-2xl border border-[var(--border)] p-3 text-sm font-bold text-[var(--primary)]">
          Менторский чат
          <span className="mt-1 block text-xs font-normal text-[var(--text-muted)]">Приватный канал; откроется после первого checkpoint.</span>
        </Link>
      </aside>

      <section className="app-card p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-black text-[var(--text-primary)]">{channels.find((item) => item.id === channelId)?.title ?? "Канал"}</h2>
            <p className="text-sm text-[var(--text-muted)]">{channels.find((item) => item.id === channelId)?.description ?? "Сообщество участников"}</p>
          </div>
          <span className="status-pill">{messages.length} сообщений</span>
        </div>

        <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
          {messages.map((chatMessage) => (
            <article
              key={chatMessage.id}
            className="chat-message rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4 shadow-[var(--shadow-sm)]"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="font-black text-[var(--text-primary)]">{chatMessage.userName}</span>
                <span className="status-pill">Уровень {chatMessage.userLevel}</span>
                <span>{chatMessage.userRank}</span>
                <span>роль: {chatRoleLabels[chatMessage.role] ?? chatMessage.role}</span>
                {chatMessage.achievementTitle ? <span className="badge">{chatMessage.achievementTitle}</span> : null}
                {chatMessage.role === "mentor" && chatMessage.mentorBadge ? (
                  <span className="badge">{chatMessage.mentorBadge}</span>
                ) : null}
                <span>{chatMessage.time}</span>
              </div>
              <p className="mt-3 text-[var(--text-secondary)]">{chatMessage.message}</p>
              {canModerate ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3 text-xs">
                  <button type="button" className="font-bold text-[var(--primary)]" onClick={() => moderate({ action: "message.hide", messageId: chatMessage.id, reason: "Inline moderation" }, chatMessage.id)}>Скрыть</button>
                  <button type="button" className="font-bold text-red-700" onClick={() => moderate({ action: "message.delete", messageId: chatMessage.id, reason: "Inline moderation" }, chatMessage.id)}>Удалить</button>
                  {chatMessage.userId ? <button type="button" className="font-bold text-amber-700" onClick={() => moderate({ action: "mute.create", userId: chatMessage.userId, channelId: channelId ?? null, reason: "Inline moderation", durationMinutes: 60 })}>Mute 1 час</button> : null}
                  {chatMessage.userId ? <button type="button" className="font-bold text-emerald-700" onClick={() => moderate({ action: "mute.remove", userId: chatMessage.userId, channelId: channelId ?? null })}>Unmute</button> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <form onSubmit={sendMessage} className="mt-5 space-y-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]">
          <label className="block text-sm font-bold text-[var(--text-secondary)]">
            Новое сообщение
            <textarea
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
              rows={3}
              className="form-input mt-2"
              placeholder="Напишите сообщение в общий чат"
            />
          </label>
          {error ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">{error}</p> : null}
          <button type="submit" className="btn btn-primary">
            Отправить
          </button>
        </form>
      </section>
    </div>
  );
}
