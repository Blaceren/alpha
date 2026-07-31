/**
 * AFD-3A3 — the authentication SURFACE registry.
 *
 * ## The problem this solves
 *
 * AFD-3A2 gave the platform one real challenge and one optional, operator-set
 * expected action (`TURNSTILE_EXPECTED_ACTION`). One action for the whole
 * deployment is the same as no action at all once there is more than one
 * protected form: a token minted by the registration widget would satisfy the
 * login owner, and a token minted on the Academy would satisfy the CRM.
 *
 * Cloudflare stamps the `action` a widget was rendered with onto the Siteverify
 * answer, so the platform CAN tell those tokens apart — but only if each surface
 * pins its OWN expected value. That is what this file is.
 *
 * ## Why the action lives in source and not in the environment
 *
 * An expected action is not a deployment preference, it is part of the route's
 * contract with its own widget. Two deployments of this code must not disagree
 * about which token is allowed to log a person in. `TURNSTILE_EXPECTED_ACTION`
 * is therefore RETIRED (see `provider.ts`): setting it is now a configuration
 * error rather than a silent global override of everything here.
 *
 * ## Why the surface is a header and never a body field
 *
 * The surface must be chosen by the trusted server that fronts the form, never
 * by the caller — otherwise an attacker holding an `academy_login` token simply
 * declares `surface: "academy_login"` on the CRM endpoint and the pin is
 * decorative.
 *
 * `AUTH_SURFACE_HEADER` is stamped by the Academy proxy and the CRM login route,
 * both of which build their outbound headers from an ALLOW-LIST and `set` (never
 * append or pass through) this one. A browser-supplied header of the same name
 * is dropped at that boundary and cannot survive the hop. The Backend's own
 * origin is bound to loopback and is not publicly routable, so the proxies are
 * the only paths a public client has.
 *
 * An UNRESOLVED surface is a configuration error, not a free pass — see
 * `verifyCaptcha`. Absent means "the fronting server did not tell us which form
 * this is", and a challenge that cannot be attributed to a form cannot be
 * checked against one.
 */
import type { CaptchaPurpose } from "@/lib/captcha/purpose";

/**
 * The header a trusted fronting server stamps to name the form being submitted.
 *
 * `x-ata-` rather than `x-forwarded-`: it carries no forwarding semantics, and a
 * name nobody else uses cannot be confused with something nginx sets.
 */
export const AUTH_SURFACE_HEADER = "x-ata-auth-surface";

/**
 * Every authentication surface this platform serves, and the Turnstile action
 * its widget stamps.
 *
 * The surface name and the action are deliberately the SAME string. One name per
 * form means an operator reading a Cloudflare analytics breakdown, a header on
 * the wire and this table sees one vocabulary rather than three.
 */
export const AUTH_SURFACES = {
  academy_register: { action: "academy_register", purpose: "register" },
  academy_login: { action: "academy_login", purpose: "login" },
  crm_login: { action: "crm_login", purpose: "login" },
} as const satisfies Record<string, { action: string; purpose: CaptchaPurpose }>;

export type AuthSurfaceName = keyof typeof AUTH_SURFACES;

export type AuthSurface = {
  readonly name: AuthSurfaceName;
  readonly action: string;
  readonly purpose: CaptchaPurpose;
};

export const AUTH_SURFACE_NAMES = Object.keys(AUTH_SURFACES) as AuthSurfaceName[];

/** The registration surface. Registration has exactly one, fixed at the route. */
export const ACADEMY_REGISTER_SURFACE: AuthSurface = surfaceOf("academy_register");
/** The learner login surface. */
export const ACADEMY_LOGIN_SURFACE: AuthSurface = surfaceOf("academy_login");
/** The staff login surface. */
export const CRM_LOGIN_SURFACE: AuthSurface = surfaceOf("crm_login");

function surfaceOf(name: AuthSurfaceName): AuthSurface {
  const entry = AUTH_SURFACES[name];
  return { name, action: entry.action, purpose: entry.purpose };
}

/** Is this string exactly one of the registered surface names? */
export function isAuthSurfaceName(value: string): value is AuthSurfaceName {
  return Object.prototype.hasOwnProperty.call(AUTH_SURFACES, value);
}

/**
 * Resolve the surface a request declares, restricted to one purpose.
 *
 * Returns `null` — never a default — when the header is absent, unknown, or
 * names a surface belonging to a DIFFERENT purpose. That last case is the one
 * that matters: it is what stops `academy_register` from being declared on the
 * login owner in order to make a registration token acceptable there.
 *
 * Exact match only, like `ATA_ENVIRONMENT` and `CAPTCHA_PROVIDER`. No trimming,
 * no case folding, no aliasing: every producer of this header is code in this
 * repository, so there is no human typing it and nothing to be lenient about.
 */
export function resolveAuthSurface(
  request: Request | undefined,
  purpose: CaptchaPurpose,
): AuthSurface | null {
  const raw = request?.headers.get(AUTH_SURFACE_HEADER);
  if (raw === null || raw === undefined || raw === "") return null;
  if (!isAuthSurfaceName(raw)) return null;

  const surface = surfaceOf(raw);
  return surface.purpose === purpose ? surface : null;
}
