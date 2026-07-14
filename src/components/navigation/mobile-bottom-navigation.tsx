import Link from "next/link";
import { MOBILE_NAV } from "@/config/navigation";
import { Icon } from "@/components/ui/icon";

/**
 * Mobile bottom navigation — 5 items. Fixed, safe-area padded, ≥54px targets,
 * active marked with aria-current + underline (not colour only). Only Главная is a
 * real route; the rest are focusable-disabled (no 404). Profile via the top-bar avatar.
 */
export function MobileBottomNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav className="bottomnav" aria-label="Мобильная навигация">
      <ul>
        {MOBILE_NAV.map((item) => (
          <li key={item.id}>
            {item.id === "home" ? (
              <Link href="/" aria-current={activeId === "home" ? "page" : undefined}>
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
