/**
 * SERVER-ONLY: whether cookies the CRM re-emits must carry `Secure`.
 *
 * The CRM decides this for its OWN origin and never copies the flag from the
 * backend response. That distinction matters: the backend computes `Secure` from
 * ITS `APP_URL`/`NODE_ENV`, and on a loopback dev backend that is `false`. If we
 * forwarded the backend's flag verbatim, a production CRM served over https and
 * talking to an http backend would drop `Secure` and start sending the staff
 * session over plaintext. The bridge therefore always recomputes it here.
 *
 * Resolution order, first match wins:
 *
 *   1. `CRM_APP_URL` — if it parses and its protocol is https:, cookies are
 *      Secure. This is the explicit, deployment-owned answer.
 *   2. `NODE_ENV === "production"` — a production build with no CRM_APP_URL is
 *      assumed to be served over https.
 *   3. otherwise false — local http development and loopback tests.
 *
 * A malformed `CRM_APP_URL` is deliberately NOT treated as "insecure": it falls
 * through to the NODE_ENV rule, so a typo in a production deployment still
 * yields Secure cookies rather than silently downgrading them.
 */
export function shouldUseSecureCookies(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  const raw = env.CRM_APP_URL;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      return new URL(raw.trim()).protocol === "https:";
    } catch {
      // Fall through: a malformed value must not weaken production.
    }
  }

  return env.NODE_ENV === "production";
}
