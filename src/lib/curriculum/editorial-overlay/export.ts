/**
 * PHASE-G2 TRANSPORT — the overlay exporter.
 *
 * Reads an accepted editorial database and emits an Editorial Overlay v1. It
 * opens the source READ-ONLY in intent and in fact: every statement below is a
 * `findMany`/`findFirst`, and nothing here writes, publishes or mutates. The
 * sealed checkpoint is evidence, and evidence that a tool can edit is not
 * evidence.
 *
 * WHERE `mode` COMES FROM. Whether a version needs creating in the target is a
 * fact about the STRUCTURAL PACKAGE, not about the checkpoint: the package is
 * what the target will already contain. So the exporter is given the package it
 * is being paired with, indexes the `(levelCode, versionNumber)` pairs the
 * package carries, and marks anything outside that set `create`. The accepted
 * corpus produces exactly two: L2's content and assessment successors, authored
 * after the structural baseline was cut.
 *
 * DETERMINISM. Collections are read with explicit ordering and the fingerprint
 * re-sorts everything by semantic key, so two exports of the same checkpoint
 * against the same package produce the same fingerprint. `generatedAt` is the
 * only value that moves, and it is excluded from the fingerprint for exactly
 * that reason.
 *
 * NO IDS LEAVE. Source row ids are used inside this function to walk relations
 * and are never written into the artifact. What comes out is stableCodes,
 * version numbers, question stable keys and principal addresses.
 */
