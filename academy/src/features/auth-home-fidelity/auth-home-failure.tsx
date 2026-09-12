"use client";

import { PAGE_FAILURE } from "@/features/auth-home-fidelity/auth-home-state";
import "@/features/auth-home-fidelity/auth-home-fidelity.css";

/**
 * PAGE_FAILURE — the route-level boundary.
 *
 * PAGE_FAILURE IS NOT UNKNOWN. UNKNOWN is Home speaking and declining to guess.
 * PAGE_FAILURE is Home never having spoken: the surface could not be produced at
 * all. The authenticated shell stays, because the session is valid and the
 * learner's other routes are intact.
 *
 * WHAT THIS MAY NOT CONTAIN, AND DOES NOT: a posture label, a current-priority
 * consequence, work identity, Signal, a stale action, an `alert` role, danger
 * colour, an error card, an admin-console treatment, a technical diagnosis, or
 * any login / re-authentication / recovery interface.
 *
 * WHAT IT CONTAINS: one page heading, one human explanation, one truthful
 * neutral retry — truthful because the route layer really can re-attempt
 * producing the page — and one optional subordinate reference code, rendered
 * only when a request id genuinely exists.
 *
 * Its urgency comes from interaction semantics, not visual drama: a control the
 * learner can press, at the same neutral weight as every other neutral control.
 */
export function AuthHomeFailure({ reset, requestId }: { reset: () => void; requestId?: string }) {
  return (
    <div className="ahm">
      <div className="route-failure" data-boundary="PAGE_FAILURE">
        <div className="route-failure__inner">
          <h1 className="route-failure__heading">{PAGE_FAILURE.heading}</h1>
          <p className="route-failure__explanation">{PAGE_FAILURE.explanation}</p>
          <div className="route-failure__resolution">
            <button type="button" className="route-failure__retry" onClick={reset}>
              {PAGE_FAILURE.retry}
            </button>
          </div>
          {requestId ? (
            <p className="route-failure__reference">
              {PAGE_FAILURE.referenceLabel}: {requestId}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
