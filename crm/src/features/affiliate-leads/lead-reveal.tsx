"use client";

/**
 * AFD-5C2 — the explicit, confirmed, audited single-lead PII reveal.
 *
 * THE LIFECYCLE, WHICH IS THE WHOLE POINT OF THIS FILE. The revealed identity
 * lives in ONE `React.useState` inside this component and nowhere else:
 *
 *   • it is never written to the URL — `leads-url-state.ts` has no key for it,
 *     and `serializeLeadsUrlState` writes only from its own closed list;
 *   • it is never written to `localStorage`, `sessionStorage` or IndexedDB —
 *     there is no storage call in this feature at all;
 *   • it is never put in a shared cache — `useLeadResource` is not used for the
 *     reveal, precisely because a keyed cache is a thing that survives remounts;
 *   • it is never placed in a `data-` attribute, a hidden input, a `title` or a
 *     telemetry event.
 *
 * It is therefore erased by construction on every path §30 lists: closing the
 * panel (`setRevealed(null)`), changing lead (the effect below, keyed on
 * `leadId`), changing route or logging out (unmount), and reloading (component
 * state does not survive a reload). None of those need a cleanup routine to
 * remember to run — the data has no home outside this component's memory.
 *
 * THE ACTION IS EXPLICIT AND CONFIRMED. `revealLeadPii` is called from exactly
 * one place: the confirm handler of a dialog the operator opened. It is not in
 * an effect, not on hover, not on focus, not on route open, not on a timer and
 * not behind a prefetch. Cancelling issues no request at all.
 *
 * THE PERMISSION IS THE BACKEND'S. `canRevealPii` from the response decides
 * whether the control is RENDERED — an honesty measure, so an analyst is not
 * offered a button that would 403. It is not the access control: the reveal
 * route re-checks `reveal_pii` from the session and refuses regardless of what
 * was drawn here.
 */
import * as React from "react";
import { revealLeadPii, type LeadOutcome } from "@/application/api/affiliate-leads-client";
import type { RevealedLeadIdentity } from "@/data/contracts/api/affiliate-leads";
import { ErrorBlock } from "./lead-primitives";
import {
  describeLeadFailure,
  failureRequestId,
  REVEAL_ACTION_LABEL,
  REVEAL_AUDIT_ACK,
  REVEAL_CONFIRM_CANCEL,
  REVEAL_CONFIRM_POINTS,
  REVEAL_CONFIRM_SUBMIT,
  REVEAL_CONFIRM_TITLE,
  REVEAL_EMAIL_LABEL,
  REVEAL_EPHEMERAL_NOTE,
  REVEAL_HIDE_LABEL,
  REVEAL_LOADING,
  REVEAL_NAME_ABSENT,
  REVEAL_NAME_LABEL,
  REVEAL_PANEL_TITLE,
  REVEAL_UNAVAILABLE_NOTE,
} from "./leads-labels";

/* -------------------------------------------------------------- the dialog */

/**
 * The confirmation.
 *
 * A REAL MODAL DIALOG, focus-managed by hand rather than by a dependency: focus
 * moves into it on open, Tab is trapped inside it while it is open, Escape
 * closes it, and focus RETURNS to the button that opened it on close. A
 * confirmation an operator can tab out of without noticing is a confirmation
 * that gets dismissed by accident.
 *
 * THE COPY IS FACTUAL, NOT FEARFUL. Three statements: one lead, it is audited,
 * do not carry the result into external tools without an authorised purpose.
 * Fear-based wording trains people to click through the dialog, and this one
 * needs to be read.
 */
function RevealConfirmDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button");
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      // `fixed inset-0` + `overflow-y-auto` + `items-start`: at 320px with a 2x
      // root font the dialog is taller than the viewport, and centring it would
      // put the confirm button off-screen with no way to scroll to it.
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-reveal-dialog-title"
        aria-describedby="lead-reveal-dialog-body"
        className="my-6 w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-lg"
      >
        <h2
          id="lead-reveal-dialog-title"
          className="break-words text-base font-semibold text-text-primary"
        >
          {REVEAL_CONFIRM_TITLE}
        </h2>

        <ul id="lead-reveal-dialog-body" className="mt-3 space-y-1.5">
          {REVEAL_CONFIRM_POINTS.map((point) => (
            <li key={point} className="break-words text-sm leading-relaxed text-text-secondary">
              {point}
            </li>
          ))}
        </ul>

        <p className="mt-3 break-words text-xs leading-relaxed text-text-muted">
          {REVEAL_EPHEMERAL_NOTE}
        </p>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* Cancel issues NO request. Nothing is prefetched, nothing is warmed
              and no audit row is written by opening this dialog. */}
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[2.25rem] rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {REVEAL_CONFIRM_CANCEL}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="min-h-[2.25rem] rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {REVEAL_CONFIRM_SUBMIT}
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the panel */

/**
 * The revealed identity.
 *
 * ONLY THE TWO BACKEND-APPROVED FIELDS. The response type has an address and a
 * display name and nothing else; there is no phone, no IP, no User-Agent, no
 * Pocket identifier, no click id and no balance to render, because none of them
 * exist in `RevealedLeadIdentity`. Nothing is inferred or supplemented.
 *
 * NO COPY-ALL BUTTON AND NO EXPORT. An operator can select the text they need;
 * a one-click "скопировать всё" is the affordance that turns an audited
 * single-lead read into a spreadsheet.
 */
