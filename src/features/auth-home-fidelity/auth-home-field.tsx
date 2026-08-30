import type { HomeField } from "@/features/auth-home-fidelity/auth-home-state";
import Link from "next/link";
import {
  AUTHORITY_KEY,
  NO_LEARNER_ACTION,
  POSTURE_LABEL,
  RETRY_LABEL,
} from "@/features/auth-home-fidelity/auth-home-state";
import { HomeRetry } from "@/features/auth-home-fidelity/auth-home-retry";
import "@/features/auth-home-fidelity/auth-home-fidelity.css";

/**
 * AUTHENTICATED HOME — the current-priority field.
 *
 * VISUAL AUTHORITY: HomeAuthATA @ a6bfdf5ecc2f361ca36b3eca192890b39afdba30 —
 * the frozen Phase-3 token, type and layout layers, and the Phase-4 page
 * composition. Eleven component contracts, and this renders the same eleven:
 * the same tags, the same classes, the same attributes.
 *
 * THE ONE STRUCTURAL RULE THAT DIFFERS BY POSTURE. In ACTION / WAIT / NONE /
 * UNKNOWN the page's heading IS the current consequence — the page is about
 * that truth. In LOADING there is no truth yet, so the heading falls back to the
 * surface's own name and the consequence slot is ABSENT, not skeletoned. That
 * keeps exactly one h1 per state without ever putting a focus-shaped
 * placeholder where the answer will go.
 *
 * WHAT THE SURFACE NEVER CONTAINS. No greeting, no learner name, no avatar, no
 * progress percentage, no programme position, no streak, no XP, no rank, no
 * financial value — none of which is a stylistic preference. Home's whole job
 * is to carry ONE current priority, and every one of those competes with it.
 *
 * WHAT DID NOT CROSS OVER. The prototype's `interaction.js` simulates a read
 * with a timer and swaps the field in place. In the product the read is real
 * and the field is server-rendered: LOADING is the route's own suspense
 * fallback, and retrying is a router refresh. The one behaviour that survives
 * is the one that is about the learner rather than the simulation — the retry
 * removes itself, and focus is placed on the field, which is the only element
 * that survives the change.
 */
export function AuthHomeField({ field }: { field: HomeField }) {
  const posture = field.posture;
  return (
    <div className="ahm">
      <div className="home-field" data-posture={posture} data-state={field.stateKey}>
        <div className="home-field__inner">
          {/* 1 — SURFACE IDENTITY. The surface names itself. It is a <p> here
              because the consequence below is the page's h1. */}
          <div className="home-rail">
            <p className="home-identity">
              Главная<span className="home-identity__role">текущий приоритет</span>
            </p>
            {/* 2 — POSTURE LABEL. */}
            <p className="home-posture">{POSTURE_LABEL[posture]}</p>
          </div>

          <div className="home-truth">
            {/* 3 — WORK IDENTITY. Present only where naming the work is what
                makes the consequence intelligible. Never a persistent header. */}
            {"workIdentity" in field && field.workIdentity ? (
              <p className="home-subject">{field.workIdentity}</p>
            ) : null}

            {/* 4 + 5 — CURRENT CONSEQUENCE and its closing boundary. The
                boundary is part of the consequence's own expression: no
                assertion, no boundary. */}
            <h1 className="home-consequence">{field.consequence}</h1>

            {/* 6 — MINIMUM CAUSAL BASIS. */}
            {field.basis ? <p className="home-basis">{field.basis}</p> : null}

            <ResolutionCondition field={field} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 7 — RESOLUTION CONDITION. One job, four expressions.
 *
 * WAIT and NONE receive no control at all — not a disabled one, not a quiet
 * one. In both, the resolution condition is carried entirely by the causal
 * basis, and rendering an inert control would say the learner could do
 * something about it.
 */
function ResolutionCondition({ field }: { field: HomeField }) {
  if (field.posture === "ACTION") {
    /* 8 — PRIMARY WORKSPACE HANDOFF. At most one, and the only Signal on the
       page. `data-level` is the ONLY thing that crosses the handoff. */
    return (
      <div className="home-resolution" data-resolution="handoff">
        <Link
          className="home-handoff"
          href={field.control.href}
          {...(field.control.levelCode ? { "data-level": field.control.levelCode } : {})}
        >
          {field.control.label}
        </Link>
      </div>
    );
  }

  if (field.posture === "WAIT") {
    /* 9 — HOLDING AUTHORITY. A role or a system, never a person, never a link. */
    return (
      <div className="home-resolution" data-resolution="authority">
        <p className="home-authority">
          <span className="home-authority__key">{AUTHORITY_KEY}</span>
          <span className="home-authority__value">{field.authority}</span>
        </p>
        <p className="home-noaction">{NO_LEARNER_ACTION}</p>
      </div>
    );
  }

  if (field.posture === "UNKNOWN" && field.retry) {
    /* 10 — QUIET RETRY. Only where the failure is source-classified
       recoverable. Subordinate to the consequence, and never Signal. */
    return (
      <div className="home-resolution" data-resolution="retry">
        <HomeRetry label={RETRY_LABEL} />
      </div>
    );
  }

  /* NONE, and the UNKNOWN rows where a retry would be a lie. */
  return null;
}
