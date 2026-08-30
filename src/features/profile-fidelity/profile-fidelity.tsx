"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveProfileName } from "@/lib/profile/profile-client";
import {
  COPY,
  FOCUS_AFTER,
  NAME_MAX,
  NAME_MIN,
  cancel as cancelEdit,
  editDraft,
  initial,
  isDirty,
  isEditing,
  openEdit,
  save as saveTransition,
  saveConfirmed,
  saveFailed,
  type FocusRole,
  type ProfileState,
} from "@/features/profile-fidelity/profile-state";
import "@/features/profile-fidelity/profile-fidelity.css";

/**
 * PROFILE — the frozen surface, on the real account.
 *
 * VISUAL AUTHORITY: ProfileATA @ df540ad3aa3fbf212499e931473fa1a9579a15d3 —
 * the four frozen design-system layers and the Phase-4 page composition. Six
 * component contracts, still six: PROFILE SURFACE · COORDINATE · CONTROL LOCUS
 * · ACTION GROUP · LOCAL FEEDBACK · SUPPORT HANDOFF.
 *
 * DATA AUTHORITY: the product. The identity is the real session viewer, and
 * saving is a real bounded write to the Backend the deployed artifact already
 * exposes — `PATCH /api/me`, whose schema is where the 2-to-50 constraint on
 * this page comes from. No fixture name, no simulated server, no timer.
 *
 * THE PROTOTYPE SIMULATED ITS SERVER; THIS DOES NOT. `resolve(outcome)` in the
 * frozen page is a harness handle, and its own comment says so: "DESIGN-BEHAVIOUR
 * SIMULATION — NOT BACKEND PROOF". Here the same two outcomes arrive from an
 * actual request, and the rules around them are unchanged — the draft survives a
 * failure, the identity never moves until the server confirms, and the value
 * that becomes canonical is the one the SERVER returned.
 *
 * THE PAGE IS STILL NARROW. One editable field. No email, no password, no
 * Pocket balance, no affiliate identity, no staff data — and the proxy behind
 * the save constructs its own body, so the adjacent Backend fields are not
 * merely unused, they are unreachable from the browser.
 */
