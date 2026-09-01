/**
 * PROFILE — the state machine, exactly as frozen.
 *
 * Six modes, and every transition between them is decided here rather than in
 * the view, so the rules that matter can be tested without a browser:
 *
 *   VIEW        the identity IS the page's subject, and is its h1
 *   EDITING     the same locus, opened; the page coordinate takes the h1 back
 *   SUBMITTING  the edit locus with the value held still
 *   INVALID     a validation failure bound to the field
 *   FAILED      a mutation failure bound to the attempt
 *   PAGEFAIL    the read itself failed — no locus, no identity, a page alert
 *
 * THE RULES THAT ARE EASY TO LOSE, AND WHY EACH IS HERE:
 *
 *   * DIRTY IS THE TRIMMED DRAFT AGAINST THE SERVER VALUE. A draft that differs
 *     only by whitespace is not dirty, because trimming removes the difference
 *     before it ever reaches the server. Warning about it would be warning
 *     about nothing.
 *
 *   * THE DRAFT IS NEVER IDENTITY. `canonical` is the server's value and the
 *     only identity truth on the page. A failed save leaves the identity
 *     untouched and the draft intact — the learner is repairing one attempt,
 *     not starting over.
 *
 *   * SAVE IS EXPLICIT. No autosave, no save-on-blur, and no optimistic
 *     identity: the name shown as identity has always been confirmed by the
 *     server.
 *
 *   * ON SUCCESS THE SERVER'S VALUE BECOMES CANONICAL, NOT THE DRAFT. They are
 *     usually the same string; when they are not, the server is right.
 */
export type ProfileMode = "VIEW" | "EDITING" | "SUBMITTING" | "INVALID" | "FAILED" | "PAGEFAIL";

export type ProfileState = {
  mode: ProfileMode;
  /** The server's value. The ONLY identity truth. */
  canonical: string | null;
  /** What the learner is typing. Never identity. */
  draft: string | null;
  /** A validation copy key, or null. */
  error: "error_short" | null;
  /** Text pending in the status region, or null. */
  announce: string | null;
};

/** Backend `profileUpdateSchema` — z.string().trim().min(2).max(50). */
/** Mirrors Backend `passwordSchema`. Length is the whole rule. */
export const PASSWORD_MIN = 6;

export const NAME_MIN = 2;
export const NAME_MAX = 50;

export function isEditing(mode: ProfileMode): boolean {
  return mode === "EDITING" || mode === "SUBMITTING" || mode === "INVALID" || mode === "FAILED";
}

export function isDirty(state: ProfileState): boolean {
  return (
    state.mode !== "VIEW" &&
    state.mode !== "PAGEFAIL" &&
    state.draft !== null &&
    state.draft.trim() !== state.canonical
  );
}

/**
 * FOCUS CONTRACT — frozen destinations. Focus is never left on a control that
 * has just been removed from the document, and never dropped to `<body>`.
 */
export const FOCUS_AFTER = {
  EDIT_OPENED: "name-control",
  VALIDATION_FAIL: "name-control",
  MUTATION_FAIL: "name-control",
  CANCELLED: "edit-affordance",
  CONFIRMED_SAVE: "edit-affordance",
} as const;

export type FocusRole = (typeof FOCUS_AFTER)[keyof typeof FOCUS_AFTER];

/** The only validation the page performs before submitting. */
export function validate(draft: string): "error_short" | null {
  return draft.trim().length < NAME_MIN ? "error_short" : null;
}

/**
 * WHEN SAVE IS ACTUALLY AVAILABLE.
 *
 * The button used to be live from the moment the editor opened, which made a
 * filled Signal button offer to save the name the learner already has. An
 * action that does nothing is worse than an absent one: it invites a request,
 * spends a round trip and returns the page to where it started.
 *
 * Three conditions, all of them necessary. The name must have actually changed
 * — `isDirty` compares TRIMMED text, so typing a space around an unchanged name
 * is not a change and does not wake the button. It must be valid at BOTH ends:
 * `maxLength` stops a person typing a 51st character, but it does not stop a
 * paste from a password manager or a value set by script, and the button must
 * not offer to submit something the Backend will refuse. And no request may
 * already be in flight.
 */
export function canSaveName(state: ProfileState): boolean {
  if (state.mode === "SUBMITTING") return false;
  if (!isDirty(state)) return false;
  const trimmed = (state.draft ?? "").trim();
  return trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
}

export const initial = (canonical: string | null): ProfileState =>
  canonical === null
    ? { mode: "PAGEFAIL", canonical: null, draft: null, error: null, announce: null }
    : { mode: "VIEW", canonical, draft: null, error: null, announce: null };

export function openEdit(state: ProfileState): ProfileState {
  return { ...state, mode: "EDITING", draft: state.canonical ?? "", error: null, announce: null };
}

export function cancel(state: ProfileState): ProfileState {
  return { ...state, mode: "VIEW", draft: null, error: null, announce: null };
}

/**
 * Typing after a failure clears the failure surface but NOT the draft — the
 * learner is repairing the same attempt, and deleting their text to "reset"
 * would be the page throwing their work away.
 */
