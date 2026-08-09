/**
 * PHASE-G1 — the server-owned authoring READ projections.
 *
 * WHY THE SERVER OWNS THESE. Every state the Studio renders — "this level has no
 * learner content", "this bank is a proposal", "this video's QA is stale" — is a
 * conclusion drawn from several tables at once. Drawing it in the CRM would put a
 * second, drifting definition of "complete" in a repository that cannot see the
 * database, and the first time the two disagreed an editor would be told a level
 * was finished when the package pipeline says it is not. So the CRM receives
 * ANSWERS, never the raw rows it would have to reason over.
 *
 * SUMMARY-SHAPED BY CONSTRUCTION (§47). `readAuthoringOverview` loads bodies
 * SERVER-side in order to count teaching characters, and returns the COUNT. No
 * lesson body, no question, no answer key and no production contract crosses the
 * wire for the overview — opening one level is what fetches one level's detail.
 *
 * NOTHING HERE WRITES. Every function in this module is a read. The staleness a
 * caller sees is DERIVED on read by the accepted `readVideoProductionCoherence`,
 * never a flag this module could set.
 *
 * THE VOCABULARIES ARE CLOSED. `AssessmentProvenanceState` and the aggregate
 * shapes below are switch-able unions, because a UI that has to guess is a UI
 * that eventually renders a blank badge next to a level nobody then reviews.
 */
import type { EditorialState, Prisma } from "@prisma/client";
import {
  contentBodyBlocks,
  contentBodySectionCodes,
  contentBodyTeachingCharacters,
  parseContentBody,
} from "@/lib/curriculum/content-body";
import { occupiesCanonicalTakeSlot } from "@/lib/curriculum/authoring-level-profile";
import { completionPair } from "@/lib/curriculum/completion-pairs";
import { countBlueprintConflicts } from "@/lib/curriculum/authoring-conflict";
import {
  readVideoProductionCoherence,
  type VideoProductionCoherence,
} from "@/lib/curriculum/video-production-coherence";
import { parseContractPayload } from "@/lib/curriculum/video-production-authoring";
import { prisma } from "@/lib/prisma";

/** The locale the ATA product authors and publishes. */
export const AUTHORING_LOCALE = "ru" as const;

/* ------------------------------------------------------------------ *
 * Aggregate lifecycle summary
 * ------------------------------------------------------------------ */

export type AuthoringActorRef = { id: number; name: string | null } | null;

export type AuthoringAggregateSummary = {
  id: number;
  versionNumber: number;
  revision: number;
  editorialState: EditorialState;
  /**
   * The RUNTIME axis, never conflated with `editorialState` (G0 §1).
   *
   * `null` for a video production version, which HAS no runtime axis: a
   * production contract is internal editorial data and the runtime never serves
   * it. Reporting a fake `"draft"` there would invent a second lifecycle.
   */
  runtimeStatus: string | null;
  /**
   * §34 — the historical carve-out, surfaced as the historical fact it is.
   *
   * Every row that predates the G0 migration is `published` with
   * `editorialState = draft`. That combination is legal and must stay readable,
   * but it must never read as "this passed review", and the Studio must never
   * offer it as a shortcut. Naming it here is what lets the UI say so out loud.
   */
  legacyPublishedUnapproved: boolean;
  lastAuthoredBy: AuthoringActorRef;
  lastAuthoredAt: Date | null;
  submittedBy: AuthoringActorRef;
  submittedAt: Date | null;
  changesRequestedBy: AuthoringActorRef;
  changesRequestedAt: Date | null;
  approvedBy: AuthoringActorRef;
  approvedAt: Date | null;
  openReviewNotes: number;
};

export type ContentAggregateSummary = AuthoringAggregateSummary & {
  hasLocalization: boolean;
  bodyFormat: "none" | "legacy_v1" | "blocks_v2" | "unparseable";
  teachingCharacters: number;
  sectionCount: number;
  blockCount: number;
  assetCount: number;
};

