import { MOBILE_NAV } from "@/config/navigation";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * Mobile bottom navigation: 5 items (Главная, Путь, Уроки, Инструменты, Ещё).
 * Profile is reached via the top-bar avatar, not from here. Fixed to the bottom
 * with safe-area padding; content pages reserve space so nothing is covered.
 */
export function MobileNavigation({ activeId = "home" }: { activeId?: string }) {
  return (
    <nav
      aria-label="Мобильная навигация"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 lg:hidden",
        "border-t border-line bg-[color-mix(in_srgb,var(--surface-primary)_92%,transparent)]",
        "backdrop-blur-md",
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-xl items-stretch justify-between px-2">
        {MOBILE_NAV.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="flex-1">
              <a
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg py-1.5",
                  "font-ui text-[0.7rem] transition-colors duration-150",
                  active ? "text-accent" : "text-ink-3 hover:text-ink-2",
                )}
              >
                <Icon name={item.iconKey} className="h-[22px] w-[22px]" />
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
