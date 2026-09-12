"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MockNewsItem } from "@/data/mockNews";
import { mockNews } from "@/data/mockNews";
import { getNews } from "@/lib/api";

type PulseCategory = "Market" | "Lesson" | "Platform" | "Mentor" | "Community";
type PulseStatus = "New" | "Hot" | "Update" | "Guide";

type PulseItem = {
  id: string;
  title: string;
  excerpt: string;
  meta: string;
  category: PulseCategory;
  status: PulseStatus;
  href: string;
};

const localHighlights: PulseItem[] = [
  {
    id: "local-checkpoints",
    title: "Обновление: контрольные точки",
    excerpt: "Checkpoint замораживает прогресс, но не сбрасывает уровень, XP и награды.",
    meta: "2 мин чтения",
    category: "Platform",
    status: "Update",
    href: "/tasks",
  },
  {
    id: "local-leaderboard",
    title: "Рейтинг обновился",
    excerpt: "Топ учеников недели — сравните свой прогресс и XP с сообществом.",
    meta: "1 мин чтения",
    category: "Community",
    status: "New",
    href: "/leaderboard",
  },
  {
    id: "local-mentor-review",
    title: "Разбор отчётов с наставником",
    excerpt: "Как проходит проверка отчётов и на что смотрит наставник в первую очередь.",
    meta: "3 мин чтения",
    category: "Mentor",
    status: "Guide",
    href: "/mentor-chat",
  },
  {
    id: "local-daily-reward",
    title: "Ежедневные награды",
    excerpt: "Streak и ежедневный бонус — простой способ не терять темп обучения.",
    meta: "1 мин чтения",
    category: "Platform",
    status: "Hot",
    href: "/rewards/daily",
  },
];

function classifyNews(item: MockNewsItem, index: number): PulseItem {
  const category = item.category.toLowerCase();
  let resolvedCategory: PulseCategory = "Platform";

  if (category.includes("рынок") || category.includes("крипто")) {
    resolvedCategory = "Market";
  } else if (category.includes("риск") || category.includes("наставник") || category.includes("ментор")) {
    resolvedCategory = "Mentor";
  } else if (category.includes("обучение") || category.includes("практика") || category.includes("разбор")) {
    resolvedCategory = "Lesson";
  }

  const status: PulseStatus =
    index === 0 ? "Hot" : index < 3 ? "New" : resolvedCategory === "Lesson" ? "Guide" : "Update";

  return {
    id: item.id,
    title: item.title,
    excerpt: item.excerpt,
    meta: item.date,
    category: resolvedCategory,
    status,
    href: `/news/${item.id}`,
  };
}

function PulseIcon({ category }: { category: PulseCategory }) {
  const paths: Record<PulseCategory, React.ReactNode> = {
    Market: (
      <path d="M3 16.5 9 10l4 4 8-8.5M15 5.5h6V11.5" />
    ),
    Lesson: (
      <path d="M4 5.5c2.2-1 5-1 7 .3 2-1.3 4.8-1.3 7-.3v12c-2.2-1-5-1-7 .3-2-1.3-4.8-1.3-7-.3z" />
    ),
    Platform: (
      <path d="m12 3 8 4-8 4-8-4zM4 12l8 4 8-4M4 16.5l8 4 8-4" />
    ),
    Mentor: (
      <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-5.5 8a5.5 5.5 0 0 1 11 0M17 8.5l1.6 1.6L22 6.5" />
    ),
    Community: (
      <path d="M7 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1.5 20a5.5 5.5 0 0 1 11 0M11.5 20a5.5 5.5 0 0 1 11 0" />
    ),
  };

  return (
    <span className="market-pulse-icon">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths[category]}
      </svg>
    </span>
  );
}

function PulseCard({ item }: { item: PulseItem }) {
  return (
    <Link href={item.href} className="market-pulse-card">
      <div className="flex items-start justify-between gap-3">
        <PulseIcon category={item.category} />
        <span className="status-pill market-pulse-status" data-status={item.status}>
          {item.status}
        </span>
      </div>
      <div>
        <span className="badge market-pulse-badge" data-category={item.category}>
          {item.category}
        </span>
        <h3 className="mt-3 text-base font-black leading-snug text-[var(--text-primary)]">
          {item.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.excerpt}</p>
      </div>
      <span className="mt-auto text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        {item.meta}
      </span>
    </Link>
  );
}

type Lane = {
  items: PulseItem[];
  direction: "left" | "right";
  speed: "normal" | "fast" | "slow";
  offset: "none" | "in" | "out";
};

export function MarketPulse() {
  const [newsItems, setNewsItems] = useState<PulseItem[]>(() => mockNews.map(classifyNews));

  useEffect(() => {
    let isActive = true;
    getNews().then((result) => {
      if (isActive && result.data.length > 0) {
        setNewsItems(result.data.map(classifyNews));
      }
    });
    return () => {
      isActive = false;
    };
  }, []);

  const allItems = [...newsItems, ...localHighlights];

  const lanes: Lane[] = [
    { items: allItems.filter((_, index) => index % 3 === 0), direction: "left", speed: "normal", offset: "none" },
    { items: allItems.filter((_, index) => index % 3 === 1), direction: "right", speed: "slow", offset: "in" },
    { items: allItems.filter((_, index) => index % 3 === 2), direction: "left", speed: "fast", offset: "out" },
  ];

  return (
    <section className="market-pulse-section">
      <div className="market-pulse-head">
        <div>
          <p className="page-kicker">Market Pulse</p>
          <h2 className="section-title mt-2 text-2xl md:text-3xl">Живая лента рынка</h2>
          <p className="mt-3 max-w-2xl text-[var(--text-secondary)]">
            Будьте в курсе рынка, обновлений платформы, уроков и заметок наставников.
          </p>
        </div>
        <Link href="/news" className="btn btn-secondary shrink-0">
          Все новости
        </Link>
      </div>

      <div className="market-pulse-track" aria-hidden={false}>
        {lanes.map((lane, laneIndex) => (
          <div
            key={laneIndex}
            className="market-pulse-lane"
            data-direction={lane.direction}
            data-speed={lane.speed}
            data-offset={lane.offset}
          >
            <div className="market-pulse-lane-inner">
              {[...lane.items, ...lane.items].map((item, itemIndex) => (
                <PulseCard key={`${item.id}-${itemIndex}`} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="market-pulse-mobile">
        {allItems.map((item) => (
          <PulseCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
