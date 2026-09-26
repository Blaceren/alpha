/**
 * G4-GROWTH — the idempotency authority for every growth event family.
 *
 * THIS FILE IS THE CONTRACT, AND IT HAS TWO IMPLEMENTATIONS. The runtime
 * emitters call the functions below. Migration
 * `20260813000000_growth_event_foundation` builds the same strings in SQL to
 * backfill history. If the two ever disagree, a backfilled row and a runtime row
 * for the same owner both exist and every downstream count is inflated — so
 * `event-keys.test.ts` asserts these functions against the literal SQL in the
 * migration file rather than against a copy of it.
 *
 * WHY A KEY PER FAMILY RATHER THAN ONE RULE. §13 of the phase brief asks for an
 * explicit authority per family, and the families genuinely differ:
 *
 *   * `ata_reg` keys on the USER, because one registered user is one
 *     registration however many times a request is replayed.
 *   * `pocket_reg` and `dep` key on the POCKET PLAYER, because that is the
 *     identity the provider holds and the one a future reconciliation against
 *     Pocket would have to agree with. Keying on a local row id would make the
 *     key meaningless to the only other party that could ever check it.
 *   * `academy_activation` keys on the ENROLLMENT, because activation is a
 *     property of an enrollment and the level that triggered it is incidental.
 *   * `report_approved` keys on the SUBMISSION, not the review, because a
 *     submission is approved once — a second approval of the same work is not a
 *     second business event.
 *   * progression families key on the PROGRESS ROW, which the database already
 *     constrains to one per (enrollment, level).
 *
 * NONE OF THESE IS A HASH OF PAYLOAD CONTENT. A key derived from what a message
 * said cannot distinguish a retry from a genuine repeat, which is precisely the
 * mistake this platform has already refused once for Pocket deposits.
 */

/** The owner namespaces a `sourceEventId` is unique within. */
export const GROWTH_SOURCE_OWNERS = [
  "acquisition_click",
  "auth_register",
  "curriculum_enrollment",
  "curriculum_level_progress",
  "curriculum_assessment_attempt",
  "curriculum_report_submission",
  "curriculum_report_review",
  "curriculum_mentor_review",
  "pocket_identity_binding",
  "pocket_first_deposit",
  "pocket_redeposit",
] as const;

export type GrowthSourceOwner = (typeof GROWTH_SOURCE_OWNERS)[number];

export const GROWTH_EVENT_TYPES = [
  "traffic_click",
  "ata_reg",
  "curriculum_enrollment",
  "academy_activation",
  "level_started",
  "level_completed",
  "assessment_completed",
  "report_submitted",
  "report_approved",
  "mentor_review_submitted",
  "mentor_review_approved",
  "pocket_reg",
  "dep",
  "rdep",
] as const;

export type GrowthEventType = (typeof GROWTH_EVENT_TYPES)[number];

/** One acquisition click. */
export function clickSourceEventId(affiliateClickId: number): string {
  return `click:${affiliateClickId}`;
}

/**
 * One registered ATA user.
 *
 * Deliberately the same shape as the accepted
 * `registrationSourceEventId` in `registration-attribution.ts`, and for the same
 * reason: an email address is mutable and re-registrable, so keying on it would
 * let one learner produce two registrations by changing their address.
 */
export function userSourceEventId(userId: number): string {
  return `user:${userId}`;
}

/** One curriculum enrollment, and one activation of that enrollment. */
export function enrollmentSourceEventId(enrollmentId: number): string {
  return `enrollment:${enrollmentId}`;
}

/** One `UserLevelProgress` row — already unique per (enrollment, level). */
export function progressSourceEventId(userLevelProgressId: number): string {
  return `progress:${userLevelProgressId}`;
}

/** One submitted assessment attempt. */
export function assessmentAttemptSourceEventId(attemptId: number): string {
  return `attempt:${attemptId}`;
}

/** One report submission — used by both `report_submitted` and `report_approved`. */
export function reportSubmissionSourceEventId(submissionId: number): string {
  return `submission:${submissionId}`;
}

/**
 * One Pocket player, in the provider's own namespace.
 *
 * Used by `pocket_reg` and by `dep`. The two are different event types, so the
 * shared key cannot collide: the unique index covers `(eventType, sourceOwner,
 * sourceEventId)` and each family declares a different owner as well.
 */
