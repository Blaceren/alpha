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
    next: { ...state, mode: "SUBMITTING", error: null, announce: null },
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
  cancel: "Отмена",
  constraint: "От 2 до 50 символов",
  /* Community is hidden (COMMUNITY_ENABLED = false), and this line used to send
     a learner to a section they cannot open. If Community is ever switched on,
     restoring the wider context is its own decision — not a conditional string
     carried here in advance. */
  consequence: "Это имя отображается в вашем профиле ATA.",
  support_lead: "Остальные данные учётной записи меняются через поддержку.",
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
} as const;