/**
 * §15 — the assessment provenance vocabulary, kept as five DISTINCT states plus
 * one honest sixth.
 *
 * `LOCAL_DRAFT` exists because a bank on a level the Blueprint never covered has
 * no source provenance at all, and reporting it as `PROPOSED_CANON` would claim
 * a Blueprint proposal that does not exist. It is NOT a catch-all: the other five
 * are computed first and only a bank with no canonical contract reaches it.
 */
export const ASSESSMENT_PROVENANCE_STATES = [
  "MISSING",
  "PROPOSED_CANON",
  "SOURCE_BACKED",
  "APPROVED_CURRENT",
  "CONFLICTING",
  "LOCAL_DRAFT",
] as const;
export type AssessmentProvenanceState = (typeof ASSESSMENT_PROVENANCE_STATES)[number];

export type AssessmentAggregateSummary = AuthoringAggregateSummary & {
  questionCount: number;
  /** Questions whose `stableKey` is a well-formed take id for this level. */
  mappedTakeCount: number;
  provenance: AssessmentProvenanceState;
  /**
   * The canonical contract's OWN approval word, preserved separately from
   * `editorialState`. L18 is `SOURCE_BACKED` + `AWAITING_APPROVAL`, and the two
   * facts must remain visibly distinct (§15).
   */
  sourceApproval: "AWAITING_APPROVAL" | "APPROVED" | null;
  sourceProvenance: "SOURCE_BACKED" | "PROPOSED_CANON" | null;
  /** Field-level disagreements between the Blueprint proposal and this bank. */
  conflictCount: number;
};

export type VideoAggregateSummary = AuthoringAggregateSummary & {
  levelNumber: number;
  contractVersion: number;
  sourceProvenance: "SOURCE_BACKED" | "PROPOSED_CANON";
  scriptState: string;
  videoState: string;
  qaState: string;
  /** Phase-C staleness of the contract's own evidence. Server-owned. */
  contractEvidenceStale: boolean;
  /** G0-correction staleness against the REAL bank. Derived on read. */
  assessmentEvidenceStale: boolean;
  coherenceReason: VideoProductionCoherence["reason"];
};

export type AuthoringLevelSummary = {
  levelDefinitionId: number;
  levelNumber: number;
  stableCode: string;
  title: string;
  /* ---- READ-ONLY product structure (§8). Displayed, never edited here. ---- */
  levelType: string;
  completionMethod: string;
  completionPair: string;
  xpReward: number;
  requiredXp: number;
  requiredPreviousLevel: number | null;
  requiredCheckpointLevel: number | null;
  featureUnlockCode: string | null;
  moduleNumber: number;
  moduleCode: string;
  moduleTitle: string;
  /* ---------------------------- authoring state ---------------------------- */
  content: ContentAggregateSummary | null;
  assessment: AssessmentAggregateSummary | null;
  video: VideoAggregateSummary | null;
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

type UserRef = { id: number; name: string | null } | null | undefined;

function actorRef(user: UserRef): AuthoringActorRef {
  return user ? { id: user.id, name: user.name } : null;
}

const ACTOR_SELECT = { select: { id: true, name: true } } as const;

/**
 * The lifecycle columns shared by all three aggregates.
 *
 * `status` is NOT here: `VideoProductionVersion` does not have one, because a
 * production contract is never served to a learner and therefore has no runtime
 * axis to be in. The two aggregates that do carry it add it themselves.
 */
const LIFECYCLE_SELECT = {
  id: true,
  versionNumber: true,
  revision: true,
  editorialState: true,
  lastAuthoredAt: true,
  submittedAt: true,
  changesRequestedAt: true,
  approvedAt: true,
  lastAuthoredBy: ACTOR_SELECT,
  submittedBy: ACTOR_SELECT,
  changesRequestedBy: ACTOR_SELECT,
  approvedBy: ACTOR_SELECT,
} as const;

const RUNTIME_LIFECYCLE_SELECT = { ...LIFECYCLE_SELECT, status: true } as const;

type LifecycleRow = {
  id: number;
  versionNumber: number;
  revision: number;
  editorialState: EditorialState;
  status?: string;
  lastAuthoredAt: Date | null;
  submittedAt: Date | null;
  changesRequestedAt: Date | null;
  approvedAt: Date | null;
  lastAuthoredBy: UserRef;
  submittedBy: UserRef;
  changesRequestedBy: UserRef;
  approvedBy: UserRef;
};

function lifecycleSummary(row: LifecycleRow, openReviewNotes: number): AuthoringAggregateSummary {
  const runtimeStatus = row.status ?? null;
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    revision: row.revision,
    editorialState: row.editorialState,
    runtimeStatus,
    legacyPublishedUnapproved: runtimeStatus === "published" && row.editorialState !== "approved",
    lastAuthoredBy: actorRef(row.lastAuthoredBy),
    lastAuthoredAt: row.lastAuthoredAt,
    submittedBy: actorRef(row.submittedBy),
    submittedAt: row.submittedAt,
    changesRequestedBy: actorRef(row.changesRequestedBy),
    changesRequestedAt: row.changesRequestedAt,
    approvedBy: actorRef(row.approvedBy),
    approvedAt: row.approvedAt,
    openReviewNotes,
  };
}

