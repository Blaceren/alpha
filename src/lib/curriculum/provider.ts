/**
 * The single curriculum data provider.
 *
 * Components never fetch — they call the provider. The provider is selected
 * explicitly by Academy mode. In `api` mode it reads the Backend
 * (server-authoritative) and has NO fixture fallback. In `fixture` mode it
 * synthesizes a view from the local curriculum fixture for visual development.
 * There are NO write methods anywhere on this interface.
 *
 * SERVER-ONLY by convention (imports next/headers via server-read); never
 * import into a Client Component.
 */
import { getAcademyConfig } from "@/config/academy-config";
import { readCurriculumCurrent, readLevelContent } from "@/server/curriculum/server-read";
import {
  buildLevelDetail,
  findLevel,
  mapLevelContent,
  toAcademyCurriculumView,
} from "@/lib/curriculum/view-model";
import { makeReadError, type CurriculumReadError } from "@/lib/curriculum/read-errors";
import type {
  AcademyCurriculumView,
  AcademyLevelDetail,
  AcademyLevelContent,
} from "@/lib/curriculum/academy-view";
import type { BackendCurriculumRead, BackendLevel, BackendModule } from "@/lib/curriculum/backend-dto";
import { CURRICULUM } from "@/data/curriculum/fixture";
import { FIXTURE_KIND_TO_BACKEND_TYPE } from "@/lib/curriculum/level-type";

export type CurriculumViewResult =
  | { ok: true; view: AcademyCurriculumView }
  | { ok: false; error: CurriculumReadError };

/**
 * The level read, and the programme it sits in.
 *
 * `view` is carried alongside the detail because the level page has to answer
 * two questions a level alone cannot: how far through the programme this level
 * is, and what the learner should do next once it is finished. Both already have
 * exactly one owner — `deriveNextAction` and the progress summary — and handing
 * the same view to the page is what lets it reuse them instead of deriving a
 * second, disagreeing answer.
 *
 * It costs nothing: the view is the read this function already performed to find
 * the level at all.
 */
export type LevelDetailResult =
  | { ok: true; detail: AcademyLevelDetail; view: AcademyCurriculumView }
  | { ok: false; error: CurriculumReadError };

const DEFAULT_LOCALE = "ru";

/* ------------------------------- api mode ------------------------------- */

async function apiCurriculumView(): Promise<CurriculumViewResult> {
  const result = await readCurriculumCurrent();
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, view: toAcademyCurriculumView(result.read) };
}

async function apiLevelDetail(levelCode: string, locale: string): Promise<LevelDetailResult> {
  const current = await readCurriculumCurrent();
  if (!current.ok) return { ok: false, error: current.error };
  const view = toAcademyCurriculumView(current.read);
  const found = findLevel(view, levelCode);
  if (!found) return { ok: false, error: makeReadError("LEVEL_NOT_FOUND") };

  let content: AcademyLevelContent;
  if (!found.level.typeInfo.supported) {
    content = mapLevelContent(null, "unsupported_type");
  } else if (!found.level.routeAccessible) {
    // Locked/inaccessible: the Backend still enforces this; do not fetch content.
    content = mapLevelContent(null, "locked");
  } else {
    const contentResult = await readLevelContent(levelCode, locale);
    content = contentResult.ok
      ? mapLevelContent(contentResult.content, null)
      : mapLevelContent(null, contentResult.reason === "feature_disabled" ? "unavailable" : contentResult.reason);
  }

  const detail = buildLevelDetail(view, levelCode, content);
  if (!detail) return { ok: false, error: makeReadError("LEVEL_NOT_FOUND") };
  return { ok: true, detail, view };
}

/* ----------------------------- fixture mode ----------------------------- */

