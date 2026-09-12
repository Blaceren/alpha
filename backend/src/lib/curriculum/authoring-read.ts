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
  readSourceAuthority,
  resolveAuthoritySource,
  type AuthoritySourceUnavailableReason,
  type SourceAuthorityProjection,
} from "@/lib/curriculum/source-authority";
import {
  readVideoProductionCoherence,
  type VideoProductionCoherence,
} from "@/lib/curriculum/video-production-coherence";
import { parseContractPayload } from "@/lib/curriculum/video-production-authoring";
import type { VideoProductionContract } from "@/lib/curriculum/video-production-contract";
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
  /**
   * PHASE-G2 CORRECTION-2 — the bank's canonical Blueprint source cannot be
   * established, so NO provenance claim can honestly be made about it.
   *
   * It is not `CONFLICTING` (no disagreement was observed) and emphatically not
   * `APPROVED_CURRENT` (nothing was compared). It is computed FIRST, before any
   * conflict count, because the counts are zero for want of a comparison rather
   * than for want of a disagreement.
   */
  "SOURCE_UNAVAILABLE",
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
  /**
   * RAW field-level disagreements between the Blueprint proposal and this bank.
   *
   * PHASE-G2 — this keeps its exact original meaning and is deliberately NOT
   * reduced by an adjudication. A conflict that a human decided still EXISTS;
   * what changes is whether it still blocks. Overloading one number with both
   * facts would destroy the evidence that a disagreement was ever there, which
   * is the one thing a resolution must never do.
   */
  conflictCount: number;
  /**
   * PHASE-G2 — raw conflicts NOT covered by an in-force adjudication. THIS is
   * what readiness and the work queue act on.
   */
  blockingConflictCount: number;
  /**
   * PHASE-G2 — the authority axis, kept separate from `sourceProvenance`.
   * Origin says where the material came from and never changes because of a
   * review; this says which side a human chose, and whether that choice is
   * currently in force.
   *
   * Null either because nothing has been adjudicated OR because the adjudication
   * record could not be read — `authorityReadUnavailable` is what distinguishes
   * the two, and callers must not read a null projection as "settled".
   */
  authorityResolution: SourceAuthorityProjection | null;
  /**
   * CORRECTION-1 — the adjudication record could not be loaded for this bank.
   *
   * When true, `blockingConflictCount` is the FULL raw count by construction: no
   * conflict can be shown to be settled, so none of them is treated as settled.
   * Surfaced rather than swallowed so an operator can tell a genuine backlog from
   * a storage problem — the previous silence is exactly what let an unreadable
   * record read as an empty one.
   */
  authorityReadUnavailable: boolean;
  /**
   * CORRECTION-2 — the canonical Blueprint SOURCE for this bank could not be
   * established, so no comparison was possible.
   *
   * DIFFERENT FROM `authorityReadUnavailable`, which is about the adjudication
   * RECORD. This one is about the other side of the comparison: the proposal
   * itself. When it is true, `conflictCount` and `blockingConflictCount` are
   * both 0 because nothing was computed — NOT because the two sides agree — and
   * the level is blocked by `ASSESSMENT_SOURCE_CONTRACT_UNREADABLE` rather than
   * by a count. Reading a zero here as agreement is precisely the fail-open the
   * re-audit found.
   */
  sourceContractUnavailable: boolean;
  /** Why, for staff. Null whenever the source was established. */
  sourceContractUnavailableReason: AuthoritySourceUnavailableReason | null;
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

/**
 * REVIEW-SURFACE CORRECTION — the EDITORIAL candidate for one axis, reported
 * BESIDE the runtime summary and never instead of it.
 *
 * Everything a reviewer needs to reach the exact version and nothing more: no
 * adjudication evidence, no value hashes, no decision record. The queue is a
 * list of work, not a source-authority surface.
 */
export type EditorialCandidateSummary = {
  /** Null only when the axis is ambiguous — see `ambiguous`. */
  versionId: number | null;
  versionNumber: number | null;
  revision: number | null;
  editorialState: EditorialState | null;
  /** The runtime axis, or null for video production which has none. */
  runtimeStatus: string | null;
  /** Is this the very version the runtime serves? */
  isRuntimeVersion: boolean;
  /** Is this version pinned by `LevelResourceBinding`? */
  isRuntimeBound: boolean;
  /** PHASE-G2 SUCCESSOR lineage, where the axis records one. */
  predecessorVersionId: number | null;
  /** Whose desk this is on. */
  waitingOn: "reviewer" | "author" | "publisher" | "none" | null;
  /** True when two equally-active versions make the choice a human decision. */
  ambiguous: boolean;
  ambiguousVersionIds: number[];
};

