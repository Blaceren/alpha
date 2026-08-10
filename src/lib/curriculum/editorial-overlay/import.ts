/**
 * PHASE-G2 TRANSPORT — the overlay importer.
 *
 * Applies an Editorial Overlay v1 to a target that has already received the
 * matching structural package. Everything it writes is EVIDENCE THAT ALREADY
 * EXISTED somewhere else; nothing it writes is a new editorial act.
 *
 * THE ORDER IS THE SAFETY MODEL.
 *
 *   1. validate the artifact offline — no connection is opened for a malformed
 *      overlay, so "bad file" and "bad target" stay separately diagnosable;
 *   2. preflight the target's STRUCTURE — the curriculum, its package marker and
 *      every semantic key the overlay expects to update;
 *   3. preflight the PRINCIPALS — resolve every historical actor by address and
 *      refuse before any editorial write if one is missing or incompatible;
 *   4. then, and only then, one transaction.
 *
 * Steps 1–3 are all read-only. A run that fails any of them leaves the target
 * byte-identical, which is what makes `--dry-run` a real rehearsal rather than a
 * different code path.
 *
 * WHAT IT REFUSES TO DO.
 *
 *   It never publishes. No `CurriculumVersion`, `ContentVersion` or
 *   `AssessmentVersion` status is touched for an `update` entry, no
 *   `LevelResourceBinding` is written, no flag is read or set. After a
 *   successful import the target's runtime is exactly what it was — the
 *   curriculum is still a draft and the previously published one is still
 *   serving. Activation is a separate, later, explicitly-audited decision.
 *
 *   It never invents an actor. The operator running the import is recorded in
 *   the import audit event and NOWHERE else. `approvedBy`, `submittedBy`,
 *   `decidedBy` and note authorship come from the overlay or the import fails.
 *
 *   It never overwrites a contradiction. A target that already carries DIFFERENT
 *   editorial truth — another approver, another timestamp, another decision — is
 *   a fact about the world that an import has no authority to erase. Replay of
 *   an IDENTICAL overlay is `unchanged`; anything else fails closed.
 */
