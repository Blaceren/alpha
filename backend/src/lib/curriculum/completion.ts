import { createHash } from "node:crypto";
import {
  Prisma,
  type CurriculumXpSourceType,
  type PrismaClient,
  type UserLevelProgressStatus,
} from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2XpEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  emitLevelCompletedEvent,
  emitMentorReviewApprovedEvent,
} from "@/lib/growth/product-events";
import { isFinancialCheckpointType } from "./checkpoint";
import {
  ADMIN_CORRECTABLE_COMPLETION_PAIRS,
  isProtectedAuthorityPair,
  PRODUCTION_COMPLETION_PAIRS,
  STAGING_ATTESTED_COMPLETION_PAIRS,
  ZERO_REWARD_ONLY_OWNERS,
} from "./completion-pairs";
import {
  CURRICULUM_AUDIT_ACTIONS,
  DEFAULT_CURRICULUM_CODE,
  isProgressionAdjustmentReasonCode,
} from "./constants";
import { isStagingAttestationUsable } from "./staging-attestation-policy";
import {
  validatePinnedEnrollmentSnapshot,
  type EnrollmentResolutionGraph,
} from "./resolver";
import {
  isCurriculumXpError,
  recordCurriculumXpInTransaction,
  resolveEnrollmentXp,
  verifyCurriculumXpAwardInTransaction,
  type CurriculumXpTransactionSummary,
} from "./xp";

const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const MAX_SOURCE_ID_LENGTH = 200;
const UNSAFE_REVIEW_TEXT = /<\/?[a-z][^>]*>|\bon[a-z]+\s*=|javascript\s*:|data\s*:/i;

/**
 * Completion owners that can carry an XP reward. Every member is also a member
 * of `CurriculumXpSourceType`, so an award is representable in the ledger.
 */
export type CurriculumXpBearingCompletionSource = Extract<
  CurriculumXpSourceType,
  | "level_completion"
  | "assessment_pass"
  | "report_approval"
  | "mentor_completion"
>;

/**
 * The financial-checkpoint owner (L4VC-1).
 *
 * Deliberately NOT a member of `CurriculumXpSourceType`. A checkpoint is a gate,
 * not an achievement: it awards nothing. Keeping it outside the XP vocabulary
 * means an XPTransaction for a checkpoint is not merely forbidden by a rule —
 * it does not typecheck, and the database CHECK constraint on
 * `XPTransaction.sourceType` would reject it even if it did.
 */
export type CurriculumCheckpointCompletionSource = "checkpoint_verification";

/**
 * L1OWNER-1 — the authenticated Pocket registration owner.
 *
 * Level 1 is `external_event:pocket_postback`: the learner completes it by
 * registering with Pocket, and the only trustworthy witness of that is a
 * postback ATA itself authenticated. Before this owner existed the pair had NO
 * entry in `OWNER_RULES`, so a successful registration bound the identity, set
 * the account connected, completed the legacy V1 task — and left curriculum L1
 * untouched. Every learner was stuck on L1, and L2-L4 were unreachable; earlier
 * end-to-end phases hid it by inserting UserLevelProgress rows directly.
 *
 * Like the checkpoint owner this is deliberately NOT XP-bearing: registration is
 * a gate, not an achievement. Keeping it outside `CurriculumXpSourceType` means
 * an XPTransaction for it does not typecheck, and the database CHECK constraint
 * on `XPTransaction.sourceType` would reject it even if it did.
 */
export type CurriculumPocketRegistrationCompletionSource = "pocket_registration_postback";

/**
 * A8 — the STAGING-ONLY QA attestation owners.
 *
 * They say one thing and one thing only: "an authorized PREPROD operator
 * attested that this gate should be considered satisfied for QA". They do NOT
 * say the learner deposited money and they do NOT say Pocket witnessed a
 * registration. That distinction is why they are separate sources rather than a
 * second way to reach `checkpoint_verification` /
 * `pocket_registration_postback`: the completion audit, the progress row's
 * provenance and every later reader can tell a QA attestation from a real
 * financial or partner event by its source alone, permanently.
 *
 * Like the two production gate owners they are deliberately NOT members of
 * `CurriculumXpSourceType`, so an XPTransaction for a staging attestation does
 * not typecheck and the database CHECK constraint would reject it anyway.
 */
export type CurriculumStagingAttestedCompletionSource =
  | "staging_attested_registration"
  | "staging_attested_checkpoint";

/**
 * PHASE-1 ADMIN — the administrative forward-correction owner.
 *
 * WHAT IT SAYS, EXACTLY: "an authorized CRM operator recorded that this level
 * should count as completed for progression purposes, and here is who, when and
 * why." It does NOT say the learner passed an assessment, wrote a report, was
 * approved by a mentor, or did anything at all. That distinction is the entire
 * reason it is a separate source rather than a second route into
 * `assessment_pass` / `report_approval` / `mentor_completion`: the progress
 * row's own `completionMethod`, the completion audit and the XP ledger all name
 * `admin_correction` permanently, so no later reader can mistake an
 * administrative correction for educational evidence.
 *
 * IT IS A MEMBER OF `CurriculumXpSourceType`. That is deliberate and it is what
 * makes the XP arithmetic survive a correction: a corrected learner reaches
 * level 15 with the same total the ordinary path would have given them, so
 * `requiredXp` gates downstream keep working, while every one of those points
 * is filterable by source. The alternative — awarding nothing — would leave a
 * corrected learner permanently unable to pass an XP-gated level, which is a
 * different corruption wearing an honest face.
 *
 * IT CAN NEVER REACH A PROTECTED GATE. `financial_checkpoint:balance_check` and
 * `external_event:pocket_postback` are absent from its pair set (which is
 * DERIVED by subtraction in `completion-pairs.ts`, not listed), and
 * `assertAdminCorrectionBoundary` re-checks that here, inside the transaction,
 * so calling the primitive directly cannot bypass the HTTP layer.
 */
export type CurriculumAdministrativeCompletionSource = "admin_correction";

export type CurriculumLevelCompletionSource =
  | CurriculumXpBearingCompletionSource
  | CurriculumCheckpointCompletionSource
  | CurriculumPocketRegistrationCompletionSource
  | CurriculumStagingAttestedCompletionSource
  | CurriculumAdministrativeCompletionSource;

const COMPLETION_SOURCES = new Set<string>([
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
  "checkpoint_verification",
  "pocket_registration_postback",
  "staging_attested_registration",
  "staging_attested_checkpoint",
  "admin_correction",
]);

/** The subset that may appear in the XP ledger. */
const XP_BEARING_SOURCES: CurriculumXpBearingCompletionSource[] = [
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
];

/**
 * PHASE-1 ADMIN — why there is no `admin_correction` entry beside these.
 *
 * `levelXpRows` finds a level's durable award BY `levelDefinitionId`, and an
 * administrative award deliberately names no level (see `xpInput`). So an
 * administrative row is invisible to that query by construction, and listing the
 * source here would change nothing except to suggest otherwise. The retry path
 * verifies an administrative award by its idempotency key instead, which is the
 * identity it actually has.
 */
void XP_BEARING_SOURCES;

/**
 * A source that can never award XP, whatever the level definition says.
 *
 * The membership comes from `completion-pairs.ts` rather than being repeated
 * here, so the package validator — which refuses a positive reward on a
 * zero-reward pair at authoring time — and this engine, which refuses the
 * completion at runtime, are answering from ONE list. A8's two staging owners
 * are in it for the same reason the two production gates are: a QA attestation
 * stands in for a gate, and a gate awards nothing.
 *
 * The explicit return type keeps the narrowing a `Set` lookup cannot express.
 */
function isZeroRewardOnlySource(
  sourceType: CurriculumLevelCompletionSource,
): sourceType is
  | CurriculumCheckpointCompletionSource
  | CurriculumPocketRegistrationCompletionSource
  | CurriculumStagingAttestedCompletionSource {
  return ZERO_REWARD_ONLY_OWNERS.has(sourceType);
}