/**
 * The content axis carries the two material facts the queue judges — "is there a
 * lesson" and "is it long enough" — so they are read from the CANDIDATE. A queue
 * that measured the predecessor would keep demanding a rewrite of a lesson an
 * author has already replaced.
 */
export type EditorialContentCandidateSummary = EditorialCandidateSummary & {
  hasLocalization: boolean;
  teachingCharacters: number;
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
  /**
   * THE RUNTIME AXIS. These three describe the version the level SERVES —
   * `LevelResourceBinding` where there is one, otherwise the highest
   * `versionNumber`. Unchanged by the review-surface correction, deliberately:
   * every existing reader, every readiness counter and the handoff bundle mean
   * exactly this by "the level's content".
   */
  content: ContentAggregateSummary | null;
  assessment: AssessmentAggregateSummary | null;
  video: VideoAggregateSummary | null;
  /**
   * REVIEW-SURFACE CORRECTION — THE EDITORIAL AXIS, beside the runtime one.
   *
   * Which version is somebody supposed to be working on. On a level with no
   * successor this names the same row as the runtime axis and says so
   * (`isRuntimeVersion`). On a level mid-succession the two differ, which is the
   * whole point: L2 serves Content v1 and owes a review of Content v79.
   */
  editorial: {
    content: EditorialContentCandidateSummary;
    assessment: EditorialCandidateSummary;
    video: EditorialCandidateSummary;
  };
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
 * PHASE-G2 SUCCESSOR — the level's RUNTIME version selector, now defined once in
 * `authoring-candidate` and re-exported here.
 *
 * IT WAS CALLED `pickWorkingVersion`, and that name is what let four callers
 * reuse a RUNTIME answer for an AUTHORING question. `LevelResourceBinding` is
 * what a learner follows, so a bound version always wins — correct for "what is
 * served", exactly wrong for "what is being edited". A level with a published,
 * bound v1 and a draft successor v2 has two truthful versions at once, and this
 * function only ever returns the first.
 *
 * Behaviour is unchanged to the byte. What changed is that a caller wanting the
 * authoring candidate must now say so explicitly, and that there is no longer a
 * second private copy of this rule in the validation service.
 */
export { pickRuntimeVersion } from "@/lib/curriculum/authoring-candidate";
import {
  pickRuntimeVersion,
  resolveCandidate,
  type AuthoringCandidateSelection,
} from "@/lib/curriculum/authoring-candidate";
import { pickEditorialCandidate } from "@/lib/curriculum/authoring-editorial-candidate";

/**
 * REVIEW-SURFACE CORRECTION — project one axis' editorial candidate.
 *
 * Pure, and fed from the rows the overview has already loaded, so exposing the
 * editorial axis costs no additional query.
 */
function editorialSummary<
  T extends {
    id: number;
    versionNumber: number;
    revision: number;
    editorialState: EditorialState;
    status?: string;
    predecessorVersionId?: number | null;
  },
>(
  versions: readonly T[],
  runtimeVersionId: number | null,
  boundVersionId: number | null,
): EditorialCandidateSummary {
  const resolved = pickEditorialCandidate(
    versions.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      editorialState: row.editorialState,
      runtimeStatus: row.status ?? null,
    })),
    runtimeVersionId,
  );
  const row = resolved.candidate ? versions.find((v) => v.id === resolved.candidate!.id) ?? null : null;
  return {
    versionId: row?.id ?? null,
    versionNumber: row?.versionNumber ?? null,
    revision: row?.revision ?? null,
    editorialState: row?.editorialState ?? null,
    runtimeStatus: row?.status ?? null,
    isRuntimeVersion: resolved.isRuntimeVersion,
    isRuntimeBound: row !== null && boundVersionId !== null && row.id === boundVersionId,
    predecessorVersionId: row?.predecessorVersionId ?? null,
    waitingOn: resolved.waitingOn,
    ambiguous: resolved.ambiguous,
    ambiguousVersionIds: resolved.ambiguousVersionIds,
  };
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
          // REVIEW-SURFACE CORRECTION — so the editorial axis can name the
          // ancestor a successor descends from without a second query.
          predecessorVersionId: true,
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

    const contentRow = pickRuntimeVersion(
      contentByLevel.get(level.id) ?? [],
      binding?.contentVersionId ?? null,
    );
    const assessmentRow = pickRuntimeVersion(
      assessmentByLevel.get(level.id) ?? [],
      binding?.assessmentVersionId ?? null,
    );
    const videoRow = pickRuntimeVersion(videoByLevel.get(level.id) ?? [], null);

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
    let blockingConflictCount = 0;
    let authorityResolution: SourceAuthorityProjection | null = null;
    let authorityReadUnavailable = false;
    let sourceContractUnavailable = false;
    let sourceContractUnavailableReason: AuthoritySourceUnavailableReason | null = null;
    if (videoRow) {
      sourceProvenance = videoRow.sourceProvenance as "SOURCE_BACKED" | "PROPOSED_CANON";
      // `sourceApproval` describes the LEVEL'S WORKING production version, which
      // is what the video column of the studio shows. It is deliberately read
      // from `videoRow` and not from the authority source: the two are the same
      // row in every ordinary case, and where they differ the approval badge
      // belongs to the aggregate being authored.
      try {
        sourceApproval = parseContractPayload(videoRow.contractPayload).approval;
      } catch {
        sourceApproval = null;
      }

      // CORRECTION-2 — the AUTHORITY axis now comes from the one shared
      // resolver, so this projection, the staff GET, the handoff and the command
      // cannot describe different proposals for the same bank. It also reports
      // the difference between "no proposal" and "a proposal we cannot read",
      // which is what the `catch` here used to erase.
      let contract: VideoProductionContract | null = null;
      let authoritySourceVideoId: number | null = null;
      let authoritySourceLinked = false;
      if (assessmentRow) {
        const source = await resolveAuthoritySource(prisma, assessmentRow.id);
        contract = source.contract;
        authoritySourceVideoId = source.videoProductionVersionId;
        authoritySourceLinked = source.link !== null;
        if (source.unavailableReason !== null) {
          // FAIL CLOSED. No comparison was made, so no count may be presented as
          // one, and the level is blocked by the flag rather than by a number
          // this branch is in no position to compute. The previous shape reported
          // 0 raw / 0 blocking / APPROVED_CURRENT and went handoff-ready.
          sourceContractUnavailable = true;
          sourceContractUnavailableReason = source.unavailableReason;
        }
      }
      if (contract && assessmentRow) {
        // NOT INSIDE ANY CATCH. `compareBlueprintProposal` already turns every
        // expected domain condition into `comparable: false`, so anything that
        // throws here is a genuine failure to read the bank. A swallowed one used
        // to report 0 raw conflicts — an overview that quietly understates the
        // disagreement is worse than one that refuses to render.
        conflictCount = await countBlueprintConflicts(prisma, {
          contract,
          assessmentVersionId: assessmentRow.id,
        });

        // CORRECTION-1 (audit BLOCKER-1) — FAIL CLOSED, AND FAIL CLOSED FIRST.
        //
        // The blocking count starts at the FULL raw count and is only ever
        // lowered by a resolution that was actually read and actually applies.
        // The previous shape started it at 0 and raised it from the adjudication
        // record, so any failure of that one query — a client/schema skew, a
        // transient database error — left the optimistic zero standing: a bank
        // with real unadjudicated conflicts reported 0 blocking, provenance
        // APPROVED_CURRENT, and went HANDOFF-READY, silently. An unreadable
        // adjudication record means "nothing is proven settled", never "nothing
        // is outstanding", and the initialiser is now what says so.
        blockingConflictCount = conflictCount;
        try {
          // PHASE-G2 — the authority axis. The RAW count above is left exactly
          // as it was so a reader can still see the disagreement; this reads the
          // adjudication record and reports which of those raw conflicts are
          // still unsettled.
          authorityResolution = await readSourceAuthority(prisma, {
            assessmentVersionId: assessmentRow.id,
            // CORRECTION-2 — the CANONICAL source, not the level's working video
            // row. Where a bank is linked to an older production version than the
            // one currently being authored, the two differ, and the adjudication
            // record belongs to the linked one.
            videoProductionVersionId: authoritySourceVideoId,
            contract,
            sourceLinked: authoritySourceLinked,
          });
          blockingConflictCount = authorityResolution.blockingConflictCount;
        } catch {
          // The evidence that would clear these conflicts could not be read, so
          // none of them is cleared. Reported rather than swallowed: a caller
          // that sees `authorityReadUnavailable` knows the difference between
          // "seven conflicts nobody has decided" and "seven conflicts whose
          // decisions we could not load", which a bare count cannot express.
          authorityReadUnavailable = true;
          authorityResolution = null;
          blockingConflictCount = conflictCount;
        }
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
            blockingConflictCount,
            sourceContractUnavailable,
          }),
          sourceApproval,
          sourceProvenance,
          conflictCount,
          blockingConflictCount,
          authorityResolution,
          authorityReadUnavailable,
          sourceContractUnavailable,
          sourceContractUnavailableReason,
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
      editorial: {
        content: (() => {
          const rows = contentByLevel.get(level.id) ?? [];
          const base = editorialSummary(rows, contentRow?.id ?? null, binding?.contentVersionId ?? null);
          const row = rows.find((candidate) => candidate.id === base.versionId) ?? null;
          const loc = row?.localizations[0] ?? null;
          const body = loc
            ? describeBody(loc.body)
            : { bodyFormat: "none" as const, teachingCharacters: 0, sectionCount: 0, blockCount: 0 };
          return { ...base, hasLocalization: loc !== null, teachingCharacters: body.teachingCharacters };
        })(),
        assessment: editorialSummary(
          assessmentByLevel.get(level.id) ?? [],
          assessmentRow?.id ?? null,
          binding?.assessmentVersionId ?? null,
        ),
        // Video production has no runtime axis at all, so it has no binding
        // either: every production version is editorial by construction.
        video: editorialSummary(videoByLevel.get(level.id) ?? [], videoRow?.id ?? null, null),
      },
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
  /**
   * PHASE-G2 — raw conflicts with no in-force adjudication. Optional so every
   * accepted caller that predates the authority axis keeps its exact behaviour:
   * absent means "nothing has been adjudicated", which is what was true before
   * the primitive existed.
   */
  blockingConflictCount?: number;
  /**
   * PHASE-G2 CORRECTION-2 — the canonical source could not be established, so
   * no comparison happened. Optional, so every accepted caller that predates the
   * flag keeps its exact behaviour.
   */
  sourceContractUnavailable?: boolean;
}): AssessmentProvenanceState {
  // CORRECTION-2 — FIRST, and before any count is consulted. With no readable
  // proposal there is no evidence of agreement, and the counts below are zero
  // only because nothing was computed. Falling through to the approval branch is
  // what produced APPROVED_CURRENT for a bank with eight real disagreements.
  //
  // WHY `SOURCE_UNAVAILABLE` RATHER THAN `CONFLICTING`. Claiming a conflict we
  // did not observe would be the same class of error in the other direction, and
  // §9 asks for the two to stay distinguishable. This state says exactly what is
  // known: the source is unknown, and nothing may be concluded from that.
  if (input.sourceContractUnavailable === true) return "SOURCE_UNAVAILABLE";

  // PHASE-G2 — CONFLICTING now means "a disagreement nobody has settled", not
  // "a disagreement exists". A bank whose seven conflicts were each explicitly
  // adjudicated is no longer waiting on anybody, and reporting it as CONFLICTING
  // would keep demanding a decision that was already made. The raw count stays
  // visible on the summary either way, and the authority axis reports which side
  // won — so nothing is hidden by this, only stopped from blocking.
  const blocking = input.blockingConflictCount ?? input.conflictCount;
  if (blocking > 0) return "CONFLICTING";
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
  /**
   * PHASE-G2 SUCCESSOR — every version of this level, so the Studio can offer a
   * successor picker rather than infer one.
   *
   * The audit's brief was explicit that nothing may guess a predecessor from
   * `versionNumber - 1`, an audit row or a timestamp. The same discipline applies
   * to the UI: it selects from ids the server listed, and the server verifies the
   * id it is handed back.
   */
  versions: AuthoringLevelVersionIndex;
  /** Which version each panel is actually showing. */
  opened: {
    contentVersionId: number | null;
    assessmentVersionId: number | null;
    videoProductionVersionId: number | null;
  };
};

