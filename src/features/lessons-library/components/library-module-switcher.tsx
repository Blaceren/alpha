"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LibraryModuleIndex } from "@/features/lessons-library/components/library-module-index";
import type { LibraryModuleRow } from "@/features/lessons-library/model/lessons-library-model";

/**
 * Mobile module switcher (the ONE element carried over from Concept A, DD-261).
 *
 * Mobile does not get the desktop index shrunk down: it gets a one-line stepper
 * (‹ «Модуль 04 из 20» ›) plus a disclosure to the full contents. The desktop
 * index column is CSS-hidden below 900px, and `display: none` removes it from the
 * tab order and the accessibility tree — so the two never offer duplicate
 * focusable controls at the same viewport.
 *
 * The sheet is a real dialog built from primitives (no new dependency):
 * `role="dialog"` + `aria-modal`, Escape closes, focus moves in and returns to
 * the trigger, background scroll is locked while open, and the list is only
 * mounted while open.
 */
export function LibraryModuleSwitcher({
  modules,
  selectedIndex,
  totalModules,
}: {
  modules: LibraryModuleRow[];
  selectedIndex: number;
  totalModules: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const selected = modules.find((m) => m.index === selectedIndex);
  const prev = modules.find((m) => m.index === selectedIndex - 1);
  const next = modules.find((m) => m.index === selectedIndex + 1);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes; focus is returned to the trigger by the effect below.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Background must not scroll under an open sheet; the previous value is
  // restored rather than assumed, so we never clobber another owner of it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the sheet on open, and back to the trigger on close.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      sheetRef.current?.focus();
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  return (
    <div className="lib-switch">
      <div className="lib-step">
        {prev ? (
          <Link className="lib-step-arrow" href={prev.href} aria-label={`Предыдущий модуль — ${prev.title}`}>
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        ) : (
          <span className="lib-step-arrow is-off" aria-hidden="true">
            <svg className="ic" viewBox="0 0 24 24">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </span>
        )}

        <button
          type="button"
          className="lib-step-now"
          ref={triggerRef}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="lib-step-k mono">
            Модуль {String(selectedIndex).padStart(2, "0")} из {totalModules}
          </span>
          <span className="lib-step-t">
            {selected?.title}
            <svg className="ic lib-step-chev" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
          <span className="sr-only">Открыть список всех модулей</span>
        </button>

        {next ? (
          <Link className="lib-step-arrow" href={next.href} aria-label={`Следующий модуль — ${next.title}`}>
            <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        ) : (
          <span className="lib-step-arrow is-off" aria-hidden="true">
            <svg className="ic" viewBox="0 0 24 24">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </span>
        )}
      </div>

      {open && (
        <div className="lib-sheet-root">
          {/* The scrim is a real button so a pointer dismiss is also a keyboard
              dismiss target, not a click handler on a div. */}
          <button type="button" className="lib-scrim" onClick={close} tabIndex={-1} aria-hidden="true" />
          <div
            className="lib-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lib-sheet-h"
            ref={sheetRef}
            tabIndex={-1}
          >
            <div className="lib-sheet-head">
              <h2 className="lib-sheet-h" id="lib-sheet-h">
                Содержание программы
              </h2>
              <button type="button" className="lib-sheet-x" onClick={close}>
                Закрыть
              </button>
            </div>
            <div className="lib-sheet-body">
              <LibraryModuleIndex modules={modules} idPrefix="sheet" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
