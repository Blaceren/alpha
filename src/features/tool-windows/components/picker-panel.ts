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

  // A panel that opened below the fold is brought into view, and only as far
  // as it takes: the field it belongs to stays where the learner left it.
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView?.({ block: "nearest" });
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