/** A8 — the two staging-only owners, as a runtime predicate. */
function isStagingAttestedSource(
  sourceType: CurriculumLevelCompletionSource,
): sourceType is CurriculumStagingAttestedCompletionSource {
  return (
    sourceType === "staging_attested_registration" ||
    sourceType === "staging_attested_checkpoint"
  );
}

/** PHASE-1 ADMIN — the administrative owner, as a runtime predicate. */
function isAdministrativeSource(
  sourceType: CurriculumLevelCompletionSource,
): sourceType is CurriculumAdministrativeCompletionSource {
  return sourceType === "admin_correction";
}

type OwnerRule = {
  /**
   * The progress status this owner normally takes over from, and the one its
   * CAS claims when nothing else is stated.
   */
  initialStatus: UserLevelProgressStatus;
  /**
   * Additional pre-completion statuses this owner may take over from.
   *
   * ONLY the administrative owner has any, and it needs them for a specific,
   * real case: a learner who submitted a mentor-review level sits at
   * `pending_review`, and a learner who merely started one sits at
   * `in_progress`. A correction has to be able to resolve BOTH, or the single
   * state operators most often need to unstick would be the one state they
   * could not. Every other owner keeps exactly one takeover status, which is
   * what makes `pending_review` the authorization boundary for mentor review.
   */
  alsoTakesOver?: readonly UserLevelProgressStatus[];
  pairs: ReadonlySet<string>;
};

/** Every pre-completion status an owner may claim, in CAS order. */
function takeoverStatuses(
  sourceType: CurriculumLevelCompletionSource,
): UserLevelProgressStatus[] {
  const rule = OWNER_RULES[sourceType];
  return [rule.initialStatus, ...(rule.alsoTakesOver ?? [])];
}

// Only mappings already made unambiguous by the V2 definition vocabulary are
// accepted. Scenario/practice definitions remain unavailable until their owning
// phase defines a durable authorization contract.
//
// The pair lists come from `completion-pairs.ts` so package validation can
// check a curriculum against the SAME vocabulary the runtime enforces; the
// `initialStatus` — the progress state an owner is allowed to take over from —
// stays here, because it is authorization rather than vocabulary.
const OWNER_RULES: Record<CurriculumLevelCompletionSource, OwnerRule> = {
  // Product decision R1: `lesson:manual` is how a practical level completes.
  // Real practical content, an explicit learner action, one canonical engine.
  level_completion: {
    initialStatus: "in_progress",
    pairs: new Set(PRODUCTION_COMPLETION_PAIRS.level_completion),
  },
  assessment_pass: {
    initialStatus: "in_progress",
    pairs: new Set(PRODUCTION_COMPLETION_PAIRS.assessment_pass),
  },
  report_approval: {
    initialStatus: "pending_review",
    pairs: new Set(PRODUCTION_COMPLETION_PAIRS.report_approval),
  },
  // A4. `pending_review` is the whole authorization boundary: the learner puts
  // their own progress there and cannot leave it, and only an authorized
  // reviewer — never the learner — hands it to this owner.
  mentor_completion: {
    initialStatus: "pending_review",
    pairs: new Set(PRODUCTION_COMPLETION_PAIRS.mentor_completion),
  },
  // L4VC-1. The verification engine is the ONLY owner of a financial
  // checkpoint: it is not startable by the learner, not completable by an
  // assessment, a report or a mentor, and there is no staff override.
  checkpoint_verification: {
    initialStatus: "in_progress",
    pairs: new Set(PRODUCTION_COMPLETION_PAIRS.checkpoint_verification),
  },
  // L1OWNER-1. Exactly ONE pair. There is deliberately no `external_event:*`
  // wildcard and no generic "external" owner: a future external-event level
  // with a different completion method must define its own trusted contract
  // rather than inherit registration's.
  pocket_registration_postback: {
    initialStatus: "in_progress",
    pairs: new Set(PRODUCTION_COMPLETION_PAIRS.pocket_registration_postback),
  },
  // A8 — STAGING-ONLY. Same pairs as the two production owners above, and a
  // completely separate trust story: each requires a durable StagingAttestation
  // written by an authorized operator on a deployment authoritatively
  // classified `staging`, and each re-checks that classification here (see
  // `assertStagingAttestationProof`) so calling the primitive directly in
  // production fails closed rather than relying on the HTTP layer.
  staging_attested_registration: {
    initialStatus: "in_progress",
    pairs: new Set(STAGING_ATTESTED_COMPLETION_PAIRS.staging_attested_registration),
  },
  staging_attested_checkpoint: {
    initialStatus: "in_progress",
    pairs: new Set(STAGING_ATTESTED_COMPLETION_PAIRS.staging_attested_checkpoint),
  },
  // PHASE-1 ADMIN. The pair set is DERIVED by subtracting the protected-authority
  // owners from the production ones, so this owner cannot be pointed at a
  // financial checkpoint or the Pocket registration level — not because someone
  // remembered to exclude them here, but because they were never in the set.
  //
  // `alsoTakesOver` is what lets one correction resolve a level the learner
  // started (`in_progress`) and one they submitted for review
  // (`pending_review`). It does NOT weaken the mentor boundary: a LEARNER still
  // cannot reach this owner at all, because reaching it requires
  // `curriculum_progress_override` on a CRM staff session.
  admin_correction: {
    initialStatus: "in_progress",
    alsoTakesOver: ["pending_review"],
    pairs: ADMIN_CORRECTABLE_COMPLETION_PAIRS,
  },
};

export type CurriculumLevelCompletionErrorCode =
  | "COMPLETION_DISABLED"
  | "COMPLETION_INPUT_INVALID"
  | "COMPLETION_ENROLLMENT_NOT_FOUND"
  | "COMPLETION_ENROLLMENT_CORRUPT"
  | "COMPLETION_LEVEL_NOT_FOUND"
  | "COMPLETION_LEVEL_NOT_CURRENT"
  | "COMPLETION_PROGRESS_NOT_STARTED"
  | "COMPLETION_STATUS_INVALID"
  | "COMPLETION_OWNER_MISMATCH"
  | "COMPLETION_OWNER_UNAVAILABLE"
  | "COMPLETION_REWARD_INVALID"
  | "COMPLETION_IDEMPOTENCY_CONFLICT"
  | "COMPLETION_CONFLICT"
  | "COMPLETION_STATE_CORRUPT"
  | "COMPLETION_INTERNAL_ERROR";

export class CurriculumLevelCompletionError extends Error {
  readonly code: CurriculumLevelCompletionErrorCode;
  readonly retryableCas: boolean;

  constructor(
    code: CurriculumLevelCompletionErrorCode,
    message: string,
    retryableCas = false,
  ) {
    super(message);
    this.name = "CurriculumLevelCompletionError";
    this.code = code;
    this.retryableCas = retryableCas;
  }
}

export function isCurriculumLevelCompletionError(
  error: unknown,
): error is CurriculumLevelCompletionError {
  return error instanceof CurriculumLevelCompletionError;
}

/**
 * PHASE-1 ADMIN — durable provenance for an administrative completion.
 *
 * Written to `UserLevelProgress.completionEvidence`, which the engine has never
 * used and which therefore costs no migration. BOUNDED AND STRUCTURED ON
 * PURPOSE: four short scalars, no free-form bag, no learner data, no session
 * material. `reasonText` is deliberately NOT here — operator prose belongs in
 * the AuditLog envelope, not stamped onto a domain row that every progression
 * read loads. What lives here is only what a reader of the ROW needs in order
 * to know this level was corrected and where to go for the rest.
 */
export type AdministrativeCompletionProvenance = {
  reasonCode: string;
  actorStaffProfileId: string;
  /** Hashed, never the raw operator identity string. */
  requestIdHash: string;
  referenceId?: string | null;
};

export type CompleteCurriculumLevelInput = {
  enrollmentId: number;
  levelDefinitionId: number;
  sourceType: CurriculumLevelCompletionSource;
  sourceId: string;
  actorId?: number | null;
  evaluationTime?: Date;
  /** Required for `admin_correction`; refused for every other source. */
  administrativeProvenance?: AdministrativeCompletionProvenance | null;
  db?: Pick<PrismaClient, "$transaction">;
};

