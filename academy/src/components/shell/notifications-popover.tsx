"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { clearAllNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api/client";
import {
  toRecord,
  type NotificationRecord,
  type NotificationRow,
  type NotificationTypeName,
} from "@/features/notifications-fidelity/notifications-state";
import "@/components/shell/notifications-popover.css";

/**
 * THE BELL'S WINDOW (DD-349, owner 2026-10-06: «уведомления открываются отдельным
 * экраном, сделай небольшое окно с уведомлениями которое открывается по нажатию»,
 * with another product's window as the example, «в наших цветах и языке», and its
 * two buttons — «как в примере, с «Очистить всё»»).
 *
 * The same register the notifications page reads, through the same rules: only
 * what is learner-facing (`toRecord` drops the broker's own events), the
 * product's own words, never an amount. Opening it changes nothing — reading is
 * the learner's: «Прочитать все», or opening one. «Очистить всё» asks once more
 * and then empties the learner's list; the Backend hides, it does not delete.
 */

type Load = { phase: "loading" } | { phase: "ready"; records: NotificationRecord[] } | { phase: "failed" };

/** A glyph per kind of event, from the product's icon set. */
const GLYPH: Partial<Record<NotificationTypeName, string>> = {
  support_reply: "support",
  mentor_reply: "mentor",
  level_up: "path",
  task_report_approved: "check",
  task_report_rejected: "lessons",
  reward_granted: "star",
  daily_reward: "star",
  referral_bonus: "star",
  promocode_redeemed: "star",
  achievement_granted: "sparkles",
  checkpoint_frozen: "shield",
  checkpoint_restored: "shield",
  community_reply: "community",
  community_moderation: "community",
  system: "bell",
};

export const POPOVER_COPY = {
  title: "Уведомления",
  all: "Все",
  empty: "Уведомлений нет",
  emptyLead: "Здесь появятся ответы поддержки и всё, что изменилось в вашей работе.",
  failed: "Не удалось загрузить уведомления.",
  retry: "Повторить",
  readAll: "Прочитать все",
  clearAll: "Очистить всё",
  confirm: "Очистить все уведомления?",
  confirmYes: "Очистить",
  confirmNo: "Отмена",
  readDone: "Все уведомления прочитаны",
  clearDone: "Уведомления очищены",
  readFailed: "Не получилось отметить прочитанными. Попробуйте ещё раз.",
  clearFailed: "Не получилось очистить. Попробуйте ещё раз.",
} as const;

