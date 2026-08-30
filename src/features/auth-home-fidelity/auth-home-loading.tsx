"use client";

import { useEffect, useState } from "react";
import {
  LONG_WAIT_MS,
  PENDING_INITIAL,
  PENDING_LONG_WAIT,
  POSTURE_LABEL,
} from "@/features/auth-home-fidelity/auth-home-state";
import "@/features/auth-home-fidelity/auth-home-fidelity.css";

/**
 * 11 — LOADING PRESENCE. Honest busy semantics, and no answer pretending to be
 * one.
 *
 * LOADING IS NOT A FOCUS POSTURE. There is no truth yet, so the consequence slot
 * is ABSENT rather than skeletoned, and the heading falls back to the surface's
 * own name — which is what keeps "exactly one h1 per state" true without putting
 * a focus-shaped placeholder where the answer will go.
 *
 * THE LIVE REGION SHIPS POPULATED. `.home-pending` already carries its text when
 * the page arrives, so the initial load performs no announcement of its own. The
 * long-wait line then replaces that text IN PLACE, which is the one polite
 * announcement this surface is allowed to make.
 *
 * NOTHING MOVES. No spinner, no skeleton, no progress bar, no changing geometry
 * — which is exactly why the acknowledgement has to arrive early rather than
 * late. See LONG_WAIT_MS.
 */
export function AuthHomeLoadingField() {
  const [pending, setPending] = useState(PENDING_INITIAL);

  useEffect(() => {
    /* The long wait may change the copy ONCE. */
    const timer = setTimeout(() => setPending(PENDING_LONG_WAIT), LONG_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="ahm">
      <div className="home-field" data-posture="LOADING" data-state="LOADING_INITIAL" aria-busy="true">
        <div className="home-field__inner">
          <div className="home-rail">
            <h1 className="home-identity">
              Главная<span className="home-identity__role">текущий приоритет</span>
            </h1>
            <p className="home-posture">{POSTURE_LABEL.LOADING}</p>
          </div>
          <div className="home-truth">
            <p className="home-pending" role="status" aria-live="polite">
              {pending}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