/** One selectable version, with the two axes a picker has to distinguish. */
export type AuthoringVersionRef = {
  id: number;
  versionNumber: number;
  /** Null for video production, which has no runtime axis. */
  runtimeStatus: string | null;
  editorialState: EditorialState;
  /** PHASE-G2 SUCCESSOR — the explicit lineage relation, never inferred. */
  predecessorVersionId?: number | null;
};

export type AuthoringLevelVersionIndex = {
  content: AuthoringVersionRef[];
  assessment: AuthoringVersionRef[];
  video: AuthoringVersionRef[];
};

/**
 * Every version of one level, newest first.
 *
 * Deliberately a separate, cheap read rather than an addition to the overview:
 * the overview is summary-shaped by construction (§47) and returns one row per
 * level for ~78 levels, so hanging a full version list off it would multiply the
 * payload for a picker only the opened level needs.
 */
export async function readLevelVersionIndex(
  levelDefinitionId: number,
): Promise<AuthoringLevelVersionIndex> {
  const [content, assessment, video] = await Promise.all([
    prisma.contentVersion.findMany({
      where: { levelDefinitionId },
      orderBy: { versionNumber: "desc" },
      select: { id: true, versionNumber: true, status: true, editorialState: true },
    }),
    prisma.assessmentVersion.findMany({
      where: { levelDefinitionId },
      orderBy: { versionNumber: "desc" },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        editorialState: true,
        predecessorVersionId: true,
      },
    }),
    prisma.videoProductionVersion.findMany({
      where: { levelDefinitionId },
      orderBy: { versionNumber: "desc" },
      select: { id: true, versionNumber: true, editorialState: true },
    }),
  ]);
  return {
    content: content.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      runtimeStatus: row.status,
      editorialState: row.editorialState,
    })),
    assessment: assessment.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      runtimeStatus: row.status,
      editorialState: row.editorialState,
      predecessorVersionId: row.predecessorVersionId,
    })),
    video: video.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      runtimeStatus: null,
      editorialState: row.editorialState,
    })),
  };
}