async function requestList(): Promise<Load> {
  try {
    const res = await fetch("/api/backend/notifications", {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { items?: NotificationRow[] };
    const now = new Date();
    const records = (data.items ?? [])
      .map((row) => toRecord(row, now))
      .filter((record): record is NotificationRecord => record !== null);
    return { phase: "ready", records };
  } catch {
    return { phase: "failed" };
  }
}

export function NotificationsPopover({
  id,
  onClose,
  onQuiet,
}: {
  id: string;
  /** Close the window; `restoreFocus` returns the keyboard to the bell. */
  onClose: (restoreFocus: boolean) => void;
  /** The learner has nothing unread any more: the bell drops its mark. */
  onQuiet: () => void;
}) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [busy, setBusy] = useState<null | "read" | "clear">(null);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState<string>("");
  const titleRef = useRef<HTMLParagraphElement>(null);
  const router = useRouter();
  const titleId = `${id}-title`;

  useEffect(() => {
    let alive = true;
    void requestList().then((next) => {
      if (alive) setLoad(next);
    });
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      alive = false;
    };
  }, []);

  const records = load.phase === "ready" ? load.records : [];
  const unread = records.some((record) => record.consumption === "UNREAD");

  async function readAll() {
    setBusy("read");
    const result = await markAllNotificationsRead();
    setBusy(null);
    if (!result.ok) {
      setSaid(POPOVER_COPY.readFailed);
      return;
    }
    setLoad({ phase: "ready", records: records.map((record) => ({ ...record, consumption: "READ" })) });
    setSaid(POPOVER_COPY.readDone);
    onQuiet();
    router.refresh();
  }

  async function clearAll() {
    setBusy("clear");
    const result = await clearAllNotifications();
    setBusy(null);
    setConfirming(false);
    if (!result.ok) {
      setSaid(POPOVER_COPY.clearFailed);
      return;
    }
    setLoad({ phase: "ready", records: [] });
    setSaid(POPOVER_COPY.clearDone);
    onQuiet();
    router.refresh();
  }

  function retry() {
    setLoad({ phase: "loading" });
    void requestList().then(setLoad);
  }

  /* Opening one reads it; the window closes on the way to its page. */
  function opened(record: NotificationRecord) {
    if (record.consumption === "UNREAD") void markNotificationRead(record.id);
    onClose(false);
  }

  return (
    <div className="ntp" id={id} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className="ntp__head">
        <p className="ntp__title" id={titleId} ref={titleRef} tabIndex={-1}>
          {POPOVER_COPY.title}
        </p>
        <Link className="ntp__all" href="/notifications" onClick={() => onClose(false)}>
          {POPOVER_COPY.all}
          <span className="sr-only"> уведомления</span>
        </Link>
      </div>

      <div className="ntp__body">
        {load.phase === "loading" ? (
          <ul className="ntp__list" aria-busy="true" aria-label="Загрузка уведомлений">
            {[0, 1, 2].map((n) => (
              <li key={n} className="ntp__item ntp__item--ghost" aria-hidden="true">
                <span className="ntp__glyph" />
                <span className="ntp__ghostline" />
              </li>
            ))}
          </ul>
        ) : null}

        {load.phase === "failed" ? (
          <div className="ntp__state" role="alert">
            <p className="ntp__state-lead">{POPOVER_COPY.failed}</p>
            <button type="button" className="ntp__btn" onClick={retry}>
              {POPOVER_COPY.retry}
            </button>
          </div>
        ) : null}

        {load.phase === "ready" && records.length === 0 ? (
          <div className="ntp__state">
            <p className="ntp__state-lead">{POPOVER_COPY.empty}</p>
            <p className="ntp__state-text">{POPOVER_COPY.emptyLead}</p>
          </div>
        ) : null}

        {records.length > 0 ? (
          <ul className="ntp__list" aria-label="Последние уведомления">
            {records.map((record) => (
              <li
                key={record.id}
                className="ntp__item"
                data-unread={record.consumption === "UNREAD" ? "" : undefined}
              >
                <span className="ntp__glyph" aria-hidden="true">
                  <Icon name={GLYPH[record.type] ?? "bell"} className="h-4 w-4" />
                </span>
                <div className="ntp__content">
                  <p className="ntp__change">
                    {record.consumption === "UNREAD" ? <span className="sr-only">Новое: </span> : null}
                    {record.change}
                  </p>
                  {record.reason ? <p className="ntp__reason">{record.reason}</p> : null}
                  <p className="ntp__meta">
                    <time dateTime={record.timeMachine}>{record.time}</time>
                    {record.handoff ? (
                      <Link className="ntp__go" href={record.handoff.href} onClick={() => opened(record)}>
                        {record.handoff.label}
                      </Link>
                    ) : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="ntp__foot">
        {confirming ? (
          <>
            <p className="ntp__ask">{POPOVER_COPY.confirm}</p>
            <button type="button" className="ntp__btn" onClick={() => setConfirming(false)} disabled={busy !== null}>
              {POPOVER_COPY.confirmNo}
            </button>
            <button
              type="button"
              className="ntp__btn ntp__btn--danger"
              onClick={() => void clearAll()}
              disabled={busy !== null}
              autoFocus
            >
              {POPOVER_COPY.confirmYes}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="ntp__btn"
              onClick={() => void readAll()}
              disabled={busy !== null || !unread}
            >
              {POPOVER_COPY.readAll}
            </button>
            <button
              type="button"
              className="ntp__btn"
              onClick={() => setConfirming(true)}
              disabled={busy !== null || records.length === 0}
            >
              {POPOVER_COPY.clearAll}
            </button>
          </>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
    </div>
  );
}
