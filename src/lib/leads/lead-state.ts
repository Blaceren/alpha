/**
 * AFD-5B2B — journey stage and first-deposit state, kept apart on purpose.
 *
 * WHY TWO FIELDS AND NOT ONE STATUS. A single "status" would have to choose
 * between two facts that are both true and mean different things. A learner
 * whose deposit was legitimately counted and whose provider row was LATER
 * quarantined by a divergent redelivery has genuinely reached the deposit
 * milestone AND genuinely has a deposit an operator must look at. Collapsing
 * that into one enum forces a lie in one direction or the other: either the
 * conflict disappears from every list, or a confirmed, paid conversion is
 * displayed as unresolved. So there are two dimensions, each with exactly one
 * authoritative source:
 *
 *   journeyStage  — the LEDGER. How far this learner demonstrably got.
 *   depositState  — the PROVIDER ROW. What state Pocket's own event is in.
 *
 * NEITHER IS EVER DERIVED FROM THE OTHER, and neither is ever derived from a
 * balance: PVA-1 established that no authoritative balance exists, and
 * `ExchangeAccount.balance` carries no trading P&L.
 */

/**
 * The furthest AUTHORITATIVELY COMPLETED stage.
 *
 * There is no `pocket_registration_pending`, no `deposit_pending` and no
 * `churned`: every member here is a milestone some immutable row proves
 * happened. Anything a row cannot prove belongs in `depositState` or in an
 * integrity flag, not in a stage.
 */
export const LEAD_JOURNEY_STAGES = [
  "academy_registered",
  "pocket_registered",
  "first_deposit_confirmed",
] as const;
export type LeadJourneyStage = (typeof LEAD_JOURNEY_STAGES)[number];

/**
 * The current state of this lead's Pocket first-deposit event.
 *
 * `none` means NO EVENT IS LINKED TO THIS LEAD — which is not the same as "this
 * learner never deposited". A deposit whose Pocket identity has never been
 * bound by a trusted `goal=reg` belongs to nobody, by AFD-4's design, and
 * guessing an owner for it is precisely the fabrication this phase refuses.
 */
export const LEAD_DEPOSIT_STATES = [
  "none",
  "pending_identity",
  "conflict",
  "confirmed",
] as const;
export type LeadDepositState = (typeof LEAD_DEPOSIT_STATES)[number];

/**
 * Bounded, non-diagnostic integrity findings.
 *
 * Every member describes a shape of the STORED DATA, never a SQL error, a row
 * id, a column name or a provider payload. They exist so a malformed record is
 * reported instead of silently rendered as a clean one — §12's rule that a
 * broken lead must not get a fabricated timeline.
 */
export const LEAD_INTEGRITY_FLAGS = [
  /** More than one academy_registration event names this learner. */
  "duplicate_academy_registration",
  /** An attribution exists but its frozen click rows could not all be read. */
  "attribution_clicks_incomplete",
  /** A Pocket identity exists whose `source` is not the trusted binder. */
  "pocket_identity_untrusted_source",
  /** More than one provider deposit event resolves to this learner. */
  "multiple_provider_deposit_events",
  /** A deposit is still pending although the identity binding already exists. */
  "deposit_pending_after_identity_binding",
  /** The ledger has a confirmed deposit with no provider row behind it. */
  "confirmed_deposit_without_provider_event",
  /** More than one first_deposit conversion event names this learner. */
  "duplicate_first_deposit_conversion",
  /** A later milestone carries an earlier timestamp than its prerequisite. */
  "negative_journey_duration",
  /** Acquisition happened after the registration it supposedly caused. */
  "acquisition_after_registration",
] as const;
export type LeadIntegrityFlag = (typeof LEAD_INTEGRITY_FLAGS)[number];

/**
 * The raw, already-loaded facts one lead's state is decided from.
 *
 * Everything here is a stored column. There is no clock, no configuration and
 * no request in this shape, which is what makes `deriveLeadState` a pure
 * function two callers cannot disagree about.
 */
export type LeadStateFacts = {
  readonly academyRegisteredAt: Date;
  readonly academyRegistrationCount: number;
  /** Trusted only when the Pocket identity `source` is the registration binder. */
  readonly pocketRegisteredAt: Date | null;
  readonly pocketIdentitySource: string | null;
  readonly firstDepositConfirmedAt: Date | null;
  readonly firstDepositConversionCount: number;
  readonly providerEventCount: number;
  readonly providerStatus: string | null;
  readonly providerFirstReceivedAt: Date | null;
  readonly providerConflictDetectedAt: Date | null;
  readonly providerMatchedAt: Date | null;
};

/**
 * The provider row's state, reduced to the four members `depositState` has.
 *
 * A CONFLICT OUTRANKS A MATCH, and the reason is the database's own shape. The
 * `PocketProviderEvent` CHECK constraints allow exactly four reachable rows:
 *
 *   status=matched, no conflict code            an ordinary counted deposit
 *   status=matched, conflict code + instant     counted, then a later delivery
 *                                               disagreed. AFD-4 keeps the match
 *                                               rather than orphaning a
 *                                               canonical conversion, and flags
 *                                               the disagreement beside it.
 *   status=pending_identity                     no trusted owner yet
 *   status=conflict                             quarantined and NEVER counted
 *
 * Reading `status` alone would report the second row as a clean `confirmed` and
 * an operator would never see the disagreement — the row would be flagged in
 * the database and invisible in the product. So a detected conflict is reported
 * as `conflict` whether or not the deposit was also counted, and whether it WAS
 * counted is answered by `journeyStage`, which reads the ledger instead. That is
 * the whole reason the two fields are separate.
 */
