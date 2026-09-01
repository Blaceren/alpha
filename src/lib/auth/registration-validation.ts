/**
 * Client-side registration validation — an EARLY UX AID ONLY.
 *
 * Backend validation stays authoritative: every rule here mirrors the
 * authoritative `registerSchema`, and anything that passes here is still sent
 * and still judged by Backend. Nothing here may be relied on for safety.
 *
 * Mirrored rules (Backend `src/lib/validation.ts`):
 *   email        — trimmed, must be an email, lowercased
 *   password     — min 6 chars, ≥1 upper [A-ZА-Я], ≥1 lower [a-zа-я], ≥1 digit
 *   name         — optional, trimmed, min 1
 *   referralCode — optional, trimmed, 1..100  (see `referral-code.ts`)
 *
 * `confirmPassword` has NO Backend counterpart. It is a client-only field, is
 * never placed in the request payload, and is validated only here.
 */

export const PASSWORD_MIN_LENGTH = 6;

export type RegistrationField = "email" | "name" | "password" | "confirmPassword";

export type RegistrationFieldErrors = Partial<Record<RegistrationField, string>>;

export type RegistrationDraft = {
  email: string;
  password: string;
  confirmPassword: string;
  name: string;
};

/**
 * Backend applies `.toLowerCase()` after `.trim()`. We normalize identically so
 * the address shown in the success state is the address that was stored.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 50;

/**
 * Backend's `name` is `nameSchema` — trimmed, 2 to 50, required. It is no longer
 * optional and there is no longer anything to omit: a blank name is a rejected
 * registration, not an instruction to invent one.
 */
export function normalizeName(raw: string): string {
  return raw.trim();
}

export function nameProblem(raw: string): string | undefined {
  const name = normalizeName(raw);
  if (name.length === 0) return "Укажите имя.";
  if (name.length < NAME_MIN_LENGTH) return `Имя должно быть не короче ${NAME_MIN_LENGTH} символов.`;
  if (name.length > NAME_MAX_LENGTH) return `Имя должно быть не длиннее ${NAME_MAX_LENGTH} символов.`;
  return undefined;
}

/**
 * Deliberately permissive: a client-side address check exists to catch typos,
 * not to out-guess Backend's validator. Anything ambiguous is allowed through
 * and Backend decides.
 */
function looksLikeEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  if (domain.length === 0 || !domain.includes(".")) return false;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return true;
}

/**
 * Length, and nothing else — the mirror of Backend's `passwordSchema`.
 *
 * The three category checks that were here are gone with the server rule they
 * mirrored. The value is measured as typed: no trim, so a password that begins
 * or ends with a space is exactly as long as its author intended.
 */
export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`;
  }
  return undefined;
}

export function validateRegistrationDraft(draft: RegistrationDraft): RegistrationFieldErrors {
  const errors: RegistrationFieldErrors = {};

  if (!looksLikeEmail(normalizeEmail(draft.email))) {
    errors.email = "Введите корректный email.";
  }

  const name = nameProblem(draft.name);
  if (name) errors.name = name;

  const password = passwordProblem(draft.password);
  if (password) errors.password = password;

  if (draft.confirmPassword !== draft.password) {
    errors.confirmPassword = "Пароли не совпадают.";
  }

  return errors;
}

export function hasFieldErrors(errors: RegistrationFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
