"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { NotificationsPopover } from "@/components/shell/notifications-popover";

/**
 * The bell opens its window in place (DD-349, owner 2026-10-06) instead of
 * leading to a page. A disclosure: the button says whether its window is open
 * and which it is; Escape closes it and gives the keyboard back to the bell; a
 * press outside closes it, and so does following anything inside it. Another
 * page draws its own shell, so a move to another page starts closed.
 *
 * The unread mark is still the server's answer, handed in as an element; once
 * the learner reads or clears everything in the window, the bell drops it at
 * once instead of waiting for the next page.
 */
export function NotificationsBell({
  presence,
  current,
  placement,
}: {
  presence: ReactNode;
  current: boolean;
  /** The shell draws the bell twice — one per bar — so each window has its own id. */
  placement: "desktop" | "mobile";
}) {
  const [open, setOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const id = `nt-pop-${placement}`;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  return (
    <span className="ntb" ref={wrapRef} data-placement={placement}>
      <button
        ref={buttonRef}
        type="button"
        className="iconbtn"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {/* THE NAME IS TEXT (2026-10-04, launch audit), so the unread mark's own
            «, есть непрочитанные» joins it for a screen reader. */}
        <span className="sr-only">Уведомления</span>
        <Icon name="bell" className="h-5 w-5" />
        {quiet ? null : presence}
      </button>
      {open ? <NotificationsPopover id={id} onClose={close} onQuiet={() => setQuiet(true)} /> : null}
    </span>
  );
}
