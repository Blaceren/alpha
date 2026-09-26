"use client";

import Link from "next/link";
import { useState } from "react";

type ZoneId = "path" | "market" | "mentor" | "exchange" | "rewards" | "leaderboard";

type ZoneSide = "core" | "left" | "right";

type Zone = {
  id: ZoneId;
  number: string;
  code: string;
  title: string;
  description?: string;
  href: string;
  metric: string;
  metricLabel: string;
  hint: string;
  side: ZoneSide;
};

const zones: Zone[] = [
  {
    id: "path",
    number: "01",
    code: "TASKS",
    title: "Путь",
    description: "Задания идут в заданном порядке: уроки, отчёты наставнику и контрольные точки на бирже.",
    href: "/tasks",
    metric: "420 / 700",
    metricLabel: "XP до уровня 3 — осталось 280",
    hint: "Открыть задания",
    side: "core",
  },
  {
    id: "market",
    number: "02",
    code: "MARKET",
    title: "Рынок",
    href: "/dashboard",
    metric: "EUR/USD",
    metricLabel: "sandbox-превью за сегодня",
    hint: "Открыть кабинет",
    side: "left",
  },
  {
    id: "mentor",
    number: "03",
    code: "MENTOR",
    title: "Наставник",
    href: "/mentor-chat",
    metric: "~2 ч",
    metricLabel: "среднее время ответа",
    hint: "Написать наставнику",
    side: "left",
  },
  {
    id: "exchange",
    number: "04",
    code: "POCKET",
    title: "Pocket",
    href: "/exchange",
    metric: "$120",
    metricLabel: "подтверждённый депозит",
    hint: "Перейти к Pocket",
    side: "right",
  },
  {
    id: "rewards",
    number: "05",
    code: "STREAK",
    title: "Награды",
    href: "/rewards/daily",
    metric: "7 дней",
    metricLabel: "+150 XP сегодня",
    hint: "Посмотреть награды",
    side: "right",
  },
  {
    id: "leaderboard",
    number: "06",
    code: "RANK",
    title: "Рейтинг",
    href: "/leaderboard",
    metric: "#12",
    metricLabel: "из 340 участников",
    hint: "Посмотреть рейтинг",
    side: "right",
  },
];

const pathSteps = [
  { number: "01", label: "Регистрация на сайте", state: "done" },
  { number: "02", label: "Базовое обучение", state: "done" },
  { number: "03", label: "Подключение биржи", state: "done" },
  { number: "04", label: "Пополнение баланса", state: "active" },
  { number: "05", label: "Серии сделок и отчёты", state: "locked" },
  { number: "06", label: "Checkpoint · баланс $2000", state: "locked" },
] as const;

const marketArea = "0,52 22,40 44,46 66,30 88,36 110,22 132,28 154,16 176,24 200,10";
const streakDays = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const rankRows = [
  { place: "1", name: "Алекс М.", xp: "12 450", width: "100%", isYou: false },
  { place: "2", name: "Сара К.", xp: "8 290", width: "67%", isYou: false },
  { place: "12", name: "Вы", xp: "2 450", width: "20%", isYou: true },
];

