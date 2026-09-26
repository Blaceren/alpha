"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { canAccessRoute, type AppRole } from "@/lib/permissions";

const navGroups = [
  {
    id: "main",
    items: [
      { href: "/", label: "Главная" },
      { href: "/dashboard", label: "Кабинет" },
      { href: "/tasks", label: "Задания" },
      { href: "/levels", label: "Уровни" },
      { href: "/rewards", label: "Награды" },
      { href: "/rewards/daily", label: "Стрик" },
      { href: "/leaderboard", label: "Рейтинг" },
      { href: "/news", label: "Новости" },
      { href: "/chat", label: "Сообщество" },
      { href: "/profile", label: "Профиль" },
      { href: "/feedback", label: "Сообщить о проблеме" },
    ],
  },
  {
    id: "staff",
    items: [
      { href: "/support", label: "Проблемы пользователей" },
      { href: "/admin/feedback", label: "Проблемы" },
      { href: "/admin/task-reports", label: "Проверка отчётов" },
      { href: "/admin/chat-moderation", label: "Модерация" },
      { href: "/admin/news", label: "Новости" },
      { href: "/admin", label: "Рабочая консоль" },
    ],
  },
] as const;

type NavigationProps = {
  role?: AppRole | null;
};

const guestGroup = {
  id: "guest",
  items: [
    { href: "/", label: "Главная" },
    { href: "/#program", label: "Программа" },
    { href: "/news", label: "Новости" },
    { href: "/leaderboard", label: "Рейтинг" },
  ],
} as const;

export function Navigation({ role }: NavigationProps) {
  const pathname = usePathname();
  const visibleGroups = (role ? navGroups : [guestGroup])
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!role) {
          return true;
        }

        if (item.href === "/") return false;
        if (group.id === "staff") {
          const roleEntry: Partial<Record<AppRole, string[]>> = {
            admin: ["/admin"],
            support: ["/support", "/admin/feedback"],
            mentor: ["/support", "/admin/task-reports"],
            moderator: ["/admin/chat-moderation"],
            news_editor: ["/admin/news"],
          };
          if (!roleEntry[role]?.includes(item.href)) return false;
        }
        return canAccessRoute(role, item.href);
      }),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav aria-label="Primary navigation" className="premium-nav min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1 pr-2">
      <div className="flex w-max max-w-none flex-nowrap items-center gap-1 text-[13px] font-semibold text-[var(--text-secondary)]">
        {visibleGroups.map((group, groupIndex) => (
          <ul
            key={group.id}
            className={`flex shrink-0 items-center gap-0.5 ${groupIndex > 0 ? "ml-2 border-l border-[var(--border)] pl-2.5" : ""}`}
          >
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));

              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    data-active={isActive || undefined}
                    className="nav-item block whitespace-nowrap rounded-lg px-2.5 py-2 transition-colors hover:text-[var(--text-primary)]"
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>
    </nav>
  );
}
