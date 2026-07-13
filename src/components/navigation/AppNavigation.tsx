import { PRIMARY_NAV } from "@/config/navigation";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";

/**
 * Desktop sidebar navigation. Labels/order are identical across all three art
 * directions. `activeId` highlights the current section.
 */
export function AppNavigation({
  activeId = "home",
  className,
}: {
  activeId?: string;
  className?: string;
}) {
  return (
    <nav aria-label="Основная навигация" className={cn("flex flex-col gap-1", className)}>
      {PRIMARY_NAV.map((item) => {
        const active = item.id === activeId;
        return (
          <a
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5",
              "font-ui text-[0.95rem] transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
              active
                ? "bg-surface-3 text-ink border border-line"
                : "text-ink-2 hover:text-ink hover:bg-surface-2 border border-transparent",
            )}
          >
            <Icon
              name={item.iconKey}
              className={cn("h-5 w-5 shrink-0", active ? "text-accent" : "text-ink-3")}
            />
            <span className="truncate">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
