"use client";

/**
 * Personal Stats (L25) — the working tool.
 *
 * WHAT THE JOURNAL SAYS, SPLIT BY PLAN. Over 7 days, 30 days or all time: the
 * trades, their win rate, break-even at the average payout, the share on plan,
 * the win rate on plan against a broken plan, and the rules broken. Fewer than
 * fifty trades is called a preliminary sample.
 *
 * READ-ONLY. Every figure is the Backend's, computed from the learner's own
 * journal entries; there is nothing to fill in here, and the way to better
 * figures is the journal itself. Counts and shares only, never money.
 *
 * THE LEARNER'S OWN DAYS. All time needs no date, so the server draws it first;
 * 7 and 30 days are read from the browser with the learner's own today.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { NormalizedError } from "@/lib/api/errors";
import { localDate } from "../model/local-date";
import { fetchStats } from "./stats-client";
import { windowWords, type JournalStats, type StatsPeriod } from "./stats-model";
import { StatsFigures, StatsPeriodBar, StatsSample, StatsSplit, StatsViolations } from "./stats-parts";

type Phase =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "locked" }
  | { kind: "ready"; stats: JournalStats };

function messageFor(error: NormalizedError): string {
  switch (error.category) {
    case "NETWORK_ERROR":
    case "BACKEND_UNAVAILABLE":
      return "Нет связи с ATA. Проверьте интернет и попробуйте ещё раз.";
    case "RATE_LIMITED":
      return "Слишком много действий подряд. Подождите минуту и попробуйте снова.";
    case "UNAUTHENTICATED":
      return "Сессия закончилась. Войдите снова.";
    default:
      return "Не получилось. Попробуйте ещё раз.";
  }
}

/**
 * `initialStats` is the server's read of all time. With it, the tool arrives
 * already drawn; without it (the read failed, or fixture mode), the tool reads
 * from the browser.
 */
export function StatsWorkspace({ initialStats = null }: { initialStats?: JournalStats | null }) {
  const [phase, setPhase] = useState<Phase>(() =>
    initialStats ? { kind: "ready", stats: initialStats } : { kind: "loading" },
  );
  const [period, setPeriod] = useState<StatsPeriod>(initialStats?.period ?? "all");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  /** Only the newest read may land; an older one finishing later is dropped. */
  const request = useRef(0);

  const read = useCallback(async (next: StatsPeriod, initial: boolean) => {
    const mine = ++request.current;
    setPeriod(next);
    if (initial) setPhase({ kind: "loading" });
    else setSwitching(true);
    setSwitchError(null);
    const response = await fetchStats(next, next === "all" ? null : localDate(new Date()));
    if (mine !== request.current) return;
    setSwitching(false);
    if (!response.ok) {
      if (response.error.code === "TOOL_LOCKED") setPhase({ kind: "locked" });
      else if (initial) setPhase({ kind: "failed", message: messageFor(response.error) });
      else setSwitchError(messageFor(response.error));
      return;
    }
    setPhase({ kind: "ready", stats: response.data });
  }, []);

  /* The first read, when the server could not make it. */
  const serverRead = initialStats !== null;
  useEffect(() => {
    if (serverRead) return;
    let cancelled = false;
    const mine = ++request.current;
    void fetchStats("all", null).then((response) => {
      if (cancelled || mine !== request.current) return;
      if (!response.ok) {
        setPhase(
          response.error.code === "TOOL_LOCKED" ? { kind: "locked" } : { kind: "failed", message: messageFor(response.error) },
        );
        return;
      }
      setPhase({ kind: "ready", stats: response.data });
    });
    return () => {
      cancelled = true;
    };
  }, [serverRead]);

  if (phase.kind === "loading") {
    return (
      <div className="tw-quiet" role="status">
        <p className="tw-quiet__line">Считаю статистику…</p>
      </div>
    );
  }
  if (phase.kind === "locked") {
    return (
      <div className="tw-quiet">
        <h2 className="tw-quiet__title">Инструмент закрыт</h2>
        <p className="tw-quiet__line">Personal Stats открывается после контрольной точки уровня 25.</p>
        <Link className="tw-button" data-variant="outline" href="/path">
          Продолжить путь
        </Link>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <div className="tw-quiet" role="alert">
        <p className="tw-quiet__line">{phase.message}</p>
        <button type="button" className="tw-button" data-variant="outline" onClick={() => void read(period, true)}>
          Повторить
        </button>
      </div>
    );
  }

  const { stats } = phase;
  const range = windowWords(stats.window);

  return (
    <div className="st">
      <div className="st-top">
        <StatsPeriodBar
          period={period}
          onChange={(next) => {
            if (next !== period || switchError) void read(next, false);
          }}
        />
        <p className="st-top__range">{range ?? "Все записи журнала"}</p>
      </div>
      {switchError ? (
        <p className="tc-error" role="alert">
          {switchError}
        </p>
      ) : null}

      {/* While another period is on its way, the figures on screen stay, quieted. */}
      <div className="st-body" aria-busy={switching} data-stale={switching || undefined}>
        <p className="tw-sr-only" role="status">
          {switching ? "Считаю статистику…" : ""}
        </p>
        {stats.trades === 0 ? (
          <div className="tw-quiet st-empty">
            <h2 className="tw-quiet__title">
              {stats.period === "all" ? "В журнале пока нет сделок" : "За этот период в журнале нет сделок"}
            </h2>
            <p className="tw-quiet__line">
              Статистика считается только по записям Trading Journal — разберите в нём свои сделки, и цифры появятся здесь.
            </p>
            <Link className="tw-button" data-variant="outline" href="/tools/journal">
              Открыть журнал
            </Link>
          </div>
        ) : (
          <>
            <StatsSample stats={stats} />
            <StatsFigures stats={stats} />
            <div className="st-sections">
              <StatsSplit stats={stats} />
              <StatsViolations stats={stats} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
