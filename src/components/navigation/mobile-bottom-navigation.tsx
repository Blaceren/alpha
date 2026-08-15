import Link from "next/link";
import { PRIMARY_NAV } from "@/config/navigation";
import { isBuiltRoute } from "@/config/built-routes";
import { Icon } from "@/components/ui/icon";

/**
 * Mobile bottom navigation — the built sections of the canonical `PRIMARY_NAV`,
 * in canonical order. Five today, matching the designed bar.
 *
 * THE "ЕЩЁ" ITEM IS GONE FOR NOW, DELIBERATELY. It was an overflow entry into
 * `MORE_MENU`, and it was rendered as a DISABLED button because its own id was
 * not in the built list — so the menu it existed to open could never be opened,
 * and every section inside it (including Поддержка) was unreachable. An
 * overflow control that opens nothing is worse than no overflow control. When a
 * sixth section ships, "Ещё" comes back as a real control that actually opens
 * `MORE_MENU`.
 *
 * Fixed, safe-area padded, >=54px targets, active marked with aria-current +
 * underline rather than colour alone. Профиль stays on the top-bar avatar.
 */
export function MobileBottomNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav className="bottomnav" aria-label="Мобильная навигация">
      <ul>
        {PRIMARY_NAV.filter((item) => isBuiltRoute(item.id)).map((item) => (
          <li key={item.id}>
            <Link href={item.href} aria-current={activeId === item.id ? "page" : undefined}>
              <Icon name={item.iconKey} className="ic" />
              <span className="lbl">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
