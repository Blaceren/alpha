import Link from "next/link";
import { MOBILE_NAV } from "@/config/navigation";
import { Icon } from "@/components/ui/icon";

/** Sections that exist as real routes (D4-B adds Инструменты). */
const BUILT_ROUTES = new Set(["home", "path", "lessons", "tools"]);

/**
 * Mobile bottom navigation — 5 items. Fixed, safe-area padded, ≥54px targets,
 * active marked with aria-current + underline (not colour only). Built sections
 * are real links; the rest are focusable-disabled (no 404). Profile via the
 * top-bar avatar.
 */
export function MobileBottomNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav className="bottomnav" aria-label="Мобильная навигация">
      <ul>
        {MOBILE_NAV.map((item) => (
          <li key={item.id}>
            {BUILT_ROUTES.has(item.id) ? (
              <Link href={item.href} aria-current={activeId === item.id ? "page" : undefined}>
                <Icon name={item.iconKey} className="ic" />
                <span className="lbl">{item.label}</span>
              </Link>
            ) : (
              <button type="button" aria-disabled="true" title="Скоро">
                <Icon name={item.iconKey} className="ic" />
                <span className="lbl">{item.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