export function ProfileFidelity({ canonical }: { canonical: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<ProfileState>(() => initial(canonical));
  /* The pending focus destination is a REF, not state: it is an instruction to
     the DOM, not something the page renders, and holding it in state would mean
     a second render and a setState inside the effect that consumes it. Every
     handoff in the focus contract accompanies a mode change, so the effect
     keyed on the mode is exactly when it should run. */
  const pendingFocus = useRef<FocusRole | null>(null);
  const caretToEnd = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* WARN ONCE WHILE DIRTY, never permanently blocked. The smallest
     platform-correct mechanism is the browser's own prompt: the page has no
     business styling a navigation decision that belongs to the browser, and a
     branded modal here would be inventing one. */
  const dirty = isDirty(state);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* Focus lands where the frozen contract says, after the DOM has caught up —
     never on a control that has just been removed, never dropped to body. */
  useEffect(() => {
    const role = pendingFocus.current;
    if (!role) return;
    pendingFocus.current = null;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-role="${role}"]`);
    if (!el) return;
    el.focus();
    if (caretToEnd.current && el instanceof HTMLInputElement) {
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollLeft = el.scrollWidth;
    }
    caretToEnd.current = false;
  }, [state.mode]);

  const submit = useCallback(async (name: string) => {
    const result = await saveProfileName(name);
    setState((current) => {
      if (current.mode !== "SUBMITTING") return current;
      return result.ok ? saveConfirmed(current, result.name) : saveFailed(current);
    });
    caretToEnd.current = !result.ok;
    pendingFocus.current = result.ok ? FOCUS_AFTER.CONFIRMED_SAVE : FOCUS_AFTER.MUTATION_FAIL;
  }, []);

  const onSave = useCallback(() => {
    const outcome = saveTransition(state);
    setState(outcome.next);
    if (!outcome.submit) {
      if (outcome.next.mode === "INVALID") pendingFocus.current = FOCUS_AFTER.VALIDATION_FAIL;
      return;
    }
    void submit(outcome.name);
  }, [state, submit]);

  const editing = isEditing(state.mode);
  const busy = state.mode === "SUBMITTING";
  const invalid = state.mode === "INVALID";
  const failed = state.mode === "FAILED";

  if (state.mode === "PAGEFAIL") {
    return (
      <div className="pf" ref={rootRef}>
        <div className="p-profile" data-mode="PAGEFAIL">
          <h1 className="p-coord p-coord--page" data-role="page-title">
            {COPY.page_title}
          </h1>
          <StatusRegion text={null} />
          <div className="p-pagefail" data-role="page-failure" role="alert">
            <p className="p-pagefail__lead">{COPY.page_failed_lead}</p>
            <p>{COPY.page_failed_support}</p>
            <div className="p-actions">
              <button
                type="button"
                className="p-save"
                data-role="page-retry"
                onClick={() => router.refresh()}
              >
                {COPY.page_failed_retry}
              </button>
            </div>
          </div>
          <SupportHandoff />
        </div>
      </div>
    );
  }

  return (
    <div className="pf" ref={rootRef}>
      <div className="p-profile" data-mode={state.mode}>
        {/* EXACTLY ONE h1 PER STATE. In read the page's subject IS the identity,
            so the name is the h1. Once the name is a field value it can no
            longer be the heading, so the page coordinate takes it back. */}
        {editing ? (
          <h1 className="p-coord p-coord--page" data-role="page-title">
            {COPY.page_title}
          </h1>
        ) : (
          <p className="p-coord p-coord--page" data-role="page-title">
            {COPY.page_title}
          </p>
        )}

        <StatusRegion text={state.announce} />

        {editing ? (
          <label className="p-coord p-coord--field" htmlFor="p-name" data-role="identity-label">
            {COPY.identity_label}
          </label>
        ) : null}

        {/* THE CONTROL LOCUS — the same element, the same measure, the same
            place. `data-open` is the only structural difference between read and
            edit, and SUBMITTING is the edit locus with the value held still. */}
        {editing ? (
          <div className="p-locus" data-role="control-locus" data-open="1">
            <input
              id="p-name"
              className="p-name-control"
              type="text"
              value={state.draft ?? ""}
              data-role="name-control"
              minLength={NAME_MIN}
              maxLength={NAME_MAX}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={invalid ? "p-constraint p-field-error" : "p-constraint"}
              {...(invalid ? { "aria-invalid": true as const } : {})}
              readOnly={busy}
              onChange={(event) => setState((s) => editDraft(s, event.target.value))}
            />
          </div>
        ) : (
          <div className="p-locus" data-role="control-locus" data-open="0">
            <h1 className="p-identity" data-role="identity">
              {state.canonical}
            </h1>
            <button
              type="button"
              className="p-edit"
              data-role="edit-affordance"
              onClick={() => {
                caretToEnd.current = true;
                pendingFocus.current = FOCUS_AFTER.EDIT_OPENED;
                setState(openEdit);
              }}
            >
              {COPY.edit}
            </button>
          </div>
        )}

        {editing ? (
          <div className="p-meta">
            <p className="p-constraint" id="p-constraint">
              {COPY.constraint}
            </p>
            <div className="p-actions">
              <button
                type="button"
                className="p-save"
                data-role="save"
                onClick={onSave}
                {...(busy ? { "aria-busy": true as const, disabled: true } : {})}
              >
                {busy ? COPY.saving : COPY.save}
              </button>
              <button
                type="button"
                className="p-cancel"
                data-role="cancel"
                onClick={() => {
                  pendingFocus.current = FOCUS_AFTER.CANCELLED;
                  setState(cancelEdit);
                }}
              >
                {COPY.cancel}
              </button>
            </div>
          </div>
        ) : null}

        {/* VALIDATION — bound to the field, announced with the field. Never a
            page alert, never a card, never a banner. */}
        {invalid && state.error ? (
          <p className="p-feedback p-feedback--field" id="p-field-error" data-role="field-error" role="alert">
            {COPY[state.error]}
          </p>
        ) : null}

        {/* MUTATION FAILURE — bound to the attempt. It states what happened and
            it stops. No separate retry control: Save above IS the retry. */}
        {failed ? (
          <div className="p-feedback p-feedback--mutation" data-role="mutation-failure" role="alert">
            <p>{COPY.mutation_failed}</p>
          </div>
        ) : null}

        <p className="p-consequence" data-role="consequence">
          {COPY.consequence}
        </p>
        <SupportHandoff />
      </div>
    </div>
  );
}

/**
 * The live region lives OUTSIDE every state branch, so it is never unmounted and
 * re-mounted — a live region inserted at the moment it receives text is
 * unreliable in real assistive technology. It is visually hidden and adds zero
 * pixels.
 */
function StatusRegion({ text }: { text: string | null }) {
  return (
    <p
      className="p4-status"
      data-role="save-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-visually-hidden="true"
    >
      {text ?? ""}
    </p>
  );
}

function SupportHandoff() {
  return (
    <p className="p-support" data-role="support">
      {COPY.support_lead}{" "}
      <Link href="/support" data-role="support-link">
        {COPY.support_link}
      </Link>
    </p>
  );
}
