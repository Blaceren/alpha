"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/api";

type NotificationItem = {
  id: number;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  metadata: unknown;
};

function getActionUrl(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).actionUrl;
  return typeof value === "string" && value.startsWith("/") ? value : null;
}

export function NotificationBell() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch("/api/notifications", { cache: "no-store" });
    if (!response.ok) return;
    const result = (await response.json()) as { items: NotificationItem[]; unreadCount: number };
    setItems(result.items);
    setUnreadCount(result.unreadCount);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  async function markRead(id: number) {
    const response = await csrfFetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    if (response.ok) await load();
  }

  async function markAllRead() {
    const response = await csrfFetch("/api/notifications/read-all", { method: "PATCH" });
    if (response.ok) await load();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="btn btn-secondary relative min-h-9 px-3 py-1.5 text-xs"
        aria-label={`Уведомления: ${unreadCount} непрочитанных`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 ? (
          <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-black text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-lg)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
            <strong className="text-sm text-[var(--text-primary)]">Уведомления</strong>
            <button type="button" className="text-xs font-bold text-[var(--primary)]" onClick={markAllRead} disabled={unreadCount === 0}>
              Прочитать все
            </button>
          </div>
          <div className="max-h-[26rem] space-y-2 overflow-y-auto py-2">
            {items.length === 0 ? <p className="p-3 text-sm text-[var(--text-muted)]">Новых уведомлений нет.</p> : null}
            {items.map((item) => {
              const actionUrl = getActionUrl(item.metadata);
              return (
                <article key={item.id} className={`rounded-xl border p-3 text-sm ${item.readAt ? "border-[var(--border)]" : "border-[var(--primary)] bg-[var(--primary-soft)]"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-[var(--text-primary)]">{item.title}</p>
                      <p className="mt-1 text-[var(--text-secondary)]">{item.message}</p>
                      <p className="mt-2 text-xs text-[var(--text-muted)]">{new Date(item.createdAt).toLocaleString("ru-RU")}</p>
                    </div>
                    {!item.readAt ? (
                      <button type="button" className="shrink-0 text-xs font-bold text-[var(--primary)]" onClick={() => markRead(item.id)}>
                        Прочитать
                      </button>
                    ) : null}
                  </div>
                  {actionUrl ? (
                    <Link href={actionUrl} onClick={() => { void markRead(item.id); setOpen(false); }} className="mt-2 inline-block text-xs font-bold text-[var(--primary)]">
                      Открыть →
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-[var(--border)] pt-3 text-center text-xs font-bold text-[var(--primary)]">
            История уведомлений
          </Link>
        </div>
      ) : null}
    </div>
  );
}