export async function readLevelAuthoringWorkspace(input: {
  curriculumVersionId: number;
  levelDefinitionId: number;
  /**
   * PHASE-G2 SUCCESSOR — WHICH version to open, when the author knows.
   *
   * Without this the Studio could only ever open the level's runtime version, so
   * an author who had just cloned a published lesson had nowhere to type: the
   * clone existed, was writable by the domain, and was invisible on every screen.
   *
   * Omitted axes keep the accepted behaviour exactly, and the level SUMMARY above
   * always describes the runtime version regardless — opening a draft must not
   * silently redefine what the overview says the level is serving.
   */
  candidate?: AuthoringCandidateSelection;
}): Promise<AuthoringLevelWorkspace | null> {
  const overview = await readAuthoringOverview(input.curriculumVersionId);
  const level = overview.find((row) => row.levelDefinitionId === input.levelDefinitionId);
  if (!level) return null;

  // Every version of this level, so the Studio can offer a picker instead of
  // guessing which ids exist — and so `resolveCandidate` has a level-scoped list
  // to verify a requested id against.
  const versions = await readLevelVersionIndex(input.levelDefinitionId);

  const openContent = resolveCandidate(
    versions.content, input.candidate?.contentVersionId, level.content?.id ?? null, "content", level.levelDefinitionId,
  );
  const openAssessment = resolveCandidate(
    versions.assessment, input.candidate?.assessmentVersionId, level.assessment?.id ?? null, "assessment", level.levelDefinitionId,
  );
  const openVideo = resolveCandidate(
    versions.video, input.candidate?.videoProductionVersionId, level.video?.id ?? null, "video_production", level.levelDefinitionId,
  );

  const [contentDetail, assessmentDetail, videoRow] = await Promise.all([
    openContent
      ? prisma.contentVersion.findUnique({
          where: { id: openContent.id },
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
    openAssessment
      ? prisma.assessmentVersion.findUnique({
          where: { id: openAssessment.id },
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
    openVideo
      ? prisma.videoProductionVersion.findUnique({
          where: { id: openVideo.id },
          select: { id: true, contractPayload: true },
        })
      : Promise.resolve(null),
  ]);

  // Notes follow the OPENED versions, not the runtime ones: a reviewer reading
  // v2 must see v2's notes, and showing the predecessor's would attach a previous
  // round's refusals to text nobody has reviewed yet.
  const notes = await readNotesForLevel({
    contentVersionId: openContent?.id ?? null,
    assessmentVersionId: openAssessment?.id ?? null,
    videoProductionVersionId: openVideo?.id ?? null,
  });

  return {
    level,
    versions,
    opened: {
      contentVersionId: openContent?.id ?? null,
      assessmentVersionId: openAssessment?.id ?? null,
      videoProductionVersionId: openVideo?.id ?? null,
    },
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
