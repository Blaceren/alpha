import type { ReactNode } from "react";
import { AppNavigation } from "@/components/navigation/AppNavigation";
import { MobileNavigation } from "@/components/navigation/MobileNavigation";
import { TopBar } from "@/components/shell/TopBar";
import { LogoPlaceholder } from "@/components/shell/LogoPlaceholder";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";

/**
 * Minimal responsive application shell shared by all three art directions.
 * Navigation model and labels are identical; only `sidebarClassName` /
 * `mainClassName` allow small compositional differences per direction.
 */
export function AppShell({
  activeId = "home",
  pageContext,
  userName,
  sidebarClassName,
  mainClassName,
  children,
}: {
  activeId?: string;
  pageContext: string;
  userName: string;
  sidebarClassName?: string;
  mainClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-base">
      <div className="lg:grid lg:grid-cols-[264px_1fr]">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh flex-col border-r border-line px-4 py-5 lg:flex",
            "bg-surface-1",
            sidebarClassName,
          )}
        >
          <div className="px-2 pb-6">
            <LogoPlaceholder />
          </div>
          <AppNavigation activeId={activeId} className="px-0" />
          <div className="mt-auto">
            <a
              href="/profile"
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:bg-surface-3"
            >
              <Avatar name={userName} size={34} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-ui text-sm text-ink">{userName}</span>
                <span className="truncate font-ui text-xs text-ink-3">Профиль</span>
              </span>
            </a>
          </div>
        </aside>

        {/* Main column. min-w-0 lets the 1fr grid track shrink below its
            content's min-content so nested horizontal scrollers (the path)
            don't force page-level overflow. */}
        <div className="flex min-h-dvh min-w-0 flex-col">
          <TopBar context={pageContext} userName={userName} />
          <main
            className={cn(
              "flex-1 overflow-x-clip px-4 pb-28 pt-5 lg:px-8 lg:pb-10 lg:pt-8",
              mainClassName,
            )}
          >
            {children}
          </main>
        </div>
      </div>

      <MobileNavigation activeId={activeId} />
    </div>
  );
}
