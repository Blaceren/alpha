/**
 * Pure mappers: Backend curriculum read -> Academy view models.
 *
 * No I/O, no storage, no fetch. Fully unit-testable. Renders the Backend's
 * authoritative decisions; never recomputes prerequisites or unlocks. Unknown
 * types/states degrade safely (see level-type.ts / progress-state.ts).
 */
import type {
  BackendCurriculumRead,
  BackendCurriculumMeta,
  BackendLevel,
  BackendModule,
  BackendXp,
  BackendLevelContent,
  BackendContentAsset,
} from "@/lib/curriculum/backend-dto";
import { mapLevelType, type AcademyLevelType } from "@/lib/curriculum/level-type";
import { mapCompletionMethod } from "@/lib/curriculum/completion-method";
import { mapLevelState } from "@/lib/curriculum/progress-state";
import type {
  AcademyCheckpointState,
  AcademyCurriculumSummary,
  AcademyCurriculumView,
  AcademyLessonReadingProgress,
  AcademyLevelContent,
  AcademyLevelDetail,
  AcademyLessonMedia,
  AcademyLevelSummary,
  AcademyModuleSummary,
  AcademyProgressSummary,
} from "@/lib/curriculum/academy-view";
import { completionSourceLabel } from "@/lib/curriculum/completion-source";
import { normalizeLessonBody } from "@/lib/curriculum/lesson-body";
import { readBackendToolAccess } from "@/lib/curriculum/backend-dto";

/**
 * The learner's reading position, read defensively.
 *
 * `progress` crosses the wire as `unknown`. Anything missing or malformed
 * yields null, which the reader treats as "no saved position" — the same thing
 * a first visit looks like. It is never invented: a fabricated revision would
 * be refused by the Backend's optimistic-concurrency check anyway, and a
 * fabricated section list would tell the learner they had read something they
 * had not.
 */
export function mapReadingProgress(raw: unknown): AcademyLessonReadingProgress | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 0) return null;

  const completedSections = Array.isArray(row.completedSections)
    ? row.completedSections.filter((code): code is string => typeof code === "string" && code.length > 0)
    : [];

  const progressData = typeof row.progressData === "object" && row.progressData !== null
    ? (row.progressData as Record<string, unknown>)
    : null;
  const activeSectionCode = typeof progressData?.activeSectionCode === "string"
    ? progressData.activeSectionCode
    : null;

  return {
    revision: row.revision,
    completedSections,
    activeSectionCode,
    playbackPositionSeconds:
      typeof row.playbackPositionSeconds === "number" && row.playbackPositionSeconds >= 0
        ? Math.floor(row.playbackPositionSeconds)
        : 0,
  };
}

export function levelHref(levelCode: string): string {
  return `/lessons/${encodeURIComponent(levelCode)}`;
}

const COMPLETION_SOURCE: Record<AcademyLevelType, string> = {
  external: "external_event",
  checkpoint: "financial_checkpoint",
  report: "mentor_review",
  "mentor-review": "mentor_review",
  lesson: "self",
  scenario: "self",
  practice: "self",
  "final-exam": "final_exam",
  unsupported: "unknown",
};

function mapCurriculum(meta: BackendCurriculumMeta): AcademyCurriculumSummary {
  return {
    curriculumCode: meta.code,
    curriculumVersion: meta.versionNumber,
    title: meta.name,
    status: meta.status,
    publishedAt: meta.publishedAt,
  };
}

const CHECKPOINT_STATES = new Set([
  "verification_unavailable",
  "ready",
  "checking",
  "cooldown",
  "not_met",
  "completed",
]);

const CHECKPOINT_REASONS = new Set([
  "none",
  "checkpoint_disabled",
  "provider_disabled",
  "provider_unconfigured",
  "requirement_unconfigured",
  "integration_unknown",
  "identity_unlinked",
  "identity_mismatch",
  "unsupported_currency",
  "provider_timeout",
  "provider_maintenance",
  "provider_rate_limited",
  "stale",
  "invalid_provider_response",
  "cooldown_active",
  "rate_limited",
  "not_met",
]);

/** An advertised wait longer than this is treated as absent rather than shown. */
const MAX_RETRY_AFTER_SECONDS = 3_600;

/**
 * Map the Backend checkpoint block. Fail-closed in both directions: a missing
 * block (older Backend) and an unrecognised verification state both resolve to
 * "cannot verify, cannot start, cannot complete", so the Academy can never
 * present a checkpoint as passable because it failed to understand the payload.
 */
