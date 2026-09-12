"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ApiNotification,
} from "@/lib/api";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function notificationTypeLabel(type: ApiNotification["type"]) {
  const labels: Record<ApiNotification["type"], string> = {
    support_reply: "Ответ саппорта",
    task_report_approved: "Отчёт принят",
    task_report_rejected: "Отчёт отклонён",
    reward_granted: "Награда",
    level_up: "Новый уровень",
    checkpoint_frozen: "Контрольная точка",
    checkpoint_restored: "Прогресс восстановлен",
    postback_received: "Биржа",
    exchange_connected: "Биржа подключена",
    exchange_rejected: "Биржа отклонена",
    exchange_blocked: "Биржа заблокирована",
    system: "Система",
  };

  return labels[type] ?? type;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  const groupedItems = useMemo(
    () => ({
      unread: items.filter((item) => !item.readAt),
      read: items.filter((item) => item.readAt),
    }),
    [items],
  );

  useEffect(() => {
    let isMounted = true;

    getNotifications().then((result) => {
      if (!isMounted) return;

      setItems(result.data.items);
      setUnreadCount(result.data.unreadCount);
      setMessage(result.isFallback ? "Ошибка загрузки. Фиктивные уведомления не показываются." : "");
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleRead(notificationId: number) {
    const result = await markNotificationRead(notificationId);

    if (result.isFallback || !result.data) {
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.id === notificationId
            ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
            : item,
        ),
      );
      setUnreadCount((currentCount) => Math.max(currentCount - 1, 0));
      setMessage("API недоступен, статус изменён локально");
      return;
    }

    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === notificationId ? result.data.notification : item,
      ),
    );
    setUnreadCount(result.data.unreadCount);
  }

  async function handleReadAll() {
    const result = await markAllNotificationsRead();
    const readAt = new Date().toISOString();

    setItems((currentItems) =>
      currentItems.map((item) => ({
        ...item,
        readAt: item.readAt ?? readAt,
      })),
    );
    setUnreadCount(result.data?.unreadCount ?? 0);
    setMessage(result.isFallback ? "API недоступен, статусы изменены локально" : "");
  }

  function renderGroup(title: string, groupItems: ApiNotification[]) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{title}</h2>
          <StatusPill>{groupItems.length}</StatusPill>
        </div>
        {groupItems.length === 0 ? <EmptyState label="В этой группе пока пусто" /> : null}
        {groupItems.map((item) => (
          <article
            key={item.id}
            className={`app-card-flat p-4 ${item.readAt ? "opacity-75" : "ring-1 ring-[var(--primary)]"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-[var(--text-primary)]">{item.title}</h3>
                  <span className="badge">{notificationTypeLabel(item.type)}</span>
                  <StatusPill>{item.readAt ? "прочитано" : "новое"}</StatusPill>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDate(item.createdAt)}</p>
              </div>
              {!item.readAt ? (
                <button type="button" onClick={() => handleRead(item.id)} className="btn btn-secondary min-h-9 px-3 py-1.5 text-xs">
                  Отметить прочитанным
                </button>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-[var(--text-secondary)]">{item.message}</p>
          </article>
        ))}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Аккаунт"
        title="Уведомления"
        description="Внутренние уведомления платформы. Email, web-push и Telegram будут подключены позже через настройки уведомлений."
        action={
          <button
            type="button"
            onClick={handleReadAll}
            disabled={unreadCount === 0}
            className="btn btn-secondary disabled:opacity-50"
          >
            Отметить все прочитанными
          </button>
        }
      />

      <div className="app-card-flat flex flex-wrap items-center gap-3 p-4">
        <StatusPill>Непрочитано: {unreadCount}</StatusPill>
        {isLoading ? <span className="text-sm text-[var(--text-secondary)]">Загрузка...</span> : null}
        {message ? <span className="text-sm text-amber-700">{message}</span> : null}
      </div>

      {items.length === 0 && !isLoading ? <EmptyState label="Уведомлений пока нет" /> : null}
      {items.length > 0 ? renderGroup("Новые", groupedItems.unread) : null}
      {items.length > 0 ? renderGroup("Прочитанные", groupedItems.read) : null}
    </div>
  );
}
