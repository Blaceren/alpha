"use client";

import { useSyncExternalStore } from "react";

/**
 * NEWS — a release on the reader's own clock.
 *
 * The server writes the release in UTC, which is true for every reader and for
 * search engines. After the page arrives, the browser adds what the reader's
 * clock shows — «у вас 14:30» — unless the reader is on UTC already. The first
 * render in the browser matches the server's exactly, so nothing jumps and
 * nothing mismatches during hydration.
 */
const subscribe = () => () => {};

function useInBrowser(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

const UTC_DAY = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const UTC_SHORT = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" });
const UTC_TIME = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function localWords(date: Date, withDay: boolean): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  if (zone === "UTC" || zone === "Etc/UTC") return null;
  if (!withDay) return time;
  const localDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  const utcDay = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" }).format(date);
  return localDay === utcDay ? time : `${localDay}, ${time}`;
}

export function LocalReleaseTime({ iso, variant }: { iso: string; variant: "full" | "short" }) {
  const inBrowser = useInBrowser();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  if (variant === "short") {
    const onLocalClock = inBrowser && localWords(date, false) !== null;
    const day = onLocalClock ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date) : UTC_SHORT.format(date);
    const time = onLocalClock ? localWords(date, false) : `${UTC_TIME.format(date)} UTC`;
    return (
      <time dateTime={iso} className="pn-time">
        {day}, {time}
      </time>
    );
  }

  const local = inBrowser ? localWords(date, true) : null;
  return (
    <>
      <time dateTime={iso} className="pn-time">
        {UTC_DAY.format(date).replace(/\s*г\.$/, "")}, {UTC_TIME.format(date)} UTC
      </time>
      {local ? <span className="pn-local"> · у вас {local}</span> : null}
    </>
  );
}
