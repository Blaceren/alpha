"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  humanTime,
  toRecord,
  type NotificationRecord,
  type NotificationRow,
} from "@/features/notifications-fidelity/notifications-state";

/**
 * «Что нового» — the latest few changes in the learner's work.
 *
 * The rows are the learner's own notifications, read once on the server with
 * the bell's read; this part maps them through the register's own rules
 * (`toRecord`: the same visibility, the same suppression of a type with no
 * approved words, the same statement) and prints the newest three.
 *
 * THE TIME IS THE BROWSER'S. The server renders on UTC, and «Сегодня, 06:10»
 * three hours off is a wrong fact, not a rounding. Until the page is live in
 * the browser the time slot is empty and keeps its width, so nothing moves
 * when it fills.
 *
 * Read-only, like the register: nothing here marks anything read.
 */
const subscribe = () => () => {};

function useInBrowser(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

export const HOME_NEWS_COPY = {
  heading: "Что нового",
  empty: "Пока ничего нового. Здесь появятся ответы и изменения по вашей работе.",
  unavailable: "Не удалось загрузить уведомления — они есть на странице уведомлений.",
  all: "Все уведомления",
  unread: "не прочитано",
} as const;

/** How many lines the block shows. */
export const HOME_NEWS_LIMIT = 3;

export function homeNewsRecords(rows: readonly NotificationRow[], now: Date): NotificationRecord[] {
  const records: NotificationRecord[] = [];
  for (const row of rows) {
    const record = toRecord(row, now);
    if (record) records.push(record);
    if (records.length === HOME_NEWS_LIMIT) break;
  }
  return records;
}

export function HomeNews({ rows }: { rows: readonly NotificationRow[] | null }) {
  const inBrowser = useInBrowser();
  /* The records do not depend on the clock — only their printed time does —
     so the server and the browser agree on every line before the time fills. */
  const records = rows === null ? null : homeNewsRecords(rows, new Date(0));
  const now = inBrowser ? new Date() : null;

  return (
    <section className="hm-news" aria-labelledby="hm-news-title">
      <header className="hm-block__head">
        <h2 className="hm-block__title" id="hm-news-title">
          {HOME_NEWS_COPY.heading}
        </h2>
      </header>
      {records === null ? (
        <p className="hm-block__quiet">{HOME_NEWS_COPY.unavailable}</p>
      ) : records.length === 0 ? (
        <p className="hm-block__quiet">{HOME_NEWS_COPY.empty}</p>
      ) : (
        <ol className="hm-news__list">
          {records.map((record) => (
            <li key={record.id} className="hm-news__item" data-unread={record.consumption === "UNREAD" ? "1" : undefined}>
              <span className="hm-news__context">{record.context}</span>
              <span className="hm-news__change">
                {record.consumption === "UNREAD" ? <span className="hm-sr">{HOME_NEWS_COPY.unread}: </span> : null}
                {record.change}
              </span>
              <time className="hm-news__time" dateTime={record.timeMachine}>
                {now ? humanTime(new Date(record.timeMachine), now) : ""}
              </time>
            </li>
          ))}
        </ol>
      )}
      <Link className="hm-more" href="/notifications">
        {HOME_NEWS_COPY.all}
      </Link>
    </section>
  );
}
