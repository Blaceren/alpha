import { NotificationButton } from "@/components/shell/NotificationButton";
import { Avatar } from "@/components/ui/Avatar";
import { LogoPlaceholder } from "@/components/shell/LogoPlaceholder";
import { cn } from "@/lib/cn";

/**
 * Top bar: page context (left), notifications + profile avatar (right).
 * On mobile it also carries the compact logo. Profile opens via the avatar.
 */
export function TopBar({
  context,
  userName,
  className,
}: {
  context: string;
  userName: string;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-center justify-between gap-3 border-b border-line",
        "bg-[color-mix(in_srgb,var(--background-base)_88%,transparent)] px-4 py-3 backdrop-blur-md lg:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="lg:hidden">
          <LogoPlaceholder compact />
        </span>
        <span className="truncate font-display text-sm font-semibold text-ink-2 lg:text-[0.95rem]">
          {context}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <NotificationButton />
        <a
          href="/profile"
          aria-label="Профиль"
          className="ml-1 rounded-full outline-offset-2 transition-transform duration-150 hover:scale-105"
        >
          <Avatar name={userName} size={36} />
        </a>
      </div>
    </header>
  );
}
