/**
 * POCKET-REG-SECURITY-CLOSURE-1 (§17/§18) — which PREPROD learners are
 * acceptance fixtures, stated in source rather than remembered.
 *
 * THE PROBLEM THIS SOLVES. Proving the Pocket integration works requires
 * driving a real registration through the real public edge, which creates real
 * rows: an identity, a canonical `pocket_reg`, a level completion, growth
 * events. Those rows are indistinguishable, to any dashboard, from a real
 * learner's — so a Growth surface would present acceptance activity as business
 * activity, and nobody reading it would know.
 *
 * Deleting the fixture after acceptance is the other option, and it is worse:
 * the runtime rows ARE the evidence that the integration works, and removing
 * them returns the ledger to "0 runtime rows", which is the state four
 * consecutive audits recorded as the thing that had to change.
 *
 * SO THE FIXTURES ARE RETAINED AND MADE IDENTIFIABLE.
 *
 * THE MARKER IS THE EMAIL DOMAIN, AND THAT IS DELIBERATE. `.invalid` is
 * reserved by RFC 2606 and can never be a real address, so an account on this
 * domain cannot be a real person by construction — no schema change, no new
 * column, no migration, and nothing an operator has to remember to set. The
 * accounts were already created this way; this module makes the convention
 * enforceable instead of incidental.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not subtract anything from any metric.
 * §18 forbids silently removing data client-side, and a dashboard that quietly
 * drops rows is how a real number goes missing. It provides IDENTIFICATION; the
 * decision to report "N of M events are acceptance fixtures" belongs to the
 * surface, stated out loud.
 */

/**
 * The reserved domain for PREPROD acceptance fixtures.
 *
 * RFC 2606 guarantees `.invalid` is never resolvable, so this cannot collide
 * with a real learner address.
 */
export const SYNTHETIC_FIXTURE_EMAIL_DOMAIN = "@ata-preprod.invalid";

/**
 * Is this learner an acceptance fixture rather than a person?
 *
 * Case-insensitive: addresses are compared lower-cased, because a fixture
 * created with different casing is still a fixture.
 */
export function isSyntheticFixtureEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string") return false;
  return email.trim().toLowerCase().endsWith(SYNTHETIC_FIXTURE_EMAIL_DOMAIN);
}

/**
 * The SQL predicate for the same rule, for reporting queries.
 *
 * Kept beside the TypeScript predicate so the two cannot drift into disagreeing
 * about what counts as a fixture — the failure mode that makes a "test data"
 * convention untrustworthy.
 */
export const SYNTHETIC_FIXTURE_SQL_PREDICATE = `LOWER("email") LIKE '%${SYNTHETIC_FIXTURE_EMAIL_DOMAIN}'`;

/**
 * Why a given fixture exists. Recorded in the phase package, not in the
 * database: the classification is an audit fact about how a row came to be,
 * and inventing a column for it would be a schema change this phase does not
 * need.
 */
export type SyntheticFixtureClass =
  /** Created deliberately, retained deliberately, and expected to persist. */
  | "INTENTIONAL_PERSISTENT_PREPROD_FIXTURE"
  /** Created by a provisioning attempt that failed part-way; carries no business fact. */
  | "FAILED_PROVISIONING_ARTIFACT"
  /** Created for one acceptance run and removed afterwards. */
  | "DISPOSABLE_ACCEPTANCE_FIXTURE";