/**
 * Which version of an aggregate does the Studio author?
 *
 * THE BINDING WINS, exactly as `resolveCanonicalAssessmentVersion` decides for
 * coherence: `LevelResourceBinding` is what the runtime serves, so it is the
 * level's current truth. With no binding the HIGHEST `versionNumber` is the
 * working version — the one a `createXVersion` just produced. Picking the lowest
 * would hand an editor the version they replaced.
 */
function pickWorkingVersion<T extends { id: number; versionNumber: number }>(
  candidates: readonly T[],
  boundId: number | null,
): T | null {
  if (candidates.length === 0) return null;
  if (boundId !== null) {
    const bound = candidates.find((candidate) => candidate.id === boundId);
    if (bound) return bound;
  }
  return candidates.reduce((best, candidate) =>
    candidate.versionNumber > best.versionNumber ? candidate : best,
  );
}

export function describeBody(body: unknown): {
  bodyFormat: ContentAggregateSummary["bodyFormat"];
  teachingCharacters: number;
  sectionCount: number;
  blockCount: number;
} {
  const parsed = parseContentBody(body);
  if (!parsed.ok) {
    return { bodyFormat: "unparseable", teachingCharacters: 0, sectionCount: 0, blockCount: 0 };
  }
  const isV2 =
    typeof parsed.body === "object" && parsed.body !== null && "format" in parsed.body;
  return {
    bodyFormat: isV2 ? "blocks_v2" : "legacy_v1",
    teachingCharacters: contentBodyTeachingCharacters(parsed.body),
    sectionCount: contentBodySectionCodes(parsed.body).length,
    blockCount: contentBodyBlocks(parsed.body).length,
  };
}

/* ------------------------------------------------------------------ *
 * Open review notes, counted in ONE query rather than 300
 * ------------------------------------------------------------------ */

type OpenNoteCounts = {
  content: Map<number, number>;
  assessment: Map<number, number>;
  video: Map<number, number>;
};

