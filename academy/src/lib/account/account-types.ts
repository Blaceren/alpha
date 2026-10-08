/**
 * ACCOUNT RECOVERY — the shapes the Academy reads from the Backend.
 *
 * `AccountCapabilities` is the Backend's answer to "can this deployment send
 * the messages these flows end in?". The Academy never decides that itself:
 * where the answer is false — or cannot be read — nothing that ends in an email
 * is offered, which is the state PREPROD is in by design.
 */
export type AccountCapabilities = {
  readonly passwordRecovery: boolean;
  readonly emailVerification: boolean;
  readonly emailChange: boolean;
};

/** What an unreadable or absent answer means: nothing is offered. */
export const NO_ACCOUNT_CAPABILITIES: AccountCapabilities = {
  passwordRecovery: false,
  emailVerification: false,
  emailChange: false,
};

export type AccountEmailState = {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly pendingEmail: string | null;
  /**
   * When the account was made (ISO), for the profile's «В Академии с …»
   * (2026-10-03). Optional: a Backend from before it sends nothing, and the
   * profile then says nothing about it.
   */
  readonly memberSince?: string | null;
};

export type AccountView = {
  readonly account: AccountEmailState;
  readonly capabilities: AccountCapabilities;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAccountCapabilities(value: unknown): value is AccountCapabilities {
  return (
    isRecord(value) &&
    typeof value.passwordRecovery === "boolean" &&
    typeof value.emailVerification === "boolean" &&
    typeof value.emailChange === "boolean"
  );
}

export function isAccountView(value: unknown): value is AccountView {
  if (!isRecord(value) || !isRecord(value.account) || !isAccountCapabilities(value.capabilities)) return false;
  const { email, emailVerified, pendingEmail, memberSince } = value.account;
  return (
    typeof email === "string" &&
    email.length > 0 &&
    typeof emailVerified === "boolean" &&
    (pendingEmail === null || typeof pendingEmail === "string") &&
    (memberSince === undefined || memberSince === null || typeof memberSince === "string")
  );
}
