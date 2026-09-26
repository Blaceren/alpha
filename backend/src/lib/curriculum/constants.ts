// Approved stable code format (V2_PRODUCT_DECISIONS.md §8):
// v2.lNNN.<lowercase-kebab-slug>, NNN is always three digits and must match levelNumber.
export const STABLE_CODE_PATTERN = /^v2\.l(\d{3})\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const DEFAULT_CURRICULUM_CODE = "ata-v2" as const;

export const CURRICULUM_AUDIT_ACTIONS = {
  published: "CURRICULUM_VERSION_PUBLISHED",
  replaced: "CURRICULUM_VERSION_REPLACED",
  archived: "CURRICULUM_VERSION_ARCHIVED",
  publicationRejected: "CURRICULUM_PUBLICATION_REJECTED",
  draftCreated: "CURRICULUM_DRAFT_CREATED",
  draftUpdated: "CURRICULUM_DRAFT_UPDATED",
  draftDeleted: "CURRICULUM_DRAFT_DELETED",
  moduleCreated: "MODULE_DEFINITION_CREATED",
  moduleUpdated: "MODULE_DEFINITION_UPDATED",
  moduleDeleted: "MODULE_DEFINITION_DELETED",
  levelCreated: "LEVEL_DEFINITION_CREATED",
  levelUpdated: "LEVEL_DEFINITION_UPDATED",
  levelDeleted: "LEVEL_DEFINITION_DELETED",
  userEnrolled: "CURRICULUM_USER_ENROLLED",
  levelStarted: "CURRICULUM_LEVEL_STARTED",
  levelCompleted: "CURRICULUM_LEVEL_COMPLETED",
  // L4VC-1. Recorded ONLY when a financial checkpoint is passed; a refusal or
  // an unavailable provider writes nothing, so the presence of this action is
  // itself the proof that a threshold was met.
  checkpointVerified: "CURRICULUM_CHECKPOINT_VERIFIED",
  // A8. Written in the SAME transaction that creates a StagingAttestation, so a
  // durable attestation without an audit record is not a state the database can
  // hold. Recorded before any completion is attempted, so an attestation whose
  // completion later fails is still fully accounted for.
  stagingAttestationRecorded: "CURRICULUM_STAGING_ATTESTATION_RECORDED",
  // A4. The learner moving their own mentor-review level into `pending_review`.
  // A learner-owned transition, and the only one they own on this level.
  mentorReviewRequested: "CURRICULUM_MENTOR_REVIEW_REQUESTED",
  xpAwarded: "CURRICULUM_XP_AWARDED",
  contentVersionCreated: "CONTENT_VERSION_CREATED",
  contentVersionUpdated: "CONTENT_VERSION_UPDATED",
  contentVersionDeleted: "CONTENT_VERSION_DELETED",
  contentVersionPublished: "CONTENT_VERSION_PUBLISHED",
  contentVersionReplaced: "CONTENT_VERSION_REPLACED",
  contentVersionArchived: "CONTENT_VERSION_ARCHIVED",
  contentLocalizationCreated: "CONTENT_LOCALIZATION_CREATED",
  contentLocalizationUpdated: "CONTENT_LOCALIZATION_UPDATED",
  contentLocalizationDeleted: "CONTENT_LOCALIZATION_DELETED",
  contentAssetCreated: "CONTENT_ASSET_CREATED",
  contentAssetUpdated: "CONTENT_ASSET_UPDATED",
  contentAssetDeleted: "CONTENT_ASSET_DELETED",
  contentBound: "CONTENT_BOUND",
  contentUnbound: "CONTENT_UNBOUND",
  contentPublicationRejected: "CONTENT_PUBLICATION_REJECTED",
  assessmentVersionCreated: "ASSESSMENT_VERSION_CREATED",
  assessmentVersionUpdated: "ASSESSMENT_VERSION_UPDATED",
  assessmentVersionDeleted: "ASSESSMENT_VERSION_DELETED",
  assessmentVersionPublished: "ASSESSMENT_VERSION_PUBLISHED",
  assessmentVersionReplaced: "ASSESSMENT_VERSION_REPLACED",
  assessmentVersionArchived: "ASSESSMENT_VERSION_ARCHIVED",
  assessmentQuestionCreated: "ASSESSMENT_QUESTION_CREATED",
  assessmentQuestionUpdated: "ASSESSMENT_QUESTION_UPDATED",
  assessmentQuestionDeleted: "ASSESSMENT_QUESTION_DELETED",
  assessmentLocalizationCreated: "ASSESSMENT_LOCALIZATION_CREATED",
  assessmentLocalizationUpdated: "ASSESSMENT_LOCALIZATION_UPDATED",
  assessmentLocalizationDeleted: "ASSESSMENT_LOCALIZATION_DELETED",
  assessmentBound: "ASSESSMENT_BOUND",
  assessmentUnbound: "ASSESSMENT_UNBOUND",
  assessmentPublicationRejected: "ASSESSMENT_PUBLICATION_REJECTED",
  assessmentAttemptStarted: "CURRICULUM_ASSESSMENT_ATTEMPT_STARTED",
  assessmentAttemptGraded: "CURRICULUM_ASSESSMENT_ATTEMPT_GRADED",
  reportAssignmentCreated: "REPORT_ASSIGNMENT_CREATED",
  reportAssignmentUpdated: "REPORT_ASSIGNMENT_UPDATED",
  reportAssignmentDeleted: "REPORT_ASSIGNMENT_DELETED",
  reportAssignmentPublished: "REPORT_ASSIGNMENT_PUBLISHED",
  reportAssignmentReplaced: "REPORT_ASSIGNMENT_REPLACED",
  reportAssignmentArchived: "REPORT_ASSIGNMENT_ARCHIVED",
  reportAssignmentLocalizationCreated: "REPORT_ASSIGNMENT_LOCALIZATION_CREATED",
  reportAssignmentLocalizationUpdated: "REPORT_ASSIGNMENT_LOCALIZATION_UPDATED",
  reportAssignmentLocalizationDeleted: "REPORT_ASSIGNMENT_LOCALIZATION_DELETED",
  reportFieldCreated: "REPORT_FIELD_CREATED",
  reportFieldUpdated: "REPORT_FIELD_UPDATED",
  reportFieldDeleted: "REPORT_FIELD_DELETED",
  reportFieldLocalizationCreated: "REPORT_FIELD_LOCALIZATION_CREATED",
  reportFieldLocalizationUpdated: "REPORT_FIELD_LOCALIZATION_UPDATED",
  reportFieldLocalizationDeleted: "REPORT_FIELD_LOCALIZATION_DELETED",
  reportRubricCreated: "REPORT_RUBRIC_CREATED",
  reportRubricUpdated: "REPORT_RUBRIC_UPDATED",
  reportRubricDeleted: "REPORT_RUBRIC_DELETED",
  reportRubricPublished: "REPORT_RUBRIC_PUBLISHED",
  reportRubricReplaced: "REPORT_RUBRIC_REPLACED",
  reportRubricArchived: "REPORT_RUBRIC_ARCHIVED",
  reportCriterionCreated: "REPORT_CRITERION_CREATED",
  reportCriterionUpdated: "REPORT_CRITERION_UPDATED",
  reportCriterionDeleted: "REPORT_CRITERION_DELETED",
  reportCriterionLocalizationCreated: "REPORT_CRITERION_LOCALIZATION_CREATED",
  reportCriterionLocalizationUpdated: "REPORT_CRITERION_LOCALIZATION_UPDATED",
  reportCriterionLocalizationDeleted: "REPORT_CRITERION_LOCALIZATION_DELETED",
  reportScaleOptionCreated: "REPORT_SCALE_OPTION_CREATED",
  reportScaleOptionUpdated: "REPORT_SCALE_OPTION_UPDATED",
  reportScaleOptionDeleted: "REPORT_SCALE_OPTION_DELETED",
  reportScaleLocalizationCreated: "REPORT_SCALE_LOCALIZATION_CREATED",
  reportScaleLocalizationUpdated: "REPORT_SCALE_LOCALIZATION_UPDATED",
  reportScaleLocalizationDeleted: "REPORT_SCALE_LOCALIZATION_DELETED",
  reportReasonCreated: "REPORT_REASON_CREATED",
  reportReasonUpdated: "REPORT_REASON_UPDATED",
  reportReasonDeleted: "REPORT_REASON_DELETED",
  reportReasonLocalizationCreated: "REPORT_REASON_LOCALIZATION_CREATED",
  reportReasonLocalizationUpdated: "REPORT_REASON_LOCALIZATION_UPDATED",
  reportReasonLocalizationDeleted: "REPORT_REASON_LOCALIZATION_DELETED",
  reportBound: "REPORT_BOUND",
  reportUnbound: "REPORT_UNBOUND",
  reportSubmitted: "REPORT_SUBMITTED",
  reportResubmitted: "REPORT_RESUBMITTED",
  reportClaimed: "REPORT_CLAIMED",
  reportReviewStarted: "REPORT_REVIEW_STARTED",
  reportReassigned: "REPORT_REASSIGNED",
  reportRejected: "REPORT_REJECTED",
  reportApproved: "REPORT_APPROVED",
  reportAttachmentAvailable: "CURRICULUM_REPORT_ATTACHMENT_AVAILABLE",
  reportAttachmentDeleted: "CURRICULUM_REPORT_ATTACHMENT_DELETED",
  reportAttachmentRejected: "CURRICULUM_REPORT_ATTACHMENT_REJECTED",

  // PHASE-G0 — the EDITORIAL axis. These are deliberately distinct from the
  // CONTENT_VERSION_PUBLISHED / ASSESSMENT_VERSION_PUBLISHED actions above:
  // those record a RUNTIME activation, these record a HUMAN editorial decision,
  // and an operator reading the trail must never have to guess which happened.
  // `AUTHORING_APPROVED` in particular never implies publication.
  authoringSubmittedForReview: "AUTHORING_SUBMITTED_FOR_REVIEW",
  authoringChangesRequested: "AUTHORING_CHANGES_REQUESTED",
  authoringApproved: "AUTHORING_APPROVED",
  authoringReviewNoteAdded: "AUTHORING_REVIEW_NOTE_ADDED",
  authoringReviewNoteResolved: "AUTHORING_REVIEW_NOTE_RESOLVED",
  authoringVideoProductionCreated: "AUTHORING_VIDEO_PRODUCTION_CREATED",
  authoringVideoProductionUpdated: "AUTHORING_VIDEO_PRODUCTION_UPDATED",
  authoringVideoProductionBootstrapped: "AUTHORING_VIDEO_PRODUCTION_BOOTSTRAPPED",

  // PHASE-G0 CORRECTION.
  authoringPreviewSnapshotCreated: "AUTHORING_PREVIEW_SNAPSHOT_CREATED",
  // A four-eyes refusal. Recorded because "who tried to approve their own work"
  // is an operational question, and a refusal that leaves no trace can only be
  // answered by guessing. It carries actor, target and reason and NO draft
  // content -- see authoring-lifecycle.ts for why it is written in its own
  // transaction rather than inside the refused one.
  authoringSelfApprovalRefused: "AUTHORING_SELF_APPROVAL_REFUSED",

  // PHASE-G1.
  //
  // A NEW DRAFT CLONED FROM AN EXISTING VERSION. Its own action rather than
  // CONTENT_VERSION_CREATED, because the two answer different questions: a
  // create says "an empty version now exists", a clone says "this text is a copy
  // of approved version N and the approval did NOT travel with it". The metadata
  // records the source id and its editorial state so the trail can prove the
  // approved evidence was left untouched.
  authoringVersionCloned: "AUTHORING_VERSION_CLONED",
  // A deterministic package-handoff bundle was produced. It is NOT a
  // publication and NOT an activation: the action name says handoff, and the
  // metadata records the fingerprint so the artifact a reviewer holds can be
  // matched to the moment it was generated.
  authoringHandoffBundleGenerated: "AUTHORING_HANDOFF_BUNDLE_GENERATED",

  // PHASE-G2 FOUNDATION.
  //
  // A HUMAN CHOSE BETWEEN TWO COMPETING SOURCES. Deliberately NOT
  // AUTHORING_APPROVED: approval accepts work as editorial truth, adjudication
  // decides which of two sources the work should follow, and a bank that has
  // been adjudicated still owes the product a normal four-eyes review. The
  // metadata carries the exact conflict paths, both value hashes, the evidence
  // identity and the authority state before and after, so the trail proves what
  // was settled without anyone re-deriving it from a later database state.
  authoringSourceAuthorityResolved: "AUTHORING_SOURCE_AUTHORITY_RESOLVED",

  // PHASE-1 ADMIN — the ENVELOPE event for one administrative progression
  // correction. Exactly one per accepted request, however many levels it moved.
  //
  // It does not replace the per-level `CURRICULUM_LEVEL_COMPLETED` rows the
  // engine writes anyway; it explains them. Those rows answer "what changed",
  // this one answers "who decided, why, and under which reference" — which is
  // the question an auditor actually arrives with, and the one a pile of
  // per-level rows cannot answer on its own.
  progressionAdjusted: "CURRICULUM_PROGRESSION_ADJUSTED",
} as const;

/**
 * PHASE-1 ADMIN — the closed reason vocabulary for a progression correction.
 *
 * CLOSED, because a free-text-only reason is a field that reads as documentation
 * and aggregates as nothing: six months on, "why do we keep correcting
 * progression?" has to be answerable by grouping, not by reading. The code says
 * WHICH KIND of correction this was; `reasonText` (mandatory, and stored only in
 * the AuditLog envelope) says what actually happened.
 *
 * `other` exists so an operator facing a genuinely novel situation is never
 * pushed into mislabelling it as one of the four — a miscoded reason is worse
 * than an honest `other` with prose beside it.
 */
export const PROGRESSION_ADJUSTMENT_REASON_CODES = [
  "preprod_qa",
  "support_correction",
  "state_recovery",
  "data_correction",
  "other",
] as const;

export type ProgressionAdjustmentReasonCode =
  (typeof PROGRESSION_ADJUSTMENT_REASON_CODES)[number];

export function isProgressionAdjustmentReasonCode(
  value: unknown,
): value is ProgressionAdjustmentReasonCode {
  return (
    typeof value === "string" &&
    (PROGRESSION_ADJUSTMENT_REASON_CODES as readonly string[]).includes(value)
  );
}
