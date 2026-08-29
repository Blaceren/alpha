/**
 * Canonical navigation model. Shared by all three art directions — labels and
 * order are identical across directions (only composition may differ).
 * Routes follow docs/ROUTE_MAP.md (App Router). iconKey maps to a lucide icon
 * in the component layer, keeping this config pure/testable.
 *
 * UNIFIED-DESIGN-V1: `home` points at `/home`, not `/`. `/` is now the Public
 * Home — a marketing surface outside the authenticated guard — so an
 * authenticated nav item pointing there would take a signed-in learner OUT of
 * the Academy. Both the desktop bar and the mobile bottom bar read this one
 * list, so they cannot disagree about it.
 */

export interface NavItem {
  id: string;
  label: string;
  href: string;
  iconKey: string;
}

/** Desktop sidebar navigation (RU labels). */
export const PRIMARY_NAV: NavItem[] = [
  { id: "home", label: "Главная", href: "/home", iconKey: "home" },
  { id: "path", label: "Путь", href: "/path", iconKey: "path" },
  { id: "lessons", label: "Уроки", href: "/lessons", iconKey: "lessons" },
  { id: "tools", label: "Инструменты", href: "/tools", iconKey: "tools" },
  { id: "community", label: "Сообщество", href: "/community", iconKey: "community" },
  { id: "news", label: "Новости", href: "/news", iconKey: "news" },
  { id: "referrals", label: "Рефералы", href: "/referrals", iconKey: "referrals" },
  { id: "mentor", label: "Ментор", href: "/mentor", iconKey: "mentor" },
  { id: "support", label: "Поддержка", href: "/support", iconKey: "support" },
];

/** Mobile bottom navigation: 5 items, last is "Ещё". */
export const MOBILE_NAV: NavItem[] = [
  { id: "home", label: "Главная", href: "/home", iconKey: "home" },
  { id: "path", label: "Путь", href: "/path", iconKey: "path" },
  { id: "lessons", label: "Уроки", href: "/lessons", iconKey: "lessons" },
  { id: "tools", label: "Инструменты", href: "/tools", iconKey: "tools" },
  { id: "more", label: "Ещё", href: "#more", iconKey: "more" },
];

/** Contents of the mobile "Ещё" menu. Profile is also reachable via avatar. */
export const MORE_MENU: NavItem[] = [
  { id: "community", label: "Сообщество", href: "/community", iconKey: "community" },
  { id: "news", label: "Новости", href: "/news", iconKey: "news" },
  { id: "referrals", label: "Рефералы", href: "/referrals", iconKey: "referrals" },
  { id: "mentor", label: "Ментор", href: "/mentor", iconKey: "mentor" },
  { id: "support", label: "Поддержка", href: "/support", iconKey: "support" },
  { id: "profile", label: "Профиль", href: "/profile", iconKey: "profile" },
  { id: "settings", label: "Настройки", href: "/settings", iconKey: "settings" },
];
