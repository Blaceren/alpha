/**
 * Backend Curriculum V2 read wire types + narrow runtime guards.
 *
 * These mirror EXACTLY the shapes the Backend read API emits
 * (`src/lib/curriculum/read-api.ts` in the Backend), which the Academy consumes
 * read-only. We do not add a schema library; explicit guards validate only the
 * fields the Academy reads and treat unknown enum values safely (never as an
 * unlock). Raw Backend objects never leave this boundary — callers map to the
 * Academy view models in `view-model.ts`.
 */

/** GET /api/curriculum/v2/current envelope: { data: BackendCurriculumRead }. */
export type BackendCurriculumEnvelope = { data: BackendCurriculumRead };

export type BackendCurriculumRead =
  | BackendCandidateRead
  | BackendEnrolledRead
  | BackendCompletedRead
  | BackendUnavailableRead;

export type BackendCurriculumMeta = {
  code: string;
  name: string;
  versionNumber: number;
  status: string;
  effectiveFrom: string | null;
  publishedAt: string | null;
};

export type BackendEnrollment = {
  status: string;
  enrolledAt: string;
  currentLevel: number;
  highestCompletedLevel: number;
  lastMeaningfulActionAt: string | null;
  completedAt: string | null;
};

export type BackendProgress = {
  status: string;
  startedAt: string;
  lastProgressAt: string | null;
  completedAt: string | null;
  completionMethod: string | null;
  attemptCount: number;
};

export type BackendLevel = {
  levelNumber: number;
  stableCode: string;
  type: string;
  title: string;
  shortDescription: string | null;
  learningObjective: string;
  completionMethod: string;
  xpReward: number;
  requirements: {
    previousLevel: number | null;
    requiredXp: number;
    checkpointLevel: number | null;
  };
  status: string;
  /** Only present in enrolled context. */
  presentationState?: string;
  /** Only present in enrolled context. */
  blockers?: string[];
  durableStatus: string | null;
  progress: BackendProgress | null;
};

export type BackendModule = {
  moduleNumber: number;
  code: string;
  title: string;
  description: string | null;
  firstLevel: number;
  lastLevel: number;
  checkpointLevel: number | null;
  learningObjective: string;
  status: string;
  levels: BackendLevel[];
};

export type BackendXp =
  | { kind: "disabled" }
  | {
      kind: "available";
      currentXp: number;
      transactionCount: number;
      lastTransactionAt: string | null;
      nextLevelRequiredXp: number | null;
      xpRemaining: number;
    };

export type BackendCandidateRead = {
  kind: "candidate";
  curriculum: BackendCurriculumMeta & { moduleCount: number; levelCount: number };
  enrollment: null;
  xp?: { kind: "disabled" };
};

export type BackendEnrolledRead = {
  kind: "enrolled";
  curriculum: BackendCurriculumMeta;
  enrollment: BackendEnrollment;
  modules: BackendModule[];
  xp: BackendXp;
};

export type BackendCompletedRead = {
  kind: "completed";
  curriculum: BackendCurriculumMeta;
  enrollment: BackendEnrollment;
  modules: BackendModule[];
  xp?: BackendXp;
};

export type BackendUnavailableRead = {
  kind: "unavailable";
  reason: string;
  xp?: { kind: "disabled" };
};

/* --------------------------- content route --------------------------- */

/** GET /api/curriculum/v2/levels/{stableCode}/content envelope: { data: BackendLevelContent }. */
export type BackendLevelContentEnvelope = { data: BackendLevelContent };

export type BackendLevelContent = {
  kind: "available" | "completed";
  level: {
    levelNumber: number;
    stableCode: string;
    type: string;
    title: string;
    shortDescription: string;
    learningObjective: string;
  };
  content: {
    versionNumber: number;
    videoDurationSeconds: number | null;
    publishedAt: string;
    localization: {
      locale: string;
      title: string;
      subtitle: string;
      learningObjectiveExtension: string;
      summary: string;
      transcript: string | null;
      body: unknown;
    };
    assets: unknown[];
  };
  progress: unknown | null;
};

/* ------------------------------ guards ------------------------------- */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isStrOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}

