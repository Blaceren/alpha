"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { changeProfilePassword, saveProfileName } from "@/lib/profile/profile-client";
import {
  COPY,
  FOCUS_AFTER,
  NAME_MAX,
  NAME_MIN,
  PASSWORD_MIN,
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
 * PROFILE — account data and sign-in security, on the real account.
 *
 * WHAT CHANGED, AND WHY. The page used to be one editable field with the
 * learner's name as its h1, so the heading moved every time the field opened:
 * in read mode the subject was the identity, in edit mode it was the word
 * «Профиль». A heading that changes as a side effect of opening a form is a
 * heading a screen-reader user cannot navigate by, so the page coordinate is
 * now permanent and the identity is a value inside a row.
 *
 * TWO AREAS, NOT A DASHBOARD. Account data and security. No cards, no tiles, no
 * decorative summary of things the page cannot change.
 *
 * ONE EDITOR AT A TIME, and the page enforces it rather than hoping. Two open
 * forms means two drafts and two ways to lose one; `editor` is a single value,
 * so opening either closes the question.
 *
 * ONE SUPPORT PATH, AND IT BELONGS TO EMAIL. The page used to end with
 * «Остальные данные учётной записи меняются через поддержку», which was true
 * when the password was one of those data. It is not any more — the password is
 * changed here, in the section above — so the sentence would have started
 * pointing people at support for something this page now does. The only thing
 * still handed off is the email address, so the only handoff left is in that
 * row, next to the thing it is about.
 *
 * EMAIL IS NAMED BUT NOT SHOWN. `AcademyViewer` carries id, name, role and
 * status — deliberately not the address — and this phase does not widen it. The
 * row states where an email change happens instead of printing a value the page
 * has no right to fetch. Nothing here promises a date for self-service, and
 * nothing here touches `pendingEmail`: that flow has no mail transport behind it
 * and is a separate, blocked phase.
 *
 * PASSWORDS EXIST ONLY IN THE FIELDS AND THE REQUEST. They are never placed in
 * state that outlives the submit, never logged, never carried in an error, and
 * cleared on success.
 */

type Editor = "none" | "name" | "password";

type PasswordPhase = "idle" | "submitting" | "wrong-current" | "invalid" | "failed" | "done";

export function ProfileFidelity({ canonical }: { canonical: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<ProfileState>(() => initial(canonical));
  const [editor, setEditor] = useState<Editor>("none");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phase, setPhase] = useState<PasswordPhase>("idle");

  /* A DOM instruction, not rendered state. The name machine names its own
     destinations in FOCUS_AFTER; the password form names its fields directly,
     because a shared enum would have to invent a meaning for each in the
     other's vocabulary. */
  const pendingFocus = useRef<FocusRole | string | null>(null);
  const caretToEnd = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

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
  }, [state.mode, editor, phase]);

  const submit = useCallback(async (name: string) => {
    const result = await saveProfileName(name);
    setState((current) => {
      if (current.mode !== "SUBMITTING") return current;
      return result.ok ? saveConfirmed(current, result.name) : saveFailed(current);
    });
    if (result.ok) setEditor("none");
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

  /** Every exit from the password form goes through here, so no value survives it. */
  const clearPassword = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, []);

  const onChangePassword = useCallback(async () => {
    if (phase === "submitting") return;
    if (newPassword.length < PASSWORD_MIN || newPassword !== confirmPassword) {
      setPhase("invalid");
      pendingFocus.current = "new-password";
      return;
    }
    setPhase("submitting");
    const result = await changeProfilePassword(currentPassword, newPassword);
    if (result.ok) {
      clearPassword();
      setPhase("done");
      setEditor("none");
      pendingFocus.current = "password-affordance";
      return;
    }
    /* A refusal keeps the form open and keeps what was typed EXCEPT nothing:
       the current password is the field that was wrong, and the two new-password
       fields are still the person's intent. Only the outcome changes. */
    setPhase(result.wrongCurrent ? "wrong-current" : "failed");
    pendingFocus.current = "current-password";
  }, [phase, newPassword, confirmPassword, currentPassword, clearPassword]);

  const editingName = isEditing(state.mode) && editor === "name";
  const busy = state.mode === "SUBMITTING";
  const invalid = state.mode === "INVALID";
  const failed = state.mode === "FAILED";
  const pwBusy = phase === "submitting";
  const editingPassword = editor === "password";

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
      <div className="p-profile" data-mode={state.mode} data-editor={editor}>
        {/* PERMANENT. The page coordinate does not move when a form opens. */}
        <h1 className="p-coord p-coord--page" data-role="page-title">
          {COPY.page_title}
        </h1>
        <p className="p-lead" data-role="page-lead">
          {COPY.page_lead}
        </p>

        <StatusRegion text={state.announce} />

        {/* ------------------------------------------------ account data -- */}
        <section className="p-section" aria-labelledby="p-section-account">
          <h2 className="p-section__title" id="p-section-account">
            {COPY.section_account}
          </h2>

          {editingName ? (
            <div className="p-row p-row--open" data-role="name-editor">
              <label className="p-coord p-coord--field" htmlFor="p-name" data-role="identity-label">
                {COPY.identity_label}
              </label>
              <div className="p-locus" data-role="control-locus" data-open="1">
                <input
                  id="p-name"
                  className="p-name-control"
                  type="text"
                  value={state.draft ?? ""}
                  data-role="name-control"
                  minLength={NAME_MIN}
                  maxLength={NAME_MAX}
                  autoComplete="nickname"
                  spellCheck={false}
                  aria-describedby={invalid ? "p-constraint p-field-error" : "p-constraint"}
                  {...(invalid ? { "aria-invalid": true as const } : {})}
                  readOnly={busy}
                  onChange={(event) => setState((s) => editDraft(s, event.target.value))}
                />
              </div>
              <p className="p-constraint" id="p-constraint">
                {COPY.constraint}
              </p>
              {invalid && state.error ? (
                <p className="p-feedback p-feedback--field" id="p-field-error" data-role="field-error" role="alert">
                  {COPY[state.error]}
                </p>
              ) : null}
              {failed ? (
                <div className="p-feedback p-feedback--mutation" data-role="mutation-failure" role="alert">
                  <p>{COPY.mutation_failed}</p>
                </div>
              ) : null}
              <div className="p-actions">
                <button
                  type="button"
                  className="p-save"
                  data-role="save"
                  onClick={onSave}
                  {...(busy ? { "aria-busy": true as const, disabled: true } : {})}
                >
                  {busy ? COPY.saving : COPY.save_name}
                </button>
                <button
                  type="button"
                  className="p-cancel"
                  data-role="cancel"
                  onClick={() => {
                    pendingFocus.current = FOCUS_AFTER.CANCELLED;
                    setState(cancelEdit);
                    setEditor("none");
                  }}
                >
                  {COPY.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-row" data-role="name-row">
              <span className="p-row__label">{COPY.identity_label}</span>
              <span className="p-row__value" data-role="identity">
                {state.canonical}
              </span>
              <button
                type="button"
                className="p-edit"
                data-role="edit-affordance"
                disabled={editingPassword}
                onClick={() => {
                  caretToEnd.current = true;
                  pendingFocus.current = FOCUS_AFTER.EDIT_OPENED;
                  setEditor("name");
                  setState(openEdit);
                }}
              >
                {COPY.edit}
              </button>
            </div>
          )}

          {/* EMAIL — named, not printed. See the file header. */}
          <div className="p-row" data-role="email-row">
            <span className="p-row__label">{COPY.email_label}</span>
            <span className="p-row__value p-row__value--muted" data-role="email-note">
              {COPY.email_via_support}
            </span>
            <Link className="p-edit p-edit--link" href="/support" data-role="email-support-link">
              {COPY.support_link}
            </Link>
          </div>
        </section>

        {/* --------------------------------------------------- security -- */}
        <section className="p-section" aria-labelledby="p-section-security">
          <h2 className="p-section__title" id="p-section-security">
            {COPY.section_security}
          </h2>

          {editingPassword ? (
            <div className="p-row p-row--open" data-role="password-editor">
              <div className="p-field">
                <label className="p-coord p-coord--field" htmlFor="p-current">
                  {COPY.password_current}
                </label>
                <input
                  id="p-current"
                  className="p-name-control"
                  type="password"
                  autoComplete="current-password"
                  data-role="current-password"
                  value={currentPassword}
                  readOnly={pwBusy}
                  aria-invalid={phase === "wrong-current" ? true : undefined}
                  aria-describedby={phase === "wrong-current" ? "p-pw-error" : undefined}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>

              <div className="p-field">
                <label className="p-coord p-coord--field" htmlFor="p-new">
                  {COPY.password_new}
                </label>
                <input
                  id="p-new"
                  className="p-name-control"
                  type="password"
                  autoComplete="new-password"
                  data-role="new-password"
                  value={newPassword}
                  readOnly={pwBusy}
                  minLength={PASSWORD_MIN}
                  aria-describedby={phase === "invalid" ? "p-pw-constraint p-pw-error" : "p-pw-constraint"}
                  {...(phase === "invalid" ? { "aria-invalid": true as const } : {})}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <p className="p-constraint" id="p-pw-constraint">
                  {COPY.password_constraint}
                </p>
              </div>

              <div className="p-field">
                <label className="p-coord p-coord--field" htmlFor="p-confirm">
                  {COPY.password_confirm}
                </label>
                <input
                  id="p-confirm"
                  className="p-name-control"
                  type="password"
                  autoComplete="new-password"
                  data-role="confirm-password"
                  value={confirmPassword}
                  readOnly={pwBusy}
                  {...(phase === "invalid" ? { "aria-invalid": true as const } : {})}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>

              {phase === "invalid" || phase === "wrong-current" || phase === "failed" ? (
                <p className="p-feedback p-feedback--field" id="p-pw-error" data-role="password-error" role="alert">
                  {phase === "invalid"
                    ? newPassword.length < PASSWORD_MIN
                      ? COPY.password_too_short
                      : COPY.password_mismatch
                    : phase === "wrong-current"
                      ? COPY.password_wrong_current
                      : COPY.password_failed}
                </p>
              ) : null}

              <div className="p-actions">
                <button
                  type="button"
                  className="p-save"
                  data-role="password-submit"
                  onClick={() => void onChangePassword()}
                  {...(pwBusy ? { "aria-busy": true as const, disabled: true } : {})}
                >
                  {pwBusy ? COPY.saving : COPY.password_submit}
                </button>
                <button
                  type="button"
                  className="p-cancel"
                  data-role="password-cancel"
                  onClick={() => {
                    /* Cancel sends nothing and keeps nothing. */
                    clearPassword();
                    setPhase("idle");
                    setEditor("none");
                    pendingFocus.current = "password-affordance";
                  }}
                >
                  {COPY.cancel}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-row" data-role="password-row">
              <span className="p-row__label">{COPY.password_label}</span>
              <span className="p-row__value p-row__value--muted">
                {phase === "done" ? COPY.password_changed : ""}
              </span>
              <button
                type="button"
                className="p-edit"
                data-role="password-affordance"
                disabled={editingName}
                onClick={() => {
                  setPhase("idle");
                  setEditor("password");
                  pendingFocus.current = "current-password";
                }}
              >
                {COPY.password_edit}
              </button>
            </div>
          )}
        </section>

        <p className="p-consequence" data-role="consequence">
          {COPY.consequence}
        </p>
      </div>
    </div>
  );
}

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
