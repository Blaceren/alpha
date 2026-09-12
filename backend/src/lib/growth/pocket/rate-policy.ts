/**
 * G4-GROWTH — the rate policy for provider callbacks, which is not the policy
 * for people.
 *
 * WHY THIS IS SEPARATE FROM THE CONSUMER LIMITER. A login limiter exists to slow
 * a human or a script guessing a password: low ceilings, per-IP, and blocking is
 * the desired outcome. A provider callback limiter has the opposite failure
 * mode. Pocket is ONE origin sending EVERY learner's events, so all of its
 * traffic shares a small set of source addresses; a consumer-shaped ceiling
 * would throttle the entire integration during any burst — and the events it
 * refused would be real conversions. §51 names this exactly.
 *
 * THE SHAPE CHOSEN. A high steady ceiling with burst tolerance, still per-IP,
 * still applied BEFORE any database work so an unauthenticated flood cannot
 * cost a query. `429` is retry-safe and Pocket's retry is the recovery path, so
 * a refusal delays an event rather than losing it — provided the ceiling is high
 * enough that legitimate retries are not themselves refused, which is why the
 * retry allowance is part of the budget rather than an afterthought.
 *
 * WHAT THIS IS NOT, STATED PLAINLY. The underlying limiter is IN-MEMORY and
 * PER-PROCESS. With more than one application process the effective ceiling is
 * the value below multiplied by the process count, and a restart clears the
 * window. That is a genuine limitation and it is NOT fixed here: §51 explicitly
 * declines to have this wave invent a distributed limiter, and inventing one
 * badly would be worse than documenting a bounded one accurately. It is carried
 * to the deep-audit handoff as remaining PROD hardening.
 *
 * WHY IT IS STILL WORTH HAVING. It bounds the cost of an unauthenticated flood
 * against one process, which is the attack this layer can actually stop. It is
 * not, and is not presented as, the defence against a distributed attacker —
 * that is the provider secret's job, and the secret is timing-safe.
 */

/**
 * The per-IP budget for the Pocket callback endpoint.
 *
 * 600/minute is roughly ten events per second from one source address. Sized
 * against what a provider plausibly sends — including a catch-up burst after an
 * outage, which is precisely when refusing would be most expensive — rather than
 * against what a person plausibly types.
 */
export const POCKET_CALLBACK_RATE_LIMIT = {
  limit: 600,
  windowMs: 60_000,
} as const;

/**
 * The budget for authentication FAILURES from one address.
 *
 * Deliberately far tighter than the accepted-traffic budget above. A correctly
 * configured provider essentially never fails authentication, so a source
 * producing them is either misconfigured or probing — and neither deserves the
 * generous ceiling that exists to protect real conversions.
 *
 * This is what keeps raising the main ceiling from also raising the rate at
 * which a stolen-secret hunt can proceed.
 */
export const POCKET_CALLBACK_AUTH_FAILURE_LIMIT = {
  limit: 20,
  windowMs: 60_000,
} as const;

/** Namespaced so the two budgets cannot consume each other. */
export function pocketCallbackRateKey(ip: string): string {
  return `postback:pocket:${ip}`;
}

export function pocketCallbackAuthFailureKey(ip: string): string {
  return `postback:pocket:authfail:${ip}`;
}
