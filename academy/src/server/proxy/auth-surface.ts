/**
 * The Backend authentication-surface contract (SERVER-ONLY).
 *
 * ## What a surface is
 *
 * The Backend pins one expected Cloudflare Turnstile action per authentication
 * form, so a token minted by the registration widget cannot log anybody in and a
 * token minted on the Academy cannot open the CRM. To apply the right pin the
 * Backend has to know WHICH form a submission came from, and it cannot work that
 * out from the path: the Academy and the CRM both submit to the same
 * `POST /api/auth/login`.
 *
 * ## Why the Academy declares it, and why a browser cannot
 *
 * This value is stamped here, on the server, from a CONSTANT in the proxy
 * allow-list. It is never read from the incoming request, never derived from a
 * body field and never derived from a query parameter — if a caller could choose
 * the surface, an attacker holding an `academy_login` token would simply declare
 * `crm_login` and the pin would be decorative.
 *
 * The header name below is deliberately absent from the proxy's
 * forwarded-request-header allow-list, so a browser that sends it has it dropped
 * at the boundary; the proxy then `set`s (never appends to) its own value. This
 * is the same trust model the client-IP contract uses, for the same reason.
 *
 * The Backend origin is bound to loopback and is not publicly routable, so this
 * proxy and the CRM's login route are the only paths a public client has to the
 * login owner.
 *
 * ## Fail-safe direction
 *
 * An UNSTAMPED request is refused by the Backend with a configuration error, not
 * waved through unpinned. Forgetting to stamp breaks login loudly rather than
 * quietly disabling the check — which is the direction that mistake has to fail
 * in for the pin to mean anything.
 */

/** The header the Backend reads. Mirrors `AUTH_SURFACE_HEADER` there. */
export const BACKEND_AUTH_SURFACE_HEADER = "x-ata-auth-surface";

/**
 * The surfaces the Backend recognises. This is the Academy's half of a contract
 * whose authority is `src/lib/captcha/surface.ts` in the Backend repository —
 * the two lists must agree exactly, and a value absent there is refused there.
 */
export const BACKEND_AUTH_SURFACES = ["academy_register", "academy_login"] as const;

export type BackendAuthSurface = (typeof BACKEND_AUTH_SURFACES)[number];