async function countOpenNotes(client: typeof prisma): Promise<OpenNoteCounts> {
  const rows = await client.editorialReviewNote.findMany({
    where: { resolvedAt: null },
    select: {
      contentVersionId: true,
      assessmentVersionId: true,
      videoProductionVersionId: true,
    },
  });
  const counts: OpenNoteCounts = { content: new Map(), assessment: new Map(), video: new Map() };
  const bump = (map: Map<number, number>, id: number | null) => {
    if (id === null) return;
    map.set(id, (map.get(id) ?? 0) + 1);
  };
  for (const row of rows) {
    bump(counts.content, row.contentVersionId);
    bump(counts.assessment, row.assessmentVersionId);
    bump(counts.video, row.videoProductionVersionId);
  }
  return counts;
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

/**
 * Every level of a curriculum version with its authoring state.
 *
 * Batched: one query per table, joined in memory. A per-level query would be 100
 * round trips for a page an editor opens dozens of times a day, and the coherence
 * read is the only per-row call that remains — it is a derivation, not a cache,
 * and it only runs for levels that actually carry a production contract.
 */
export async function readAuthoringOverview(
  curriculumVersionId: number,
): Promise<AuthoringLevelSummary[]> {
  const [levels, contentVersions, assessmentVersions, videoVersions, bindings, notes] =
    await Promise.all([
      prisma.levelDefinition.findMany({
        where: { curriculumVersionId },
        orderBy: { levelNumber: "asc" },
        select: {
          id: true,
          levelNumber: true,
          stableCode: true,
          title: true,
          type: true,
          completionMethod: true,
          xpReward: true,
          requiredXp: true,
          requiredPreviousLevel: true,
          requiredCheckpointLevel: true,
          featureUnlockCode: true,
          module: { select: { moduleNumber: true, code: true, title: true } },
        },
      }),
      prisma.contentVersion.findMany({
        where: { curriculumVersionId },
        select: {
          ...RUNTIME_LIFECYCLE_SELECT,
          levelDefinitionId: true,
          localizations: {
            where: { locale: AUTHORING_LOCALE },
            select: { body: true },
          },
          _count: { select: { assets: true } },
        },
      }),
      prisma.assessmentVersion.findMany({
        where: { curriculumVersionId },
        select: {
          ...RUNTIME_LIFECYCLE_SELECT,
          levelDefinitionId: true,
          questions: { select: { stableKey: true, questionNumber: true } },
        },
      }),
      prisma.videoProductionVersion.findMany({
        where: { curriculumVersionId },
        select: {
          ...LIFECYCLE_SELECT,
          levelDefinitionId: true,
          levelNumber: true,
          contractVersion: true,
          sourceProvenance: true,
          scriptState: true,
          videoState: true,
          qaState: true,
          productionEvidenceStale: true,
          contractPayload: true,
        },
      }),
      prisma.levelResourceBinding.findMany({
        where: { curriculumVersionId },
        select: { levelDefinitionId: true, contentVersionId: true, assessmentVersionId: true },
      }),
      countOpenNotes(prisma),
    ]);

  const bindingByLevel = new Map(bindings.map((row) => [row.levelDefinitionId, row]));
  const group = <T extends { levelDefinitionId: number }>(rows: readonly T[]) => {
    const map = new Map<number, T[]>();
    for (const row of rows) {
      const list = map.get(row.levelDefinitionId) ?? [];
      list.push(row);
      map.set(row.levelDefinitionId, list);
    }
    return map;
  };
  const contentByLevel = group(contentVersions);
  const assessmentByLevel = group(assessmentVersions);
  const videoByLevel = group(videoVersions);

  const summaries: AuthoringLevelSummary[] = [];

  for (const level of levels) {
    const binding = bindingByLevel.get(level.id) ?? null;

    const contentRow = pickWorkingVersion(
      contentByLevel.get(level.id) ?? [],
      binding?.contentVersionId ?? null,
    );
    const assessmentRow = pickWorkingVersion(
      assessmentByLevel.get(level.id) ?? [],
      binding?.assessmentVersionId ?? null,
    );
    const videoRow = pickWorkingVersion(videoByLevel.get(level.id) ?? [], null);

    const localization = contentRow?.localizations[0] ?? null;
    const described = localization
      ? describeBody(localization.body)
      : { bodyFormat: "none" as const, teachingCharacters: 0, sectionCount: 0, blockCount: 0 };

    const content: ContentAggregateSummary | null = contentRow
      ? {
          ...lifecycleSummary(contentRow, notes.content.get(contentRow.id) ?? 0),
          hasLocalization: localization !== null,
          ...described,
          assetCount: contentRow._count.assets,
        }
      : null;

    /* --- the canonical contract's provenance, read from the durable payload --- */
    let sourceProvenance: "SOURCE_BACKED" | "PROPOSED_CANON" | null = null;
    let sourceApproval: "AWAITING_APPROVAL" | "APPROVED" | null = null;
    let conflictCount = 0;
    if (videoRow) {
      sourceProvenance = videoRow.sourceProvenance as "SOURCE_BACKED" | "PROPOSED_CANON";
      try {
        const contract = parseContractPayload(videoRow.contractPayload);
        sourceApproval = contract.approval;
        if (assessmentRow) {
          conflictCount = await countBlueprintConflicts(prisma, {
            contract,
            assessmentVersionId: assessmentRow.id,
          });
        }
      } catch {
        // A payload that no longer parses is reported by validation, not here.
        sourceApproval = null;
      }
    }

    const assessment: AssessmentAggregateSummary | null = assessmentRow
      ? {
          ...lifecycleSummary(assessmentRow, notes.assessment.get(assessmentRow.id) ?? 0),
          questionCount: assessmentRow.questions.length,
          // PHASE-G1 TAKE-SLOT CORRECTION — questions sitting in their OWN slot.
          //
          // This used to accept any key merely SHAPED like one of this level's
          // takes, so a permuted bank counted four and readiness let it through
          // while the fingerprint bound the takes positionally. The rule is now
          // asked of `authoring-level-profile`, the single authority, so
          // readiness cannot drift from the validator.
          mappedTakeCount: assessmentRow.questions.filter((question) =>
            occupiesCanonicalTakeSlot(question.stableKey, level.levelNumber, question.questionNumber),
          ).length,
          provenance: resolveProvenance({
            editorialState: assessmentRow.editorialState,
            sourceProvenance,
            conflictCount,
          }),
          sourceApproval,
          sourceProvenance,
          conflictCount,
        }
      : null;

    let video: VideoAggregateSummary | null = null;
    if (videoRow) {
      const coherence = await readVideoProductionCoherence(videoRow.id, prisma);
      video = {
        ...lifecycleSummary(videoRow, notes.video.get(videoRow.id) ?? 0),
        levelNumber: videoRow.levelNumber,
        contractVersion: videoRow.contractVersion,
        sourceProvenance: videoRow.sourceProvenance as "SOURCE_BACKED" | "PROPOSED_CANON",
        scriptState: videoRow.scriptState,
        videoState: videoRow.videoState,
        qaState: videoRow.qaState,
        contractEvidenceStale: videoRow.productionEvidenceStale,
        assessmentEvidenceStale: coherence.assessmentEvidenceStale,
        coherenceReason: coherence.reason,
      };
    }

    summaries.push({
      levelDefinitionId: level.id,
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      title: level.title,
      levelType: level.type,
      completionMethod: level.completionMethod,
      completionPair: completionPair(level.type, level.completionMethod),
      xpReward: level.xpReward,
      requiredXp: level.requiredXp,
      requiredPreviousLevel: level.requiredPreviousLevel,
      requiredCheckpointLevel: level.requiredCheckpointLevel,
      featureUnlockCode: level.featureUnlockCode,
      moduleNumber: level.module.moduleNumber,
      moduleCode: level.module.code,
      moduleTitle: level.module.title,
      content,
      assessment,
      video,
    });
  }

  return summaries;
}

/**
 * The five-state provenance decision, in one place.
 *
 * ORDER IS THE RULE. A CONFLICTING bank is reported as conflicting even if it is
 * approved, because the disagreement with the Blueprint is the fact a reviewer
 * must act on and an "approved" badge would hide it. Approval is checked next,
 * then the contract's own provenance, and only a bank with no contract at all
 * falls through to LOCAL_DRAFT.
 */
export function resolveProvenance(input: {
  editorialState: EditorialState;
  sourceProvenance: "SOURCE_BACKED" | "PROPOSED_CANON" | null;
  conflictCount: number;
}): AssessmentProvenanceState {
  if (input.conflictCount > 0) return "CONFLICTING";
  if (input.editorialState === "approved") return "APPROVED_CURRENT";
  if (input.sourceProvenance === "SOURCE_BACKED") return "SOURCE_BACKED";
  if (input.sourceProvenance === "PROPOSED_CANON") return "PROPOSED_CANON";
  return "LOCAL_DRAFT";
}

/* ------------------------------------------------------------------ *
 * One level, in full
 * ------------------------------------------------------------------ */

export type AuthoringLocalizationDetail = {
  id: number;
  locale: string;
  title: string;
  subtitle: string;
  learningObjectiveExtension: string;
  summary: string;
  transcript: string | null;
  body: Prisma.JsonValue;
};

export type AuthoringAssetDetail = {
  id: number;
  kind: string;
  assetCode: string;
  locale: string | null;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  checksum: string | null;
  sortOrder: number;
};

export type AuthoringQuestionDetail = {
  id: number;
  questionNumber: number;
  stableKey: string;
  type: string;
  skillTag: string | null;
  options: Prisma.JsonValue;
  /**
   * STAFF-ONLY. This projection is served exclusively to an authorized authoring
   * caller and is never part of a preview payload (§14): `authoring-preview.ts`
   * builds the learner frame from a different function that has no access to it.
   */
  correctAnswer: Prisma.JsonValue;
  localizations: Array<{
    id: number;
    locale: string;
    prompt: string;
    optionLabels: Prisma.JsonValue;
    explanation: string | null;
  }>;
};

export type AuthoringReviewNoteDetail = {
  id: number;
  targetKind: "content" | "assessment" | "video_production";
  targetId: number;
  targetRevision: number;
  path: string | null;
  body: string;
  author: AuthoringActorRef;
  createdAt: Date;
  resolvedBy: AuthoringActorRef;
  resolvedAt: Date | null;
};

export type AuthoringLevelWorkspace = {
  level: AuthoringLevelSummary;
  contentDetail: {
    localizations: AuthoringLocalizationDetail[];
    assets: AuthoringAssetDetail[];
  } | null;
  assessmentDetail: { questions: AuthoringQuestionDetail[] } | null;
  videoDetail: {
    contractPayload: Prisma.JsonValue;
    coherence: VideoProductionCoherence;
  } | null;
  notes: AuthoringReviewNoteDetail[];
};

export async function readLevelAuthoringWorkspace(input: {
  curriculumVersionId: number;
  levelDefinitionId: number;
}): Promise<AuthoringLevelWorkspace | null> {
  const overview = await readAuthoringOverview(input.curriculumVersionId);
  const level = overview.find((row) => row.levelDefinitionId === input.levelDefinitionId);
  if (!level) return null;

  const [contentDetail, assessmentDetail, videoRow] = await Promise.all([
    level.content
      ? prisma.contentVersion.findUnique({
          where: { id: level.content.id },
          select: {
            localizations: {
              orderBy: [{ locale: "asc" }],
              select: {
                id: true,
                locale: true,
                title: true,
                subtitle: true,
                learningObjectiveExtension: true,
                summary: true,
                transcript: true,
                body: true,
              },
            },
            assets: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: {
                id: true,
                kind: true,
                assetCode: true,
                locale: true,
                url: true,
                mimeType: true,
                sizeBytes: true,
                durationSeconds: true,
                checksum: true,
                sortOrder: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    level.assessment
      ? prisma.assessmentVersion.findUnique({
          where: { id: level.assessment.id },
          select: {
            questions: {
              orderBy: [{ questionNumber: "asc" }],
              select: {
                id: true,
                questionNumber: true,
                stableKey: true,
                type: true,
                skillTag: true,
                options: true,
                correctAnswer: true,
                localizations: {
                  orderBy: [{ locale: "asc" }],
                  select: {
                    id: true,
                    locale: true,
                    prompt: true,
                    optionLabels: true,
                    explanation: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
    level.video
      ? prisma.videoProductionVersion.findUnique({
          where: { id: level.video.id },
          select: { id: true, contractPayload: true },
        })
      : Promise.resolve(null),
  ]);

  const notes = await readNotesForLevel({
    contentVersionId: level.content?.id ?? null,
    assessmentVersionId: level.assessment?.id ?? null,
    videoProductionVersionId: level.video?.id ?? null,
  });

  return {
    level,
    contentDetail: contentDetail
      ? { localizations: contentDetail.localizations, assets: contentDetail.assets }
      : null,
    assessmentDetail: assessmentDetail ? { questions: assessmentDetail.questions } : null,
    videoDetail: videoRow
      ? {
          contractPayload: videoRow.contractPayload,
          coherence: await readVideoProductionCoherence(videoRow.id, prisma),
        }
      : null,
    notes,
  };
}

export async function readNotesForLevel(targets: {
  contentVersionId: number | null;
  assessmentVersionId: number | null;
  videoProductionVersionId: number | null;
}): Promise<AuthoringReviewNoteDetail[]> {
  const or: Prisma.EditorialReviewNoteWhereInput[] = [];
  if (targets.contentVersionId !== null) or.push({ contentVersionId: targets.contentVersionId });
  if (targets.assessmentVersionId !== null) {
    or.push({ assessmentVersionId: targets.assessmentVersionId });
  }
  if (targets.videoProductionVersionId !== null) {
    or.push({ videoProductionVersionId: targets.videoProductionVersionId });
  }
  if (or.length === 0) return [];

  const rows = await prisma.editorialReviewNote.findMany({
    where: { OR: or },
    orderBy: { id: "asc" },
    select: {
      id: true,
      contentVersionId: true,
      assessmentVersionId: true,
      videoProductionVersionId: true,
      targetRevision: true,
      path: true,
      body: true,
      createdAt: true,
      resolvedAt: true,
      author: ACTOR_SELECT,
      resolvedBy: ACTOR_SELECT,
    },
  });

  return rows.map((row) => {
    const targetKind: AuthoringReviewNoteDetail["targetKind"] =
      row.contentVersionId !== null
        ? "content"
        : row.assessmentVersionId !== null
          ? "assessment"
          : "video_production";
    const targetId =
      row.contentVersionId ?? row.assessmentVersionId ?? row.videoProductionVersionId ?? 0;
    return {
      id: row.id,
      targetKind,
      targetId,
      targetRevision: row.targetRevision,
      path: row.path,
      body: row.body,
      author: actorRef(row.author),
      createdAt: row.createdAt,
      resolvedBy: actorRef(row.resolvedBy),
      resolvedAt: row.resolvedAt,
    };
  });
}

/**
 * The single curriculum version the Studio authors against.
 *
 * Prefers the PUBLISHED version, because that is the one the runtime resolves
 * and therefore the one an editor means by "the curriculum". With none published
 * the most recent draft is used, so a fresh disposable database is authorable
 * without a manual selection step. Returns null rather than inventing one.
 */
export async function resolveAuthoringCurriculumVersionId(): Promise<number | null> {
  const published = await prisma.curriculumVersion.findFirst({
    where: { status: "published" },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  if (published) return published.id;
  const latest = await prisma.curriculumVersion.findFirst({
    orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  return latest?.id ?? null;
}
