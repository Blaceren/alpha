/**
 * ACCOUNT RECOVERY — the links in the emails.
 *
 * THE TOKEN RIDES IN THE FRAGMENT, not in the query. `…/reset-password#token=…`
 * is opened by the browser without the token ever appearing in a request line:
 * not in the Academy's access log, not in nginx's, not in a Referer header sent
 * to anything the page loads. The page reads the fragment in the browser and
 * posts the token in a request body. A token in a query string would be written
 * into every one of those places by default — and this deployment already
 * keeps a separate log format for Pocket postbacks precisely so that a secret
 * in a URL does not reach a log.
 *
 * The origin is the deployment's public origin (`PUBLIC_APP_URL`), never a
 * request header: a link built from `Host` is a link an attacker can point at
 * their own machine.
 */
export const ACCOUNT_LINK_PATHS = {
  verify_email: "/verify-email",
  password_reset: "/reset-password",
  email_change: "/confirm-email",
} as const;

export type AccountLinkKind = keyof typeof ACCOUNT_LINK_PATHS;

export function accountLink(origin: string, kind: AccountLinkKind, token: string): string {
  return `${origin}${ACCOUNT_LINK_PATHS[kind]}#token=${encodeURIComponent(token)}`;
}
