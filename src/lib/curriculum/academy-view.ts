/**
 * Academy-facing curriculum view models (narrow, display-safe).
 *
 * These are the ONLY curriculum shapes components see. They carry no Prisma
 * objects, no correct answers, no feature-flag internals, no staff/session
 * data, and never use an array index as identity — stable module/level codes
 * are the identity. Timestamps are ISO strings; nulls are explicit.
 */
import type { AcademyLevelType } from "@/lib/curriculum/level-type";
import type { AcademyLevelState, AcademyLockReason } from "@/lib/curriculum/progress-state";

export type AcademyCurriculumSummary = {
  curriculumCode: string;
  curriculumVersion: number;
  title: string;
  status: string;
  publishedAt: string | null;
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
  requirements: { previousLevel: number | null; requiredXp: number; checkpointLevel: number | null };
  routeAccessible: boolean;
  /** Read-only in CI-2: "view" only, never a write action. */
  actions: ReadonlyArray<"view">;
  href: string;
  xpReward: number;
  /** Opaque staleness marker (latest progress timestamp), else null. */
  progressVersion: string | null;
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

export type AcademyLevelContent = {
  available: boolean;
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