export type CompleteCurriculumLevelInTransactionInput = Omit<
  CompleteCurriculumLevelInput,
  "db"
>;

export type CurriculumLevelCompletedResult = {
  kind: "completed";
  created: boolean;
  enrollmentId: number;
  levelNumber: number;
  stableCode: string;
  /** 0 for a zero-reward level; positive otherwise. */
  xpAwarded: number;
  /** null when the level awarded no XP (zero reward); the XPTransaction id otherwise. */
  xpTransactionId: number | null;
  nextLevelNumber: number | null;
  terminal: boolean;
  completedAt: Date;
};

export type CompleteCurriculumLevelResult =
  | CurriculumLevelCompletedResult
  | { kind: "disabled"; code: "COMPLETION_DISABLED" }
  | {
      kind: "rejected";
      code: Exclude<
        CurriculumLevelCompletionErrorCode,
        | "COMPLETION_DISABLED"
        | "COMPLETION_IDEMPOTENCY_CONFLICT"
        | "COMPLETION_CONFLICT"
        | "COMPLETION_ENROLLMENT_CORRUPT"
        | "COMPLETION_REWARD_INVALID"
        | "COMPLETION_STATE_CORRUPT"
        | "COMPLETION_INTERNAL_ERROR"
      >;
    }
  | {
      kind: "conflict";
      code: "COMPLETION_IDEMPOTENCY_CONFLICT" | "COMPLETION_CONFLICT";
    }
  | {
      kind: "corrupt";
      code:
        | "COMPLETION_ENROLLMENT_CORRUPT"
        | "COMPLETION_REWARD_INVALID"
        | "COMPLETION_STATE_CORRUPT"
        | "COMPLETION_INTERNAL_ERROR";
    };

type CompletionContext = {
  enrollment: EnrollmentResolutionGraph;
  level: EnrollmentResolutionGraph["curriculumVersion"]["levels"][number];
  progress: EnrollmentResolutionGraph["levelProgress"][number];
  maxLevel: number;
};

function failure(
  code: CurriculumLevelCompletionErrorCode,
  message: string,
  retryableCas = false,
): never {
  throw new CurriculumLevelCompletionError(code, message, retryableCas);
}

/**
 * Base completion flags. READ and ENROLLMENT are always required. The XP flag is
 * NOT required here: per the operator platform decision, `CURRICULUM_V2_XP_ENABLED`
 * is required only for a positive XP award, which is enforced by
 * `assertXpFlagForReward` once the level (and therefore its reward) is loaded.
 */
function assertBaseFlags() {
  if (!isCurriculumV2ReadEnabled() || !isCurriculumV2EnrollmentEnabled()) {
    failure("COMPLETION_DISABLED", "curriculum level completion is disabled");
  }
}

/** The XP flag gates positive awards only; a zero-reward completion needs no XP flag. */
function assertXpFlagForReward(
  context: CompletionContext,
  sourceType: CurriculumLevelCompletionSource,
) {
  if (awardsXp(context, sourceType) && !isCurriculumV2XpEnabled()) {
    failure("COMPLETION_DISABLED", "curriculum level completion is disabled");
  }
}

function positiveId(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    failure("COMPLETION_INPUT_INVALID", `${field} must be a positive integer`);
  }
  return Number(value);
}

