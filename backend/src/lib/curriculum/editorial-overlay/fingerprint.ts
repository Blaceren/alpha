/**
 * PHASE-G2 TRANSPORT — the deterministic overlay fingerprint.
 *
 * WHAT IT COVERS. Everything an overlay asserts: its binding, the structural
 * identity of every level, its principals, the REVIEWED PAYLOAD of every content
 * and assessment entry, both of that entry's hashes, and every historical fact it
 * carries. Two overlays with the same fingerprint make the same claims about the
 * same curriculum.
 *
 * v1's fingerprint covered only the paperwork, so two overlays that approved
 * DIFFERENT lesson bodies under the same approval metadata hashed identically.
 * They no longer can: change one body, one option label or one correct answer and
 * the fingerprint moves, because the payload digests are part of the projection.
 *
 * WHAT IT EXCLUDES, AND WHY EXACTLY TWO THINGS.
 *
 *   `generatedAt` — when the artifact was written is not what it says. Including
 *   it would make every re-export of an unchanged checkpoint a different overlay
 *   and destroy the drift check the fingerprint exists to provide.
 *
 *   the fingerprint field itself — for the obvious reason.
 *
 * Nothing else is excluded. In particular every historical actor and every
 * historical timestamp IS covered, because an overlay that moved an approval to a
 * different reviewer or a different day is a different claim and must not be able
 * to hide behind an unchanged hash.
 *
 * DETERMINISM COMES FROM AN EXPLICIT PROJECTION. Every object is rebuilt field by
 * field in a fixed order and every collection is sorted by its semantic key, so
 * neither author key order nor export order can move the hash. This mirrors the
 * accepted package fingerprint's discipline deliberately: the two artifacts should
 * fail the same way for the same reasons.
 */
