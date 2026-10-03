"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { changeProfilePassword, saveProfileName } from "@/lib/profile/profile-client";
import {
  cancelEmailChange,
  requestEmailChange,
  resendVerification,
  type EmailChangeFailure,
} from "@/lib/account/account-client";
import type { AccountEmailState, AccountView } from "@/lib/account/account-types";
import {
  COPY,
  FOCUS_AFTER,
  NAME_MAX,
  NAME_MIN,
  PASSWORD_MIN,
  canSaveName,
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
import "@/features/profile-fidelity/profile-hifi.css";

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
 * EMAIL, WHERE MAIL CAN BE SENT (ACCOUNT RECOVERY, 2026-10-01). The three
 * paragraphs above describe the page on a deployment that cannot send mail —
 * PREPROD, by design — and they remain exactly true there: the row names
 * support and prints nothing. Where the Backend reports that it CAN send mail,
 * the page receives the address through its own narrow read (`account`) and the
 * row becomes the address, its state and three honest actions: send the
 * confirmation message, ask to change the address (new address and current
 * password), withdraw a pending change. A change is shown as pending until the
 * new mailbox answers; this page never claims the address has changed.
 *
 * A NEW PASSWORD WITHDRAWS A PENDING CHANGE OF ADDRESS. The Backend drops it in
 * the same commit as the new password — a change of password is what a person
 * does when someone else may have asked for the address to move — so the page
 * stops saying the address is waiting and says once that the request is gone.
 *
 * PASSWORDS EXIST ONLY IN THE FIELDS AND THE REQUEST. They are never placed in
 * state that outlives the submit, never logged, never carried in an error, and
 * cleared on success.
 *
 * A NORMAL PROFILE, HI-FI (owner, 2026-10-03: «наполни как нормальный профиль
 * на платформе, поддержку тоже сюда переноси»; DD-337). The page receives its
 * frame from the route — the passport (who, since when, how far) and the two
 * parts, «Аккаунт» and «Поддержка» — and a closing section (signing out). Support
 * is a part of the profile now, so every handoff on this page leads to
 * `/profile/support`. Where mail cannot be sent the email row still names
 * support for a change, and now prints the learner's own address beside it:
 * a profile that hides a person's address from them is not a normal one.
 */

type Editor = "none" | "name" | "password" | "email";

type PasswordPhase = "idle" | "submitting" | "wrong-current" | "invalid" | "failed" | "done";

type EmailPhase = "idle" | "submitting" | "invalid" | EmailChangeFailure;
type ResendPhase = "idle" | "sending" | "sent" | "limited" | "failed";

const EMAIL_ERROR: Record<Exclude<EmailPhase, "idle" | "submitting">, keyof typeof COPY> = {
  invalid: "email_error_invalid",
  VALIDATION_ERROR: "email_error_invalid",
  INVALID_PASSWORD: "email_error_password",
  SAME_EMAIL: "email_error_same",
  EMAIL_IN_USE: "email_error_in_use",
  RATE_LIMITED: "email_error_limited",
  UNAVAILABLE: "email_error_failed",
  FAILED: "email_error_failed",
};

/** A deliberately loose shape check; the Backend is the authority on addresses. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Where support lives (2026-10-03): a part of the profile. */
export const SUPPORT_HREF = "/profile/support";

export function ProfileFidelity({
  canonical,
  account = null,
  frame = null,
  closing = null,
  aside = null,
}: {
  canonical: string | null;
  /** The learner's address and what can be done with it, or null where that is unknown or unavailable. */
  account?: AccountView | null;
  /** The passport and the profile's parts, drawn under the page coordinate. */
  frame?: ReactNode;
  /** A last section after security — signing out. */
  closing?: ReactNode;
  /** Beside the rows on a wide screen, after them on a narrow one — the support card. */
  aside?: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<ProfileState>(() => initial(canonical));
  const [editor, setEditor] = useState<Editor>("none");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phase, setPhase] = useState<PasswordPhase>("idle");
  /** Whether the last successful password change also withdrew a pending change of address. */
  const [pendingDropped, setPendingDropped] = useState(false);

  /* The email row acts only where the Backend can send mail. Everywhere else
     `emailActions` is false and the row below is the one the page always had. */
  const emailActions = account?.capabilities.emailChange === true;
  const canVerify = account?.capabilities.emailVerification === true;
  const [emailState, setEmailState] = useState<AccountEmailState | null>(account?.account ?? null);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailPhase, setEmailPhase] = useState<EmailPhase>("idle");
  const [resendPhase, setResendPhase] = useState<ResendPhase>("idle");
  const [cancelling, setCancelling] = useState(false);

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
  }, [state.mode, editor, phase, emailPhase]);

  const submit = useCallback(async (name: string) => {
    const result = await saveProfileName(name);
    setState((current) => {
      if (current.mode !== "SUBMITTING") return current;
      return result.ok ? saveConfirmed(current, result.name) : saveFailed(current);
    });
    if (result.ok) {
      setEditor("none");
      /* The passport and the shell's avatar print the server's name; a refresh
         brings them to the one just confirmed. This page's own state survives
         it — the row already shows the confirmed value. */
      router.refresh();
    }
    caretToEnd.current = !result.ok;
    pendingFocus.current = result.ok ? FOCUS_AFTER.CONFIRMED_SAVE : FOCUS_AFTER.MUTATION_FAIL;
  }, [router]);

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
      /* The pending address died with the old password (see the file header). */
      const hadPending = Boolean(emailState?.pendingEmail);
      if (hadPending) setEmailState((current) => (current ? { ...current, pendingEmail: null } : current));
      setPendingDropped(hadPending);
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
  }, [phase, newPassword, confirmPassword, currentPassword, clearPassword, emailState]);

  /** Every exit from the email form goes through here: the password never outlives it. */
  const clearEmailForm = useCallback(() => {
    setNewEmail("");
    setEmailPassword("");
  }, []);

  const onRequestEmailChange = useCallback(async () => {
    if (emailPhase === "submitting") return;
    const address = newEmail.trim().toLowerCase();
    if (!looksLikeEmail(address)) {
      setEmailPhase("invalid");
      pendingFocus.current = "new-email";
      return;
    }
    if (emailPassword.length === 0) {
      setEmailPhase("INVALID_PASSWORD");
      pendingFocus.current = "email-password";
      return;
    }
    setEmailPhase("submitting");
    const result = await requestEmailChange({ newEmail: address, currentPassword: emailPassword });
    if (result.ok) {
      clearEmailForm();
      setEmailPhase("idle");
      setEmailState((current) => (current ? { ...current, pendingEmail: result.pendingEmail } : current));
      setEditor("none");
      pendingFocus.current = "email-pending-cancel";
      return;
    }
    setEmailPassword("");
    setEmailPhase(result.failure);
    pendingFocus.current = result.failure === "INVALID_PASSWORD" ? "email-password" : "new-email";
  }, [emailPhase, newEmail, emailPassword, clearEmailForm]);

  const onCancelPending = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    const result = await cancelEmailChange();
    setCancelling(false);
    if (result.ok) {
      setEmailState((current) => (current ? { ...current, pendingEmail: null } : current));
      pendingFocus.current = "email-affordance";
    }
  }, [cancelling]);

  const onResend = useCallback(async () => {
    if (resendPhase === "sending") return;
    setResendPhase("sending");
    const result = await resendVerification();
    if (result.ok) {
      if (result.alreadyVerified) {
        setEmailState((current) => (current ? { ...current, emailVerified: true } : current));
        setResendPhase("idle");
        return;
      }
      setResendPhase("sent");
      return;
    }
    setResendPhase(result.failure === "RATE_LIMITED" ? "limited" : "failed");
  }, [resendPhase]);

  const editingName = isEditing(state.mode) && editor === "name";
  const busy = state.mode === "SUBMITTING";
  const canSave = canSaveName(state);
  const invalid = state.mode === "INVALID";
  const failed = state.mode === "FAILED";
  const pwBusy = phase === "submitting";
  const editingPassword = editor === "password";
  const editingEmail = editor === "email";
  const emailBusy = emailPhase === "submitting";

  if (state.mode === "PAGEFAIL") {
    return (
      <div className="pf pf--hifi" ref={rootRef}>
        <div className="p-profile" data-mode="PAGEFAIL">
          <h1 className="p-coord p-coord--page" data-role="page-title">
            {COPY.page_title}
          </h1>
          {frame}
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
    <div className="pf pf--hifi" ref={rootRef}>
      <div className="p-profile" data-mode={state.mode} data-editor={editor}>
        {/* PERMANENT. The page coordinate does not move when a form opens. */}
        <h1 className="p-coord p-coord--page" data-role="page-title">
          {COPY.page_title}
        </h1>
        {frame}
        <p className="p-lead" data-role="page-lead">
          {COPY.page_lead}
        </p>

        <StatusRegion text={state.announce} />

        <div className="p-body">
        <div className="p-main">
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
                  /* A real `disabled`, not `pointer-events: none`: the second
                     leaves the control in the tab order and reachable by
                     keyboard while looking unavailable, which is the worst of
                     both. Disabled here means disabled to everyone. */
                  disabled={!canSave}
                  {...(busy ? { "aria-busy": true as const } : {})}
                >
                  {/* ALWAYS THE SAME WORD. The request is announced in the
                      live region and marked with `aria-busy`; the label is not
                      the place to report it, because changing it changes the
                      button's width and moves «Отмена». */}
                  {COPY.save_name}
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
                disabled={editingPassword || editingEmail}
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

          {/* What the name is for — under the name, not at the foot of the page
              after security (2026-10-03). */}
          <p className="p-consequence" data-role="consequence">
            {COPY.consequence}
          </p>

          {emailActions && emailState ? (
            <>
              {editingEmail ? (
                <div className="p-row p-row--open" data-role="email-editor">
                  <div className="p-field">
                    <label className="p-coord p-coord--field" htmlFor="p-new-email">
                      {COPY.email_new}
                    </label>
                    <input
                      id="p-new-email"
                      className="p-name-control"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      spellCheck={false}
                      data-role="new-email"
                      value={newEmail}
                      readOnly={emailBusy}
                      aria-describedby={emailPhase !== "idle" && emailPhase !== "submitting" ? "p-email-hint p-email-error" : "p-email-hint"}
                      {...(emailPhase !== "idle" && emailPhase !== "submitting" && emailPhase !== "INVALID_PASSWORD" ? { "aria-invalid": true as const } : {})}
                      onChange={(event) => setNewEmail(event.target.value)}
                    />
                    <p className="p-constraint" id="p-email-hint">
                      {COPY.email_hint}
                    </p>
                  </div>

                  <div className="p-field">
                    <label className="p-coord p-coord--field" htmlFor="p-email-password">
                      {COPY.email_current_password}
                    </label>
                    <input
                      id="p-email-password"
                      className="p-name-control"
                      type="password"
                      autoComplete="current-password"
                      data-role="email-password"
                      value={emailPassword}
                      readOnly={emailBusy}
                      {...(emailPhase === "INVALID_PASSWORD" ? { "aria-invalid": true as const, "aria-describedby": "p-email-error" } : {})}
                      onChange={(event) => setEmailPassword(event.target.value)}
                    />
                  </div>

                  {emailPhase !== "idle" && emailPhase !== "submitting" ? (
                    <p className="p-feedback p-feedback--field" id="p-email-error" data-role="email-error" role="alert">
                      {COPY[EMAIL_ERROR[emailPhase]]}
                    </p>
                  ) : null}

                  <div className="p-actions">
                    <button
                      type="button"
                      className="p-save"
                      data-role="email-submit"
                      onClick={() => void onRequestEmailChange()}
                      {...(emailBusy ? { "aria-busy": true as const, disabled: true } : {})}
                    >
                      {emailBusy ? COPY.saving : COPY.email_submit}
                    </button>
                    <button
                      type="button"
                      className="p-cancel"
                      data-role="email-cancel"
                      onClick={() => {
                        /* Cancel sends nothing and keeps nothing. */
                        clearEmailForm();
                        setEmailPhase("idle");
                        setEditor("none");
                        pendingFocus.current = "email-affordance";
                      }}
                    >
                      {COPY.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-row" data-role="email-row">
                  <span className="p-row__label">{COPY.email_label}</span>
                  <span className="p-row__value" data-role="email-value">
                    {emailState.email}{" "}
                    <span className="p-row__state" data-role="email-state" data-verified={emailState.emailVerified ? "1" : "0"}>
                      · {emailState.emailVerified ? COPY.email_state_verified : COPY.email_state_unverified}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="p-edit"
                    data-role="email-affordance"
                    disabled={editingName || editingPassword}
                    onClick={() => {
                      setEmailPhase("idle");
                      setEditor("email");
                      pendingFocus.current = "new-email";
                    }}
                  >
                    {COPY.email_edit}
                  </button>
                </div>
              )}

              {/* A PENDING CHANGE IS SHOWN AS PENDING. The address above is still
                  the account's address until the new mailbox answers. */}
              {emailState.pendingEmail ? (
                <div className="p-row p-row--note" data-role="email-pending-row">
                  <span className="p-row__label" aria-hidden="true" />
                  <span className="p-row__value p-row__value--muted" data-role="email-pending" role="status">
                    {COPY.email_pending.replace("{email}", emailState.pendingEmail)}
                  </span>
                  <button
                    type="button"
                    className="p-edit"
                    data-role="email-pending-cancel"
                    onClick={() => void onCancelPending()}
                    {...(cancelling ? { "aria-busy": true as const, disabled: true } : {})}
                  >
                    {COPY.email_pending_cancel}
                  </button>
                </div>
              ) : null}

              {canVerify && !emailState.emailVerified && !emailState.pendingEmail ? (
                <div className="p-row p-row--note" data-role="email-verify-row">
                  <span className="p-row__label" aria-hidden="true" />
                  <span className="p-row__value p-row__value--muted" data-role="email-verify-note" role="status">
                    {resendPhase === "sent"
                      ? COPY.email_verify_sent
                      : resendPhase === "limited"
                        ? COPY.email_verify_limited
                        : resendPhase === "failed"
                          ? COPY.email_verify_failed
                          : COPY.email_verify_lead}
                  </span>
                  {resendPhase === "sent" ? null : (
                    <button
                      type="button"
                      className="p-edit"
                      data-role="email-verify-send"
                      onClick={() => void onResend()}
                      {...(resendPhase === "sending" ? { "aria-busy": true as const, disabled: true } : {})}
                    >
                      {COPY.email_verify_send}
                    </button>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            /* EMAIL where no mail can be sent: the change goes through support.
               With the address in hand the row prints it (2026-10-03); without
               one it names support and prints nothing, as it always did. */
            <div className="p-row" data-role="email-row">
              <span className="p-row__label">{COPY.email_label}</span>
              {account?.account.email ? (
                <span className="p-row__value" data-role="email-value">
                  {account.account.email}{" "}
                  <span className="p-row__state" data-role="email-note">
                    · {COPY.email_via_support_short}
                  </span>
                </span>
              ) : (
                <span className="p-row__value p-row__value--muted" data-role="email-note">
                  {COPY.email_via_support}
                </span>
              )}
              <Link className="p-edit p-edit--link" href={SUPPORT_HREF} data-role="email-support-link">
                {COPY.support_link}
              </Link>
            </div>
          )}
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
              <span className="p-row__value p-row__value--muted" data-role="password-note">
                {phase === "done" ? (pendingDropped ? COPY.password_changed_email_dropped : COPY.password_changed) : ""}
              </span>
              <button
                type="button"
                className="p-edit"
                data-role="password-affordance"
                disabled={editingName || editingEmail}
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

        </div>
        {aside}
        </div>

        {closing}
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
      <Link href={SUPPORT_HREF} data-role="support-link">
        {COPY.support_link}
      </Link>
    </p>
  );
}
