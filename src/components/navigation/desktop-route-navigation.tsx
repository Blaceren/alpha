import Link from "next/link";
import { MOBILE_NAV } from "@/config/navigation";

/**
 * Desktop/tablet primary navigation — 5 items (Главная · Путь · Уроки · Инструменты · Ещё).
 * Active section is marked with aria-current + a route-segment underline (not colour only).
 * Only Главная is a real route in D1B; the rest are focusable but disabled (no 404).
 */
export function DesktopRouteNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav className="rnav" aria-label="Основная навигация">
      {MOBILE_NAV.map((item) =>
        item.id === "home" ? (
          <Link key={item.id} href="/" aria-current={activeId === "home" ? "page" : undefined}>
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
