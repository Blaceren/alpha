/**
 * ACCOUNT RECOVERY — the token in a link, read in the browser.
 *
 * The links the Backend mails look like `/reset-password#token=…`. The token is
 * in the FRAGMENT on purpose: a fragment is never sent to a server, so it is in
 * no access log and in no Referer. The page reads it here, keeps it in memory,
 * posts it in a request body — and takes it out of the address bar, so it does
 * not sit in the browser's history or get copied along with the URL.
 */

/** A reset or change token is 43 base64url characters; a confirmation token is a UUID. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** The token inside a `location.hash`, or null when there is none of the right shape. */
export function parseLinkToken(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of raw.split("&")) {
    const [key, ...rest] = part.split("=");
    if (key !== "token") continue;
    let value: string;
    try {
      value = decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
    return TOKEN_SHAPE.test(value) ? value : null;
  }
  return null;
}

/** Read the token from the address bar and remove the fragment from it. Browser only. */
export function takeLinkToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = parseLinkToken(window.location.hash);
  if (window.location.hash) {
    try {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    } catch {
      /* A browser that refuses is no worse off than before. */
    }
  }
  return token;
}
