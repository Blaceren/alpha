/**
 * PHASE-G2 TRANSPORT — the deterministic overlay fingerprint.
 *
 * WHAT IT COVERS. Everything an overlay asserts: its binding, its principals and
 * every editorial fact it carries. Two overlays with the same fingerprint make
 * the same claims about the same curriculum.
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
 * historical timestamp IS covered, because an overlay that moved an approval to
 * a different reviewer or a different day is a different claim and must not be
 * able to hide behind an unchanged hash.
 *
 * DETERMINISM COMES FROM AN EXPLICIT PROJECTION. Every object is rebuilt field
 * by field in a fixed order and every collection is sorted by its semantic key,
 * so neither author key order nor export order can move the hash. This mirrors
 * the accepted package fingerprint's discipline deliberately: the two artifacts
 * should fail the same way for the same reasons.
 */
import { createHash } from "node:crypto";
import {
  authorityKey,
  questionKey,
  versionKey,
  type EditorialOverlay,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";

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
 * Opaque payloads (content bodies, question options, contract payloads) are
 * hashed rather than embedded. They are already canonical JSON produced by the
 * accepted domain, and hashing keeps the projection readable without weakening
 * it: a changed body changes its digest.
 */
function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null), "utf8").digest("hex");
}

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
    },
    principals: sortBy(overlay.principals, (p) => p.ref).map((p) => ({
      ref: p.ref,
      displayName: p.displayName,
      role: p.role,
      staffRole: p.staffRole,
      provisionIfMissing: p.provisionIfMissing,
    })),
    content: sortBy(overlay.content, versionKey).map((entry) => ({
      key: versionKey(entry),
      mode: entry.mode,
      editorial: evidence(entry.editorial),
      payload: entry.payload
        ? {
            status: entry.payload.status,
            videoDurationSeconds: entry.payload.videoDurationSeconds,
            changeNotes: entry.payload.changeNotes,
            createdAt: entry.payload.createdAt,
            publishedAt: entry.payload.publishedAt,
            archivedAt: entry.payload.archivedAt,
            localizations: sortBy(entry.payload.localizations, (l) => l.locale).map((l) => ({
              locale: l.locale,
              title: l.title,
              subtitle: l.subtitle,
              learningObjectiveExtension: l.learningObjectiveExtension,
              summary: l.summary,
              transcript: l.transcript,
              bodyDigest: digest(l.body),
            })),
          }
        : null,
    })),
    assessments: sortBy(overlay.assessments, versionKey).map((entry) => ({
      key: versionKey(entry),
      mode: entry.mode,
      editorial: evidence(entry.editorial),
      predecessor: entry.predecessor ? versionKey(entry.predecessor) : null,
      payload: entry.payload
        ? {
            status: entry.payload.status,
            passPercent: entry.payload.passPercent,
            maxAttempts: entry.payload.maxAttempts,
            showExplanation: entry.payload.showExplanation,
            changeNotes: entry.payload.changeNotes,
            createdAt: entry.payload.createdAt,
            publishedAt: entry.payload.publishedAt,
            archivedAt: entry.payload.archivedAt,
            questions: sortBy(entry.payload.questions, (q) => q.stableKey).map((q) => ({
              key: questionKey(entry, q.stableKey),
              questionNumber: q.questionNumber,
              type: q.type,
              skillTag: q.skillTag,
              status: q.status,
              optionsDigest: digest(q.options),
              correctAnswerDigest: digest(q.correctAnswer),
              createdAt: q.createdAt,
              localizations: sortBy(q.localizations, (l) => l.locale).map((l) => ({
                locale: l.locale,
                prompt: l.prompt,
                optionLabelsDigest: digest(l.optionLabels),
                explanation: l.explanation,
              })),
            })),
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
    reviewNotes: sortBy(overlay.reviewNotes, (n) => n.noteKey).map((n) => ({
      noteKey: n.noteKey,
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
 * The deterministic identity of one review note.
 *
 * `EditorialReviewNote` carries no unique index, so replay needs an identity the
 * overlay supplies. Target, revision, author, creation time and body together
 * describe the note a human actually wrote; two notes matching on all five are
 * the same note, and anything else is a different one.
 */
export function calculateNoteKey(input: {
  target: { kind: string; level: string; versionNumber: number };
  targetRevision: number;
  path: string | null;
  body: string;
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
        input.body,
      ]),
      "utf8",
    )
    .digest("hex");
}