export function pocketPlayerSourceEventId(pocketPlayerId: string): string {
  return `pocket:player:${pocketPlayerId}`;
}

/**
 * One provider-supplied redeposit event identity.
 *
 * THE ONLY KEY THIS PLATFORM WILL ACCEPT FOR A REDEPOSIT. It requires an
 * identifier the PROVIDER generated and guarantees is stable across retries.
 * There is deliberately no fallback overload taking a player, an amount and a
 * timestamp: two legitimate redeposits can share all three, so such a key would
 * silently collapse real money into one row. When Pocket supplies no identity,
 * the caller does not compute a degraded key — it declines to emit, and the
 * delivery is recorded as `identity_unresolved` instead.
 */
export function redepositSourceEventId(providerEventIdentity: string): string {
  return `pocket:event:${providerEventIdentity}`;
}

/**
 * The owner table each family is derived from, for `sourceEntityType`.
 *
 * G4-R8 — WHY `ata_reg` NAMES THE USER.
 *
 * It used to declare `AffiliateConversionEvent` while `sourceEntityId` carried
 * a `User.id` and both backfill passes wrote `'User'`. The column exists so a
 * reader can find the origin row without a mapping, and a type that does not
 * name the table the id belongs to defeats exactly that. The disagreement was
 * never a duplication risk — `sourceEntityType` is not part of `UNIQUE
 * (eventType, sourceOwner, sourceEventId)` — but it made the ledger's own
 * provenance untrue, which is the reason it is corrected rather than tolerated.
 *
 * SAFE TO CHANGE, MEASURED RATHER THAN ASSUMED. Every `ata_reg` row that exists
 * carries `'User'` already: the family is backfill-only today and the runtime
 * emitter has never written one. So this changes no stored row, contradicts no
 * stored row, and brings the runtime into agreement with 100% of the history
 * rather than introducing a second spelling into it.
 *
 * The registration event is the account coming into existence. The
 * `AUTH_REGISTER` audit row proves that origin was self-service — it is the
 * membership predicate the backfill selects on — but it is not the owner of the
 * fact, and `sourceEntityId` has always been the `User.id`.
 */
export const GROWTH_SOURCE_ENTITY_TYPES = {
  traffic_click: "AffiliateClick",
  ata_reg: "User",
  curriculum_enrollment: "UserCurriculumEnrollment",
  academy_activation: "UserLevelProgress",
  level_started: "UserLevelProgress",
  level_completed: "UserLevelProgress",
  assessment_completed: "AssessmentAttempt",
  report_submitted: "ReportSubmission",
  report_approved: "ReportReview",
  mentor_review_submitted: "UserLevelProgress",
  mentor_review_approved: "UserLevelProgress",
  pocket_reg: "PocketTraderIdentity",
  dep: "PocketProviderEvent",
  // POCKET-DEP-RDEP-1. A canonical redeposit now lives in PocketProviderEvent
  // beside the first deposit, so the OWNER of the fact moved with it. It used to
  // name ProviderIngressEvent because, without an identity, the only durable
  // artefact was the delivery record — evidence standing in for an event that
  // could not be written. Now that the event exists, evidence and event are
  // different rows again, and this names the event.
  rdep: "PocketProviderEvent",
} as const satisfies Record<GrowthEventType, string>;

/** The owner namespace each family declares. */
export const GROWTH_SOURCE_OWNER_BY_TYPE = {
  traffic_click: "acquisition_click",
  ata_reg: "auth_register",
  curriculum_enrollment: "curriculum_enrollment",
  academy_activation: "curriculum_level_progress",
  level_started: "curriculum_level_progress",
  level_completed: "curriculum_level_progress",
  assessment_completed: "curriculum_assessment_attempt",
  report_submitted: "curriculum_report_submission",
  report_approved: "curriculum_report_review",
  mentor_review_submitted: "curriculum_mentor_review",
  mentor_review_approved: "curriculum_mentor_review",
  pocket_reg: "pocket_identity_binding",
  dep: "pocket_first_deposit",
  rdep: "pocket_redeposit",
} as const satisfies Record<GrowthEventType, GrowthSourceOwner>;