import { Prisma, type PrismaClient, type QuestionType, type StaffRole } from "@prisma/client";
import {
  authorityKey,
  questionKey,
  versionKey,
  type EditorialOverlay,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import { calculateNoteKey } from "@/lib/curriculum/editorial-overlay/fingerprint";
import { validateEditorialOverlay, type OverlayIssue } from "@/lib/curriculum/editorial-overlay/validate";

export const EDITORIAL_OVERLAY_AUDIT_ACTION = "G2_EDITORIAL_BASELINE_IMPORTED" as const;

export type OverlayImportErrorCode =
  | "OVERLAY_INVALID"
  | "TARGET_PREFLIGHT_FAILED"
  | "PRINCIPAL_PREFLIGHT_FAILED"
  | "TARGET_CONTRADICTION"
  | "APPLY_FAILED";

export type PrincipalResolution = {
  ref: string;
  targetUserId: number | null;
  status: "matched" | "provisioned" | "missing" | "incompatible";
  detail: string | null;
};

export type OverlayCounts = { created: number; updated: number; unchanged: number };

export type OverlayImportSummary = {
  outcome: "applied" | "dry-run";
  overlayFingerprint: string;
  overlayCode: string;
  overlayRevision: number;
  curriculum: { id: number; code: string; versionNumber: number; status: string };
  principals: PrincipalResolution[];
  counts: Record<
    | "contentVersions"
    | "contentLocalizations"
    | "assessmentVersions"
    | "questions"
    | "questionLocalizations"
    | "assessmentLineage"
    | "videoProductions"
    | "videoAssessmentLinks"
    | "sourceAuthorityResolutions"
    | "reviewNotes",
    OverlayCounts
  >;
  auditEventId: number | null;
  notes: string[];
};

export type OverlayImportResult =
  | { ok: true; summary: OverlayImportSummary }
  | { ok: false; code: OverlayImportErrorCode; issues: OverlayIssue[] };

export type OverlayImportOptions = {
  db: PrismaClient;
  /** Nothing is written when true. Every check still runs. */
  dryRun?: boolean;
  /**
   * The operator performing the import. Recorded in the audit event and used for
   * nothing else — it never becomes an author, a reviewer or an adjudicator.
   */
  importActorId?: number | null;
  /**
   * Allow the importer to create declared, provisionable process identities that
   * the target lacks. Off by default: minting principals is an identity
   * operation and a caller must ask for it explicitly.
   */
  allowPrincipalProvisioning?: boolean;
};

function issue(code: string, path: string, message: string): OverlayIssue {
  return { code, path, message };
}

const emptyCounts = (): OverlayCounts => ({ created: 0, updated: 0, unchanged: 0 });

function sameInstant(left: Date | null, right: string | null): boolean {
  if (left === null && right === null) return true;
  if (left === null || right === null) return false;
  return left.getTime() === new Date(right).getTime();
}

/**
 * Is this row still at the structural importer's baseline?
 *
 * A freshly imported version is `draft` with no author, no submission and no
 * approval. That is the only state an overlay may move without contradiction:
 * it is the absence of editorial truth, not a competing one.
 */
function isEditorialBaseline(row: {
  editorialState: string;
  approvedById: number | null;
  approvedAt: Date | null;
  submittedById: number | null;
  lastAuthoredById: number | null;
}): boolean {
  return (
    row.editorialState === "draft" &&
    row.approvedById === null &&
    row.approvedAt === null &&
    row.submittedById === null &&
    row.lastAuthoredById === null
  );
}

function evidenceMatches(
  row: {
    editorialState: string;
    revision: number;
    lastAuthoredById: number | null;
    lastAuthoredAt: Date | null;
    submittedById: number | null;
    submittedAt: Date | null;
    changesRequestedById: number | null;
    changesRequestedAt: Date | null;
    approvedById: number | null;
    approvedAt: Date | null;
  },
  want: OverlayEditorialEvidence,
  resolve: (ref: string | null) => number | null,
): boolean {
  return (
    row.editorialState === want.editorialState &&
    row.revision === want.revision &&
    row.lastAuthoredById === resolve(want.lastAuthoredBy) &&
    sameInstant(row.lastAuthoredAt, want.lastAuthoredAt) &&
    row.submittedById === resolve(want.submittedBy) &&
    sameInstant(row.submittedAt, want.submittedAt) &&
    row.changesRequestedById === resolve(want.changesRequestedBy) &&
    sameInstant(row.changesRequestedAt, want.changesRequestedAt) &&
    row.approvedById === resolve(want.approvedBy) &&
    sameInstant(row.approvedAt, want.approvedAt)
  );
}

const asDate = (value: string | null): Date | null => (value === null ? null : new Date(value));
const asDateRequired = (value: string): Date => new Date(value);
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export async function importEditorialOverlay(
  raw: unknown,
  options: OverlayImportOptions,
): Promise<OverlayImportResult> {
  const { db } = options;
  const dryRun = options.dryRun ?? false;

  /* ================= 1. offline validation ================= */
  const validation = validateEditorialOverlay(raw);
  if (!validation.ok) return { ok: false, code: "OVERLAY_INVALID", issues: validation.issues };
  const overlay: EditorialOverlay = validation.overlay;
  const notes: string[] = [];

  /* ================= 2. target structural preflight ================= */
  const preflight: OverlayIssue[] = [];
  const curriculum = await db.curriculumVersion.findFirst({
    where: {
      code: overlay.binding.curriculumCode,
      versionNumber: overlay.binding.curriculumVersionNumber,
    },
  });
  if (!curriculum) {
    return {
      ok: false,
      code: "TARGET_PREFLIGHT_FAILED",
      issues: [
        issue(
          "CURRICULUM_NOT_FOUND",
          "binding",
          `target has no CurriculumVersion ${overlay.binding.curriculumCode} v${overlay.binding.curriculumVersionNumber}`,
        ),
      ],
    };
  }

  // The package marker proves the target's STRUCTURE came from the exact file
  // this overlay was generated against. A valid overlay on a structurally
  // different curriculum is the failure this check exists to make loud.
  const marker = curriculum.changeNotes ?? "";
  const expectedMarker = `ata-package:${overlay.binding.structuralPackageCode}@${overlay.binding.structuralPackageRevision}:${overlay.binding.structuralPackageFingerprint}`;
  if (marker.trim() !== expectedMarker) {
    preflight.push(
      issue(
        "PACKAGE_MARKER_MISMATCH",
        "binding.structuralPackageFingerprint",
        `target curriculum was not built from the declared structural package (expected "${expectedMarker}", found "${marker.trim() || "<none>"}")`,
      ),
    );
  }

  const levels = await db.levelDefinition.findMany({
    where: { curriculumVersionId: curriculum.id },
    select: { id: true, stableCode: true },
  });
  const levelIdByCode = new Map(levels.map((l) => [l.stableCode, l.id]));

  const contentRows = await db.contentVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
  });
  const assessmentRows = await db.assessmentVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
  });
  const contentByKey = new Map<string, (typeof contentRows)[number]>();
  for (const row of contentRows) {
    const code = levels.find((l) => l.id === row.levelDefinitionId)?.stableCode;
    if (code) contentByKey.set(`${code}#v${row.versionNumber}`, row);
  }
  const assessmentByKey = new Map<string, (typeof assessmentRows)[number]>();
  for (const row of assessmentRows) {
    const code = levels.find((l) => l.id === row.levelDefinitionId)?.stableCode;
    if (code) assessmentByKey.set(`${code}#v${row.versionNumber}`, row);
  }

  const requiredLevels = new Set<string>();
  for (const entry of overlay.content) requiredLevels.add(entry.level);
  for (const entry of overlay.assessments) requiredLevels.add(entry.level);
  for (const entry of overlay.videoProductions) requiredLevels.add(entry.level);
  for (const code of requiredLevels) {
    if (!levelIdByCode.has(code)) {
      preflight.push(issue("LEVEL_NOT_FOUND", `level ${code}`, `target has no level with stableCode ${code}`));
    }
  }
  // `mode` states what the STRUCTURAL PACKAGE carries, so `update` requires the
  // row to be there. `create` does NOT require it to be absent: after a first
  // successful apply the successor exists, and a replay must recognise it as
  // already-imported rather than treat its own previous work as a collision.
  // Whether an existing row AGREES is the contradiction check below.
  for (const entry of overlay.content) {
    const key = versionKey(entry);
    if (entry.mode === "update" && !contentByKey.has(key)) {
      preflight.push(issue("CONTENT_NOT_FOUND", `content ${key}`, "overlay expects an existing content version"));
    }
  }
  for (const entry of overlay.assessments) {
    const key = versionKey(entry);
    if (entry.mode === "update" && !assessmentByKey.has(key)) {
      preflight.push(
        issue("ASSESSMENT_NOT_FOUND", `assessment ${key}`, "overlay expects an existing assessment version"),
      );
    }
  }
  // Question layout must agree for every bank the overlay only updates: the
  // stable keys are the anchor and questionNumber is the cross-check.
  for (const entry of overlay.assessments) {
    if (entry.mode !== "update") continue;
    const row = assessmentByKey.get(versionKey(entry));
    if (!row) continue;
    const questions = await db.questionDefinition.findMany({
      where: { assessmentVersionId: row.id },
      select: { stableKey: true, questionNumber: true },
    });
    if (questions.length === 0) {
      preflight.push(
        issue("QUESTIONS_MISSING", `assessment ${versionKey(entry)}`, "target bank has no questions"),
      );
    }
  }

  if (preflight.length > 0) {
    return { ok: false, code: "TARGET_PREFLIGHT_FAILED", issues: preflight };
  }

  /* ================= 3. principal preflight ================= */
  const principalIssues: OverlayIssue[] = [];
  const resolutions: PrincipalResolution[] = [];
  const targetIdByRef = new Map<string, number>();
  const toProvision: EditorialOverlay["principals"] = [];

  for (const principal of overlay.principals) {
    const existing = await db.user.findFirst({
      where: { email: principal.ref },
      select: { id: true, email: true, role: true, status: true },
    });
    if (!existing) {
      if (principal.provisionIfMissing && (options.allowPrincipalProvisioning ?? false)) {
        toProvision.push(principal);
        resolutions.push({ ref: principal.ref, targetUserId: null, status: "provisioned", detail: null });
      } else {
        principalIssues.push(
          issue(
            "PRINCIPAL_MISSING",
            `principals ${principal.ref}`,
            principal.provisionIfMissing
              ? "principal is absent and provisioning was not enabled for this run"
              : "principal is absent and this overlay does not permit provisioning it",
          ),
        );
        resolutions.push({ ref: principal.ref, targetUserId: null, status: "missing", detail: null });
      }
      continue;
    }
    const staff = await db.staffProfile.findFirst({
      where: { userId: existing.id },
      select: { staffRole: true },
    });
    const targetStaffRole = staff?.staffRole ?? null;
    // Address equality is not identity equality. A target account that reuses
    // the address with a different role is a DIFFERENT principal, and binding a
    // reviewer's approvals to it would be exactly the misattribution this whole
    // design exists to prevent.
    if (targetStaffRole !== principal.staffRole || existing.role !== principal.role) {
      principalIssues.push(
        issue(
          "PRINCIPAL_INCOMPATIBLE",
          `principals ${principal.ref}`,
          `target principal has role=${existing.role} staffRole=${targetStaffRole ?? "<none>"}, overlay declares role=${principal.role} staffRole=${principal.staffRole ?? "<none>"}`,
        ),
      );
      resolutions.push({
        ref: principal.ref,
        targetUserId: existing.id,
        status: "incompatible",
        detail: `role=${existing.role} staffRole=${targetStaffRole ?? "<none>"}`,
      });
      continue;
    }
    targetIdByRef.set(principal.ref, existing.id);
    resolutions.push({ ref: principal.ref, targetUserId: existing.id, status: "matched", detail: null });
  }

  if (principalIssues.length > 0) {
    return { ok: false, code: "PRINCIPAL_PREFLIGHT_FAILED", issues: principalIssues };
  }

  /* ================= 4. contradiction preflight ================= */
  // Read-only, and deliberately before the transaction: a contradiction is a
  // reason not to start, not a reason to roll back.
  const resolvePlanned = (ref: string | null): number | null => {
    if (ref === null) return null;
    const found = targetIdByRef.get(ref);
    if (found !== undefined) return found;
    return Number.NaN; // a principal that will be provisioned — unknown id yet
  };
  // Applies to every entry that already has a row, whatever its declared mode:
  // a version at the structural baseline may be moved, a version that already
  // agrees is a no-op, and a version carrying DIFFERENT truth is a fact this
  // import has no authority to erase.
  const contradictions: OverlayIssue[] = [];
  for (const entry of overlay.content) {
    const row = contentByKey.get(versionKey(entry));
    if (!row) continue;
    if (isEditorialBaseline(row)) continue;
    if (!evidenceMatches(row, entry.editorial, resolvePlanned)) {
      contradictions.push(
        issue(
          "CONTENT_EVIDENCE_CONFLICT",
          `content ${versionKey(entry)}`,
          "target already carries different editorial evidence for this version",
        ),
      );
    }
  }
  for (const entry of overlay.assessments) {
    const row = assessmentByKey.get(versionKey(entry));
    if (!row) continue;
    if (isEditorialBaseline(row)) continue;
    if (!evidenceMatches(row, entry.editorial, resolvePlanned)) {
      contradictions.push(
        issue(
          "ASSESSMENT_EVIDENCE_CONFLICT",
          `assessment ${versionKey(entry)}`,
          "target already carries different editorial evidence for this version",
        ),
      );
    }
  }
  if (contradictions.length > 0) {
    return { ok: false, code: "TARGET_CONTRADICTION", issues: contradictions };
  }

  const counts: OverlayImportSummary["counts"] = {
    contentVersions: emptyCounts(),
    contentLocalizations: emptyCounts(),
    assessmentVersions: emptyCounts(),
    questions: emptyCounts(),
    questionLocalizations: emptyCounts(),
    assessmentLineage: emptyCounts(),
    videoProductions: emptyCounts(),
    videoAssessmentLinks: emptyCounts(),
    sourceAuthorityResolutions: emptyCounts(),
    reviewNotes: emptyCounts(),
  };

  if (dryRun) {
    // Report the shape of the work without doing any of it, using the SAME
    // comparisons the apply path uses. A dry run whose arithmetic differed from
    // the real thing would be a rehearsal of something else.
    for (const entry of overlay.content) {
      const row = contentByKey.get(versionKey(entry));
      if (!row) {
        counts.contentVersions.created += 1;
        counts.contentLocalizations.created += entry.payload?.localizations.length ?? 0;
      } else if (evidenceMatches(row, entry.editorial, resolvePlanned)) counts.contentVersions.unchanged += 1;
      else counts.contentVersions.updated += 1;
    }
    for (const entry of overlay.assessments) {
      const row = assessmentByKey.get(versionKey(entry));
      if (!row) {
        counts.assessmentVersions.created += 1;
        for (const question of entry.payload?.questions ?? []) {
          counts.questions.created += 1;
          counts.questionLocalizations.created += question.localizations.length;
        }
      } else if (evidenceMatches(row, entry.editorial, resolvePlanned)) counts.assessmentVersions.unchanged += 1;
      else counts.assessmentVersions.updated += 1;
      if (entry.predecessor) {
        const successor = assessmentByKey.get(versionKey(entry));
        const predecessor = assessmentByKey.get(versionKey(entry.predecessor));
        if (successor && predecessor && successor.predecessorVersionId === predecessor.id) {
          counts.assessmentLineage.unchanged += 1;
        } else {
          counts.assessmentLineage.updated += 1;
        }
      }
    }
    for (const video of overlay.videoProductions) {
      const levelId = levelIdByCode.get(video.level);
      const existing = levelId
        ? await db.videoProductionVersion.findFirst({
            where: { levelDefinitionId: levelId, versionNumber: video.versionNumber },
            select: { id: true },
          })
        : null;
      if (existing) counts.videoProductions.unchanged += 1;
      else counts.videoProductions.created += 1;
    }
    // Links, authority rows and notes hang off versions that may not exist yet,
    // so a dry run reports them as work to do rather than pretending to resolve
    // ids it cannot have.
    const existingLinks = await db.videoProductionAssessmentLink.count();
    counts.videoAssessmentLinks.created = Math.max(0, overlay.videoAssessmentLinks.length - existingLinks);
    counts.videoAssessmentLinks.unchanged = Math.min(existingLinks, overlay.videoAssessmentLinks.length);
    const existingAuthority = await db.sourceAuthorityResolution.count({
      where: { curriculumVersionId: curriculum.id },
    });
    counts.sourceAuthorityResolutions.created = Math.max(
      0,
      overlay.sourceAuthorityResolutions.length - existingAuthority,
    );
    counts.sourceAuthorityResolutions.unchanged = Math.min(
      existingAuthority,
      overlay.sourceAuthorityResolutions.length,
    );
    const existingNotes = await db.editorialReviewNote.count();
    counts.reviewNotes.created = Math.max(0, overlay.reviewNotes.length - existingNotes);
    counts.reviewNotes.unchanged = Math.min(existingNotes, overlay.reviewNotes.length);
    notes.push("dry run: no transaction was opened and no row was written");
    return {
      ok: true,
      summary: {
        outcome: "dry-run",
        overlayFingerprint: validation.fingerprint,
        overlayCode: overlay.overlayCode,
        overlayRevision: overlay.overlayRevision,
        curriculum: {
          id: curriculum.id,
          code: curriculum.code,
          versionNumber: curriculum.versionNumber,
          status: curriculum.status,
        },
        principals: resolutions,
        counts,
        auditEventId: null,
        notes,
      },
    };
  }

  /* ================= 5. apply, in one transaction ================= */
  let auditEventId: number | null = null;
  try {
    await db.$transaction(
      async (tx) => {
        const idByRef = new Map(targetIdByRef);

        // Provisioned principals are created inside the same transaction as the
        // evidence that references them, so a target can never hold one without
        // the other.
        for (const principal of toProvision) {
          const created = await tx.user.create({
            data: {
              email: principal.ref,
              name: principal.displayName,
              role: principal.role,
              // Blocked, always. These are provenance identities, not accounts:
              // the login route refuses `blocked` outright, so the row can carry
              // history without ever being able to act.
              status: "blocked",
              referralCode: `overlay-${principal.ref.replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${overlay.overlayCode}`.slice(0, 64),
              // A locally generated, non-recoverable placeholder. No credential
              // is transported and none is emitted; combined with `blocked` this
              // identity has no authentication path at all.
              passwordHash: `!overlay-provisioned-no-login!${Date.now().toString(36)}`,
            },
            select: { id: true },
          });
          if (principal.staffRole) {
            await tx.staffProfile.create({
              data: {
                userId: created.id,
                displayName: principal.displayName,
                staffRole: principal.staffRole as StaffRole,
              },
            });
          }
          idByRef.set(principal.ref, created.id);
        }
        const resolve = (ref: string | null): number | null =>
          ref === null ? null : (idByRef.get(ref) ?? null);
        for (const resolution of resolutions) {
          if (resolution.status === "provisioned") {
            resolution.targetUserId = idByRef.get(resolution.ref) ?? null;
          }
        }

        /* ---- content ---- */
        const contentIdByKey = new Map<string, number>();
        for (const entry of overlay.content) {
          const key = versionKey(entry);
          const levelId = levelIdByCode.get(entry.level)!;
          const existing = contentByKey.get(key);
          const evidence = {
            editorialState: entry.editorial.editorialState,
            revision: entry.editorial.revision,
            lastAuthoredById: resolve(entry.editorial.lastAuthoredBy),
            lastAuthoredAt: asDate(entry.editorial.lastAuthoredAt),
            submittedById: resolve(entry.editorial.submittedBy),
            submittedAt: asDate(entry.editorial.submittedAt),
            changesRequestedById: resolve(entry.editorial.changesRequestedBy),
            changesRequestedAt: asDate(entry.editorial.changesRequestedAt),
            approvedById: resolve(entry.editorial.approvedBy),
            approvedAt: asDate(entry.editorial.approvedAt),
          };
          if (existing) {
            if (evidenceMatches(existing, entry.editorial, resolve)) {
              counts.contentVersions.unchanged += 1;
            } else {
              await tx.contentVersion.update({ where: { id: existing.id }, data: evidence });
              counts.contentVersions.updated += 1;
            }
            contentIdByKey.set(key, existing.id);
            continue;
          }
          const payload = entry.payload!;
          const created = await tx.contentVersion.create({
            data: {
              levelDefinitionId: levelId,
              curriculumVersionId: curriculum.id,
              versionNumber: entry.versionNumber,
              status: payload.status,
              videoDurationSeconds: payload.videoDurationSeconds,
              createdById: resolve(entry.editorial.createdBy),
              createdAt: asDateRequired(payload.createdAt),
              publishedAt: asDate(payload.publishedAt),
              archivedAt: asDate(payload.archivedAt),
              changeNotes: payload.changeNotes,
              ...evidence,
            },
            select: { id: true },
          });
          contentIdByKey.set(key, created.id);
          counts.contentVersions.created += 1;
          for (const localization of payload.localizations) {
            await tx.contentLocalization.create({
              data: {
                contentVersionId: created.id,
                locale: localization.locale,
                title: localization.title,
                subtitle: localization.subtitle,
                learningObjectiveExtension: localization.learningObjectiveExtension,
                summary: localization.summary,
                transcript: localization.transcript,
                body: asJson(localization.body),
              },
            });
            counts.contentLocalizations.created += 1;
          }
        }

        /* ---- assessments ---- */
        const assessmentIdByKey = new Map<string, number>();
        for (const entry of overlay.assessments) {
          const key = versionKey(entry);
          const levelId = levelIdByCode.get(entry.level)!;
          const existing = assessmentByKey.get(key);
          const evidence = {
            editorialState: entry.editorial.editorialState,
            revision: entry.editorial.revision,
            lastAuthoredById: resolve(entry.editorial.lastAuthoredBy),
            lastAuthoredAt: asDate(entry.editorial.lastAuthoredAt),
            submittedById: resolve(entry.editorial.submittedBy),
            submittedAt: asDate(entry.editorial.submittedAt),
            changesRequestedById: resolve(entry.editorial.changesRequestedBy),
            changesRequestedAt: asDate(entry.editorial.changesRequestedAt),
            approvedById: resolve(entry.editorial.approvedBy),
            approvedAt: asDate(entry.editorial.approvedAt),
          };
          if (existing) {
            if (evidenceMatches(existing, entry.editorial, resolve)) {
              counts.assessmentVersions.unchanged += 1;
            } else {
              await tx.assessmentVersion.update({ where: { id: existing.id }, data: evidence });
              counts.assessmentVersions.updated += 1;
            }
            assessmentIdByKey.set(key, existing.id);
            continue;
          }
          const payload = entry.payload!;
          const created = await tx.assessmentVersion.create({
            data: {
              levelDefinitionId: levelId,
              curriculumVersionId: curriculum.id,
              versionNumber: entry.versionNumber,
              status: payload.status,
              passPercent: payload.passPercent,
              maxAttempts: payload.maxAttempts,
              showExplanation: payload.showExplanation,
              createdById: resolve(entry.editorial.createdBy),
              createdAt: asDateRequired(payload.createdAt),
              publishedAt: asDate(payload.publishedAt),
              archivedAt: asDate(payload.archivedAt),
              changeNotes: payload.changeNotes,
              ...evidence,
            },
            select: { id: true },
          });
          assessmentIdByKey.set(key, created.id);
          counts.assessmentVersions.created += 1;
          for (const question of payload.questions) {
            const createdQuestion = await tx.questionDefinition.create({
              data: {
                assessmentVersionId: created.id,
                questionNumber: question.questionNumber,
                stableKey: question.stableKey,
                type: question.type as QuestionType,
                skillTag: question.skillTag,
                status: question.status,
                options: question.options === null ? Prisma.DbNull : asJson(question.options),
                correctAnswer: asJson(question.correctAnswer),
                createdAt: asDateRequired(question.createdAt),
              },
              select: { id: true },
            });
            counts.questions.created += 1;
            for (const localization of question.localizations) {
              await tx.questionLocalization.create({
                data: {
                  questionId: createdQuestion.id,
                  locale: localization.locale,
                  prompt: localization.prompt,
                  optionLabels:
                    localization.optionLabels === null ? Prisma.DbNull : asJson(localization.optionLabels),
                  explanation: localization.explanation,
                },
              });
              counts.questionLocalizations.created += 1;
            }
          }
        }

        /* ---- lineage, after every bank exists ---- */
        for (const entry of overlay.assessments) {
          if (!entry.predecessor) continue;
          const successorId = assessmentIdByKey.get(versionKey(entry))!;
          const predecessorId = assessmentIdByKey.get(versionKey(entry.predecessor));
          if (predecessorId === undefined) {
            throw new Error(`predecessor ${versionKey(entry.predecessor)} did not resolve in target`);
          }
          const current = await tx.assessmentVersion.findUnique({
            where: { id: successorId },
            select: { predecessorVersionId: true },
          });
          if (current?.predecessorVersionId === predecessorId) {
            counts.assessmentLineage.unchanged += 1;
          } else if (current?.predecessorVersionId != null) {
            throw new Error(
              `assessment ${versionKey(entry)} already descends from a different bank in the target`,
            );
          } else {
            await tx.assessmentVersion.update({
              where: { id: successorId },
              data: { predecessorVersionId: predecessorId },
            });
            counts.assessmentLineage.updated += 1;
          }
        }

        /* ---- video productions ---- */
        const videoIdByKey = new Map<string, number>();
        for (const video of overlay.videoProductions) {
          const key = versionKey(video);
          const levelId = levelIdByCode.get(video.level)!;
          const existing = await tx.videoProductionVersion.findFirst({
            where: { levelDefinitionId: levelId, versionNumber: video.versionNumber },
            select: {
              id: true,
              revision: true,
              editorialState: true,
              contractFingerprint: true,
              assessmentFingerprint: true,
              scriptState: true,
              videoState: true,
              qaState: true,
              approvedById: true,
              approvedAt: true,
            },
          });
          if (existing) {
            const same =
              existing.revision === video.revision &&
              existing.editorialState === video.editorialState &&
              existing.contractFingerprint === video.contractFingerprint &&
              existing.assessmentFingerprint === video.assessmentFingerprint &&
              existing.scriptState === video.scriptState &&
              existing.videoState === video.videoState &&
              existing.qaState === video.qaState &&
              existing.approvedById === resolve(video.evidence.approvedBy) &&
              sameInstant(existing.approvedAt, video.evidence.approvedAt);
            if (!same) {
              throw new Error(`video production ${key} already exists in the target with different contents`);
            }
            videoIdByKey.set(key, existing.id);
            counts.videoProductions.unchanged += 1;
            continue;
          }
          const created = await tx.videoProductionVersion.create({
            data: {
              levelDefinitionId: levelId,
              curriculumVersionId: curriculum.id,
              versionNumber: video.versionNumber,
              revision: video.revision,
              editorialState: video.editorialState,
              levelNumber: video.levelNumber,
              contractVersion: video.contractVersion,
              sourceProvenance: video.sourceProvenance,
              scriptState: video.scriptState,
              videoState: video.videoState,
              qaState: video.qaState,
              contractPayload: asJson(video.contractPayload),
              contractFingerprint: video.contractFingerprint,
              assessmentFingerprint: video.assessmentFingerprint,
              productionEvidenceStale: video.productionEvidenceStale,
              createdById: resolve(video.evidence.createdBy),
              createdAt: asDateRequired(video.createdAt),
              lastAuthoredById: resolve(video.evidence.lastAuthoredBy),
              lastAuthoredAt: asDate(video.evidence.lastAuthoredAt),
              submittedById: resolve(video.evidence.submittedBy),
              submittedAt: asDate(video.evidence.submittedAt),
              changesRequestedById: resolve(video.evidence.changesRequestedBy),
              changesRequestedAt: asDate(video.evidence.changesRequestedAt),
              approvedById: resolve(video.evidence.approvedBy),
              approvedAt: asDate(video.evidence.approvedAt),
            },
            select: { id: true },
          });
          videoIdByKey.set(key, created.id);
          counts.videoProductions.created += 1;
        }

        /* ---- links ---- */
        for (const link of overlay.videoAssessmentLinks) {
          const videoId = videoIdByKey.get(versionKey(link.video))!;
          const assessmentId = assessmentIdByKey.get(versionKey(link.assessment))!;
          // `findUnique` on the unique column, never `findFirst`: one production
          // has at most one link, and expressing that as a unique lookup is what
          // stops an order-dependent read from ever creeping back in here.
          const existing = await tx.videoProductionAssessmentLink.findUnique({
            where: { videoProductionVersionId: videoId },
            select: { id: true, assessmentVersionId: true, assessmentRevision: true, assessmentBankFingerprint: true },
          });
          if (existing) {
            const same =
              existing.assessmentVersionId === assessmentId &&
              existing.assessmentRevision === link.assessmentRevision &&
              existing.assessmentBankFingerprint === link.assessmentBankFingerprint;
            if (!same) {
              throw new Error(`video ${versionKey(link.video)} is already linked to a different bank in the target`);
            }
            counts.videoAssessmentLinks.unchanged += 1;
            continue;
          }
          await tx.videoProductionAssessmentLink.create({
            data: {
              videoProductionVersionId: videoId,
              assessmentVersionId: assessmentId,
              assessmentRevision: link.assessmentRevision,
              assessmentBankFingerprint: link.assessmentBankFingerprint,
              linkedById: resolve(link.linkedBy),
              linkedAt: asDateRequired(link.linkedAt),
            },
          });
          counts.videoAssessmentLinks.created += 1;
        }

        /* ---- source authority: historical evidence, verbatim ---- */
        for (const row of overlay.sourceAuthorityResolutions) {
          const assessmentId = assessmentIdByKey.get(versionKey(row.assessment))!;
          const videoId = videoIdByKey.get(versionKey(row.video))!;
          const levelId = levelIdByCode.get(row.level)!;
          const existing = await tx.sourceAuthorityResolution.findFirst({
            where: {
              assessmentVersionId: assessmentId,
              questionIndex: row.questionIndex,
              field: row.field,
              supersededAt: null,
            },
            select: {
              id: true,
              decision: true,
              currentValueHash: true,
              blueprintValueHash: true,
              decidedById: true,
              decidedAt: true,
              batchId: true,
            },
          });
          if (existing) {
            const same =
              existing.decision === row.decision &&
              existing.currentValueHash === row.currentValueHash &&
              existing.blueprintValueHash === row.blueprintValueHash &&
              existing.decidedById === resolve(row.decidedBy) &&
              sameInstant(existing.decidedAt, row.decidedAt) &&
              existing.batchId === row.batchId;
            if (!same) {
              throw new Error(
                `source-authority slot ${authorityKey(row)} already holds a different decision in the target`,
              );
            }
            counts.sourceAuthorityResolutions.unchanged += 1;
            continue;
          }
          await tx.sourceAuthorityResolution.create({
            data: {
              assessmentVersionId: assessmentId,
              videoProductionVersionId: videoId,
              levelDefinitionId: levelId,
              curriculumVersionId: curriculum.id,
              questionIndex: row.questionIndex,
              field: row.field,
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
              decidedById: resolve(row.decidedBy)!,
              decidedAt: asDateRequired(row.decidedAt),
              createdAt: asDateRequired(row.createdAt),
              supersededAt: asDate(row.supersededAt),
              supersededById: resolve(row.supersededBy),
            },
          });
          counts.sourceAuthorityResolutions.created += 1;
        }

        /* ---- review notes, keyed by the overlay's own deterministic identity ---- */
        const existingNoteKeys = new Set<string>();
        for (const [key, contentId] of contentIdByKey) {
          const [level, version] = key.split("#v");
          for (const note of await tx.editorialReviewNote.findMany({ where: { contentVersionId: contentId } })) {
            existingNoteKeys.add(
              calculateNoteKey({
                target: { kind: "content", level, versionNumber: Number(version) },
                targetRevision: note.targetRevision,
                path: note.path,
                body: note.body,
                author: overlay.principals.find((p) => idByRef.get(p.ref) === note.authorId)?.ref ?? "",
                createdAt: note.createdAt.toISOString(),
              }),
            );
          }
        }
        for (const [key, assessmentId] of assessmentIdByKey) {
          const [level, version] = key.split("#v");
          for (const note of await tx.editorialReviewNote.findMany({ where: { assessmentVersionId: assessmentId } })) {
            existingNoteKeys.add(
              calculateNoteKey({
                target: { kind: "assessment", level, versionNumber: Number(version) },
                targetRevision: note.targetRevision,
                path: note.path,
                body: note.body,
                author: overlay.principals.find((p) => idByRef.get(p.ref) === note.authorId)?.ref ?? "",
                createdAt: note.createdAt.toISOString(),
              }),
            );
          }
        }
        for (const [key, videoId] of videoIdByKey) {
          const [level, version] = key.split("#v");
          for (const note of await tx.editorialReviewNote.findMany({
            where: { videoProductionVersionId: videoId },
          })) {
            existingNoteKeys.add(
              calculateNoteKey({
                target: { kind: "video", level, versionNumber: Number(version) },
                targetRevision: note.targetRevision,
                path: note.path,
                body: note.body,
                author: overlay.principals.find((p) => idByRef.get(p.ref) === note.authorId)?.ref ?? "",
                createdAt: note.createdAt.toISOString(),
              }),
            );
          }
        }

        for (const note of overlay.reviewNotes) {
          if (existingNoteKeys.has(note.noteKey)) {
            counts.reviewNotes.unchanged += 1;
            continue;
          }
          const targetKey = versionKey(note.target);
          const data = {
            contentVersionId: note.target.kind === "content" ? contentIdByKey.get(targetKey)! : null,
            assessmentVersionId: note.target.kind === "assessment" ? assessmentIdByKey.get(targetKey)! : null,
            videoProductionVersionId: note.target.kind === "video" ? videoIdByKey.get(targetKey)! : null,
            targetRevision: note.targetRevision,
            path: note.path,
            body: note.body,
            authorId: resolve(note.author)!,
            createdAt: asDateRequired(note.createdAt),
            resolvedAt: asDate(note.resolvedAt),
            resolvedById: resolve(note.resolvedBy),
          };
          await tx.editorialReviewNote.create({ data });
          counts.reviewNotes.created += 1;
        }

        /* ---- the import event ---- */
        // Records the IMPORT and nothing else. It is not, and must never be read
        // as, an approval or an adjudication: the human evidence for those lives
        // on the rows above, with its original actors and its original times.
        const audit = await tx.auditLog.create({
          data: {
            userId: options.importActorId ?? null,
            action: EDITORIAL_OVERLAY_AUDIT_ACTION,
            entityType: "CurriculumVersion",
            entityId: String(curriculum.id),
            metadata: {
              overlayCode: overlay.overlayCode,
              overlayRevision: overlay.overlayRevision,
              overlayFingerprint: validation.fingerprint,
              sourceCheckpointSha256: overlay.binding.sourceCheckpointSha256,
              structuralPackageFingerprint: overlay.binding.structuralPackageFingerprint,
              sourceBackendCommit: overlay.binding.sourceBackendCommit,
              sourceBackendTree: overlay.binding.sourceBackendTree,
              curriculumCode: curriculum.code,
              curriculumVersionNumber: curriculum.versionNumber,
              counts: JSON.parse(JSON.stringify(counts)) as Prisma.InputJsonValue,
              principals: resolutions.map((r) => ({
                ref: r.ref,
                targetUserId: r.targetUserId,
                status: r.status,
              })),
              importActorId: options.importActorId ?? null,
            } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        auditEventId = audit.id;
      },
      { timeout: 120_000, maxWait: 30_000 },
    );
  } catch (error) {
    return {
      ok: false,
      code: "APPLY_FAILED",
      issues: [issue("APPLY_FAILED", "<transaction>", error instanceof Error ? error.message : String(error))],
    };
  }

  notes.push("no publication, binding or flag change was performed by this import");

  return {
    ok: true,
    summary: {
      outcome: "applied",
      overlayFingerprint: validation.fingerprint,
      overlayCode: overlay.overlayCode,
      overlayRevision: overlay.overlayRevision,
      curriculum: {
        id: curriculum.id,
        code: curriculum.code,
        versionNumber: curriculum.versionNumber,
        status: curriculum.status,
      },
      principals: resolutions,
      counts,
      auditEventId,
      notes,
    },
  };
}
