/**
 * AFD-4 — the one place that decides whether Pocket first-deposit ingestion is
 * on, and the one place that judges the optional deposit currency.
 *
 * SEPARATE FROM ATTRIBUTION, DELIBERATELY. `AFFILIATE_ATTRIBUTION_ENABLED`
 * governs whether ATA measures where a learner came from. This switch governs
 * whether ATA accepts a money event from Pocket. They fail for different
 * reasons, are enabled at different times by different people, and an operator
 * must be able to turn deposits off without blinding acquisition reporting — so
 * they are two switches, not one.
 *
 * FIRST DEPOSIT CANNOT OUTLIVE ITS OWN AUTHENTICATION. The deposit callback is
 * authenticated by exactly the same `POSTBACK_SECRET` the registration callback
 * uses; this phase introduces no second secret and no fallback mode. So enabling
 * deposits while the Pocket integration itself is disabled would describe a
 * state that cannot exist, and resolves to "off" rather than to a half-open
 * route.
 */
import { resolvePocketPostbackConfig } from "@/lib/exchange/pocketPostbackAuth";

export const POCKET_FIRST_DEPOSIT_ENABLED_KEY = "POCKET_FIRST_DEPOSIT_ENABLED";
export const POCKET_DEPOSIT_CURRENCY_KEY = "POCKET_DEPOSIT_CURRENCY";

/**
 * The shape of an ISO-4217 alphabetic code: exactly three uppercase ASCII
 * letters.
 *
 * SHAPE, NOT MEMBERSHIP. This deliberately does not carry a list of the world's
 * currencies. A hard-coded list goes stale, and rejecting a real currency an
 * operator actually settles in would be a worse failure than accepting a
 * well-formed code that happens to be unallocated. Lower case is refused rather
 * than up-cased: `usd` and `USD` must not be two spellings of one configured
 * value, because the stored code is compared and reported downstream.
 */
const ISO_4217_ALPHA = /^[A-Z]{3}$/;

/**
 * Whether a currency was configured at all, recorded ALONGSIDE the code.
 *
 * The distinction this phase exists to preserve: Pocket's callback carries no
 * currency field, so "the amount is 282.70 and we do not know the unit" is the
 * honest state for an unconfigured deployment. A schema that stored only a
 * nullable code would let a later reader interpret NULL as "not yet backfilled"
 * and quietly default it to USD — which is exactly the fabrication AFD-1 found
 * in the legacy route and this phase removes.
 */
export type PocketDepositCurrencyStatus = "unspecified" | "configured";

export type PocketDepositCurrency =
  | { readonly status: "unspecified"; readonly code: null }
  | { readonly status: "configured"; readonly code: string };

export type PocketFirstDepositRejection =
  | "postback_integration_disabled"
  | "malformed_currency";

export type PocketFirstDepositConfig =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly currency: PocketDepositCurrency };

export type PocketFirstDepositResolution =
  | { readonly kind: "resolved"; readonly config: PocketFirstDepositConfig }
  | { readonly kind: "invalid"; readonly reason: PocketFirstDepositRejection };

/** Whether the operator asked for first-deposit ingestion. Absent means no. */
export function isPocketFirstDepositRequested(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[POCKET_FIRST_DEPOSIT_ENABLED_KEY] === "true";
}

/**
 * Read the optional currency configuration.
 *
 * An absent or empty value is the documented default and is NOT an error: it
 * selects the explicit `unspecified` state. A present but malformed value IS an
 * error, because it means the operator intended to declare a currency and got
 * it wrong — silently falling back to `unspecified` there would record money
 * under a unit nobody chose.
 */
export function resolveDepositCurrency(
  env: NodeJS.ProcessEnv = process.env,
): PocketDepositCurrency | { readonly malformed: true } {
  const raw = env[POCKET_DEPOSIT_CURRENCY_KEY];

  if (raw === undefined || raw.trim() === "") {
    return { status: "unspecified", code: null };
  }

  // Compared untrimmed against the strict shape: a value with surrounding
  // whitespace is a configuration mistake worth surfacing, not something to
  // quietly repair.
  if (!ISO_4217_ALPHA.test(raw)) {
    return { malformed: true };
  }

  return { status: "configured", code: raw };
}

/**
 * The authoritative resolution.
 *
 * Disabled resolves cleanly whatever the currency looks like — a deployment
 * that is not ingesting deposits is not obliged to have decided on a currency.
 */
export function resolvePocketFirstDepositConfig(
  env: NodeJS.ProcessEnv = process.env,
): PocketFirstDepositResolution {
  if (!isPocketFirstDepositRequested(env)) {
    return { kind: "resolved", config: { enabled: false } };
  }

  // The deposit callback authenticates with POSTBACK_SECRET through the Pocket
  // postback owner. If that owner is disabled or misconfigured there is no
  // secret to authenticate against, so deposits are off too.
  if (!resolvePocketPostbackConfig(env as Record<string, string | undefined>).enabled) {
    return { kind: "invalid", reason: "postback_integration_disabled" };
  }

  const currency = resolveDepositCurrency(env);
  if ("malformed" in currency) {
    return { kind: "invalid", reason: "malformed_currency" };
  }

  return { kind: "resolved", config: { enabled: true, currency } };
}

/**
 * Read at call time, never captured at module load: a long-lived server and a
 * regression suite that flips the flag between cases must both see the truth.
 *
 * Any invalid configuration reads as NOT enabled. There is no degraded mode in
 * which deposits are accepted under a currency the operator did not choose.
 */
export function isPocketFirstDepositEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const resolution = resolvePocketFirstDepositConfig(env);
  return resolution.kind === "resolved" && resolution.config.enabled;
}

/**
 * The currency to stamp on an accepted deposit.
 *
 * Throws when first deposit is not cleanly enabled, so a caller that forgot to
 * check the flag fails closed instead of recording money under a guess.
 */
export function requireDepositCurrency(
  env: NodeJS.ProcessEnv = process.env,
): PocketDepositCurrency {
  const resolution = resolvePocketFirstDepositConfig(env);

  if (resolution.kind === "invalid" || !resolution.config.enabled) {
    throw new PocketFirstDepositUnavailableError(
      resolution.kind === "invalid" ? resolution.reason : "disabled",
    );
  }

  return resolution.config.currency;
}

export class PocketFirstDepositUnavailableError extends Error {
  constructor(readonly reason: PocketFirstDepositRejection | "disabled") {
    // The reason is a bounded code. No environment value is in the message.
    super(`pocket first deposit unavailable: ${reason}`);
    this.name = "PocketFirstDepositUnavailableError";
  }
}