// A small synthetic Backend read built from the local fixture, so the fixture
// provider produces the SAME view model as api mode via the SAME mapper (parity
// by construction). It is clearly synthetic and never touches the Backend.
function fixtureBackendRead(): BackendCurriculumRead {
  const fixtureModule = CURRICULUM.modules[0];
  if (!fixtureModule) throw new Error("curriculum fixture has no modules");
  const sliceLevels = fixtureModule.levels.slice(0, 4);
  const currentLevel = 2;

  const levels: BackendLevel[] = sliceLevels.map((level, index) => {
    const levelNumber = index + 1;
    const backendType = FIXTURE_KIND_TO_BACKEND_TYPE[level.kind];
    const isCompleted = levelNumber < currentLevel;
    const isCurrent = levelNumber === currentLevel;
    const presentationState = isCompleted ? "completed" : isCurrent ? "available" : "locked";
    const blockers = presentationState === "locked" ? ["not_current_level", "sequence_incomplete"] : [];
    return {
      levelNumber,
      stableCode: `level.${String(levelNumber).padStart(3, "0")}`,
      type: backendType,
      title: level.title,
      shortDescription: null,
      learningObjective: level.title,
      completionMethod: "manual",
      xpReward: 10 * levelNumber,
      requirements: { previousLevel: levelNumber === 1 ? null : levelNumber - 1, requiredXp: 0, checkpointLevel: backendType === "financial_checkpoint" ? levelNumber : null },
      status: "active",
      presentationState,
      blockers,
      durableStatus: isCompleted ? "completed" : null,
      progress: isCompleted
        ? { status: "completed", startedAt: "2026-07-01T00:00:00.000Z", lastProgressAt: "2026-07-01T00:00:00.000Z", completedAt: "2026-07-01T00:00:00.000Z", completionMethod: "manual", attemptCount: 1 }
        : null,
    };
  });

  const backendModule: BackendModule = {
    moduleNumber: 1,
    code: "module.01",
    title: fixtureModule.title,
    description: fixtureModule.description ?? null,
    firstLevel: 1,
    lastLevel: sliceLevels.length,
    checkpointLevel: sliceLevels.length,
    learningObjective: fixtureModule.title,
    status: "active",
    levels,
  };

  return {
    kind: "enrolled",
    curriculum: { code: "ata-v2", name: "Alfa Trade Academy (fixture)", versionNumber: 1, status: "published", effectiveFrom: null, publishedAt: "2026-07-01T00:00:00.000Z" },
    enrollment: { status: "active", enrolledAt: "2026-07-01T00:00:00.000Z", currentLevel, highestCompletedLevel: currentLevel - 1, lastMeaningfulActionAt: "2026-07-01T00:00:00.000Z", completedAt: null },
    modules: [backendModule],
    xp: { kind: "disabled" },
  };
}

function fixtureCurriculumView(): CurriculumViewResult {
  return { ok: true, view: toAcademyCurriculumView(fixtureBackendRead()) };
}

function fixtureLevelDetail(levelCode: string): LevelDetailResult {
  const view = toAcademyCurriculumView(fixtureBackendRead());
  const found = findLevel(view, levelCode);
  if (!found) return { ok: false, error: makeReadError("LEVEL_NOT_FOUND") };
  const content = mapLevelContent(null, "not_configured");
  const detail = buildLevelDetail(view, levelCode, content);
  if (!detail) return { ok: false, error: makeReadError("LEVEL_NOT_FOUND") };
  return { ok: true, detail, view };
}

/* ------------------------------- selection ------------------------------ */

export function getCurriculumView(): Promise<CurriculumViewResult> {
  const mode = getAcademyConfig().mode;
  return mode === "api" ? apiCurriculumView() : Promise.resolve(fixtureCurriculumView());
}

export function getLevelDetail(levelCode: string, locale: string = DEFAULT_LOCALE): Promise<LevelDetailResult> {
  const mode = getAcademyConfig().mode;
  return mode === "api" ? apiLevelDetail(levelCode, locale) : Promise.resolve(fixtureLevelDetail(levelCode));
}
