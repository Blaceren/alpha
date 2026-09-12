import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Navigation } from "@/components/Navigation";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCurrentUser } from "@/lib/auth";

export async function Header() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[color-mix(in_srgb,var(--surface-glass)_92%,transparent)] backdrop-blur-2xl">
      <div className="app-container flex min-h-[64px] flex-col gap-3 py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="group flex min-w-0 items-center gap-3 font-black text-[var(--text-primary)]">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--primary)] text-sm text-white transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
              TQ
            </span>
            <span className="truncate text-lg tracking-[-0.02em]">TradeQuest</span>
          </Link>
          <div className="flex items-center gap-2 xl:hidden">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3 xl:flex-1 xl:flex-row xl:items-center xl:justify-end">
          <Navigation role={user?.role} />
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)] xl:justify-end">
            <div className="hidden xl:block">
              <ThemeToggle />
            </div>
            {user ? (
              <>
                <NotificationBell />
                <Link href="/profile" className="status-pill max-w-[11rem] truncate transition-colors hover:text-[var(--text-primary)]" title={`${user.name || user.email} — ${user.role}`}>
                  {user.name || user.email}
                </Link>
                <LogoutButton />
              </>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost min-h-9 px-3 py-1.5 text-xs">
                  Войти
                </Link>
                <Link href="/register" className="btn btn-primary cta-sheen min-h-9 px-4 py-1.5 text-xs">
                  Начать бесплатно
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
