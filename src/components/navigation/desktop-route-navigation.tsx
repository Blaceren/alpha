import Link from "next/link";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";

/**
 * Desktop/tablet primary navigation.
 *
 * It renders the BUILT sections of the canonical `PRIMARY_NAV`, in canonical
 * order. Today that is exactly five — Главная · Путь · Уроки · Инструменты ·
 * Поддержка — so the designed five-item bar is preserved without a hardcoded
 * list of which five.
 *
 * It no longer renders disabled "Скоро" buttons for unbuilt sections. A control
 * that advertises a section which does not exist is a promise the product
 * cannot keep, and it was also what hid `/support`: the item was filtered out
 * as unbuilt long after it had shipped.
 *
 * Active section is marked with aria-current + a route-segment underline, not
 * colour alone.
 */
export function DesktopRouteNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav className="rnav" aria-label="Основная навигация">
      {PRIMARY_NAV.filter((item) => isBuiltRoute(item.id)).map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={activeId === item.id ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
