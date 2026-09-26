/**
 * PHASE-G2 TRANSPORT — the overlay exporter.
 *
 * Reads an accepted editorial database and the structural package it was built
 * from, and emits an Editorial Overlay v2. Every statement below is a
 * `findMany`/`findFirst`: nothing here writes, publishes or mutates. The sealed
 * checkpoint is evidence, and evidence that a tool can edit is not evidence — the
 * CLI additionally guarantees that by never handing the real file to a client at
 * all.
 *
 * WHY IT NEEDS BOTH INPUTS. The overlay declares two hashes per entry: what the
 * target must hold if it has only had the structural import, and what the reviewer
 * approved. The second comes from the checkpoint. The FIRST CANNOT: the checkpoint
 * no longer contains the pre-review bytes — the review overwrote them, which is the
 * entire point. Deriving a baseline from edited rows would be inventing one. So the
 * package is a required input and the baseline is projected from it, through the
 * structural importer's own mapping (see `payload.ts`).
 *
 * WHERE `mode` COMES FROM. Whether a version needs creating in the target is a fact
 * about the STRUCTURAL PACKAGE, not about the checkpoint: the package is what the
 * target will already contain. Anything outside the package's `(levelCode,
 * versionNumber)` set is `create`. The accepted corpus produces exactly two: L2's
 * content and assessment successors, authored after the structural baseline was cut.
 *
 * DETERMINISM. Collections are read with explicit ordering and the fingerprint
 * re-sorts everything by semantic key, so two exports of the same checkpoint against
 * the same package produce the same fingerprint. `generatedAt` is the only value
 * that moves, and it is excluded from the fingerprint for exactly that reason.
 *
 * NO IDS LEAVE. Source row ids are used inside this function to walk relations and
 * are never written into the artifact. What comes out is stableCodes, version
 * numbers, question stable keys and principal addresses.
 */
import type { PrismaClient } from "@prisma/client";
import {
  EDITORIAL_OVERLAY_IMPORTER_VERSION,
  EDITORIAL_OVERLAY_SCHEMA_VERSION,
  versionKey,
  type EditorialOverlay,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import {
  calculateAcceptedReviewedRootHash,
  calculateNoteIdentity,
} from "@/lib/curriculum/editorial-overlay/fingerprint";
import {
  assessmentPayloadHash,
  contentPayloadHash,
  projectPackageAssessment,
  projectPackageContent,
  projectPackageLevelIdentities,
  readAssessmentPayload,
  readContentPayload,
  type PackageLevelShape,
  type PackageShape,
} from "@/lib/curriculum/editorial-overlay/payload";

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
  shape: PackageShape;
  levelByCode: Map<string, PackageLevelShape>;
  contentVersions: Map<string, number>;
  assessmentVersions: Map<string, number>;
};

