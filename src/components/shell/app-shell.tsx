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
 * mobile bottom navigation. No sidebar, no card grid. `children` is the surface
 * content rendered inside <main>.
 *
 * THE BRAND MARK LINKS TO `/home`, NOT `/`. UNIFIED-DESIGN-V1 made `/` the
 * Public Home. Inside the authenticated shell the brand mark means "back to my
 * Academy", so it must resolve to the Authenticated Home; pointing it at `/`
 * would eject a signed-in learner onto the marketing surface.
 *
 * THE SKIP LINK BELOW IS THE PRODUCT'S ONE SKIP LINK for every surface that
 * mounts through this shell — Authenticated Home, Path, Lessons Index, Lesson
 * Reader, Workspace, Tools, Notifications, Profile, Support and Community. It is
 * the first focusable element, is hidden until focused, and moves focus to the
 * `#main` landmark below without changing route or product state. Public Home
 * carries its own, because it is deliberately outside this shell.
 */
export function AppShell({
  userName,
  activeId = "home",
  frozenSurface = false,
  children,
}: {
  userName: string;
  activeId?: string;
  /**
   * `true` for a surface restored from a frozen *ATA design.
   *
   * Such a surface carries its own container geometry — width, inline centring
   * and padding all come from its own scoped stylesheet, because in the frozen
   * document those lived on `main`. Two things follow, and only these two:
   *
   *   * the shell must not add a second padding box around it, or every
   *     restored surface is inset twice and none matches its accepted design;
   *   * the shell's field becomes the brand ground the frozen system paints
   *     (`--background-base`, #0B0D0A — the same value HomeAuthATA's token
   *     layer carries "unchanged from the ATA brand foundation"). The surface
   *     paints that ground opaquely inside its own container, so leaving the
   *     shell's decorative wash underneath would show it only in the margins,
   *     as a seam around the content. No new colour is introduced.
   *
   * Everything else about the shell is unchanged: same landmark, same skip
   * link, same navigation, same session controls.
   */
  frozenSurface?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={frozenSurface ? "home home--frozen" : "home"}>
      <a href="#main" className="skip">
        Перейти к содержимому
      </a>
      {/* desktop / tablet top command band */}
      <header className="appbar">
        <Link href="/home" aria-label="Alfa Trade Academy — на главную"><BrandMark /></Link>
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
        <Link href="/home" aria-label="Alfa Trade Academy — на главную"><BrandMark compact /></Link>
        <div className="actions" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <NotificationButton />
          <UserAvatar name={userName} />
          <SessionControls />
        </div>
      </div>

      <main className={frozenSurface ? "home-main home-main--frozen" : "home-main"} id="main">
        {children}
      </main>

      <MobileBottomNavigation activeId={activeId} />
    </div>
  );
}
