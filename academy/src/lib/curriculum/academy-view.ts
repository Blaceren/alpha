/**
 * Academy-facing curriculum view models (narrow, display-safe).
 *
 * These are the ONLY curriculum shapes components see. They carry no Prisma
 * objects, no correct answers, no feature-flag internals, no staff/session
 * data, and never use an array index as identity — stable module/level codes
 * are the identity. Timestamps are ISO strings; nulls are explicit.
 */
import type { AcademyLevelType } from "@/lib/curriculum/level-type";
import type { AcademyCompletionMethod } from "@/lib/curriculum/completion-method";
import type { AcademyLevelState, AcademyLockReason } from "@/lib/curriculum/progress-state";

export type AcademyCurriculumSummary = {
  curriculumCode: string;
  curriculumVersion: number;
  title: string;
  status: string;
  publishedAt: string | null;
};

/**
 * Display-safe financial-checkpoint state for a level.
 *
 * Carries the Backend's verdict about *the platform's own ability to verify*
 * and nothing about the learner's money. The canonical target amount is NOT
 * here — it lives in the published curriculum (level title / fixture
 * threshold), so this object can never become a place a balance is stored.
 */
/**
 * The learner-visible checkpoint state (L4HG-1, extended by L4VC-1).
 *
 * `unsupported` is the Academy's own fail-closed member: a Backend payload this
 * build does not understand presents as unavailable rather than as a passable
 * gate. Every other member mirrors a Backend state exactly — the Academy never
 * invents or widens one.
 */
export type AcademyCheckpointVerificationState =
  | "verification_unavailable"
  | "ready"
  | "checking"
  | "cooldown"
  | "not_met"
  | "completed"
  | "unsupported";

/**
 * Why, in operational or threshold terms. NEVER financial: no member of this
 * union can describe how much money the learner has.
 */
export type AcademyCheckpointReason =
  | "none"
  | "checkpoint_disabled"
  | "provider_disabled"
  | "provider_unconfigured"
  | "requirement_unconfigured"
  | "integration_unknown"
  | "identity_unlinked"
  | "identity_mismatch"
  | "unsupported_currency"
  | "provider_timeout"
  | "provider_maintenance"
  | "provider_rate_limited"
  | "stale"
  | "invalid_provider_response"
  | "cooldown_active"
  | "rate_limited"
  | "not_met"
  | "unsupported";

export type AcademyCheckpointState = {
  verificationState: AcademyCheckpointVerificationState;
  reason: AcademyCheckpointReason;
  canVerify: boolean;
  canStart: boolean;
  canComplete: boolean;
  /** Seconds to wait. A duration, never an amount. */
  retryAfterSeconds: number | null;
};

export type AcademyLevelSummary = {
  levelCode: string;
  order: number;
  title: string;
  shortDescription: string | null;
  learningObjective: string;
  typeInfo: { type: AcademyLevelType; label: string; isCheckpoint: boolean; isExternal: boolean; supported: boolean };
  state: AcademyLevelState;
  lockReason: AcademyLockReason | null;
  stateLabel: string;
  completionSource: string;
  /**
   * Learner-facing Russian for `completionSource`. Added beside the enum rather
   * than replacing it: the payload contract keeps the machine value, and the UI
   * renders this. See lib/curriculum/completion-source.ts.
   */
  completionSourceLabel: string;
  requirements: { previousLevel: number | null; requiredXp: number; checkpointLevel: number | null };
  routeAccessible: boolean;
  /** Read-only in CI-2: "view" only, never a write action. */
  actions: ReadonlyArray<"view">;
  href: string;
  xpReward: number;
  /** Opaque staleness marker (latest progress timestamp), else null. */
  progressVersion: string | null;
  /** Present only on checkpoint levels; null everywhere else. */
  checkpoint: AcademyCheckpointState | null;
  /**
   * G3 — the BOUNDED completion method, mapped from the Backend's own field.
   *
   * `typeInfo.type` alone cannot distinguish the two things a `lesson` can be:
   * `lesson:assessment_pass` (58 levels, finished by a graded check) and
   * `lesson:manual` (13 canonical practical levels, finished by an explicit
   * learner declaration). Before this field the page offered the assessment
   * surface to both, so a practical level showed a check that did not exist and
   * offered no way to finish.
   *
   * Mapped through a closed vocabulary rather than passed through, for the same
   * reason `mapLevelType` exists: an unrecognised value must degrade to a
   * bounded `unsupported`, never be treated as one of the known methods.
   *
   * This is presentation only. It selects which surface is rendered; it never
   * decides whether a completion is allowed — the Backend owner does that and
   * refuses anything else, whatever this page offers.
   */
  completionMethod: AcademyCompletionMethod;
};

