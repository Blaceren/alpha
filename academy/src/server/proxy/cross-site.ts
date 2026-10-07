/**
 * Whether a browser says this request was made by ANOTHER site's page.
 *
 * 2026-10-07 audit: the account operations take no CSRF pair before a session
 * exists (sign-in, registration, recovery), so a page elsewhere could submit a
 * hidden form to the sign-in with its own account's credentials and a token it
 * solved itself; the browser keeps the session it is handed, and the learner
 * goes on studying — and writing in their journal — inside a stranger's account.
 *
 * `Sec-Fetch-Site` where the browser sends it (every current one does): only
 * `same-origin` and `none` (the person's own action) pass — `same-site` is
 * another host of this domain, which has no business here either. Without it,
 * `Origin`, compared with the host the request was addressed to. A request that
 * names neither is not a browser's page at all (a server, a script) and is not
 * judged here.
 */
export function isCrossSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";

  const origin = request.headers.get("origin");
  if (origin === null) return false;
  if (origin === "null") return true;
  const host = request.headers.get("host");
  if (host === null) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