function RevealedPanel({
  identity,
  revealedAt,
  onHide,
}: {
  identity: RevealedLeadIdentity;
  revealedAt: string;
  onHide: () => void;
}) {
  return (
    <section
      aria-labelledby="lead-reveal-panel-title"
      className="rounded-md border-2 border-accent/50 bg-accent/5 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3
          id="lead-reveal-panel-title"
          className="text-sm font-semibold text-text-primary"
        >
          {REVEAL_PANEL_TITLE}
        </h3>
        <button
          type="button"
          onClick={onHide}
          className="min-h-[2.25rem] shrink-0 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-text-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {REVEAL_HIDE_LABEL}
        </button>
      </div>

      {/* `aria-live="polite"` on the region, so the values are announced when
          they appear rather than silently replacing a masked address. */}
      <dl aria-live="polite" className="mt-2 space-y-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-text-secondary">{REVEAL_EMAIL_LABEL}</dt>
          <dd className="break-all text-sm text-text-primary">{identity.email}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-text-secondary">{REVEAL_NAME_LABEL}</dt>
          <dd className="break-words text-sm text-text-primary">
            {identity.displayName ?? REVEAL_NAME_ABSENT}
          </dd>
        </div>
      </dl>

      <p role="status" className="mt-2 break-words text-[11px] leading-snug text-text-secondary">
        {REVEAL_AUDIT_ACK} <time dateTime={revealedAt}>{revealedAt}</time>
      </p>
      <p className="mt-1 break-words text-[11px] leading-snug text-text-muted">
        {REVEAL_EPHEMERAL_NOTE}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------- the control */

type RevealState =
  | { phase: "idle" }
  | { phase: "confirming" }
  | { phase: "loading" }
  | { phase: "revealed"; identity: RevealedLeadIdentity; revealedAt: string }
  | { phase: "failed"; outcome: LeadOutcome<unknown> };

export function LeadPiiReveal({
  leadId,
  canRevealPii,
  /** Injection seam for tests; production always uses the real client. */
  reveal = revealLeadPii,
}: {
  leadId: string;
  canRevealPii: boolean;
  reveal?: typeof revealLeadPii;
}) {
  const [state, setState] = React.useState<RevealState>({ phase: "idle" });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  // Guards a double submit: a second click while the first request is in flight
  // must not mint a second audit row for one operator intent.
  const inFlight = React.useRef(false);

  /**
   * CHANGING LEAD ERASES THE REVEAL.
   *
   * Keyed on `leadId` and running on every change of it, so navigating from one
   * lead to another inside the same mounted panel cannot carry a previous
   * learner's address onto a different learner's card. It also resets the error
   * and confirmation phases, so no dialog outlives the lead it was opened for.
   */
  React.useEffect(() => {
    setState({ phase: "idle" });
    inFlight.current = false;
  }, [leadId]);

  const close = React.useCallback(() => {
    setState({ phase: "idle" });
    // Focus returns to the control that opened the dialog. Without this a
    // keyboard user is dropped at the top of the document.
    triggerRef.current?.focus();
  }, []);

  const confirm = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ phase: "loading" });

    const outcome = await reveal(leadId);
    inFlight.current = false;

    if (outcome.status === "success") {
      setState({
        phase: "revealed",
        identity: outcome.data.identity,
        revealedAt: outcome.data.revealedAt,
      });
      return;
    }
    // NO RETRY LOOP. A failure is reported once and the operator decides whether
    // to ask again — an automatic retry would write a second audit row for a
    // reveal nobody requested twice.
    setState({ phase: "failed", outcome });
  }, [leadId, reveal]);

  // An operator without the permission is told why, and is offered nothing that
  // would 403. The absence of the button is honesty, not the access control.
  if (!canRevealPii) {
    return (
      <p className="break-words text-xs leading-relaxed text-text-muted">
        {REVEAL_UNAVAILABLE_NOTE}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {state.phase === "revealed" ? (
        <RevealedPanel
          identity={state.identity}
          revealedAt={state.revealedAt}
          onHide={close}
        />
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setState({ phase: "confirming" })}
          disabled={state.phase === "loading"}
          className="min-h-[2.25rem] rounded-md border border-accent bg-surface px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {REVEAL_ACTION_LABEL}
        </button>
      )}

      {state.phase === "loading" ? (
        <p role="status" aria-live="polite" className="text-xs text-text-secondary">
          {REVEAL_LOADING}
        </p>
      ) : null}

      {state.phase === "failed" ? (
        <ErrorBlock
          message={describeLeadFailure(state.outcome)}
          requestId={failureRequestId(state.outcome)}
          onRetry={() => setState({ phase: "confirming" })}
          retryLabel="Попробовать ещё раз"
        />
      ) : null}

      {state.phase === "confirming" ? (
        <RevealConfirmDialog onConfirm={() => void confirm()} onCancel={close} />
      ) : null}
    </div>
  );
}
