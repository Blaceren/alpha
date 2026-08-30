"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * The quiet retry.
 *
 * IT REMOVES ITSELF WHEN PRESSED. A control that lingers during its own loading
 * is a stale control — it invites a second press against a read that is already
 * running, and it says the learner still has something to do while the page is
 * already doing it.
 *
 * FOCUS GOES TO THE FIELD, NOT TO A HEADING. Neither h1 survives the change: in
 * LOADING the heading is the surface identity, and in a resolved posture it is
 * the current consequence, so anchoring focus to "the heading" means moving
 * focus twice and announcing twice. `main.home-field` survives every re-render,
 * so focus moves there exactly once and is never left on a removed node.
 *
 * `tabindex="-1"` is set here rather than by the renderer, so the field's
 * rendered markup stays identical to the frozen component contract.
 */
export function HomeRetry({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState(false);

  if (pressed || pending) return null;

  return (
    <button
      type="button"
      className="home-retry"
      onClick={(event) => {
        const field = event.currentTarget.closest<HTMLElement>(".home-field");
        setPressed(true);
        if (field) {
          field.setAttribute("tabindex", "-1");
          field.focus({ preventScroll: true });
        }
        startTransition(() => router.refresh());
      }}
    >
      {label}
    </button>
  );
}
