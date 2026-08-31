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

/**
 * Bounded financial-checkpoint block. Present only on `financial_checkpoint`
 * levels; `null` on every other level.
 *
 * The Backend never sends a balance, a remaining amount or any account value,
 * and this type has no field one could occupy — so a future Backend change that
 * started sending one would fail the guard rather than reach the UI.
 */
export type BackendCheckpoint = {
  kind: string;
  integrationCode: string | null;
  verificationState: string;
  verificationReason: string;
  canVerify: boolean;
  canStart: boolean;
  canComplete: boolean;
  /**
   * Seconds to wait before retrying. A DURATION, never an amount of money.
   * Absent on a Backend that predates L4VC-1.
   */
  retryAfterSeconds?: number | null;
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
  /** Absent on a Backend that predates the honest gate; null on non-checkpoints. */
  checkpoint?: BackendCheckpoint | null;
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
  /** Read only through `readBackendToolAccess`. */
  toolAccess?: unknown;
};

export type BackendCompletedRead = {
  kind: "completed";
  curriculum: BackendCurriculumMeta;
  enrollment: BackendEnrollment;
  modules: BackendModule[];
  xp?: BackendXp;
  /** Read only through `readBackendToolAccess`. */
  toolAccess?: unknown;
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
    assets: BackendContentAsset[];
  };
  progress: unknown | null;
};

/**
 * One published media asset attached to a lesson's content version
 * (L2START-PLAYER-1).
 *
 * This is not a new contract — the Backend has always returned these; the
 * Academy simply never typed them, so the lesson page could not know a video
 * existed. Typing them here is the whole of the change: no upload, no storage,
 * no new Backend field.
 *
 * `url` is asserted https by the Backend's own asset schema. Unknown kinds are
 * kept rather than dropped, so a future asset kind is inert here instead of
 * invalidating the whole content payload.
 */
export type BackendContentAsset = {
  kind: string;
  assetCode: string;
  locale: string | null;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  sortOrder: number;
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

function isCheckpoint(v: unknown): v is BackendCheckpoint {
  return (
    isObject(v) &&
    isStr(v.kind) &&
    isStrOrNull(v.integrationCode) &&
    isStr(v.verificationState) &&
    isStr(v.verificationReason) &&
    typeof v.canVerify === "boolean" &&
    typeof v.canStart === "boolean" &&
    typeof v.canComplete === "boolean" &&
    (v.retryAfterSeconds === undefined ||
      v.retryAfterSeconds === null ||
      isNum(v.retryAfterSeconds))
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
    (v.progress === null || isProgress(v.progress)) &&
    (v.checkpoint === undefined || v.checkpoint === null || isCheckpoint(v.checkpoint))
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

/**
 * A content asset the Academy is willing to believe.
 *
 * Deliberately strict about `url`: a lesson media source is handed straight to
 * a <video> element, so anything that is not an absolute https URL is dropped
 * rather than rendered. That rules out `javascript:` and `data:` sources, and
 * also `blob:` — which is exactly what the showcase's local file picker
 * produces, and must never reach a real lesson.
 */
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

export function isBackendContentAsset(value: unknown): value is BackendContentAsset {
  if (!isObject(value)) return false;
  return (
    isStr(value.kind) &&
    isStr(value.assetCode) &&
    isStrOrNull(value.locale) &&
    isHttpsUrl(value.url) &&
    isStr(value.mimeType)
  );
}

/**
 * Read the asset list defensively.
 *
 * A malformed asset drops out on its own instead of invalidating the lesson: a
 * learner who can read the text and take the assessment should not lose the
 * whole level because one media row is wrong.
 */
export function readBackendContentAssets(value: unknown): BackendContentAsset[] {
  if (!Array.isArray(value)) return [];
  const assets: BackendContentAsset[] = [];
  for (const entry of value) {
    if (!isBackendContentAsset(entry)) continue;
    const record = entry as unknown as Record<string, unknown>;
    assets.push({
      kind: entry.kind,
      assetCode: entry.assetCode,
      locale: entry.locale,
      url: entry.url,
      mimeType: entry.mimeType,
      sizeBytes: isNum(record.sizeBytes) ? record.sizeBytes : null,
      durationSeconds: isNum(record.durationSeconds) ? record.durationSeconds : null,
      sortOrder: isNum(record.sortOrder) ? record.sortOrder : 0,
    });
  }
  return assets;
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

/**
 * TOOLS-AUTHORITY-DIVERGENCE-1 — the Backend's tool verdict, read strictly.
 *
 * The Backend has decided which tools are unlocked since Phase F and has been
 * shipping the answer on this payload the whole time. The Academy was deriving
 * its own from a contiguous-completed-prefix join. The two agreed for every
 * learner anyone checked, and the Academy's rule was the stricter of the two, so
 * nothing shipped wrong — but "agrees today" is not an authority, and two rules
 * that must not drift are one rule too many.
 *
 * EVERY REJECTION HERE LOCKS EVERYTHING. The caller turns `null` into a locked
 * register, so each `return null` below is a decision to withhold access rather
 * than to guess at it. Withholding a tool someone earned is a recoverable
 * annoyance; opening one because a payload could not be parsed is not.
 *
 * `unlocked` must be a real boolean. A JSON `"false"` is a truthy string, and
 * that is exactly the mistake this refuses to make.
 *
 * A duplicate code is fail-closed rather than last-wins: two entries for one
 * tool means the payload does not have a single opinion about it, and picking
 * one of them would be inventing the opinion.
 */
export type BackendToolAccessEntry = {
  code: string;
  unlocked: boolean;
  unlockLevel: number;
};

export type BackendToolAccess = {
  total: number;
  unlockedCount: number;
  tools: BackendToolAccessEntry[];
};

export function readBackendToolAccess(value: unknown): BackendToolAccess | null {
  if (!isObject(value)) return null;

  const total = value.total;
  const unlockedCount = value.unlockedCount;
  const tools = value.tools;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) return null;
  if (typeof unlockedCount !== "number" || !Number.isInteger(unlockedCount) || unlockedCount < 0) return null;
  if (!Array.isArray(tools)) return null;

  const entries: BackendToolAccessEntry[] = [];
  const seen = new Set<string>();
  for (const raw of tools) {
    if (!isObject(raw)) return null;
    const { code, unlocked, unlockLevel } = raw;
    if (typeof code !== "string" || code.length === 0) return null;
    if (typeof unlocked !== "boolean") return null;
    if (typeof unlockLevel !== "number" || !Number.isInteger(unlockLevel)) return null;
    if (seen.has(code)) return null;
    seen.add(code);
    entries.push({ code, unlocked, unlockLevel });
  }

  // The envelope must agree with its own contents, or it is not one answer.
  if (entries.length !== total) return null;
  if (entries.filter((entry) => entry.unlocked).length !== unlockedCount) return null;

  return { total, unlockedCount, tools: entries };
}
