"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * Public Home header — the frozen HomeATA header, with two corrections.
 *
 * It is a client component only because the menu is interactive. The markup,
 * class names and copy are still the frozen page's; the open/closed state is
 * held in React rather than by mutating `aria-expanded` from outside, which is
 * the one mechanical difference from script.js and is invisible in behaviour.
 *
 * WHAT THIS PHASE CHANGED, AND ONLY THIS:
 *
 *   1. The navigation order now follows the DOM. The frozen order listed «Путь»
 *      before «Практика и обратная связь» while the page has always rendered
 *      review first, so the menu disagreed with the page it navigates.
 *
 *   2. `.wordmark`, `.mobile-login` and `.menu-toggle` reach 44px. They were
 *      31, 32 and 35px — three of the four sub-44 targets on the page.
 *
 * Both corrections live in the stylesheet; the element order below is the only
 * markup change.
 *
 * The three closing paths of the frozen menu are all preserved:
 *   * clicking any link inside the nav,
 *   * Escape — which also returns focus to the toggle, as HomeATA does,
 *   * a click anywhere outside the header.
 *
 * AUTH_STATE_ONLY. Signed out this is byte-for-byte HomeATA's header. Signed in,
 * the two service login affordances (`.mobile-login` and `.button--login`) are
 * omitted and the primary call to action becomes «Перейти в Академию» → /home.
 * Nothing else about the header changes: the same element order, the same
 * classes, the same geometry.
 */
export function PublicHomeHeader({ authenticated }: { authenticated: boolean }) {
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen((wasOpen) => {
        if (wasOpen) toggleRef.current?.focus();
        return false;
      });
    };
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && headerRef.current && !headerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onDocumentClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onDocumentClick);
    };
  }, []);

  const primary = authenticated
    ? { href: "/home", label: "Перейти в Академию" }
    : { href: "/register", label: "Начать путь" };

  return (
    <header className="site-header" data-header ref={headerRef}>
      <div className="site-header__inner shell">
        <a className="wordmark" href="#top" aria-label="Alfa Trade Academy — на главную">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ata-logo.svg" alt="" width={362} height={200} />
        </a>

        <div className="header-mobile-actions">
          {authenticated ? null : (
            <Link className="mobile-login" href="/login" aria-label="Войти в личный кабинет ATA">
              Войти
            </Link>
          )}
          <button
            className="menu-toggle"
            type="button"
            aria-expanded={open}
            aria-controls="primary-nav"
            data-menu-toggle
            ref={toggleRef}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            <span>Меню</span>
            <i aria-hidden="true" />
          </button>
        </div>

        <nav
          className={`primary-nav${open ? " is-open" : ""}`}
          id="primary-nav"
          aria-label="Основная навигация"
          data-nav
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) close();
          }}
        >
          <a href="#mechanism">Как это работает</a>
          <a href="#review">Практика и обратная связь</a>
          <a href="#path">Путь</a>
          <a href="#tools">Инструменты</a>
          <a href="#faq">Вопросы</a>
          <div className="nav-actions" aria-label="Действия с аккаунтом">
            {authenticated ? null : (
              <Link className="button button--login" href="/login">
                Войти
              </Link>
            )}
            <Link className="button button--small button--signal" href={primary.href}>
              {primary.label}
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
