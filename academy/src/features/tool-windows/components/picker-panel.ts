"use client";

/**
 * What the tools' two pickers — the date and the time — share: a panel that
 * opens under its field, and grids of cells walked with the arrow keys.
 *
 * THE PANEL IS NOT A MODAL. It opens in place, under the field it belongs to,
 * and the form around it stays reachable: a click or a focus anywhere else
 * closes it, Escape closes it and hands the focus back to where it was opened
 * from. Nothing is trapped, nothing is dimmed.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

export type PickerPanel = {
  open: boolean;
  /** The element that holds the field and its panel: what «outside» is measured against. */
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  panelId: string;
  show: () => void;
  /** Close; with `returnFocusTo`, put the focus back on the control it was opened from. */
  hide: (returnFocusTo?: HTMLElement | null) => void;
};

/** The floating bar of the desktop shell (10px in, 60px tall, 10px of air). */
const TOP_CHROME = 80;
/** What a panel keeps clear of the screen's edge. */
const PANEL_AIR = 16;
/** The gap between a field and its panel (tool-windows.css: `.tp-panel { margin-top }`). */
const PANEL_GAP = 6;

export function usePickerPanel(): PickerPanel {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback((returnFocusTo?: HTMLElement | null) => {
    setOpen(false);
    returnFocusTo?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) setOpen(false);
    };
    // The focus moved to something that is not the field or its panel: the
    // learner has gone on with the form. (A click on the panel's own padding
    // lands on the panel, which is focusable for exactly this reason.)
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !root.contains(next)) setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  // The panel opens upward when the screen has no room for it under the field
  // and has room above (a field near the end of a page cannot be scrolled up
  // far enough to show a panel below it). Otherwise a panel that opened below
  // the fold is brought into view, and only as far as it takes: the field it
  // belongs to stays where the learner left it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!panel) return;
    if (root) {
      const field = root.getBoundingClientRect();
      const height = panel.getBoundingClientRect().height;
      const nav = document.querySelector<HTMLElement>(".bottomnav");
      const navTop = nav && nav.offsetParent !== null ? nav.getBoundingClientRect().top : window.innerHeight;
      const below = Math.min(window.innerHeight, navTop) - field.bottom;
      const above = field.top - TOP_CHROME;
      const up = below < height + PANEL_AIR && above > height + PANEL_AIR;
      panel.dataset.side = up ? "up" : "down";
      // The panel's place is under the field; upward it is lifted by its own
      // height, the field's and the gap (CSS reads it as a negative margin).
      panel.style.setProperty("--tp-lift", up ? `${Math.ceil(height + field.height + PANEL_GAP)}px` : "0px");
    }
    panel.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  return { open, rootRef, panelRef, panelId, show, hide };
}

/**
 * Arrow keys inside a grid of cells: one step left or right, one row up or
 * down, Home and End to the ends of the row. Only one cell of a grid is in the
 * tab order (the caller marks it); the arrows move among the rest, so a grid of
 * twenty-four hours is one stop for Tab and not twenty-four.
 *
 * Cells are the grid's `button[data-cell]` elements that are not disabled.
 * Returns true when the key was a move, so a caller can add keys of its own.
 */
export function moveInGrid(event: KeyboardEvent<HTMLElement>, columns: number): boolean {
  const cells = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-cell]:not(:disabled)"));
  const at = cells.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return false;

  let next = at;
  switch (event.key) {
    case "ArrowRight":
      next = at + 1;
      break;
    case "ArrowLeft":
      next = at - 1;
      break;
    case "ArrowDown":
      next = at + columns;
      break;
    case "ArrowUp":
      next = at - columns;
      break;
    case "Home":
      next = at - (at % columns);
      break;
    case "End":
      next = Math.min(cells.length - 1, at - (at % columns) + columns - 1);
      break;
    default:
      return false;
  }
  event.preventDefault();
  if (next >= 0 && next < cells.length) cells[next]?.focus();
  return true;
}