import type { PrismaClient } from "@prisma/client";
import {
  EDITORIAL_OVERLAY_IMPORTER_VERSION,
  EDITORIAL_OVERLAY_SCHEMA_VERSION,
  type EditorialOverlay,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import { calculateNoteKey } from "@/lib/curriculum/editorial-overlay/fingerprint";

export type OverlayExportDb = Pick<
  PrismaClient,
  | "curriculumVersion"
  | "levelDefinition"
  | "contentVersion"
  | "contentLocalization"
  | "assessmentVersion"
  | "questionDefinition"
  | "questionLocalization"
  | "videoProductionVersion"
  | "videoProductionAssessmentLink"
  | "sourceAuthorityResolution"
  | "editorialReviewNote"
  | "user"
  | "staffProfile"
>;

export type ExportOverlayInput = {
  db: OverlayExportDb;
  /** The parsed structural package this overlay will be applied on top of. */
  structuralPackage: unknown;
  binding: {
    sourceCheckpointSha256: string;
    sourceBackendCommit: string;
    sourceBackendTree: string;
    blueprintSourceDocumentSha256: string;
  };
  overlayCode: string;
  overlayRevision: number;
  generatedAt?: Date;
};

type PackageIndex = {
  curriculumCode: string;
  curriculumVersionNumber: number;
  packageCode: string;
  packageRevision: number;
  fingerprint: string;
  contentVersions: Set<string>;
  assessmentVersions: Set<string>;
};

function indexPackage(raw: unknown): PackageIndex {
  const pkg = raw as {
    curriculumCode: string;
    curriculumVersionNumber: number;
    packageCode: string;
    packageRevision: number;
    contentFingerprint: string;
    modules: Array<{
      levels: Array<{
        levelCode: string;
        content?: { versionNumber: number } | null;
        assessment?: { versionNumber: number } | null;
      }>;
    }>;
  };
  const contentVersions = new Set<string>();
  const assessmentVersions = new Set<string>();
  for (const module of pkg.modules) {
    for (const level of module.levels) {
      if (level.content) contentVersions.add(`${level.levelCode}#v${level.content.versionNumber}`);
      if (level.assessment) assessmentVersions.add(`${level.levelCode}#v${level.assessment.versionNumber}`);
    }
  }
  return {
    curriculumCode: pkg.curriculumCode,
    curriculumVersionNumber: pkg.curriculumVersionNumber,
    packageCode: pkg.packageCode,
    packageRevision: pkg.packageRevision,
    fingerprint: pkg.contentFingerprint,
    contentVersions,
    assessmentVersions,
  };
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const isoRequired = (value: Date): string => value.toISOString();

/**
 * A principal address that may be recreated in a target when absent.
 *
 * `.invalid` is reserved by RFC 2606/6761 as guaranteed non-resolvable, so an
 * address under it is a PROCESS IDENTITY — a named role in a review — and never
 * a person's mailbox. Recreating it elsewhere reproduces the same principal.
 * Anything else is presumed to be a real account that must already exist, so the
 * overlay refuses rather than minting a lookalike of a human being.
 */
function mayProvision(email: string): boolean {
  return email.toLowerCase().endsWith(".invalid");
}

export async function exportEditorialOverlay(input: ExportOverlayInput): Promise<EditorialOverlay> {
  const { db } = input;
  const pkg = indexPackage(input.structuralPackage);

  const curriculum = await db.curriculumVersion.findFirst({
    where: { code: pkg.curriculumCode, versionNumber: pkg.curriculumVersionNumber },
  });
  if (!curriculum) {
    throw new Error(
      `source has no CurriculumVersion ${pkg.curriculumCode} v${pkg.curriculumVersionNumber} to export`,
    );
  }

  const levels = await db.levelDefinition.findMany({
    where: { curriculumVersionId: curriculum.id },
    select: { id: true, stableCode: true },
    orderBy: { levelNumber: "asc" },
  });
  const levelCodeById = new Map(levels.map((l) => [l.id, l.stableCode]));

  /* ---------------- principals ---------------- */
  const referencedIds = new Set<number>();
  const note = (id: number | null): number | null => {
    if (id !== null) referencedIds.add(id);
    return id;
  };

  const contentRows = await db.contentVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
    orderBy: [{ levelDefinitionId: "asc" }, { versionNumber: "asc" }],
  });
  const assessmentRows = await db.assessmentVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
    orderBy: [{ levelDefinitionId: "asc" }, { versionNumber: "asc" }],
  });
  const videoRows = await db.videoProductionVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
    orderBy: [{ levelNumber: "asc" }, { versionNumber: "asc" }],
  });
  const linkRows = await db.videoProductionAssessmentLink.findMany({
    orderBy: { videoProductionVersionId: "asc" },
  });
  const authorityRows = await db.sourceAuthorityResolution.findMany({
    where: { curriculumVersionId: curriculum.id },
    orderBy: [{ questionIndex: "asc" }, { field: "asc" }],
  });
  const noteRows = await db.editorialReviewNote.findMany({ orderBy: { id: "asc" } });

  for (const row of contentRows) {
    note(row.createdById);
    note(row.lastAuthoredById);
    note(row.submittedById);
    note(row.changesRequestedById);
    note(row.approvedById);
  }
  for (const row of assessmentRows) {
    note(row.createdById);
    note(row.lastAuthoredById);
    note(row.submittedById);
    note(row.changesRequestedById);
    note(row.approvedById);
  }
  for (const row of videoRows) {
    note(row.createdById);
    note(row.lastAuthoredById);
    note(row.submittedById);
    note(row.changesRequestedById);
    note(row.approvedById);
  }
  for (const row of linkRows) note(row.linkedById);
  for (const row of authorityRows) {
    note(row.decidedById);
    note(row.supersededById);
  }
  for (const row of noteRows) {
    note(row.authorId);
    note(row.resolvedById);
  }

  const principalRows = await db.user.findMany({
    where: { id: { in: [...referencedIds] } },
    select: { id: true, email: true, name: true, role: true },
    orderBy: { id: "asc" },
  });
  const staffRows = await db.staffProfile.findMany({
    where: { userId: { in: [...referencedIds] } },
    select: { userId: true, staffRole: true },
  });
  const staffByUser = new Map(staffRows.map((s) => [s.userId, s.staffRole]));
  const refById = new Map(principalRows.map((u) => [u.id, u.email.toLowerCase()]));
  const ref = (id: number | null): string | null => (id === null ? null : (refById.get(id) ?? null));

  const principals = principalRows
    .map((u) => ({
      ref: u.email.toLowerCase(),
      displayName: u.name,
      role: u.role as "user" | "mentor" | "support" | "admin",
      staffRole: staffByUser.get(u.id) ?? null,
      provisionIfMissing: mayProvision(u.email),
    }))
    .sort((a, b) => (a.ref < b.ref ? -1 : 1));

  const evidenceOf = (row: {
    editorialState: string;
    revision: number;
    createdById: number | null;
    lastAuthoredById: number | null;
    lastAuthoredAt: Date | null;
    submittedById: number | null;
    submittedAt: Date | null;
    changesRequestedById: number | null;
    changesRequestedAt: Date | null;
    approvedById: number | null;
    approvedAt: Date | null;
  }): OverlayEditorialEvidence => ({
    editorialState: row.editorialState as OverlayEditorialEvidence["editorialState"],
    revision: row.revision,
    createdBy: ref(row.createdById),
    lastAuthoredBy: ref(row.lastAuthoredById),
    lastAuthoredAt: iso(row.lastAuthoredAt),
    submittedBy: ref(row.submittedById),
    submittedAt: iso(row.submittedAt),
    changesRequestedBy: ref(row.changesRequestedById),
    changesRequestedAt: iso(row.changesRequestedAt),
    approvedBy: ref(row.approvedById),
    approvedAt: iso(row.approvedAt),
  });

  /* ---------------- content ---------------- */
  const content: EditorialOverlay["content"] = [];
  for (const row of contentRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (!level) continue;
    const key = `${level}#v${row.versionNumber}`;
    const mode = pkg.contentVersions.has(key) ? "update" : "create";
    let payload: EditorialOverlay["content"][number]["payload"] = null;
    if (mode === "create") {
      const localizations = await db.contentLocalization.findMany({
        where: { contentVersionId: row.id },
        orderBy: { locale: "asc" },
      });
      payload = {
        status: row.status as "draft" | "published" | "archived",
        videoDurationSeconds: row.videoDurationSeconds,
        changeNotes: row.changeNotes,
        createdAt: isoRequired(row.createdAt),
        publishedAt: iso(row.publishedAt),
        archivedAt: iso(row.archivedAt),
        localizations: localizations.map((l) => ({
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
    content.push({ level, versionNumber: row.versionNumber, mode, editorial: evidenceOf(row), payload });
  }

  /* ---------------- assessments ---------------- */
  const assessmentLevelVersion = new Map<number, { level: string; versionNumber: number }>();
  for (const row of assessmentRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (level) assessmentLevelVersion.set(row.id, { level, versionNumber: row.versionNumber });
  }

  const assessments: EditorialOverlay["assessments"] = [];
  for (const row of assessmentRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (!level) continue;
    const key = `${level}#v${row.versionNumber}`;
    const mode = pkg.assessmentVersions.has(key) ? "update" : "create";
    const predecessor =
      row.predecessorVersionId !== null ? (assessmentLevelVersion.get(row.predecessorVersionId) ?? null) : null;

    let payload: EditorialOverlay["assessments"][number]["payload"] = null;
    if (mode === "create") {
      const questions = await db.questionDefinition.findMany({
        where: { assessmentVersionId: row.id },
        orderBy: { questionNumber: "asc" },
      });
      const built = [];
      for (const question of questions) {
        const localizations = await db.questionLocalization.findMany({
          where: { questionId: question.id },
          orderBy: { locale: "asc" },
        });
        built.push({
          stableKey: question.stableKey,
          questionNumber: question.questionNumber,
          type: question.type,
          skillTag: question.skillTag,
          status: question.status as "active" | "disabled",
          options: question.options,
          correctAnswer: question.correctAnswer,
          createdAt: isoRequired(question.createdAt),
          localizations: localizations.map((l) => ({
            locale: l.locale,
            prompt: l.prompt,
            optionLabels: l.optionLabels,
            explanation: l.explanation,
          })),
        });
      }
      payload = {
        status: row.status as "draft" | "published" | "archived",
        passPercent: row.passPercent,
        maxAttempts: row.maxAttempts,
        showExplanation: row.showExplanation,
        changeNotes: row.changeNotes,
        createdAt: isoRequired(row.createdAt),
        publishedAt: iso(row.publishedAt),
        archivedAt: iso(row.archivedAt),
        questions: built,
      };
    }
    assessments.push({
      level,
      versionNumber: row.versionNumber,
      mode,
      editorial: evidenceOf(row),
      predecessor,
      payload,
    });
  }

  /* ---------------- video productions ---------------- */
  const videoLevelVersion = new Map<number, { level: string; versionNumber: number }>();
  const videoProductions: EditorialOverlay["videoProductions"] = [];
  for (const row of videoRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (!level) continue;
    videoLevelVersion.set(row.id, { level, versionNumber: row.versionNumber });
    videoProductions.push({
      level,
      versionNumber: row.versionNumber,
      levelNumber: row.levelNumber,
      revision: row.revision,
      editorialState: row.editorialState as EditorialOverlay["videoProductions"][number]["editorialState"],
      contractVersion: row.contractVersion,
      sourceProvenance: row.sourceProvenance as "SOURCE_BACKED" | "PROPOSED_CANON",
      scriptState: row.scriptState as "SCRIPT_PENDING" | "SCRIPT_READY",
      videoState: row.videoState as "NOT_RECORDED" | "VIDEO_RECORDED",
      qaState: row.qaState as "QA_PENDING" | "QA_PASSED" | "QA_FAILED",
      contractPayload: row.contractPayload,
      contractFingerprint: row.contractFingerprint,
      assessmentFingerprint: row.assessmentFingerprint,
      productionEvidenceStale: row.productionEvidenceStale,
      createdAt: isoRequired(row.createdAt),
      evidence: {
        createdBy: ref(row.createdById),
        lastAuthoredBy: ref(row.lastAuthoredById),
        lastAuthoredAt: iso(row.lastAuthoredAt),
        submittedBy: ref(row.submittedById),
        submittedAt: iso(row.submittedAt),
        changesRequestedBy: ref(row.changesRequestedById),
        changesRequestedAt: iso(row.changesRequestedAt),
        approvedBy: ref(row.approvedById),
        approvedAt: iso(row.approvedAt),
      },
    });
  }

  /* ---------------- links ---------------- */
  const videoAssessmentLinks: EditorialOverlay["videoAssessmentLinks"] = [];
  for (const row of linkRows) {
    const video = videoLevelVersion.get(row.videoProductionVersionId);
    const assessment = assessmentLevelVersion.get(row.assessmentVersionId);
    if (!video || !assessment) continue;
    videoAssessmentLinks.push({
      video,
      assessment,
      assessmentRevision: row.assessmentRevision,
      assessmentBankFingerprint: row.assessmentBankFingerprint,
      linkedBy: ref(row.linkedById),
      linkedAt: isoRequired(row.linkedAt),
    });
  }

  /* ---------------- source authority ---------------- */
  const sourceAuthorityResolutions: EditorialOverlay["sourceAuthorityResolutions"] = [];
  for (const row of authorityRows) {
    const assessment = assessmentLevelVersion.get(row.assessmentVersionId);
    const video = videoLevelVersion.get(row.videoProductionVersionId);
    const level = levelCodeById.get(row.levelDefinitionId);
    if (!assessment || !video || !level) continue;
    const decidedBy = ref(row.decidedById);
    if (!decidedBy) continue;
    sourceAuthorityResolutions.push({
      assessment,
      video,
      level,
      questionIndex: row.questionIndex,
      field: row.field as "prompt" | "correctAnswerText",
      conflictPath: row.conflictPath,
      decision: row.decision as "CURRENT" | "BLUEPRINT",
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
      decidedBy,
      decidedAt: isoRequired(row.decidedAt),
      createdAt: isoRequired(row.createdAt),
      supersededAt: iso(row.supersededAt),
      supersededBy: ref(row.supersededById),
    });
  }

  /* ---------------- review notes ---------------- */
  const contentLevelVersion = new Map<number, { level: string; versionNumber: number }>();
  for (const row of contentRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (level) contentLevelVersion.set(row.id, { level, versionNumber: row.versionNumber });
  }

  const reviewNotes: EditorialOverlay["reviewNotes"] = [];
  for (const row of noteRows) {
    const target =
      row.contentVersionId !== null
        ? { kind: "content" as const, ref: contentLevelVersion.get(row.contentVersionId) }
        : row.assessmentVersionId !== null
          ? { kind: "assessment" as const, ref: assessmentLevelVersion.get(row.assessmentVersionId) }
          : { kind: "video" as const, ref: videoLevelVersion.get(row.videoProductionVersionId!) };
    if (!target.ref) continue;
    const author = ref(row.authorId);
    if (!author) continue;
    const shaped = {
      target: { kind: target.kind, level: target.ref.level, versionNumber: target.ref.versionNumber },
      targetRevision: row.targetRevision,
      path: row.path,
      body: row.body,
      author,
      createdAt: isoRequired(row.createdAt),
      resolvedAt: iso(row.resolvedAt),
      resolvedBy: ref(row.resolvedById),
    };
    reviewNotes.push({ noteKey: calculateNoteKey(shaped), ...shaped });
  }

  return {
    schemaVersion: EDITORIAL_OVERLAY_SCHEMA_VERSION,
    minImporterVersion: EDITORIAL_OVERLAY_IMPORTER_VERSION,
    overlayCode: input.overlayCode,
    overlayRevision: input.overlayRevision,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    binding: {
      curriculumCode: pkg.curriculumCode,
      curriculumVersionNumber: pkg.curriculumVersionNumber,
      structuralPackageCode: pkg.packageCode,
      structuralPackageRevision: pkg.packageRevision,
      structuralPackageFingerprint: pkg.fingerprint,
      sourceCheckpointSha256: input.binding.sourceCheckpointSha256,
      sourceBackendCommit: input.binding.sourceBackendCommit,
      sourceBackendTree: input.binding.sourceBackendTree,
      blueprintSourceDocumentSha256: input.binding.blueprintSourceDocumentSha256,
    },
    principals,
    content,
    assessments,
    videoProductions,
    videoAssessmentLinks,
    sourceAuthorityResolutions,
    reviewNotes,
  };
}