function PathRoadmap() {
  return (
    <div className="mt-6 space-y-0">
      {pathSteps.map((step, index) => (
        <div key={step.number} className="relative flex items-center gap-3.5 pb-4 last:pb-0">
          {index < pathSteps.length - 1 ? (
            <span
              className={`path-line absolute left-[0.8125rem] top-7 h-[calc(100%-1.35rem)] w-px ${
                step.state === "done" ? "path-line-done bg-[color-mix(in_srgb,var(--success)_45%,var(--border-strong))]" : "bg-[var(--border-strong)]"
              }`}
              aria-hidden="true"
            />
          ) : null}
          <span
            className={`relative z-10 grid h-[1.65rem] w-[1.65rem] shrink-0 place-items-center rounded-full text-[10px] font-bold ${
              step.state === "done"
                ? "bg-[var(--success-soft)] text-[var(--success)]"
                : step.state === "active"
                  ? "step-breathe bg-[var(--primary)] text-white"
                  : "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-muted)]"
            }`}
          >
            {step.state === "done" ? "✓" : step.number}
          </span>
          <div className="min-w-0">
            <p
              className={`truncate text-sm font-bold ${
                step.state === "locked" ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"
              }`}
            >
              {step.label}
            </p>
            <p className="font-data text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
              {step.state === "done" ? "выполнено" : step.state === "active" ? "активный шаг" : "закрыто"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function XpArc({ metric, metricLabel }: { metric: string; metricLabel: string }) {
  return (
    <div className="mt-auto flex items-center gap-4 pt-6">
      <div className="relative h-[4.75rem] w-[4.75rem] shrink-0" aria-hidden="true">
        <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface-strong)" strokeWidth="6" />
          <circle
            className="xp-arc-fill"
            cx="40"
            cy="40"
            r="34"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="6"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="60 40"
          />
        </svg>
        <span className="font-data absolute inset-0 grid place-items-center text-[13px] font-bold text-[var(--text-primary)]">
          60%
        </span>
      </div>
      <div className="min-w-0">
        <p className="font-data text-[1.7rem] font-bold leading-none tracking-[-0.01em] text-[var(--text-primary)]">
          {metric}
          <span className="ml-1.5 text-xs font-semibold text-[var(--text-muted)]">XP</span>
        </p>
        <p className="mt-2 text-[11px] leading-4 text-[var(--text-muted)]">{metricLabel}</p>
      </div>
    </div>
  );
}

function MarketChart() {
  return (
    <div className="relative mt-4 h-24 overflow-hidden rounded-xl">
      <svg viewBox="0 0 200 64" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="map-market-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--success)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`${marketArea} 200,64 0,64`} fill="url(#map-market-fill)" />
        <polyline
          points={marketArea}
          fill="none"
          stroke="var(--success)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="market-dot absolute right-[3%] top-[10%] h-2 w-2 rounded-full bg-[var(--success)]" />
      <span className="font-data absolute left-0 top-0 text-[11px] font-bold text-[var(--success)]">+0.32%</span>
    </div>
  );
}

function MentorPreview() {
  return (
    <div className="mt-4 space-y-2">
      <div className="mentor-row flex items-center justify-between gap-2 rounded-lg border border-[var(--hairline)] bg-[color-mix(in_srgb,var(--surface-elevated)_65%,transparent)] px-3 py-2">
        <p className="truncate text-xs font-semibold text-[var(--text-secondary)]">Отчёт #14 отправлен</p>
        <span className="font-data shrink-0 text-[10px] text-[var(--text-muted)]">14:02</span>
      </div>
      <div className="mentor-row flex items-center justify-between gap-2 rounded-lg border border-[color-mix(in_srgb,var(--success)_22%,var(--hairline))] bg-[color-mix(in_srgb,var(--success)_6%,transparent)] px-3 py-2">
        <p className="truncate text-xs font-bold text-[var(--text-primary)]">Принято · +40 XP</p>
        <span className="font-data shrink-0 text-[10px] text-[var(--text-muted)]">16:47</span>
      </div>
    </div>
  );
}

function ExchangePipeline() {
  const steps = ["Регистрация", "Депозит", "Postback"];
  return (
    <div className="mt-4 flex items-center gap-1.5">
      {steps.map((step, index) => (
        <div key={step} className="flex min-w-0 flex-1 items-center gap-1.5">
          <div className="flex min-w-0 flex-col items-center gap-1.5">
            <span
              className="pipe-node grid h-5 w-5 place-items-center rounded-full bg-[var(--success-soft)] text-[9px] font-black text-[var(--success)]"
              data-step={index}
            >
              ✓
            </span>
            <span className="font-data w-full truncate text-center text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
              {step}
            </span>
          </div>
          {index < steps.length - 1 ? (
            <span className="mb-4 h-px flex-1 bg-[var(--border-strong)]" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function StreakRow() {
  return (
    <div className="mt-4 flex items-end gap-1.5">
      {streakDays.map((day, index) => (
        <div key={day} className="flex flex-1 flex-col items-center gap-1">
          <span
            className={`h-7 w-full rounded-md ${
              index < 6
                ? "bg-[color-mix(in_srgb,var(--reward)_38%,var(--surface-strong))]"
                : "streak-today border border-[var(--reward)] bg-[color-mix(in_srgb,var(--reward)_14%,transparent)]"
            }`}
          />
          <span className="font-data text-[9px] text-[var(--text-muted)]">{day}</span>
        </div>
      ))}
    </div>
  );
}

function RankRows() {
  return (
    <div className="mt-4 space-y-2.5">
      {rankRows.map((row, index) => (
        <div key={row.place}>
          <div className="flex items-baseline justify-between gap-2">
            <p className={`truncate text-xs font-bold ${row.isYou ? "text-[var(--primary)]" : "text-[var(--text-primary)]"}`}>
              <span className="font-data mr-1.5 text-[10px] text-[var(--text-muted)]">#{row.place}</span>
              {row.name}
            </p>
            <span className="font-data shrink-0 text-[10px] text-[var(--text-secondary)]">{row.xp}</span>
          </div>
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[var(--surface-strong)]">
            <div
              className={`rank-bar h-full rounded-full ${row.isYou ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]"}`}
              data-row={index}
              style={{ width: row.width }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

const zoneVisuals: Record<ZoneId, React.ReactNode> = {
  path: <PathRoadmap />,
  market: <MarketChart />,
  mentor: <MentorPreview />,
  exchange: <ExchangePipeline />,
  rewards: <StreakRow />,
  leaderboard: <RankRows />,
};

export function ProductMap() {
  const [focused, setFocused] = useState<ZoneId | null>(null);

  const stateFor = (id: ZoneId) =>
    focused === null ? "idle" : focused === id ? "active" : "dim";

  return (
    <div className="product-map-shell">
      <nav aria-label="Карта платформы" className="map-legend">
        {zones.map((zone) => (
          <Link
            key={zone.id}
            href={zone.href}
            className="map-legend-item"
            data-state={stateFor(zone.id)}
            onMouseEnter={() => setFocused(zone.id)}
            onMouseLeave={() => setFocused(null)}
            onFocus={() => setFocused(zone.id)}
            onBlur={() => setFocused(null)}
          >
            <span className="legend-dot" aria-hidden="true" />
            <span className="font-data">{zone.number}</span>
            {zone.title}
          </Link>
        ))}
        <span className="map-legend-note font-data">6 модулей · один маршрут</span>
      </nav>

      <div className="product-map">
        {zones.map((zone) => {
          const isCore = zone.side === "core";

          return (
            <Link
              key={zone.id}
              href={zone.href}
              className="map-zone"
              data-zone={zone.id}
              data-side={isCore ? undefined : zone.side}
              data-state={stateFor(zone.id)}
              onMouseEnter={() => setFocused(zone.id)}
              onMouseLeave={() => setFocused(null)}
              onFocus={() => setFocused(zone.id)}
              onBlur={() => setFocused(null)}
            >
              <span className="zone-glare" aria-hidden="true" />
              <div className="flex items-center justify-between gap-3">
                <span className="font-data text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                  {zone.number} · {zone.code}
                </span>
                <span className="map-hint" aria-hidden="true">
                  {zone.hint}
                  <span className="map-hint-arrow text-[var(--primary)]">→</span>
                </span>
              </div>

              <div>
                <h3 className={`font-black tracking-[-0.02em] text-[var(--text-primary)] ${isCore ? "text-3xl" : "text-lg"}`}>
                  {zone.title}
                </h3>
                {zone.description ? (
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">{zone.description}</p>
                ) : null}
              </div>

              {zoneVisuals[zone.id]}

              {isCore ? (
                <XpArc metric={zone.metric} metricLabel={zone.metricLabel} />
              ) : (
                <div className="mt-auto pt-4">
                  <p className="font-data text-2xl font-bold tracking-[-0.01em] text-[var(--text-primary)]">
                    {zone.metric}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{zone.metricLabel}</p>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
