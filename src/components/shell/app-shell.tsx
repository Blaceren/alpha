import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/shell/brand-mark";
import { NotificationButton } from "@/components/shell/notification-button";
import { UserAvatar } from "@/components/shell/user-avatar";
import { SessionControls } from "@/components/shell/session-controls";
import { DesktopRouteNavigation } from "@/components/navigation/desktop-route-navigation";
import { MobileBottomNavigation } from "@/components/navigation/mobile-bottom-navigation";

/**
 * Authenticated app shell: desktop/tablet top command band + mobile top bar +
 * mobile bottom navigation. No sidebar, no card grid. Only Главная is a full page
 * in D1B. `children` is the scenario content rendered inside <main>.
 */
export function AppShell({
  userName,
  activeId = "home",
  children,
}: {
  userName: string;
  activeId?: string;
  children: ReactNode;
}) {
  return (
    <div className="home">
      <a href="#main" className="skip">
        Перейти к содержимому
      </a>
      {/* desktop / tablet top command band */}
      <header className="appbar">
        <Link href="/" aria-label="Alfa Trade Academy — на главную"><BrandMark /></Link>
        <DesktopRouteNavigation activeId={activeId} />
        <span className="spacer" />
        <div className="actions">
          <NotificationButton />
          <UserAvatar name={userName} />
          <SessionControls />
        </div>
      </header>

      {/* mobile top bar */}
      <div className="mtop">
        <Link href="/" aria-label="Alfa Trade Academy — на главную"><BrandMark compact /></Link>
        <div className="actions" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <NotificationButton />
          <UserAvatar name={userName} />
          <SessionControls />
        </div>
      </div>

      <main className="home-main" id="main">
        {children}
      </main>

      <MobileBottomNavigation activeId={activeId} />
    </div>
  );
}