function mapCheckpoint(level: BackendLevel, isCheckpointType: boolean): AcademyCheckpointState | null {
  if (!isCheckpointType) return null;
  const raw = level.checkpoint;
  if (!raw) {
    return {
      verificationState: "unsupported",
      reason: "unsupported",
      canVerify: false,
      canStart: false,
      canComplete: false,
      retryAfterSeconds: null,
    };
  }
  const known = CHECKPOINT_STATES.has(raw.verificationState);
  const retry = raw.retryAfterSeconds;
  return {
    verificationState: known
      ? (raw.verificationState as AcademyCheckpointState["verificationState"])
      : "unsupported",
    reason: known && CHECKPOINT_REASONS.has(raw.verificationReason)
      ? (raw.verificationReason as AcademyCheckpointState["reason"])
      : "unsupported",
    // The Academy never widens a Backend permission: `true` is honoured only
    // when the Backend says so, and anything unrecognised stays false.
    canVerify: raw.canVerify === true && known,
    canStart: raw.canStart === true && known,
    canComplete: raw.canComplete === true && known,
    // A wait is only shown when it is a sane, positive, bounded duration.
    retryAfterSeconds:
      known &&
      typeof retry === "number" &&
      Number.isFinite(retry) &&
      retry > 0 &&
      retry <= MAX_RETRY_AFTER_SECONDS
        ? Math.ceil(retry)
        : null,
  };
}

function progressVersionOf(level: BackendLevel): string | null {
  const p = level.progress;
  if (!p) return null;
  return p.lastProgressAt ?? p.completedAt ?? p.startedAt ?? null;
}

function mapLevel(level: BackendLevel): AcademyLevelSummary {
  const typeInfo = mapLevelType(level.type);
  const stateInfo = mapLevelState({
    presentationState: level.presentationState,
    blockers: level.blockers,
    durableStatus: level.durableStatus,
    isExternal: typeInfo.isExternal,
  });
  return {
    levelCode: level.stableCode,
    order: level.levelNumber,
    title: level.title,
    shortDescription: level.shortDescription,
    learningObjective: level.learningObjective,
    typeInfo: {
      type: typeInfo.type,
      label: typeInfo.label,
      isCheckpoint: typeInfo.isCheckpoint,
      isExternal: typeInfo.isExternal,
      supported: typeInfo.supported,
    },
    state: stateInfo.state,
    lockReason: stateInfo.lockReason,
    stateLabel: stateInfo.label,
    completionSource: COMPLETION_SOURCE[typeInfo.type],
    completionSourceLabel: completionSourceLabel(COMPLETION_SOURCE[typeInfo.type]),
    requirements: {
      previousLevel: level.requirements.previousLevel,
      requiredXp: level.requirements.requiredXp,
      checkpointLevel: level.requirements.checkpointLevel,
    },
    routeAccessible: stateInfo.routeAccessible,
    actions: stateInfo.routeAccessible ? ["view"] : [],
    href: levelHref(level.stableCode),
    xpReward: level.xpReward,
    progressVersion: progressVersionOf(level),
    checkpoint: mapCheckpoint(level, typeInfo.isCheckpoint),
    // G3. `completionMethod` has always travelled in the Backend payload and was
    // dropped here, which is why a `lesson:manual` level was indistinguishable
    // from a `lesson:assessment_pass` one and got the wrong surface.
    completionMethod: mapCompletionMethod(level.completionMethod),
  };
}

function mapModule(moduleDefinition: BackendModule): AcademyModuleSummary {
  const levels = [...moduleDefinition.levels]
    .sort((a, b) => a.levelNumber - b.levelNumber)
    .map(mapLevel);
  return {
    moduleCode: moduleDefinition.code,
    order: moduleDefinition.moduleNumber,
    title: moduleDefinition.title,
    description: moduleDefinition.description,
    learningObjective: moduleDefinition.learningObjective,
    status: moduleDefinition.status,
    levels,
    progress: { total: levels.length, completed: levels.filter((l) => l.state === "completed").length },
  };
}

function mapXp(xp: BackendXp | undefined): AcademyProgressSummary["xp"] {
  if (!xp || xp.kind === "disabled") return { available: false };
  return {
    available: true,
    currentXp: xp.currentXp,
    nextLevelRequiredXp: xp.nextLevelRequiredXp,
    xpRemaining: xp.xpRemaining,
  };
}

function buildProgress(
  modules: AcademyModuleSummary[],
  currentLevelNumber: number | null,
  updatedAt: string | null,
  xp: BackendXp | undefined,
): AcademyProgressSummary {
  const allLevels = modules.flatMap((m) => m.levels.map((l) => ({ level: l, moduleCode: m.moduleCode })));
  const total = allLevels.length;
  const completed = allLevels.filter((x) => x.level.state === "completed").length;
  const current = currentLevelNumber === null ? null : allLevels.find((x) => x.level.order === currentLevelNumber) ?? null;
  const nextAvailable = allLevels.find((x) => x.level.state === "available") ?? null;
  return {
    currentLevelCode: current?.level.levelCode ?? null,
    currentModuleCode: current?.moduleCode ?? null,
    nextAvailableLevelCode: nextAvailable?.level.levelCode ?? null,
    completedLevels: completed,
    totalLevels: total,
    xp: mapXp(xp),
    updatedAt,
  };
}