export function deriveDepositState(facts: {
  readonly providerStatus: string | null;
  readonly providerConflictDetectedAt: Date | null;
}): LeadDepositState {
  if (facts.providerStatus === null) return "none";
  if (facts.providerStatus === "conflict" || facts.providerConflictDetectedAt !== null) {
    return "conflict";
  }
  if (facts.providerStatus === "matched") return "confirmed";
  return "pending_identity";
}

export type LeadState = {
  readonly journeyStage: LeadJourneyStage;
  readonly depositState: LeadDepositState;
  readonly pocketRegisteredAt: Date | null;
  readonly integrityFlags: readonly LeadIntegrityFlag[];
};

/** The one place `source` is judged. AFD-4 writes only this value. */
export const TRUSTED_POCKET_IDENTITY_SOURCE = "registration_postback";

export function isTrustedPocketIdentity(source: string | null): boolean {
  return source === TRUSTED_POCKET_IDENTITY_SOURCE;
}

/**
 * Decide both dimensions and collect every integrity finding.
 *
 * THE STAGE LADDER IS READ FROM THE TOP DOWN and each rung needs its own proof:
 *
 *   first_deposit_confirmed  a `first_deposit` AffiliateConversionEvent exists.
 *                            That row is the ledger's own immutable statement
 *                            that money was counted, and AFD-4 emits it exactly
 *                            once per Pocket player. A replay does not create
 *                            one, and a changed amount does not create one —
 *                            which is why neither can advance a stage.
 *   pocket_registered        a PocketTraderIdentity whose `source` is the
 *                            trusted binder. An untrusted source is NOT a
 *                            weaker yes: it is refused and flagged.
 *   academy_registered       the floor. Every lead has this by definition,
 *                            because the academy_registration event is what
 *                            makes it a lead at all.
 *
 * THE DEPOSIT STATE IS THE PROVIDER ROW'S OWN STATE — see `deriveDepositState`
 * for the four reachable rows and why a detected conflict outranks a match.
 * Nothing there consults the ledger, so "conflict" can never be read as
 * implying a confirmed deposit, and nothing here consults the provider row, so
 * a quarantine cannot silently undo a stage the ledger already recorded.
 */
export function deriveLeadState(facts: LeadStateFacts): LeadState {
  const flags = new Set<LeadIntegrityFlag>();

  if (facts.academyRegistrationCount > 1) flags.add("duplicate_academy_registration");
  if (facts.firstDepositConversionCount > 1) flags.add("duplicate_first_deposit_conversion");
  if (facts.providerEventCount > 1) flags.add("multiple_provider_deposit_events");

  const trusted =
    facts.pocketRegisteredAt !== null && isTrustedPocketIdentity(facts.pocketIdentitySource);
  if (facts.pocketRegisteredAt !== null && !trusted) {
    flags.add("pocket_identity_untrusted_source");
  }
  const pocketRegisteredAt = trusted ? facts.pocketRegisteredAt : null;

  const confirmed = facts.firstDepositConfirmedAt !== null;

  const journeyStage: LeadJourneyStage = confirmed
    ? "first_deposit_confirmed"
    : pocketRegisteredAt !== null
      ? "pocket_registered"
      : "academy_registered";

  const depositState = deriveDepositState(facts);

  // A deposit that is STILL pending although the trusted binding already exists
  // should have been reconciled by the `goal=reg` hook. Reporting it is how an
  // operator learns reconciliation did not run, instead of the lead quietly
  // looking like it never deposited.
  if (depositState === "pending_identity" && pocketRegisteredAt !== null) {
    flags.add("deposit_pending_after_identity_binding");
  }

  // The ledger says money was counted and no provider row stands behind it.
  // AFD-4 writes them in one transaction, so this cannot happen through the
  // supported path — which is exactly why it is worth saying out loud.
  if (confirmed && facts.providerEventCount === 0) {
    flags.add("confirmed_deposit_without_provider_event");
  }

  // Milestones that run backwards. FLAGGED, NEVER REORDERED: silently sorting a
  // deposit after the registration it precedes would erase the evidence that
  // something upstream is wrong.
  if (pocketRegisteredAt !== null && pocketRegisteredAt < facts.academyRegisteredAt) {
    flags.add("negative_journey_duration");
  }
  if (
    facts.firstDepositConfirmedAt !== null &&
    facts.firstDepositConfirmedAt < facts.academyRegisteredAt
  ) {
    flags.add("negative_journey_duration");
  }

  return {
    journeyStage,
    depositState,
    pocketRegisteredAt,
    integrityFlags: orderFlags(flags),
  };
}

/** Canonical order, so two responses about one lead never disagree. */
export function orderFlags(flags: Iterable<LeadIntegrityFlag>): LeadIntegrityFlag[] {
  const present = new Set(flags);
  return LEAD_INTEGRITY_FLAGS.filter((flag) => present.has(flag));
}