function validatedInput(input: CompleteCurriculumLevelInTransactionInput) {
  const enrollmentId = positiveId(input.enrollmentId, "enrollmentId");
  const levelDefinitionId = positiveId(
    input.levelDefinitionId,
    "levelDefinitionId",
  );
  if (!COMPLETION_SOURCES.has(String(input.sourceType))) {
    failure("COMPLETION_OWNER_MISMATCH", "completion source is not allowed");
  }
  if (typeof input.sourceId !== "string") {
    failure("COMPLETION_INPUT_INVALID", "completion source identity is invalid");
  }
  const sourceId = input.sourceId.trim();
  if (
    sourceId.length === 0 ||
    sourceId.length > MAX_SOURCE_ID_LENGTH ||
    !SOURCE_ID_PATTERN.test(sourceId)
  ) {
    failure("COMPLETION_INPUT_INVALID", "completion source identity is invalid");
  }
  const actorId =
    input.actorId === undefined || input.actorId === null
      ? null
      : positiveId(input.actorId, "actorId");
  const evaluationTime = input.evaluationTime ?? new Date();
  if (
    !(evaluationTime instanceof Date) ||
    Number.isNaN(evaluationTime.getTime())
  ) {
    failure("COMPLETION_INPUT_INVALID", "completion time is invalid");
  }
  const sourceType = input.sourceType as CurriculumLevelCompletionSource;
  const administrativeProvenance = validatedProvenance(sourceType, input);
  return {
    enrollmentId,
    levelDefinitionId,
    sourceType,
    sourceId,
    actorId,
    evaluationTime: new Date(evaluationTime.getTime()),
    administrativeProvenance,
  };
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REFERENCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const STAFF_PROFILE_ID_PATTERN = /^[a-z0-9]{1,64}$/;

/**
 * Provenance is REQUIRED for `admin_correction` and REFUSED for everything else.
 *
 * Both halves matter. Without the first, an administrative completion could land
 * with no durable trace of who or why on the row itself. Without the second,
 * an ordinary assessment completion could be given administrative-looking
 * provenance — a lie in the opposite direction, and one that would survive in
 * `completionEvidence` long after the request that told it was forgotten.
 */
function validatedProvenance(
  sourceType: CurriculumLevelCompletionSource,
  input: CompleteCurriculumLevelInTransactionInput,
): AdministrativeCompletionProvenance | null {
  const supplied = input.administrativeProvenance ?? null;
  if (!isAdministrativeSource(sourceType)) {
    if (supplied) {
      failure(
        "COMPLETION_INPUT_INVALID",
        "administrative provenance is only valid for an administrative correction",
      );
    }
    return null;
  }
  if (!supplied || typeof supplied !== "object") {
    failure("COMPLETION_INPUT_INVALID", "administrative correction requires provenance");
  }
  if (!isProgressionAdjustmentReasonCode(supplied.reasonCode)) {
    failure("COMPLETION_INPUT_INVALID", "administrative reason code is invalid");
  }
  if (
    typeof supplied.actorStaffProfileId !== "string" ||
    !STAFF_PROFILE_ID_PATTERN.test(supplied.actorStaffProfileId)
  ) {
    failure("COMPLETION_INPUT_INVALID", "administrative actor identity is invalid");
  }
  if (
    typeof supplied.requestIdHash !== "string" ||
    !SHA256_PATTERN.test(supplied.requestIdHash)
  ) {
    failure("COMPLETION_INPUT_INVALID", "administrative request identity is invalid");
  }
  const referenceId =
    supplied.referenceId === undefined || supplied.referenceId === null
      ? null
      : supplied.referenceId;
  if (referenceId !== null && !REFERENCE_ID_PATTERN.test(referenceId)) {
    failure("COMPLETION_INPUT_INVALID", "administrative reference identity is invalid");
  }
  return {
    reasonCode: supplied.reasonCode,
    actorStaffProfileId: supplied.actorStaffProfileId,
    requestIdHash: supplied.requestIdHash,
    referenceId,
  };
}

const completionGraphInclude = {
  curriculumVersion: { include: { modules: true, levels: true } },
  levelProgress: { include: { levelDefinition: true } },
} as const;

function assertSequence(context: CompletionContext) {
  const { enrollment, maxLevel } = context;
  const levelsByNumber = new Map(
    enrollment.curriculumVersion.levels.map((level) => [level.levelNumber, level]),
  );
  const progressByLevel = new Map(
    enrollment.levelProgress.map((progress) => [
      progress.levelDefinition.levelNumber,
      progress,
    ]),
  );
  if (levelsByNumber.size !== maxLevel || maxLevel < 1) {
    failure("COMPLETION_STATE_CORRUPT", "curriculum level sequence is corrupt");
  }
  for (let levelNumber = 1; levelNumber <= maxLevel; levelNumber += 1) {
    if (!levelsByNumber.has(levelNumber)) {
      failure("COMPLETION_STATE_CORRUPT", "curriculum level sequence is corrupt");
    }
  }

  const expectedCurrent = enrollment.highestCompletedLevel + 1;
  if (
    enrollment.currentLevel !== expectedCurrent ||
    (enrollment.status === "active" && enrollment.currentLevel > maxLevel) ||
    (enrollment.status === "completed" &&
      (enrollment.highestCompletedLevel !== maxLevel ||
        enrollment.currentLevel !== maxLevel + 1))
  ) {
    failure("COMPLETION_STATE_CORRUPT", "enrollment summary is inconsistent");
  }

  for (let levelNumber = 1; levelNumber <= maxLevel; levelNumber += 1) {
    const progress = progressByLevel.get(levelNumber);
    if (levelNumber <= enrollment.highestCompletedLevel) {
      if (!progress || progress.status !== "completed" || !progress.completedAt) {
        failure("COMPLETION_STATE_CORRUPT", "completed level sequence is corrupt");
      }
      continue;
    }
    if (levelNumber > enrollment.currentLevel && progress) {
      failure("COMPLETION_STATE_CORRUPT", "future progress creates a sequence gap");
    }
  }
}

async function loadContext(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof validatedInput>,
): Promise<CompletionContext> {
  // Read enum text before Prisma materializes the relation so legacy/manual
  // SQLite corruption is classified as a domain status error instead of an
  // opaque enum decoding failure.
  const rawStatuses = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status"
    FROM "UserLevelProgress"
    WHERE "enrollmentId" = ${input.enrollmentId}
  `);
  if (
    rawStatuses.some(
      ({ status }) =>
        status !== "in_progress" &&
        status !== "pending_review" &&
        status !== "completed",
    )
  ) {
    failure("COMPLETION_STATUS_INVALID", "curriculum progress status is invalid");
  }
  const enrollment = await tx.userCurriculumEnrollment.findUnique({
    where: { id: input.enrollmentId },
    include: completionGraphInclude,
  });
  if (!enrollment) {
    failure("COMPLETION_ENROLLMENT_NOT_FOUND", "curriculum enrollment does not exist");
  }
  const pinIssue = validatePinnedEnrollmentSnapshot(
    enrollment as EnrollmentResolutionGraph,
    DEFAULT_CURRICULUM_CODE,
  );
  if (pinIssue) {
    failure("COMPLETION_ENROLLMENT_CORRUPT", "curriculum enrollment pin is corrupt");
  }
  if (enrollment.status !== "active" && enrollment.status !== "completed") {
    failure("COMPLETION_ENROLLMENT_CORRUPT", "curriculum enrollment is not completable");
  }
  const owner = await tx.user.findUnique({
    where: { id: enrollment.userId },
    select: { id: true, status: true },
  });
  if (!owner || owner.status !== "active") {
    failure("COMPLETION_ENROLLMENT_CORRUPT", "curriculum enrollment owner is invalid");
  }
  const globalLevel = await tx.levelDefinition.findUnique({
    where: { id: input.levelDefinitionId },
    select: { id: true, curriculumVersionId: true },
  });
  if (!globalLevel) {
    failure("COMPLETION_LEVEL_NOT_FOUND", "curriculum level does not exist");
  }
  const level = enrollment.curriculumVersion.levels.find(
    (candidate) => candidate.id === input.levelDefinitionId,
  );
  if (!level || globalLevel.curriculumVersionId !== enrollment.curriculumVersionId) {
    failure("COMPLETION_LEVEL_NOT_CURRENT", "curriculum level is outside the pinned version");
  }
  const moduleDefinition = enrollment.curriculumVersion.modules.find(
    (candidate) => candidate.id === level.moduleId,
  );
  if (
    !moduleDefinition ||
    moduleDefinition.status !== "active" ||
    level.status !== "active"
  ) {
    failure("COMPLETION_STATE_CORRUPT", "curriculum definition is inactive");
  }
  const progress = enrollment.levelProgress.find(
    (candidate) => candidate.levelDefinitionId === level.id,
  );
  if (!progress) {
    if (level.levelNumber !== enrollment.currentLevel) {
      failure("COMPLETION_LEVEL_NOT_CURRENT", "curriculum level is not current");
    }
    failure("COMPLETION_PROGRESS_NOT_STARTED", "curriculum level was not started");
  }
  const maxLevel = enrollment.curriculumVersion.levels.reduce(
    (maximum, candidate) => Math.max(maximum, candidate.levelNumber),
    0,
  );
  const context = {
    enrollment: enrollment as EnrollmentResolutionGraph,
    level,
    progress,
    maxLevel,
  };
  assertSequence(context);
  return context;
}

function assertOwnerRule(
  context: CompletionContext,
  sourceType: CurriculumLevelCompletionSource,
) {
  const { level, progress } = context;
  const rule = OWNER_RULES[sourceType];
  const pair = `${level.type}:${level.completionMethod}`;
  if (!rule.pairs.has(pair)) {
    const mappedOwner = Object.entries(OWNER_RULES).find(([, candidate]) =>
      candidate.pairs.has(pair),
    );
    if (mappedOwner) {
      failure("COMPLETION_OWNER_MISMATCH", "completion source does not own this level");
    }
    failure("COMPLETION_OWNER_UNAVAILABLE", "completion owner is unavailable for this level");
  }
  if (progress.status === "completed") return;
  if (
    progress.status !== "in_progress" &&
    progress.status !== "pending_review"
  ) {
    failure("COMPLETION_STATUS_INVALID", "curriculum progress status is invalid");
  }
  if (!takeoverStatuses(sourceType).includes(progress.status)) {
    failure("COMPLETION_OWNER_MISMATCH", "completion owner does not match progress state");
  }
  if (progress.completedAt || progress.completionEvidence !== null) {
    failure("COMPLETION_STATE_CORRUPT", "curriculum progress fields are inconsistent");
  }
}

const ASSESSMENT_ATTEMPT_SOURCE = /^assessment-attempt:([1-9]\d*)$/;
const REPORT_REVIEW_SOURCE = /^report-review:([1-9]\d*)$/;
/** `pocket-registration:<PocketTraderIdentity.id>` — never a Pocket user id. */
const POCKET_REGISTRATION_SOURCE = /^pocket-registration:(\d+)$/;

const CHECKPOINT_ATTEMPT_SOURCE = /^checkpoint-verification:([1-9]\d*)$/;

/** A8 — `staging-attestation:<StagingAttestation.id>`. Never a learner value. */
const STAGING_ATTESTATION_SOURCE = /^staging-attestation:([1-9]\d*)$/;

async function assertLessonAssessmentProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (input.sourceType !== "assessment_pass" || context.level.type !== "lesson") {
    return;
  }
  const match = ASSESSMENT_ATTEMPT_SOURCE.exec(input.sourceId);
  const attemptId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
    failure("COMPLETION_OWNER_MISMATCH", "lesson assessment proof identity is invalid");
  }
  const attempt = await tx.assessmentAttempt.findUnique({ where: { id: attemptId } });
  const assessment = attempt
    ? await tx.assessmentVersion.findUnique({ where: { id: attempt.assessmentVersionId } })
    : null;
  if (
    !attempt ||
    attempt.userId !== context.enrollment.userId ||
    attempt.enrollmentId !== context.enrollment.id ||
    attempt.curriculumVersionId !== context.enrollment.curriculumVersionId ||
    attempt.levelDefinitionId !== context.level.id ||
    attempt.status !== "passed" ||
    !attempt.submittedAt ||
    attempt.durationSeconds === null ||
    attempt.durationSeconds < 0 ||
    attempt.durationSeconds !==
      Math.floor((attempt.submittedAt.getTime() - attempt.startedAt.getTime()) / 1_000) ||
    attempt.totalQuestions === null ||
    attempt.correctCount === null ||
    attempt.scoreBasisPoints === null ||
    attempt.submittedAnswers === null ||
    !attempt.answersFingerprint ||
    !/^sha256:[a-f0-9]{64}$/.test(attempt.answersFingerprint) ||
    !attempt.submitRequestId ||
    !assessment ||
    assessment.id !== attempt.assessmentVersionId ||
    (assessment.status !== "published" && assessment.status !== "archived") ||
    !assessment.publishedAt ||
    assessment.levelDefinitionId !== context.level.id ||
    assessment.curriculumVersionId !== context.enrollment.curriculumVersionId ||
    attempt.totalQuestions <= 0 ||
    attempt.correctCount < 0 ||
    attempt.correctCount > attempt.totalQuestions ||
    attempt.correctCount * 100 <
      assessment.passPercent * attempt.totalQuestions ||
    attempt.scoreBasisPoints !==
      Math.floor((attempt.correctCount * 10_000) / attempt.totalQuestions)
  ) {
    failure("COMPLETION_STATE_CORRUPT", "lesson assessment proof is missing or corrupt");
  }
}

async function assertReportApprovalProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (input.sourceType !== "report_approval") return;
  const match = REPORT_REVIEW_SOURCE.exec(input.sourceId);
  const reviewId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(reviewId) || reviewId <= 0) {
    failure("COMPLETION_OWNER_MISMATCH", "report approval proof identity is invalid");
  }
  const review = await tx.reportReview.findUnique({
    where: { id: reviewId },
    include: {
      reviewer: { select: { id: true, status: true } },
      scores: true,
      submission: {
        include: {
          rubric: { include: { criteria: true, scaleOptions: true } },
          submittedRevision: { select: { id: true, submissionId: true } },
        },
      },
    },
  });
  if (!review) {
    failure("COMPLETION_STATE_CORRUPT", "report approval proof is missing or corrupt");
  }
  const submission = review.submission;
  const pendingProof =
    submission.status === "pending_review" &&
    submission.approvedRevisionId === null &&
    submission.approvedReviewId === null &&
    submission.approvedAt === null &&
    submission.claimedById === review.reviewerId &&
    submission.claimedAt?.getTime() === review.claimedAt?.getTime() &&
    submission.claimExpiresAt?.getTime() === review.claimExpiresAt?.getTime() &&
    submission.claimExpiresAt !== null &&
    submission.claimExpiresAt > input.evaluationTime;
  const approvedProof =
    submission.status === "approved" &&
    submission.approvedRevisionId === review.revisionId &&
    submission.latestReviewId === review.id &&
    submission.approvedReviewId === review.id &&
    submission.reviewedAt !== null &&
    submission.approvedAt !== null &&
    submission.reviewedAt.getTime() === review.reviewedAt.getTime() &&
    submission.approvedAt.getTime() === review.reviewedAt.getTime() &&
    submission.claimedById === null &&
    submission.claimedAt === null &&
    submission.claimExpiresAt === null &&
    submission.reviewStartedAt === null;
  const criteria = new Map(submission.rubric.criteria.map((criterion) => [criterion.id, criterion]));
  const criterionIds = new Set(criteria.keys());
  const scaleIds = new Set(submission.rubric.scaleOptions.map((option) => option.id));
  const scoreCriterionIds = new Set(review.scores.map((score) => score.rubricCriterionId));
  if (
    review.decision !== "approved" ||
    review.rejectionReasonId !== null ||
    review.humanComment !== null ||
    review.correctiveAction !== null ||
    !review.claimedAt ||
    !review.claimExpiresAt ||
    review.reviewedAt < review.claimedAt ||
    review.claimExpiresAt <= review.reviewedAt ||
    !review.reviewer ||
    review.reviewer.status !== "active" ||
    review.reviewerId === submission.userId ||
    review.reviewerRoleSnapshot !== "admin" && review.reviewerRoleSnapshot !== "mentor" ||
    review.revisionId !== submission.submittedRevisionId ||
    !submission.submittedRevision ||
    submission.submittedRevision.id !== review.revisionId ||
    submission.submittedRevision.submissionId !== submission.id ||
    submission.activeRevisionId !== submission.submittedRevisionId ||
    submission.userId !== context.enrollment.userId ||
    submission.enrollmentId !== context.enrollment.id ||
    submission.curriculumVersionId !== context.enrollment.curriculumVersionId ||
    submission.levelDefinitionId !== context.level.id ||
    submission.userLevelProgressId !== context.progress.id ||
    review.curriculumVersionId !== submission.curriculumVersionId ||
    review.levelDefinitionId !== submission.levelDefinitionId ||
    review.reportAssignmentVersionId !== submission.reportAssignmentVersionId ||
    review.reportRubricVersionId !== submission.reportRubricVersionId ||
    submission.rubric.id !== submission.reportRubricVersionId ||
    submission.rubric.reportAssignmentVersionId !== submission.reportAssignmentVersionId ||
    !/^sha256:[a-f0-9]{64}$/.test(review.payloadFingerprint) ||
    review.requestId.length < 8 ||
    criterionIds.size === 0 ||
    scaleIds.size === 0 ||
    review.scores.length !== criterionIds.size ||
    scoreCriterionIds.size !== criterionIds.size ||
    review.scores.some((score) => {
      const criterion = criteria.get(score.rubricCriterionId);
      return score.reportRubricVersionId !== submission.reportRubricVersionId ||
        !criterion || !scaleIds.has(score.rubricScaleOptionId) ||
        (criterion.commentRequired && (!score.comment || score.comment.trim().length === 0)) ||
        (score.comment !== null && (score.comment.length > 4_000 || UNSAFE_REVIEW_TEXT.test(score.comment)));
    }) ||
    (!pendingProof && !approvedProof)
  ) {
    failure("COMPLETION_STATE_CORRUPT", "report approval proof is missing or corrupt");
  }
}

/**
 * A financial checkpoint may only be completed against a durable, settled
 * verification attempt that actually says `met`, for THIS enrollment and THIS
 * level. Same discipline as the assessment and report proofs: the completion
 * primitive verifies the evidence itself rather than trusting the caller that
 * claims to own it.
 *
 * Note what is NOT checked, because it is not stored: any balance. The proof of
 * a passed gate is the typed outcome, not a number.
 */
async function assertCheckpointVerificationProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (input.sourceType !== "checkpoint_verification") return;
  const match = CHECKPOINT_ATTEMPT_SOURCE.exec(input.sourceId);
  const attemptId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(attemptId) || attemptId <= 0) {
    failure("COMPLETION_OWNER_MISMATCH", "checkpoint proof identity is invalid");
  }
  const attempt = await tx.checkpointVerificationAttempt.findUnique({
    where: { id: attemptId },
  });
  if (
    !attempt ||
    attempt.enrollmentId !== context.enrollment.id ||
    attempt.levelDefinitionId !== context.level.id ||
    attempt.outcome !== "met" ||
    attempt.completedAt === null ||
    // A passed gate has nothing to wait for.
    attempt.cooldownUntil !== null ||
    attempt.requestId.trim().length < 8
  ) {
    failure("COMPLETION_STATE_CORRUPT", "checkpoint verification proof is missing or corrupt");
  }
  if (!isFinancialCheckpointType(context.level.type)) {
    failure("COMPLETION_OWNER_MISMATCH", "checkpoint proof targets a non-checkpoint level");
  }
}

/**
 * L1OWNER-1 — the trusted proof behind a Pocket registration completion.
 *
 * `PocketTraderIdentity` is the ONLY authority. It is written by exactly one
 * code path — the authenticated registration postback — and it is unique on both
 * `userId` and `pocketUserId`, so its existence for this learner is durable
 * proof that a registration ATA authenticated actually happened.
 *
 * Deliberately NOT accepted as authority:
 *   * `ExchangeAccount.traderId` — nullable, non-unique in both directions, and
 *     written by every goal, so it proves nothing about registration;
 *   * `registrationStatus` — a display flag that several paths can set;
 *   * the legacy V1 task `lvl_01_pocket_registration` — a different system;
 *   * AuditLog or notification text — narrative, not state;
 *   * anything a learner or staff member can submit.
 *
 * The identity must belong to THIS learner: an identity bound to somebody else
 * cannot complete this enrolment's level, which is what makes a Pocket-user
 * conflict unable to complete L1.
 */
async function assertPocketRegistrationProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (input.sourceType !== "pocket_registration_postback") return;

  if (context.level.type !== "external_event" || context.level.completionMethod !== "pocket_postback") {
    failure("COMPLETION_OWNER_MISMATCH", "registration proof targets a non-registration level");
  }

  const identity = await tx.pocketTraderIdentity.findUnique({
    where: { userId: context.enrollment.userId },
    select: { id: true, userId: true, source: true },
  });

  if (!identity || identity.userId !== context.enrollment.userId) {
    failure("COMPLETION_STATE_CORRUPT", "pocket registration proof is missing");
  }
  // Only a registration postback may write this row today; refusing anything
  // else keeps the proof honest if a future provenance is ever added.
  if (identity!.source !== "registration_postback") {
    failure("COMPLETION_STATE_CORRUPT", "pocket registration proof has an untrusted provenance");
  }
  // The source id names the identity row rather than any Pocket value, so no
  // Pocket user id is written into completion evidence.
  const match = POCKET_REGISTRATION_SOURCE.exec(input.sourceId);
  const identityId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(identityId) || identityId !== identity!.id) {
    failure("COMPLETION_OWNER_MISMATCH", "registration proof identity is invalid");
  }
}

/**
 * A8 — the trusted proof behind a staging QA attestation.
 *
 * FOUR INDEPENDENT THINGS MUST ALL HOLD, and each of them fails closed:
 *
 *  1. THE DEPLOYMENT IS `staging`. Re-checked HERE, inside the completion
 *     transaction, not only at the HTTP edge. `isStagingAttestationUsable`
 *     demands an explicit `ATA_ENVIRONMENT=staging` declaration plus the
 *     dedicated opt-in flag, so an absent, misspelled or `production`
 *     classification refuses — forgetting is the safe direction. A caller that
 *     reaches this primitive directly, from a script or a future route, gets
 *     the same refusal the route would have given.
 *
 *  2. A DURABLE ATTESTATION ROW EXISTS. `StagingAttestation` is written by one
 *     code path only, which requires an authorized operator, a CSRF-validated
 *     browser mutation and an audit record. Its existence is the proof; nothing
 *     a learner can submit is.
 *
 *  3. IT NAMES THIS ENROLLMENT AND THIS LEVEL. An attestation for somebody
 *     else, or for another level, completes nothing.
 *
 *  4. ITS EVENT CLASS MATCHES THE OWNER AND THE LEVEL'S PAIR. A registration
 *     attestation cannot pass a financial checkpoint and vice versa.
 *
 * WHAT IS DELIBERATELY ABSENT: any amount, any balance, any currency, any
 * Pocket identifier. The row has no field one could occupy, so "a staging
 * attestation cannot invent a deposit" is structural rather than reviewed.
 */
async function assertStagingAttestationProof(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (!isStagingAttestedSource(input.sourceType)) return;

  if (!isStagingAttestationUsable()) {
    failure(
      "COMPLETION_OWNER_UNAVAILABLE",
      "staging attestation is unavailable in this environment",
    );
  }

  const expectedEventClass =
    input.sourceType === "staging_attested_registration"
      ? "pocket_registration"
      : "financial_checkpoint";
  const expectedPair =
    input.sourceType === "staging_attested_registration"
      ? { type: "external_event", completionMethod: "pocket_postback" }
      : { type: "financial_checkpoint", completionMethod: "balance_check" };
  if (
    context.level.type !== expectedPair.type ||
    context.level.completionMethod !== expectedPair.completionMethod
  ) {
    failure("COMPLETION_OWNER_MISMATCH", "staging attestation targets the wrong level kind");
  }

  const match = STAGING_ATTESTATION_SOURCE.exec(input.sourceId);
  const attestationId = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(attestationId) || attestationId <= 0) {
    failure("COMPLETION_OWNER_MISMATCH", "staging attestation identity is invalid");
  }

  const attestation = await tx.stagingAttestation.findUnique({
    where: { id: attestationId },
    select: {
      id: true,
      eventClass: true,
      enrollmentId: true,
      levelDefinitionId: true,
      environment: true,
      attestedById: true,
      requestId: true,
    },
  });
  if (
    !attestation ||
    attestation.enrollmentId !== context.enrollment.id ||
    attestation.levelDefinitionId !== context.level.id ||
    attestation.eventClass !== expectedEventClass ||
    // The environment the attestation was MADE in is recorded on the row, so a
    // row created on a staging host can never be replayed as proof anywhere
    // else even if the database were copied.
    attestation.environment !== "staging" ||
    !Number.isSafeInteger(attestation.attestedById) ||
    attestation.attestedById <= 0 ||
    attestation.requestId.trim().length < 8
  ) {
    failure("COMPLETION_STATE_CORRUPT", "staging attestation proof is missing or corrupt");
  }

  // The operator who attested may never be the learner. Checked again here so
  // the rule survives any future caller of this primitive.
  if (attestation!.attestedById === context.enrollment.userId) {
    failure("COMPLETION_OWNER_MISMATCH", "a learner cannot attest their own gate");
  }
}

/**
 * Reward contract (operator platform decision, 2026-07-25):
 *  - `xpReward` must be a non-negative integer;
 *  - `xpReward === 0` is a valid, completable level that awards no XP and creates
 *    NO XPTransaction;
 *  - `xpReward < 0` is invalid.
 * This is a general platform rule with no per-level special case.
 */
/**
 * PHASE-1 ADMIN — the protected-authority boundary, re-checked in-transaction.
 *
 * `OWNER_RULES.admin_correction.pairs` already excludes both gates, so this can
 * only fire if that derivation is ever broken. That is exactly why it exists:
 * the pair set is computed, and a computed safety boundary deserves a second,
 * independent assertion that names the rule in plain terms rather than trusting
 * a set-difference to stay correct forever. It costs one comparison and it is
 * the difference between a refused request and an invented financial fact.
 */
function assertAdminCorrectionBoundary(
  context: CompletionContext,
  sourceType: CurriculumLevelCompletionSource,
) {
  if (!isAdministrativeSource(sourceType)) return;
  if (isProtectedAuthorityPair(context.level.type, context.level.completionMethod)) {
    failure(
      "COMPLETION_OWNER_UNAVAILABLE",
      "administrative correction cannot satisfy an external authority gate",
    );
  }
}

function assertReward(
  context: CompletionContext,
  sourceType: CurriculumLevelCompletionSource,
) {
  if (!Number.isInteger(context.level.xpReward) || context.level.xpReward < 0) {
    failure("COMPLETION_REWARD_INVALID", "curriculum level reward is invalid");
  }
  // A zero-reward-only owner cannot complete a level that promises XP. Failing
  // closed here means a mis-authored checkpoint is refused rather than silently
  // completed without the reward its definition advertises.
  if (isZeroRewardOnlySource(sourceType) && context.level.xpReward !== 0) {
    failure("COMPLETION_REWARD_INVALID", "gate completion must award no XP");
  }
}

/**
 * A completion awards XP (and creates an XPTransaction) only for a positive
 * reward from an XP-bearing owner. The checkpoint owner never does, whatever
 * the definition says — `assertReward` has already refused that case.
 */
function awardsXp(
  context: CompletionContext,
  sourceType: CurriculumLevelCompletionSource,
) {
  return !isZeroRewardOnlySource(sourceType) && context.level.xpReward > 0;
}

function xpInput(
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (isZeroRewardOnlySource(input.sourceType)) {
    // Unreachable: every caller is guarded by `awardsXp`. Kept as a hard stop so
    // a future edit cannot route a gate owner into the XP ledger.
    failure("COMPLETION_REWARD_INVALID", "gate completion must award no XP");
  }
  return {
    enrollmentId: context.enrollment.id,
    // PHASE-1 ADMIN — an administrative award names NO level. See the note on
    // `LEVEL_LINKED_SOURCES` in `xp.ts`: the currently-deployed Backend would
    // read a level-linked `admin_correction` row as a corrupt enrollment, so
    // this is what keeps that release a valid rollback anchor. The level is
    // carried by the award's `sourceId`, by the progress row's provenance and
    // by two audit records.
    levelDefinitionId: isAdministrativeSource(input.sourceType) ? null : context.level.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amount: context.level.xpReward,
    actorId: input.actorId,
  };
}

function mapXpError(error: unknown): never {
  if (!isCurriculumXpError(error)) throw error;
  switch (error.code) {
    case "XP_DISABLED":
      return failure("COMPLETION_DISABLED", "curriculum level completion is disabled");
    case "XP_INPUT_INVALID":
    case "XP_SOURCE_INVALID":
      return failure("COMPLETION_INPUT_INVALID", "completion XP identity is invalid");
    case "XP_ACTOR_INVALID":
      return failure("COMPLETION_OWNER_MISMATCH", "completion actor is invalid");
    case "XP_IDEMPOTENCY_CONFLICT":
    case "XP_SOURCE_CONFLICT":
      return failure(
        "COMPLETION_IDEMPOTENCY_CONFLICT",
        "completion identity conflicts with durable XP",
      );
    case "XP_ENROLLMENT_NOT_FOUND":
    case "XP_ENROLLMENT_CORRUPT":
    case "XP_LEVEL_VERSION_MISMATCH":
    case "XP_TOTAL_CORRUPT":
      return failure("COMPLETION_STATE_CORRUPT", "completion XP state is corrupt");
    case "XP_INTERNAL_ERROR":
      return failure("COMPLETION_INTERNAL_ERROR", "curriculum level completion failed");
  }
}

async function levelXpRows(tx: Prisma.TransactionClient, context: CompletionContext) {
  return tx.xPTransaction.findMany({
    where: {
      enrollmentId: context.enrollment.id,
      levelDefinitionId: context.level.id,
      // Only XP-bearing owners can appear in the ledger; `checkpoint_verification`
      // is not a member of the XP vocabulary at all.
      sourceType: { in: XP_BEARING_SOURCES },
    },
    orderBy: { id: "asc" },
  });
}

function completedResult(
  context: CompletionContext,
  transaction: CurriculumXpTransactionSummary | null,
  completedAt: Date,
  created: boolean,
): CurriculumLevelCompletedResult {
  const terminal = context.level.levelNumber === context.maxLevel;
  return {
    kind: "completed",
    created,
    enrollmentId: context.enrollment.id,
    levelNumber: context.level.levelNumber,
    stableCode: context.level.stableCode,
    xpAwarded: context.level.xpReward,
    xpTransactionId: transaction?.id ?? null,
    nextLevelNumber: terminal ? null : context.level.levelNumber + 1,
    terminal,
    completedAt: new Date(completedAt.getTime()),
  };
}

async function verifyCompletedRetry(
  tx: Prisma.TransactionClient,
  context: CompletionContext,
  input: ReturnType<typeof validatedInput>,
) {
  if (!context.progress.completedAt) {
    failure("COMPLETION_STATE_CORRUPT", "completed progress has no completion time");
  }
  const rows = await levelXpRows(tx, context);
  if (!awardsXp(context, input.sourceType)) {
    // Zero-reward level: the completed progress row is the durable proof of
    // completion. No XPTransaction was ever created, and none may exist.
    if (rows.length !== 0) {
      failure("COMPLETION_STATE_CORRUPT", "zero-reward completion must own no XP");
    }
    return completedResult(context, null, context.progress.completedAt, false);
  }
  if (isAdministrativeSource(input.sourceType)) {
    // An administrative award names no level, so the level-scoped row count
    // above cannot see it and `rows.length` says nothing about whether it
    // exists. Its identity is the idempotency key, so that is what is verified —
    // and a mismatch is a genuine conflict (a DIFFERENT administrative request
    // completed this level) rather than a missing award.
    let verifiedAdministrative;
    try {
      verifiedAdministrative = await verifyCurriculumXpAwardInTransaction(
        tx,
        xpInput(context, input),
      );
    } catch (error) {
      mapXpError(error);
    }
    if (verifiedAdministrative.kind === "missing") {
      failure("COMPLETION_CONFLICT", "completed level has a different owner identity");
    }
    return completedResult(
      context,
      verifiedAdministrative.transaction,
      context.progress.completedAt,
      false,
    );
  }
  const ledger = await resolveEnrollmentXp({
    enrollmentId: context.enrollment.id,
    db: tx,
  });
  if (ledger.kind !== "available") {
    failure("COMPLETION_STATE_CORRUPT", "completion XP ledger is corrupt");
  }
  if (rows.length === 0) {
    failure("COMPLETION_STATE_CORRUPT", "completed progress has no durable XP award");
  }
  if (rows.length !== 1) {
    failure("COMPLETION_STATE_CORRUPT", "completed progress has ambiguous XP awards");
  }
  let verified;
  try {
    verified = await verifyCurriculumXpAwardInTransaction(
      tx,
      xpInput(context, input),
    );
  } catch (error) {
    mapXpError(error);
  }
  if (verified.kind === "missing") {
    failure("COMPLETION_CONFLICT", "completed level has a different owner identity");
  }
  return completedResult(
    context,
    verified.transaction,
    context.progress.completedAt,
    false,
  );
}

async function runCompletionTransaction(
  tx: Prisma.TransactionClient,
  input: ReturnType<typeof validatedInput>,
): Promise<CurriculumLevelCompletedResult> {
  const context = await loadContext(tx, input);
  assertOwnerRule(context, input.sourceType);
  await assertLessonAssessmentProof(tx, context, input);
  await assertReportApprovalProof(tx, context, input);
  await assertCheckpointVerificationProof(tx, context, input);
  await assertPocketRegistrationProof(tx, context, input);
  await assertStagingAttestationProof(tx, context, input);
  assertAdminCorrectionBoundary(context, input.sourceType);
  assertReward(context, input.sourceType);
  assertXpFlagForReward(context, input.sourceType);

  if (context.progress.status === "completed") {
    return verifyCompletedRetry(tx, context, input);
  }
  if (context.enrollment.status !== "active") {
    failure("COMPLETION_CONFLICT", "completed enrollment cannot accept a new completion");
  }
  if (context.level.levelNumber !== context.enrollment.currentLevel) {
    failure("COMPLETION_LEVEL_NOT_CURRENT", "curriculum level is not current");
  }
  if ((await levelXpRows(tx, context)).length !== 0) {
    failure("COMPLETION_STATE_CORRUPT", "XP exists before progress completion");
  }

  // PHASE-1 ADMIN — durable provenance, written in the SAME claim that completes
  // the level. Two properties fall out of doing it here rather than in a second
  // update: an administratively completed row can never exist without its
  // provenance, and the CAS is unweakened — the `where` still requires the row
  // to be un-completed with NO evidence, so a concurrent writer still loses.
  const provenance = input.administrativeProvenance;
  const progressClaim = await tx.userLevelProgress.updateMany({
    where: {
      id: context.progress.id,
      enrollmentId: context.enrollment.id,
      levelDefinitionId: context.level.id,
      status: { in: takeoverStatuses(input.sourceType) },
      completedAt: null,
      completionEvidence: { equals: Prisma.DbNull },
    },
    data: {
      status: "completed",
      completedAt: input.evaluationTime,
      lastProgressAt: input.evaluationTime,
      ...(provenance
        ? {
            completionMethod: input.sourceType,
            completionEvidence: {
              kind: "administrative_progression_correction",
              reasonCode: provenance.reasonCode,
              actorStaffProfileId: provenance.actorStaffProfileId,
              requestIdHash: provenance.requestIdHash,
              referenceId: provenance.referenceId,
            },
          }
        : {}),
    },
  });
  if (progressClaim.count !== 1) {
    failure("COMPLETION_CONFLICT", "completion progress claim lost", true);
  }

  // Positive reward -> create the XPTransaction atomically with completion.
  // Zero reward -> complete without any XPTransaction (operator platform rule).
  let xpTransaction: CurriculumXpTransactionSummary | null = null;
  if (awardsXp(context, input.sourceType)) {
    let xpAward;
    try {
      xpAward = await recordCurriculumXpInTransaction(tx, xpInput(context, input));
    } catch (error) {
      mapXpError(error);
    }
    if (!xpAward.created) {
      failure("COMPLETION_STATE_CORRUPT", "XP existed before progress completion");
    }
    xpTransaction = xpAward.transaction;
  }

  const terminal = context.level.levelNumber === context.maxLevel;
  const nextCurrentLevel = context.level.levelNumber + 1;
  const enrollmentClaim = await tx.userCurriculumEnrollment.updateMany({
    where: {
      id: context.enrollment.id,
      status: "active",
      currentLevel: context.enrollment.currentLevel,
      highestCompletedLevel: context.enrollment.highestCompletedLevel,
      completedAt: null,
    },
    data: {
      status: terminal ? "completed" : "active",
      highestCompletedLevel: context.level.levelNumber,
      currentLevel: nextCurrentLevel,
      lastMeaningfulActionAt: input.evaluationTime,
      completedAt: terminal ? input.evaluationTime : null,
    },
  });
  if (enrollmentClaim.count !== 1) {
    failure("COMPLETION_CONFLICT", "completion enrollment claim lost", true);
  }

  const sourceIdHash = `sha256:${createHash("sha256")
    .update(input.sourceId, "utf8")
    .digest("hex")}`;
  await tx.auditLog.create({
    data: {
      userId: input.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.levelCompleted,
      entityType: "UserLevelProgress",
      entityId: String(context.progress.id),
      metadata: {
        enrollmentId: context.enrollment.id,
        userId: context.enrollment.userId,
        curriculumVersionId: context.enrollment.curriculumVersionId,
        levelDefinitionId: context.level.id,
        levelNumber: context.level.levelNumber,
        stableCode: context.level.stableCode,
        sourceType: input.sourceType,
        sourceIdHash,
        actorId: input.actorId,
        xpTransactionId: xpTransaction?.id ?? null,
        xpAwarded: context.level.xpReward,
        previousCurrentLevel: context.enrollment.currentLevel,
        nextCurrentLevel: terminal ? null : nextCurrentLevel,
        terminal,
        // PHASE-1 ADMIN. Present only on an administrative correction, so the
        // ABSENCE of this key is itself the statement that a completion was
        // ordinary. `reasonText` is not here: it lives once, in the envelope.
        ...(provenance
          ? {
              administrative: {
                reasonCode: provenance.reasonCode,
                actorStaffProfileId: provenance.actorStaffProfileId,
                requestIdHash: provenance.requestIdHash,
                referenceId: provenance.referenceId,
              },
            }
          : {}),
      },
    },
  });

  // G4-GROWTH — the canonical progression events for this completion.
  //
  // PLACED HERE BECAUSE THIS IS THE ONE PLACE A LEVEL EVER COMPLETES. Every
  // completion family — assessment_pass, level_completion, report_approval,
  // mentor_completion, checkpoint_verification, pocket_registration_postback —
  // arrives at this same claim. Hooking each owner separately would guarantee
  // that a future seventh owner is added without one, and the funnel would then
  // under-report a family nobody remembered to instrument.
  //
  // IN THIS TRANSACTION, so a completion that rolls back leaves no growth event.
  // Emission uses the swallowing emitter, so the reverse is not true: a growth
  // event that cannot be written never costs a learner their level.
  //
  // `academy_activation` is emitted alongside and keyed on the ENROLLMENT, so
  // only the first completion of an enrollment produces one — the unique index
  // decides that, not an ordering assumption here.
  // PHASE-1 ADMIN — an administrative correction emits NO growth events at all.
  //
  // WHY SUPPRESSION AND NOT A DISCRIMINATOR. `GrowthEvent` could carry the
  // source in `metadata`, and one query already reads a metadata flag
  // (`countAssessmentsPassed`). But `level_completed` and `academy_activation`
  // are counted WITHOUT any metadata filter, by several call sites and by the
  // CRM funnel route, so adding the field would put a truthful marker into rows
  // that every existing organic query would still count as organic. The funnel
  // would keep reporting a corrected learner as having activated, and the
  // marker would be an alibi rather than a fix. Retrofitting every consumer is a
  // larger and riskier change than this phase should carry, and inventing a
  // typed column for it would be a migration for analytics — which this phase
  // is explicitly not permitted to make.
  //
  // So the funnel simply does not learn about corrections, and it is TRUE that
  // it does not: nobody clicked through L3, and `academy_activation` means a
  // learner finished something. An absent row understates activity that never
  // happened; a present row would overstate learning that never happened.
  //
  // THE ADMINISTRATIVE TRUTH IS NOT LOST — it is in the AuditLog envelope, the
  // per-level completion audit, the XP ledger's `admin_correction` rows and the
  // progress row's own `completionMethod`. Four durable places, none of which is
  // a growth funnel.
  const emitsGrowthEvents = !isAdministrativeSource(input.sourceType);

  if (emitsGrowthEvents) {
    await emitLevelCompletedEvent(tx, {
      userLevelProgressId: context.progress.id,
      enrollmentId: context.enrollment.id,
      userId: context.enrollment.userId,
      levelDefinitionId: context.level.id,
      levelNumber: context.level.levelNumber,
      occurredAt: input.evaluationTime,
      completionMethod: input.sourceType,
    });
  }

  // A mentor-approved level is a true answer to two different questions, so it
  // produces two different events rather than one that has to be reinterpreted.
  if (emitsGrowthEvents && input.sourceType === "mentor_completion") {
    await emitMentorReviewApprovedEvent(tx, {
      userLevelProgressId: context.progress.id,
      enrollmentId: context.enrollment.id,
      userId: context.enrollment.userId,
      levelDefinitionId: context.level.id,
      levelNumber: context.level.levelNumber,
      occurredAt: input.evaluationTime,
    });
  }

  // `report_approved` is deliberately NOT emitted here. Its owner is the REVIEW,
  // not the completion, and its key is the SUBMISSION — which is what the
  // migration backfills and what `emitReportApprovedEvent` produces. Emitting it
  // from this owner as well, under a progress-shaped key, would put two rows in
  // the ledger for one approval: one backfilled, one live, neither colliding.
  // The report workflow emits it, once, where the submission id is known.

  return completedResult(
    context,
    xpTransaction,
    input.evaluationTime,
    true,
  );
}

export async function completeCurriculumLevelInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: CompleteCurriculumLevelInTransactionInput,
): Promise<CurriculumLevelCompletedResult> {
  assertBaseFlags();
  const input = validatedInput(rawInput);
  return runCompletionTransaction(tx, input);
}

function asFailureResult(
  error: CurriculumLevelCompletionError,
): CompleteCurriculumLevelResult {
  if (error.code === "COMPLETION_DISABLED") {
    return { kind: "disabled", code: error.code };
  }
  if (
    error.code === "COMPLETION_IDEMPOTENCY_CONFLICT" ||
    error.code === "COMPLETION_CONFLICT"
  ) {
    return { kind: "conflict", code: error.code };
  }
  if (
    error.code === "COMPLETION_ENROLLMENT_CORRUPT" ||
    error.code === "COMPLETION_REWARD_INVALID" ||
    error.code === "COMPLETION_STATE_CORRUPT" ||
    error.code === "COMPLETION_INTERNAL_ERROR"
  ) {
    return { kind: "corrupt", code: error.code };
  }
  return { kind: "rejected", code: error.code };
}

export async function completeCurriculumLevel({
  db = prisma,
  ...rawInput
}: CompleteCurriculumLevelInput): Promise<CompleteCurriculumLevelResult> {
  try {
    assertBaseFlags();
    const input = validatedInput(rawInput);
    try {
      return await db.$transaction((tx) => runCompletionTransaction(tx, input));
    } catch (error) {
      if (
        isCurriculumLevelCompletionError(error) &&
        error.retryableCas
      ) {
        return await db.$transaction((tx) => runCompletionTransaction(tx, input));
      }
      throw error;
    }
  } catch (error) {
    if (isCurriculumLevelCompletionError(error)) return asFailureResult(error);
    // Unknown database/infrastructure failures remain visible to the trusted
    // owner so they cannot be mistaken for an idempotent completion.
    throw error;
  }
}
