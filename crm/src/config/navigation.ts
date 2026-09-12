/**
 * Navigation model for the CRM shell. Grouped per IA §1.
 * Icons are lucide-react names resolved in the sidebar component.
 */
import type { SectionKey } from "@/domain/identity/roles";
import { GROWTH_ROOT_PATH } from "@/features/growth/growth-routes";

export interface NavItem {
  key: SectionKey;
  label: string;
  href: string;
  icon: string;
}

export interface NavGroup {
  id: string;
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "primary",
    label: null,
    items: [{ key: "today", label: "Сегодня", href: "/today", icon: "LayoutDashboard" }],
  },
  {
    id: "work",
    label: "Работа",
    items: [
      { key: "users", label: "Пользователи", href: "/users", icon: "Users" },
      { key: "segments", label: "Сегменты", href: "/segments", icon: "Layers" },
      { key: "tasks", label: "Задачи", href: "/tasks", icon: "CheckSquare" },
      { key: "cases", label: "Кейсы", href: "/cases", icon: "FolderOpen" },
    ],
  },
  {
    id: "queues",
    label: "Очереди",
    items: [
      { key: "mentor", label: "Mentor", href: "/mentor", icon: "GraduationCap" },
      { key: "support", label: "Support", href: "/support", icon: "LifeBuoy" },
      // COMMUNITY-V1. A backlog somebody works through, like the two above it.
      {
        key: "community_moderation",
        label: "Сообщество",
        href: "/community-moderation",
        icon: "MessagesSquare",
      },
    ],
  },
  {
    id: "operations",
    label: "Операции",
    items: [
      { key: "financial", label: "Финансы", href: "/financial", icon: "Wallet" },
      { key: "communications", label: "Коммуникации", href: "/communications", icon: "MessageSquare" },
      { key: "automations", label: "Автоматизации", href: "/automations", icon: "Workflow" },
    ],
  },
  {
    id: "insight",
    label: "Аналитика",
    items: [
      { key: "analytics", label: "Аналитика", href: "/analytics", icon: "BarChart3" },
      // AFD-5A. Grouped under Аналитика because that is where an operator looks
      // for traffic sources, but the section itself is configuration-only in
      // this phase — it shows no metric of any kind.
      { key: "affiliates", label: "Аффилейты", href: "/affiliates", icon: "Share2" },
      // G4-GROWTH. Beside Аффилейты because an operator looking for traffic
      // sources looks here, but a separate section: that one is configuration
      // and this one is measurement.
      // G4-R1. The href comes from the Growth route registry, which is also what
      // both shells route with, so the mock navigation cannot point at a path
      // api mode does not serve — or vice versa, which is what broke G4.
      { key: "growth", label: "Growth", href: GROWTH_ROOT_PATH, icon: "TrendingUp" },
      { key: "audit", label: "Audit", href: "/audit", icon: "ScrollText" },
    ],
  },
  {
    id: "system",
    label: null,
    items: [{ key: "settings", label: "Настройки", href: "/settings", icon: "Settings" }],
  },
];

/** Flat, ordered list of section keys (for permission filtering / tests). */
export const SECTION_ORDER: SectionKey[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

/** Human labels for breadcrumbs / titles, keyed by first path segment. */
export const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.href.replace("/", ""), i.label]),
);
