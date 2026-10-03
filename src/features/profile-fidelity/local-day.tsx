"use client";

import { useSyncExternalStore } from "react";

/**
 * A day, on the learner's own calendar: «2 октября 2026».
 *
 * The server knows only UTC, so it prints the UTC day; once the page is live
 * the browser prints the day its own clock says. The two differ only for an
 * account made near midnight UTC, and then the browser's answer is the true
 * one for the person reading it. The first browser render matches the server's
 * exactly, so hydration never disagrees.
 */
const subscribe = () => () => {};

const UTC_DAY = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const LOCAL_DAY = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/** «2 октября 2026 г.» → «2 октября 2026». */
function bare(text: string): string {
  return text.replace(/\s*г\.$/, "");
}

export function LocalDay({ iso, className }: { iso: string; className?: string }) {
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time className={className} dateTime={iso}>
      {bare((inBrowser ? LOCAL_DAY : UTC_DAY).format(date))}
    </time>
  );
}