export type AcademyModuleSummary = {
  moduleCode: string;
  order: number;
  title: string;
  description: string | null;
  learningObjective: string;
  status: string;
  levels: AcademyLevelSummary[];
  progress: { total: number; completed: number };
};

export type AcademyProgressSummary = {
  currentLevelCode: string | null;
  currentModuleCode: string | null;
  nextAvailableLevelCode: string | null;
  completedLevels: number;
  totalLevels: number;
  xp: { available: false } | { available: true; currentXp: number; nextLevelRequiredXp: number | null; xpRemaining: number };
  updatedAt: string | null;
};

/**
 * The lesson's playable media, when the curriculum actually has some
 * (L2START-PLAYER-1).
 *
 * `null` is a real and expected answer, not a failure: a lesson may legitimately
 * be text-only, and the published curriculum currently carries no video assets
 * at all. Nothing here is ever invented to fill the gap — no placeholder source,
 * no stock poster — because a fake video is worse for a learner than an honest
 * "the video is being prepared".
 */
export type AcademyLessonMedia = {
  /** Absolute https source, straight from the published content asset. */
  src: string;
  mimeType: string;
  /** Absolute https poster image, or null when the curriculum supplies none. */
  poster: string | null;
  durationSeconds: number | null;
  captions: ReadonlyArray<{ src: string; srcLang: string; label: string }>;
};

/**
 * The learner's own reading position in a lesson, as the Backend owns it.
 *
 * NOT PROGRESSION. `UserLessonProgress` is a separate row from
 * `UserLevelProgress`, written by a separate command that refuses to run unless
 * the level is already `in_progress`, and it cannot complete a level — the
 * Backend's own save path never touches the progression row. So this says where
 * the learner got to in the text, and never whether they finished the level.
 *
 * `revision` is the optimistic-concurrency token the save command requires. It
 * is carried through untouched: the Academy never guesses one, and a stale
 * value is refused by the Backend rather than resolved locally.
 */
export type AcademyLessonReadingProgress = {
  revision: number;
  completedSections: readonly string[];
  activeSectionCode: string | null;
  playbackPositionSeconds: number;
};

export type AcademyLevelContent = {
  available: boolean;
  /**
   * Present only when the published content carries a usable video asset.
   * Null on every text-only lesson.
   */
  media: AcademyLessonMedia | null;
  /**
   * The written lesson: sections and blocks, in reading order.
   *
   * Null when the published body cannot be read at all (no content configured,
   * a format this build does not support, or every block dropped by the
   * fail-closed reader). The Academy has always received this payload and until
   * now discarded it; see lib/curriculum/lesson-body.ts.
   */
  body: import("@/lib/curriculum/lesson-body").LessonBody | null;
  /** Present only when the learner has a reading position on this lesson. */
  reading: AcademyLessonReadingProgress | null;
  /** Present when available: safe, display-only content metadata. */
  metadata: {
    versionNumber: number;
    videoDurationSeconds: number | null;
    publishedAt: string;
    locale: string;
    title: string;
    subtitle: string;
    summary: string;
    learningObjectiveExtension: string;
    hasTranscript: boolean;
  } | null;
  /** Why content is not shown (honest state), else null. */
  unavailableReason:
    | "not_configured"
    | "locked"
    | "not_enrolled"
    | "unsupported_type"
    | "unavailable"
    | null;
};

export type AcademyLevelDetail = {
  summary: AcademyLevelSummary;
  moduleCode: string;
  prerequisites: { previousLevel: number | null; requiredXp: number; checkpointLevel: number | null };
  content: AcademyLevelContent;
  navigation: { previousLevelCode: string | null; nextLevelCode: string | null };
};

/** The whole curriculum read, discriminated by learner state. */
export type AcademyCurriculumView =
  | {
      state: "enrolled" | "completed";
      curriculum: AcademyCurriculumSummary;
      modules: AcademyModuleSummary[];
      progress: AcademyProgressSummary;
      /**
       * The Backend's tool verdict, or null when it could not be read.
       *
       * Null is not "unknown, decide locally" — the local join no longer decides
       * anything. Null means locked, everywhere (TOOLS-AUTHORITY-DIVERGENCE-1).
       */
      toolAccess: AcademyToolAccess | null;
    }
  | {
      state: "candidate";
      curriculum: AcademyCurriculumSummary;
      modules: [];
      progress: null;
    }
  | {
      state: "unavailable";
      reason: string;
    };

/**
 * The Backend's tool verdict as the Academy carries it.
 *
 * Deliberately the same shape the Backend sends, minus the fields no surface
 * uses. Reshaping it would create a second place where "unlocked" is decided.
 */
export type AcademyToolAccess = {
  total: number;
  unlockedCount: number;
  tools: ReadonlyArray<{ code: string; unlocked: boolean; unlockLevel: number }>;
};
