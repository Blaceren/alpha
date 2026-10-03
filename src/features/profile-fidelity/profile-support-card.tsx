"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listSupportCases, type SupportCaseSummary } from "@/lib/support/support-client";
import { CLOSED_STATUSES, statusText } from "@/lib/support/support-status";

/**
 * The profile's support card — beside the account rows on a wide screen.
 *
 * Support is a part of the profile now (owner, 2026-10-03), and the account
 * part says where it is: a line about what support is for, the learner's
 * latest requests with their state — so «Ждём вашего ответа» is seen without
 * opening anything — and the way in. The requests are the desk's own read
 * (`listSupportCases`); a failed read leaves only the way in, never an error
 * in the middle of someone's account page.
 */
export const SUPPORT_CARD_COPY = {
  title: "Поддержка",
  lead: "Вопрос по урокам, доступу или отчётам — напишите команде. Ответ придёт сюда и в уведомления.",
  none: "Обращений пока нет.",
  action: "Написать в поддержку",
} as const;

const LATEST = 2;

function day(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function ProfileSupportCard() {
  const [cases, setCases] = useState<SupportCaseSummary[] | "failed" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listSupportCases().then((result) => {
      if (!cancelled) setCases(result.ok ? result.data : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = Array.isArray(cases)
    ? [...cases].sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1)).slice(0, LATEST)
    : [];
  const open = Array.isArray(cases) ? cases.filter((row) => !CLOSED_STATUSES.has(row.status)).length : 0;

  return (
    <aside className="p-aside" aria-labelledby="p-aside-support" data-role="support-card">
      <h2 className="p-section__title" id="p-aside-support">
        {SUPPORT_CARD_COPY.title}
      </h2>
      <p className="p-aside__lead">{SUPPORT_CARD_COPY.lead}</p>
      {Array.isArray(cases) ? (
        latest.length === 0 ? (
          <p className="p-aside__quiet">{SUPPORT_CARD_COPY.none}</p>
        ) : (
          <ul className="p-aside__cases" aria-label={`Открытых обращений: ${open}`}>
            {latest.map((row) => (
              <li key={row.id} className="p-aside__case">
                <span className="p-aside__subject">{row.subject}</span>
                <span className="p-aside__meta">
                  {statusText(row.status)} · {day(row.lastActivityAt)}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
      <Link className="p-aside__action" href="/profile/support" data-role="support-card-link">
        {SUPPORT_CARD_COPY.action}
      </Link>
    </aside>
  );
}