export function editDraft(state: ProfileState, value: string): ProfileState {
  const mode = state.mode === "INVALID" || state.mode === "FAILED" ? "EDITING" : state.mode;
  return { ...state, mode, draft: value, error: null };
}

export type SaveOutcome =
  | { next: ProfileState; submit: false }
  | { next: ProfileState; submit: true; name: string };

export function save(state: ProfileState): SaveOutcome {
  /* A second click while a save is in flight is not a second save. */
  if (state.mode === "SUBMITTING") return { next: state, submit: false };
  const draft = state.draft ?? "";
  const error = validate(draft);
  if (error) {
    return { next: { ...state, mode: "INVALID", error, announce: null }, submit: false };
  }
  return {
    next: { ...state, mode: "SUBMITTING", error: null, announce: COPY.saving_status },
    submit: true,
    name: draft.trim(),
  };
}

export function saveFailed(state: ProfileState): ProfileState {
  /* Draft preserved, identity untouched. */
  return { ...state, mode: "FAILED", error: null, announce: null };
}

export function saveConfirmed(state: ProfileState, serverValue: string): ProfileState {
  return {
    mode: "VIEW",
    canonical: serverValue,
    draft: null,
    error: null,
    announce: COPY.saved_status.replace("{name}", serverValue),
  };
}

/**
 * The accepted copy, verbatim — including the two Direct-CPD repairs the frozen
 * fixture records, which are the wording that was accepted and not the wording
 * that came before it.
 */
export const COPY = {
  page_title: "Профиль",
  identity_label: "Имя",
  edit: "Изменить",
  save: "Сохранить",
  saving: "Сохранение…",
  /* THE NAME BUTTON NO LONGER SAYS THIS.
     «Сохранение…» is two characters longer than «Сохранить», which made the
     button grow 18.5px the moment it was pressed and pushed «Отмена» sideways
     for the length of the request. A control that moves under the pointer that
     just pressed it is a worse failure than a silent one, and the fix is not to
     reserve the wider word's space — that is the heavy button this phase
     removed. Progress belongs in the live region, which is where a screen
     reader was already being told about it. The password button keeps `saving`:
     it is a different control on a different row and nothing moves beside it. */
  saving_status: "Сохраняем имя…",
  cancel: "Отмена",
  constraint: "От 2 до 50 символов",
  /* Community is hidden (COMMUNITY_ENABLED = false), and this line used to send
     a learner to a section they cannot open. If Community is ever switched on,
     restoring the wider context is its own decision — not a conditional string
     carried here in advance. */
  consequence: "Это имя отображается в вашем профиле ATA.",
  /* Kept for the page-failure state, which has no email row to carry a handoff
     and still needs one. It is no longer shown on the working page: the password
     is self-service now, so «остальные данные» would have pointed at support for
     something this page does itself. */
  support_lead: "Если профиль не загружается, напишите в поддержку.",
  support_link: "Написать в поддержку",
  error_short: "Имя не может быть короче 2 символов.",
  mutation_failed: "Не удалось сохранить. Изменения не применены.",
  page_failed_lead: "Не удалось загрузить профиль.",
  page_failed_support: "Попробуйте ещё раз.",
  page_failed_retry: "Обновить",
  /**
   * Never rendered as visible UI. It is emitted into the off-screen status
   * region only AFTER the server confirms, and it names the value that actually
   * became canonical — because focus returns to «Изменить» and the new identity
   * would otherwise never be spoken.
   */
  saved_status: "Имя сохранено: {name}.",

  /* ATA-PROFILE-FOUNDATION-1 — the page grew a second area, so it grew a lead
     and two section headings. The page coordinate is permanent now, which is
     why «Профиль» is no longer conditional anywhere. */
  page_lead: "Управляйте данными аккаунта и безопасностью входа.",
  section_account: "Данные аккаунта",
  section_security: "Безопасность",
  /* «Сохранить», not «Сохранить имя». The row it sits in is already labelled
     «Имя» and the field above it holds a name; repeating the noun made the
     button the widest thing in the row — 135px of Signal fill next to the
     person's own name, which is not the more important of the two. */
  save_name: "Сохранить",

  /* The address itself is not shown: the learner viewer carries id, name, role
     and status, and printing an email would mean widening that boundary for a
     row that cannot act on it. The row says where the change happens instead —
     and promises no date, because the self-service flow has no mail transport
     behind it yet. */
  email_label: "Email",
  email_via_support: "Изменение email пока выполняется через поддержку.",

  password_label: "Пароль",
  password_edit: "Изменить пароль",
  password_current: "Текущий пароль",
  password_new: "Новый пароль",
  password_confirm: "Повторите новый пароль",
  password_constraint: "Минимум 6 символов.",
  password_submit: "Сменить пароль",
  password_changed: "Пароль изменён.",
  password_too_short: "Пароль должен быть не короче 6 символов.",
  password_mismatch: "Пароли не совпадают.",
  /* Neutral by design: the caller is already signed in, so this says something
     about the value typed, not about the account. */
  password_wrong_current: "Текущий пароль указан неверно.",
  password_failed: "Не удалось сменить пароль. Пароль не изменён.",
} as const;
