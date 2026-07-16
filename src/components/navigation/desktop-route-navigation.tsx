import Link from "next/link";
import { MOBILE_NAV } from "@/config/navigation";

/** Sections that exist as real routes (D2C-B: Главная + Путь + Уроки). */
const BUILT_ROUTES = new Set(["home", "path", "lessons"]);

/**
 * Desktop/tablet primary navigation — 5 items (Главная · Путь · Уроки · Инструменты · Ещё).
 * Active section is marked with aria-current + a route-segment underline (not colour only).
 * Built sections are real links; the rest stay focusable but disabled (no 404).
 */
export function DesktopRouteNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav className="rnav" aria-label="Основная навигация">
      {MOBILE_NAV.map((item) =>
        BUILT_ROUTES.has(item.id) ? (
          <Link
            key={item.id}
            href={item.href}
            aria-current={activeId === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <button key={item.id} type="button" aria-disabled="true" title="Скоро">
            {item.label}
          </button>
        ),
      )}
    </nav>
  );
}