export function toAcademyCurriculumView(read: BackendCurriculumRead): AcademyCurriculumView {
  if (read.kind === "unavailable") {
    return { state: "unavailable", reason: read.reason };
  }
  if (read.kind === "candidate") {
    return { state: "candidate", curriculum: mapCurriculum(read.curriculum), modules: [], progress: null };
  }
  // enrolled | completed
  const modules = [...read.modules].sort((a, b) => a.moduleNumber - b.moduleNumber).map(mapModule);
  const currentLevelNumber = read.kind === "enrolled" ? read.enrollment.currentLevel : null;
  const updatedAt = read.enrollment.lastMeaningfulActionAt ?? read.enrollment.completedAt ?? read.enrollment.enrolledAt;
  const xp = read.xp;
  return {
    state: read.kind,
    curriculum: mapCurriculum(read.curriculum),
    modules,
    progress: buildProgress(modules, currentLevelNumber, updatedAt, xp),
    /* Strictly, and fail-closed: anything unreadable becomes null, and null
       locks every tool rather than falling back to a local guess. */
    toolAccess: readBackendToolAccess(read.toolAccess),
  };
}

/** Find a mapped level summary by stable code across a curriculum view. */
export function findLevel(view: AcademyCurriculumView, levelCode: string): { level: AcademyLevelSummary; moduleCode: string } | null {
  if (view.state === "unavailable" || view.state === "candidate") return null;
  for (const moduleSummary of view.modules) {
    const level = moduleSummary.levels.find((l) => l.levelCode === levelCode);
    if (level) return { level, moduleCode: moduleSummary.moduleCode };
  }
  return null;
}

/**
 * Pick the lesson's video out of the published content assets
 * (L2START-PLAYER-1).
 *
 * Rules, in order: the first `video` asset by sort order wins; a poster is used
 * only if the curriculum published an `image` asset for it; subtitles become
 * captions. Nothing is synthesised. If there is no video asset the answer is
 * `null` and the lesson page says so honestly rather than rendering an empty
 * player.
 *
 * Locale filtering is deliberately permissive: an asset with no locale is
 * language-neutral (the video itself usually is), and a locale-tagged asset is
 * kept when it matches the localisation being shown.
 */
function mapLessonMedia(
  content: BackendLevelContent,
  locale: string,
): AcademyLessonMedia | null {
  const usable = (asset: BackendContentAsset) => asset.locale === null || asset.locale === locale;
  const byOrder = [...content.content.assets].sort((a, b) => a.sortOrder - b.sortOrder);

  const video = byOrder.find((asset) => asset.kind === "video" && usable(asset));
  if (!video) return null;

  const poster = byOrder.find((asset) => asset.kind === "image" && usable(asset));
  const captions = byOrder
    .filter((asset) => asset.kind === "subtitles" && usable(asset))
    .map((asset) => ({
      src: asset.url,
      // The asset's own locale names the track's language; the lesson locale is
      // the fallback for a language-neutral track.
      srcLang: asset.locale ?? locale,
      label: asset.locale ?? locale,
    }));

  return {
    src: video.url,
    mimeType: video.mimeType,
    poster: poster?.url ?? null,
    durationSeconds: video.durationSeconds ?? content.content.videoDurationSeconds,
    captions,
  };
}

export function mapLevelContent(
  content: BackendLevelContent | null,
  unavailableReason: AcademyLevelContent["unavailableReason"],
): AcademyLevelContent {
  if (!content) {
    return {
      available: false,
      media: null,
      body: null,
      reading: null,
      metadata: null,
      unavailableReason: unavailableReason ?? "unavailable",
    };
  }
  const loc = content.content.localization;
  return {
    available: true,
    media: mapLessonMedia(content, loc.locale),
    // The written lesson, read fail-closed. A body this build cannot parse
    // yields null and the surface says so; it never yields a half-lesson.
    body: normalizeLessonBody(loc.body, content.content.assets),
    reading: mapReadingProgress(content.progress),
    metadata: {
      versionNumber: content.content.versionNumber,
      videoDurationSeconds: content.content.videoDurationSeconds,
      publishedAt: content.content.publishedAt,
      locale: loc.locale,
      title: loc.title,
      subtitle: loc.subtitle,
      summary: loc.summary,
      learningObjectiveExtension: loc.learningObjectiveExtension,
      hasTranscript: typeof loc.transcript === "string" && loc.transcript.length > 0,
    },
    unavailableReason: null,
  };
}

export function buildLevelDetail(
  view: AcademyCurriculumView,
  levelCode: string,
  content: AcademyLevelContent,
): AcademyLevelDetail | null {
  const found = findLevel(view, levelCode);
  if (!found) return null;
  if (view.state === "unavailable" || view.state === "candidate") return null;

  const ordered = view.modules.flatMap((m) => m.levels);
  const index = ordered.findIndex((l) => l.levelCode === levelCode);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  return {
    summary: found.level,
    moduleCode: found.moduleCode,
    prerequisites: found.level.requirements,
    content,
    navigation: {
      previousLevelCode: previous?.levelCode ?? null,
      // Only expose forward navigation to an accessible next level.
      nextLevelCode: next && next.routeAccessible ? next.levelCode : null,
    },
  };
}