function isProgress(v: unknown): v is BackendProgress {
  return (
    isObject(v) &&
    isStr(v.status) &&
    isStr(v.startedAt) &&
    isStrOrNull(v.lastProgressAt) &&
    isStrOrNull(v.completedAt) &&
    isStrOrNull(v.completionMethod) &&
    isNum(v.attemptCount)
  );
}

function isLevel(v: unknown): v is BackendLevel {
  if (!isObject(v)) return false;
  const req = v.requirements;
  return (
    isNum(v.levelNumber) &&
    isStr(v.stableCode) &&
    isStr(v.type) &&
    isStr(v.title) &&
    (v.shortDescription === null || isStr(v.shortDescription)) &&
    isStr(v.learningObjective) &&
    isStr(v.completionMethod) &&
    isNum(v.xpReward) &&
    isObject(req) &&
    (req.previousLevel === null || isNum(req.previousLevel)) &&
    isNum(req.requiredXp) &&
    (req.checkpointLevel === null || isNum(req.checkpointLevel)) &&
    isStr(v.status) &&
    (v.presentationState === undefined || isStr(v.presentationState)) &&
    (v.blockers === undefined || (Array.isArray(v.blockers) && v.blockers.every(isStr))) &&
    isStrOrNull(v.durableStatus) &&
    (v.progress === null || isProgress(v.progress))
  );
}

function isModule(v: unknown): v is BackendModule {
  return (
    isObject(v) &&
    isNum(v.moduleNumber) &&
    isStr(v.code) &&
    isStr(v.title) &&
    (v.description === null || isStr(v.description)) &&
    isNum(v.firstLevel) &&
    isNum(v.lastLevel) &&
    (v.checkpointLevel === null || isNum(v.checkpointLevel)) &&
    isStr(v.learningObjective) &&
    isStr(v.status) &&
    Array.isArray(v.levels) &&
    v.levels.every(isLevel)
  );
}

function isCurriculumMeta(v: unknown): v is BackendCurriculumMeta {
  return (
    isObject(v) &&
    isStr(v.code) &&
    isStr(v.name) &&
    isNum(v.versionNumber) &&
    isStr(v.status) &&
    isStrOrNull(v.effectiveFrom) &&
    isStrOrNull(v.publishedAt)
  );
}

function isEnrollment(v: unknown): v is BackendEnrollment {
  return (
    isObject(v) &&
    isStr(v.status) &&
    isStr(v.enrolledAt) &&
    isNum(v.currentLevel) &&
    isNum(v.highestCompletedLevel) &&
    isStrOrNull(v.lastMeaningfulActionAt) &&
    isStrOrNull(v.completedAt)
  );
}

export function isBackendCurriculumRead(value: unknown): value is BackendCurriculumRead {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case "candidate":
      return isObject(value.curriculum) && isCurriculumMeta(value.curriculum) && value.enrollment === null;
    case "enrolled":
      return (
        isCurriculumMeta(value.curriculum) &&
        isEnrollment(value.enrollment) &&
        Array.isArray(value.modules) &&
        value.modules.every(isModule)
      );
    case "completed":
      return (
        isCurriculumMeta(value.curriculum) &&
        isEnrollment(value.enrollment) &&
        Array.isArray(value.modules) &&
        value.modules.every(isModule)
      );
    case "unavailable":
      return isStr(value.reason);
    default:
      return false;
  }
}

export function isBackendCurriculumEnvelope(value: unknown): value is BackendCurriculumEnvelope {
  return isObject(value) && isBackendCurriculumRead(value.data);
}

export function isBackendLevelContent(value: unknown): value is BackendLevelContent {
  if (!isObject(value)) return false;
  if (value.kind !== "available" && value.kind !== "completed") return false;
  const level = value.level;
  const content = value.content;
  return (
    isObject(level) &&
    isNum(level.levelNumber) &&
    isStr(level.stableCode) &&
    isStr(level.type) &&
    isStr(level.title) &&
    isObject(content) &&
    isObject(content.localization)
  );
}

export function isBackendLevelContentEnvelope(value: unknown): value is BackendLevelContentEnvelope {
  return isObject(value) && isBackendLevelContent(value.data);
}