import { createHash } from "node:crypto";
import {
  authorityKey,
  questionKey,
  versionKey,
  type EditorialOverlay,
  type OverlayAssessmentEntry,
  type OverlayContentEntry,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import {
  assessmentPayloadHash,
  canonicalJson,
  contentPayloadHash,
  type AssessmentReviewedPayload,
  type ContentReviewedPayload,
} from "@/lib/curriculum/editorial-overlay/payload";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function sortBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function evidence(value: OverlayEditorialEvidence): Json {
  return {
    editorialState: value.editorialState,
    revision: value.revision,
    createdBy: value.createdBy,
    lastAuthoredBy: value.lastAuthoredBy,
    lastAuthoredAt: value.lastAuthoredAt,
    submittedBy: value.submittedBy,
    submittedAt: value.submittedAt,
    changesRequestedBy: value.changesRequestedBy,
    changesRequestedAt: value.changesRequestedAt,
    approvedBy: value.approvedBy,
    approvedAt: value.approvedAt,
  };
}

/**
 * Opaque payloads (contract payloads) are hashed rather than embedded. They are
 * already canonical JSON produced by the accepted domain, and hashing keeps the
 * projection readable without weakening it: a changed payload changes its digest.
 */
function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/* ------------------------------------------------------------------ *
 * the reviewed payload, as the overlay carries it
 * ------------------------------------------------------------------ */

/**
 * Overlay entry → the shape `payload.ts` normalises.
 *
 * The overlay's question objects carry `createdAt` for row creation; the reviewed
 * hash deliberately does not see it, so it is dropped here rather than in two
 * places.
 */
export function contentPayloadOf(entry: OverlayContentEntry): ContentReviewedPayload {
  return {
    videoDurationSeconds: entry.payload.videoDurationSeconds,
    changeNotes: entry.payload.changeNotes,
    localizations: entry.payload.localizations.map((l) => ({
      locale: l.locale,
      title: l.title,
      subtitle: l.subtitle,
      learningObjectiveExtension: l.learningObjectiveExtension,
      summary: l.summary,
      transcript: l.transcript,
      body: l.body,
    })),
  };
}

export function assessmentPayloadOf(entry: OverlayAssessmentEntry): AssessmentReviewedPayload {
  return {
    passPercent: entry.payload.passPercent,
    maxAttempts: entry.payload.maxAttempts,
    showExplanation: entry.payload.showExplanation,
    changeNotes: entry.payload.changeNotes,
    questions: entry.payload.questions.map((q) => ({
      stableKey: q.stableKey,
      questionNumber: q.questionNumber,
      type: q.type,
      skillTag: q.skillTag,
      status: q.status,
      options: q.options,
      correctAnswer: q.correctAnswer,
      localizations: q.localizations.map((l) => ({
        locale: l.locale,
        prompt: l.prompt,
        optionLabels: l.optionLabels,
        explanation: l.explanation,
      })),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * the canonical projection
 * ------------------------------------------------------------------ */

export function canonicalOverlayProjection(overlay: EditorialOverlay): Json {
  return {
    schemaVersion: overlay.schemaVersion,
    minImporterVersion: overlay.minImporterVersion,
    overlayCode: overlay.overlayCode,
    overlayRevision: overlay.overlayRevision,
    binding: {
      curriculumCode: overlay.binding.curriculumCode,
      curriculumVersionNumber: overlay.binding.curriculumVersionNumber,
      structuralPackageCode: overlay.binding.structuralPackageCode,
      structuralPackageRevision: overlay.binding.structuralPackageRevision,
      structuralPackageFingerprint: overlay.binding.structuralPackageFingerprint,
      sourceCheckpointSha256: overlay.binding.sourceCheckpointSha256,
      sourceBackendCommit: overlay.binding.sourceBackendCommit,
      sourceBackendTree: overlay.binding.sourceBackendTree,
      blueprintSourceDocumentSha256: overlay.binding.blueprintSourceDocumentSha256,
      acceptedReviewedRootHash: overlay.binding.acceptedReviewedRootHash,
    },
    levels: sortBy(overlay.levels, (l) => l.level).map((l) => ({
      level: l.level,
      levelNumber: l.levelNumber,
      moduleCode: l.moduleCode,
      moduleNumber: l.moduleNumber,
      type: l.type,
    })),
    principals: sortBy(overlay.principals, (p) => p.ref).map((p) => ({
      ref: p.ref,
      displayName: p.displayName,
      kind: p.kind,
      role: p.role,
      staffRole: p.staffRole,
      provisionIfMissing: p.provisionIfMissing,
    })),
    content: sortBy(overlay.content, versionKey).map((entry) => ({
      key: versionKey(entry),
      mode: entry.mode,
      editorial: evidence(entry.editorial),
      expectedStructuralHash: entry.expectedStructuralHash,
      acceptedReviewedHash: entry.acceptedReviewedHash,
      createdAt: entry.createdAt,
      // The payload is covered through its own normalisation, so the fingerprint
      // and the three-way comparison can never disagree about what changed.
      payloadHash: contentPayloadHash(contentPayloadOf(entry)),
      creation: entry.creation
        ? {
            status: entry.creation.status,
            publishedAt: entry.creation.publishedAt,
            archivedAt: entry.creation.archivedAt,
          }
        : null,
    })),
    assessments: sortBy(overlay.assessments, versionKey).map((entry) => ({
      key: versionKey(entry),
      mode: entry.mode,
      editorial: evidence(entry.editorial),
      predecessor: entry.predecessor ? versionKey(entry.predecessor) : null,
      expectedStructuralHash: entry.expectedStructuralHash,
      acceptedReviewedHash: entry.acceptedReviewedHash,
      createdAt: entry.createdAt,
      payloadHash: assessmentPayloadHash(assessmentPayloadOf(entry)),
      // Question creation instants are not part of the reviewed hash, so they are
      // committed to here instead of escaping the fingerprint entirely.
      questionCreatedAt: sortBy(entry.payload.questions, (q) => q.stableKey).map((q) => ({
        key: questionKey(entry, q.stableKey),
        createdAt: q.createdAt,
      })),
      creation: entry.creation
        ? {
            status: entry.creation.status,
            publishedAt: entry.creation.publishedAt,
            archivedAt: entry.creation.archivedAt,
          }
        : null,
    })),
    videoProductions: sortBy(overlay.videoProductions, versionKey).map((v) => ({
      key: versionKey(v),
      levelNumber: v.levelNumber,
      revision: v.revision,
      editorialState: v.editorialState,
      contractVersion: v.contractVersion,
      sourceProvenance: v.sourceProvenance,
      scriptState: v.scriptState,
      videoState: v.videoState,
      qaState: v.qaState,
      contractPayloadDigest: digest(v.contractPayload),
      contractFingerprint: v.contractFingerprint,
      assessmentFingerprint: v.assessmentFingerprint,
      productionEvidenceStale: v.productionEvidenceStale,
      createdAt: v.createdAt,
      evidence: {
        createdBy: v.evidence.createdBy,
        lastAuthoredBy: v.evidence.lastAuthoredBy,
        lastAuthoredAt: v.evidence.lastAuthoredAt,
        submittedBy: v.evidence.submittedBy,
        submittedAt: v.evidence.submittedAt,
        changesRequestedBy: v.evidence.changesRequestedBy,
        changesRequestedAt: v.evidence.changesRequestedAt,
        approvedBy: v.evidence.approvedBy,
        approvedAt: v.evidence.approvedAt,
      },
    })),
    videoAssessmentLinks: sortBy(overlay.videoAssessmentLinks, (l) => versionKey(l.video)).map(
      (l) => ({
        video: versionKey(l.video),
        assessment: versionKey(l.assessment),
        assessmentRevision: l.assessmentRevision,
        assessmentBankFingerprint: l.assessmentBankFingerprint,
        linkedBy: l.linkedBy,
        linkedAt: l.linkedAt,
      }),
    ),
    sourceAuthorityResolutions: sortBy(overlay.sourceAuthorityResolutions, authorityKey).map(
      (row) => ({
        key: authorityKey(row),
        video: versionKey(row.video),
        level: row.level,
        conflictPath: row.conflictPath,
        decision: row.decision,
        currentValueHash: row.currentValueHash,
        blueprintValueHash: row.blueprintValueHash,
        blueprintSourceDocumentSha256: row.blueprintSourceDocumentSha256,
        contractFingerprintAtDecision: row.contractFingerprintAtDecision,
        bankFingerprintAtDecision: row.bankFingerprintAtDecision,
        assessmentRevisionAtDecision: row.assessmentRevisionAtDecision,
        rationale: row.rationale,
        evidenceRef: row.evidenceRef,
        evidenceSha256: row.evidenceSha256,
        batchId: row.batchId,
        decidedBy: row.decidedBy,
        decidedAt: row.decidedAt,
        createdAt: row.createdAt,
        supersededAt: row.supersededAt,
        supersededBy: row.supersededBy,
      }),
    ),
    reviewNotes: sortBy(overlay.reviewNotes, (n) => `${n.noteIdentity}#${n.ordinal}`).map((n) => ({
      noteIdentity: n.noteIdentity,
      ordinal: n.ordinal,
      target: `${n.target.kind}:${versionKey(n.target)}`,
      targetRevision: n.targetRevision,
      path: n.path,
      body: n.body,
      author: n.author,
      createdAt: n.createdAt,
      resolvedAt: n.resolvedAt,
      resolvedBy: n.resolvedBy,
    })),
  };
}

export function calculateOverlayFingerprint(overlay: EditorialOverlay): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalOverlayProjection(overlay)), "utf8")
    .digest("hex");
}

/**
 * One digest over every accepted per-entity hash.
 *
 * This is what makes the overlay's ROOT commit to the reviewed bytes: an
 * artifact whose approval metadata is untouched but whose content payload moved
 * has a different root, and the importer checks the root it was handed against
 * the one the entries actually produce.
 */
export function calculateAcceptedReviewedRootHash(input: {
  content: ReadonlyArray<{ level: string; versionNumber: number; acceptedReviewedHash: string }>;
  assessments: ReadonlyArray<{ level: string; versionNumber: number; acceptedReviewedHash: string }>;
  levels: ReadonlyArray<{ level: string; levelNumber: number; moduleCode: string; type: string }>;
}): string {
  const projection = {
    levels: sortBy(input.levels, (l) => l.level).map((l) => [l.level, l.levelNumber, l.moduleCode, l.type]),
    content: sortBy(input.content, versionKey).map((c) => [versionKey(c), c.acceptedReviewedHash]),
    assessments: sortBy(input.assessments, versionKey).map((a) => [versionKey(a), a.acceptedReviewedHash]),
  };
  return createHash("sha256").update(JSON.stringify(projection), "utf8").digest("hex");
}

/**
 * WHICH review note this is — deliberately NOT what it says.
 *
 * v1 hashed the body in, so a target note whose body had been altered simply
 * failed to match and a replay wrote a second note beside it. Identity here is
 * the note's provenance only: the aggregate it was left on, that aggregate's
 * revision at the time, the path inside it, its author and its instant. The body
 * is then compared against whatever carries this identity, which is what turns a
 * divergent body into a refusal instead of a duplicate.
 *
 * `ordinal` separates notes that genuinely share all of the above — one author,
 * one target, one millisecond — and is assigned deterministically by the exporter
 * from the source's own ordering.
 */
export function calculateNoteIdentity(input: {
  target: { kind: string; level: string; versionNumber: number };
  targetRevision: number;
  path: string | null;
  author: string;
  createdAt: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.target.kind,
        input.target.level,
        input.target.versionNumber,
        input.targetRevision,
        input.path,
        input.author,
        input.createdAt,
      ]),
      "utf8",
    )
    .digest("hex");
}