function indexPackage(raw: unknown): PackageIndex {
  const shape = raw as PackageShape;
  const levelByCode = new Map<string, PackageLevelShape>();
  const contentVersions = new Map<string, number>();
  const assessmentVersions = new Map<string, number>();
  for (const packageModule of shape.modules) {
    for (const level of packageModule.levels) {
      levelByCode.set(level.levelCode, level);
      if (level.content) contentVersions.set(`${level.levelCode}#v${level.content.versionNumber}`, level.content.versionNumber);
      if (level.assessment) {
        assessmentVersions.set(`${level.levelCode}#v${level.assessment.versionNumber}`, level.assessment.versionNumber);
      }
    }
  }
  return { shape, levelByCode, contentVersions, assessmentVersions };
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const isoRequired = (value: Date): string => value.toISOString();

/**
 * A principal address that may be recreated in a target when absent.
 *
 * `.invalid` is reserved by RFC 2606/6761 as guaranteed non-resolvable, so an
 * address under it names a PROCESS IDENTITY — a role in a review — and never a
 * person's mailbox. That is how the exporter CLASSIFIES what it finds; the
 * classification is then written into the artifact as an explicit `kind`, so the
 * importer's safety rules read a declared fact rather than re-deriving a
 * convention. Anything else is presumed to be a real account that must already
 * exist, and the overlay refuses to mint a lookalike of a human being.
 */
function classifyPrincipal(email: string): "process" | "human" {
  return email.toLowerCase().endsWith(".invalid") ? "process" : "human";
}

export async function exportEditorialOverlay(input: ExportOverlayInput): Promise<EditorialOverlay> {
  const { db } = input;
  const pkg = indexPackage(input.structuralPackage);

  const curriculum = await db.curriculumVersion.findFirst({
    where: { code: pkg.shape.curriculumCode, versionNumber: pkg.shape.curriculumVersionNumber },
  });
  if (!curriculum) {
    throw new Error(
      `source has no CurriculumVersion ${pkg.shape.curriculumCode} v${pkg.shape.curriculumVersionNumber} to export`,
    );
  }

  // The checkpoint must actually be the one this package produced. Exporting an
  // overlay that claims to approve a structural baseline the source never had
  // would be the mismatch every downstream check then trusts.
  const marker = (curriculum.changeNotes ?? "").trim();
  const expectedMarker = `ata-package:${pkg.shape.packageCode}@${pkg.shape.packageRevision}:${pkg.shape.contentFingerprint}`;
  if (marker !== expectedMarker) {
    throw new Error(
      `source checkpoint was not built from the supplied structural package (expected "${expectedMarker}", found "${marker || "<none>"}")`,
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
    .map((u) => {
      const kind = classifyPrincipal(u.email);
      return {
        ref: u.email.toLowerCase(),
        displayName: u.name,
        kind,
        role: u.role as "user" | "mentor" | "support" | "admin",
        staffRole: staffByUser.get(u.id) ?? null,
        // Only a process identity is ever mintable; a human account must already
        // be there and the importer will refuse rather than create one.
        provisionIfMissing: kind === "process",
      };
    })
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

    // ACCEPTED — what the reviewer approved, read from the checkpoint.
    const accepted = await readContentPayload(db as never, row.id);
    if (!accepted) continue;

    // EXPECTED — what a structural import of the package produces. Projected from
    // the package, never inferred from the edited row above.
    let expectedStructuralHash: string | null = null;
    if (mode === "update") {
      const packageLevel = pkg.levelByCode.get(level);
      const baseline = packageLevel ? projectPackageContent(packageLevel) : null;
      if (!baseline) {
        throw new Error(`structural package has no content baseline for ${key}`);
      }
      expectedStructuralHash = contentPayloadHash(baseline);
    }

    content.push({
      level,
      versionNumber: row.versionNumber,
      mode,
      editorial: evidenceOf(row),
      expectedStructuralHash,
      acceptedReviewedHash: contentPayloadHash(accepted),
      createdAt: isoRequired(row.createdAt),
      payload: {
        videoDurationSeconds: accepted.videoDurationSeconds,
        changeNotes: accepted.changeNotes,
        localizations: accepted.localizations.map((l) => ({
          locale: l.locale,
          title: l.title,
          subtitle: l.subtitle,
          learningObjectiveExtension: l.learningObjectiveExtension,
          summary: l.summary,
          transcript: l.transcript,
          body: l.body,
        })),
      },
      creation:
        mode === "create"
          ? {
              status: row.status as "draft" | "published" | "archived",
              publishedAt: iso(row.publishedAt),
              archivedAt: iso(row.archivedAt),
            }
          : null,
    });
  }

  /* ---------------- assessments ---------------- */
  const assessmentLevelVersion = new Map<number, { level: string; versionNumber: number }>();
  for (const row of assessmentRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (level) assessmentLevelVersion.set(row.id, { level, versionNumber: row.versionNumber });
  }

  const questionCreatedAt = new Map<string, Date>();
  const assessments: EditorialOverlay["assessments"] = [];
  for (const row of assessmentRows) {
    const level = levelCodeById.get(row.levelDefinitionId);
    if (!level) continue;
    const key = `${level}#v${row.versionNumber}`;
    const mode = pkg.assessmentVersions.has(key) ? "update" : "create";
    const predecessor =
      row.predecessorVersionId !== null ? (assessmentLevelVersion.get(row.predecessorVersionId) ?? null) : null;

    const accepted = await readAssessmentPayload(db as never, row.id);
    if (!accepted) continue;

    let expectedStructuralHash: string | null = null;
    if (mode === "update") {
      const packageLevel = pkg.levelByCode.get(level);
      const baseline = packageLevel ? projectPackageAssessment(packageLevel) : null;
      if (!baseline) {
        throw new Error(`structural package has no assessment baseline for ${key}`);
      }
      expectedStructuralHash = assessmentPayloadHash(baseline);
    }

    const createdAtRows = await db.questionDefinition.findMany({
      where: { assessmentVersionId: row.id },
      select: { stableKey: true, createdAt: true },
    });
    for (const q of createdAtRows) questionCreatedAt.set(`${key}#${q.stableKey}`, q.createdAt);

    assessments.push({
      level,
      versionNumber: row.versionNumber,
      mode,
      editorial: evidenceOf(row),
      predecessor,
      expectedStructuralHash,
      acceptedReviewedHash: assessmentPayloadHash(accepted),
      createdAt: isoRequired(row.createdAt),
      payload: {
        passPercent: accepted.passPercent,
        maxAttempts: accepted.maxAttempts,
        showExplanation: accepted.showExplanation,
        changeNotes: accepted.changeNotes,
        questions: accepted.questions.map((q) => ({
          stableKey: q.stableKey,
          questionNumber: q.questionNumber,
          type: q.type,
          skillTag: q.skillTag,
          status: q.status as "active" | "disabled",
          options: q.options ?? null,
          correctAnswer: q.correctAnswer,
          createdAt: isoRequired(questionCreatedAt.get(`${key}#${q.stableKey}`) ?? row.createdAt),
          localizations: q.localizations.map((l) => ({
            locale: l.locale,
            prompt: l.prompt,
            optionLabels: l.optionLabels ?? null,
            explanation: l.explanation,
          })),
        })),
      },
      creation:
        mode === "create"
          ? {
              status: row.status as "draft" | "published" | "archived",
              publishedAt: iso(row.publishedAt),
              archivedAt: iso(row.archivedAt),
            }
          : null,
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
  // Ordinals are assigned in the source's own id order, so two notes that share
  // every identity axis stay distinguishable and stay stable across re-exports.
  const ordinalByIdentity = new Map<string, number>();
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
    const provenance = {
      target: { kind: target.kind, level: target.ref.level, versionNumber: target.ref.versionNumber },
      targetRevision: row.targetRevision,
      path: row.path,
      author,
      createdAt: isoRequired(row.createdAt),
    };
    const noteIdentity = calculateNoteIdentity(provenance);
    const ordinal = ordinalByIdentity.get(noteIdentity) ?? 0;
    ordinalByIdentity.set(noteIdentity, ordinal + 1);
    reviewNotes.push({
      noteIdentity,
      ordinal,
      ...provenance,
      body: row.body,
      resolvedAt: iso(row.resolvedAt),
      resolvedBy: ref(row.resolvedById),
    });
  }

  const levelIdentities = projectPackageLevelIdentities(pkg.shape);

  return {
    schemaVersion: EDITORIAL_OVERLAY_SCHEMA_VERSION,
    minImporterVersion: EDITORIAL_OVERLAY_IMPORTER_VERSION,
    overlayCode: input.overlayCode,
    overlayRevision: input.overlayRevision,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    binding: {
      curriculumCode: pkg.shape.curriculumCode,
      curriculumVersionNumber: pkg.shape.curriculumVersionNumber,
      structuralPackageCode: pkg.shape.packageCode,
      structuralPackageRevision: pkg.shape.packageRevision,
      structuralPackageFingerprint: pkg.shape.contentFingerprint,
      sourceCheckpointSha256: input.binding.sourceCheckpointSha256,
      sourceBackendCommit: input.binding.sourceBackendCommit,
      sourceBackendTree: input.binding.sourceBackendTree,
      blueprintSourceDocumentSha256: input.binding.blueprintSourceDocumentSha256,
      acceptedReviewedRootHash: calculateAcceptedReviewedRootHash({
        content,
        assessments,
        levels: levelIdentities,
      }),
    },
    levels: levelIdentities,
    principals,
    content,
    assessments,
    videoProductions,
    videoAssessmentLinks,
    sourceAuthorityResolutions,
    reviewNotes,
  };
}

/** Re-exported so the CLI can name the same key the fingerprint uses. */
export { versionKey };
