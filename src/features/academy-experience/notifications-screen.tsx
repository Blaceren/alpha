/**
 * NOTIFICATIONS — the real route, reading the Academy's existing notification
 * owner through the same-origin proxy.
 *
 * FOUR HONEST STATES. Loading, empty, populated, error. The empty state is a
 * real product state on a fresh account and is written as one — it does not
 * invent sample notifications to make the page look inhabited. Nothing here is
 * fabricated in PREPROD.
 *
 * WHAT NEVER APPEARS. Learner Operations internal notes are a physically
 * separate table the Backend route does not join, so staff-only text cannot
 * arrive here even if this component wanted it.
 */
"use client";

import { useEffect, useState } from "react";
import { EmptyState, ErrorState } from "@/features/academy-experience/primitives";

type Notification = {
  id: number | string;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  type?: string | null;
  readAt?: string | null;
  createdAt?: string | null;
  /** Where this event happened, when the payload names somewhere real. */
  link?: string | null;
  url?: string | null;
};

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; items: Notification[]; unread: number };

/**
 * Only same-origin, in-product paths are followed.
 *
 * A notification payload is data, not instruction: if it ever carried an
 * absolute URL it would be a way to point a learner off-product from a message
 * they did not write. Anything that is not a plain internal path is rendered as
 * text with no link at all.
 */
function safeHref(n: Notification): string | null {
  const raw = n.link ?? n.url ?? null;
  if (!raw || typeof raw !== "string") return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function whenText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function NotificationsScreen() {
  const [load, setLoad] = useState<Load>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/backend/notifications", {
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { items?: Notification[]; unreadCount?: number };
        if (!alive) return;
        setLoad({ phase: "ready", items: data.items ?? [], unread: data.unreadCount ?? 0 });
      } catch {
        if (alive) setLoad({ phase: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (load.phase === "loading") {
    return (
      <section aria-busy="true" aria-label="Уведомления загружаются">
        <h1 className="ax-mod__title">Уведомления</h1>
        <div className="ax-skel ax-skel--line" style={{ width: "40%" }} />
        <div className="ax-skel ax-skel--line" style={{ width: "70%" }} />
        <div className="ax-skel ax-skel--line" style={{ width: "55%" }} />
      </section>
    );
  }

  if (load.phase === "error") {
    return (
      <ErrorState
        title="Не удалось загрузить уведомления"
        message="Проверьте соединение и обновите страницу. Ваши уведомления не потеряны."
      />
    );
  }

  if (load.items.length === 0) {
    return (
      <EmptyState
        title="Пока нет уведомлений"
        message="Здесь появятся события вашего обучения: результаты проверок, подтверждения и ответы поддержки."
      />
    );
  }

  return (
    <section>
      <h1 className="ax-mod__title">Уведомления</h1>
      <p className="ax-coord">
        {load.unread > 0 ? <>Непрочитанных: <b>{load.unread}</b></> : <>Все уведомления прочитаны</>}
      </p>
      <ul className="ax-levels">
        {load.items.map((n) => {
          const href = safeHref(n);
          const text = n.body ?? n.message ?? "";
          const unread = !n.readAt;
          return (
            <li className="ax-lvl" key={String(n.id)} data-state={unread ? "available" : "completed"}>
              <span className="ax-lvl__n" aria-hidden="true">
                {unread ? "•" : ""}
              </span>
              <span>
                {href ? (
                  <a className="ax-lvl__t" href={href}>
                    {n.title ?? "Событие обучения"}
                  </a>
                ) : (
                  <span className="ax-lvl__t">{n.title ?? "Событие обучения"}</span>
                )}
                {text ? <p className="ax-lvl__why">{text}</p> : null}
              </span>
              <span className="ax-mark" data-state={unread ? "available" : "completed"}>
                {unread ? "Новое" : whenText(n.createdAt) || "Прочитано"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
