/**
 * ACCOUNT RECOVERY — what this deployment can actually do for a learner.
 *
 * Every flow here ends in an email. A deployment that cannot send one must not
 * offer the flow: a «Забыли пароль?» that produces no message is worse than no
 * link at all, because the person waits. So the Academy asks, and shows only
 * what is true. All three follow mail today; they are separate names because
 * they are separate promises, and a later deployment may keep one and not
 * another.
 */
import { isMailEnabled } from "@/lib/mail/config";

export type AccountCapabilities = {
  readonly passwordRecovery: boolean;
  readonly emailVerification: boolean;
  readonly emailChange: boolean;
};

export function accountCapabilities(env: NodeJS.ProcessEnv = process.env): AccountCapabilities {
  const mail = isMailEnabled(env);
  return { passwordRecovery: mail, emailVerification: mail, emailChange: mail };
}
