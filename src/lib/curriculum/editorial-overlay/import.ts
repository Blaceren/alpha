/**
 * PHASE-G2 TRANSPORT — the overlay importer.
 *
 * Applies an Editorial Overlay v2 to a target that has already received the
 * matching structural package. Everything it writes is STATE THAT ALREADY EXISTED
 * somewhere else; nothing it writes is a new editorial act.
 *
 * WHAT CHANGED, AND WHY. v1 wrote approval evidence and trusted the target's
 * structural rows to already be the reviewed bytes. They were not: the accepted
 * review phase rewrote 77 of 79 content bodies and 164 of 236 correct answers after
 * the structural baseline was cut, so a v1 import produced content marked
 * `approved`, signed by the reviewer, over the pre-review skeleton — and publication
 * accepted it. v2 carries the reviewed payload and refuses to let approval evidence
 * become durable over anything else.
 *
 * THE THREE-WAY RULE IS THE WHOLE SAFETY MODEL.
 *
 *   target payload == expectedStructuralHash → write the reviewed payload;
 *   target payload == acceptedReviewedHash   → already imported, unchanged;
 *   anything else                            → contradiction, refuse.
 *
 * There is no fourth branch and no "overwrite whatever is there". This is what
 * makes a tampered target — a changed answer, a swapped stableCode, a deleted
 * question — fail BEFORE any approval is attached to it, rather than after.
 *
 * THE ORDER IS THE REST OF THE SAFETY MODEL.
 *
 *   1. validate the artifact offline — no connection is opened for a malformed
 *      overlay, so "bad file" and "bad target" stay separately diagnosable;
 *   2. preflight the target's STRUCTURE — the curriculum, its package marker, the
 *      structural identity of every level, every semantic key, and the payload
 *      three-way for every entry;
 *   3. preflight the PRINCIPALS — resolve every historical actor by address and
 *      refuse before any editorial write if one is missing or incompatible;
 *   4. preflight CONTRADICTIONS — evidence, authority, video and note state;
 *   5. then, and only then, one transaction: payload, then evidence, then
 *      dependent history, then a final proof that every approved aggregate hashes
 *      to its accepted value, then the import event.
 *
 * Steps 1–4 are all read-only. A run that fails any of them leaves the target
 * byte-identical, which is what makes `--dry-run` a real rehearsal rather than a
 * different code path.
 *
 * WHAT IT REFUSES TO DO.
 *
 *   It never publishes. No `CurriculumVersion` status, no `ContentVersion.status`
 *   for an existing row, no `LevelResourceBinding`, no flag. After a successful
 *   import the target's runtime is exactly what it was — the curriculum is still a
 *   draft and the previously published version is still serving. Activation is a
 *   separate, later, explicitly-audited decision.
 *
 *   It never invents an actor. The operator running the import is recorded in the
 *   import audit event and NOWHERE else. `approvedBy`, `submittedBy`, `decidedBy`
 *   and note authorship come from the overlay or the import fails.
 *
 *   It never lets a historical process identity act. A declared `process`
 *   principal matches only a non-loginable target account, and one it provisions is
 *   created blocked with no usable credential.
 *
 *   It never overwrites a contradiction. A target that already carries DIFFERENT
 *   truth — another approver, another timestamp, another decision, another body —
 *   is a fact about the world that an import has no authority to erase. Replay of
 *   an IDENTICAL overlay is `unchanged`; anything else fails closed.
 */
import { Prisma, type PrismaClient, type QuestionType, type StaffRole } from "@prisma/client";
import {
  authorityKey,
  versionKey,
  type EditorialOverlay,
  type OverlayAssessmentEntry,
  type OverlayContentEntry,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import { calculateNoteIdentity } from "@/lib/curriculum/editorial-overlay/fingerprint";
import {
  assessmentPayloadHash,
  canonicalJson,
  contentPayloadHash,
  readAssessmentPayload,
  readContentPayload,
} from "@/lib/curriculum/editorial-overlay/payload";
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
    | "contentPayloads"
    | "assessmentVersions"
    | "assessmentPayloads"
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
    createdById: number | null;
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
    row.createdById === resolve(want.createdBy) &&
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
const jsonOrNull = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);

/** What the three-way comparison decided for one aggregate. */
type PayloadDecision = "write" | "unchanged" | "create";

type ContentPlan = {
  entry: OverlayContentEntry;
  key: string;
  levelId: number;
  existingId: number | null;
  payload: PayloadDecision;
};

type AssessmentPlan = {
  entry: OverlayAssessmentEntry;
  key: string;
  levelId: number;
  existingId: number | null;
  payload: PayloadDecision;
};

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

  /* ---- level structural identity: the stableCode-swap killer ---- */
  const levelRows = await db.levelDefinition.findMany({
    where: { curriculumVersionId: curriculum.id },
    select: {
      id: true,
      stableCode: true,
      levelNumber: true,
      type: true,
      module: { select: { code: true, moduleNumber: true } },
    },
  });
  const levelIdByCode = new Map(levelRows.map((l) => [l.stableCode, l.id]));
  const levelRowByCode = new Map(levelRows.map((l) => [l.stableCode, l]));

  // A level code is only a name. It must be attached to the levelNumber, module
  // and type the package gives it, or the overlay's evidence for one level would
  // land on the row that merely borrowed its code.
  for (const declared of overlay.levels) {
    const row = levelRowByCode.get(declared.level);
    if (!row) continue; // reported below only when the overlay actually needs it
    const mismatches: string[] = [];
    if (row.levelNumber !== declared.levelNumber) {
      mismatches.push(`levelNumber ${row.levelNumber} != ${declared.levelNumber}`);
    }
    if (row.module.code !== declared.moduleCode) {
      mismatches.push(`module ${row.module.code} != ${declared.moduleCode}`);
    }
    if (row.module.moduleNumber !== declared.moduleNumber) {
      mismatches.push(`moduleNumber ${row.module.moduleNumber} != ${declared.moduleNumber}`);
    }
    if (String(row.type) !== declared.type) {
      mismatches.push(`type ${String(row.type)} != ${declared.type}`);
    }
    if (mismatches.length > 0) {
      preflight.push(
        issue(
          "LEVEL_IDENTITY_MISMATCH",
          `level ${declared.level}`,
          `target level does not have the structural identity the package gives this code (${mismatches.join(", ")})`,
        ),
      );
    }
  }

  const contentRows = await db.contentVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
  });
  const assessmentRows = await db.assessmentVersion.findMany({
    where: { curriculumVersionId: curriculum.id },
  });
  const codeByLevelId = new Map(levelRows.map((l) => [l.id, l.stableCode]));
  const contentByKey = new Map<string, (typeof contentRows)[number]>();
  for (const row of contentRows) {
    const code = codeByLevelId.get(row.levelDefinitionId);
    if (code) contentByKey.set(`${code}#v${row.versionNumber}`, row);
  }
  const assessmentByKey = new Map<string, (typeof assessmentRows)[number]>();
  for (const row of assessmentRows) {
    const code = codeByLevelId.get(row.levelDefinitionId);
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

  /* ---- the payload three-way, per content entry ---- */
  const contentPlans: ContentPlan[] = [];
  for (const entry of overlay.content) {
    const key = versionKey(entry);
    const levelId = levelIdByCode.get(entry.level);
    const existing = contentByKey.get(key);
    if (entry.mode === "update" && !existing) {
      preflight.push(issue("CONTENT_NOT_FOUND", `content ${key}`, "overlay expects an existing content version"));
      continue;
    }
    if (levelId === undefined) continue;
    if (!existing) {
      contentPlans.push({ entry, key, levelId, existingId: null, payload: "create" });
      continue;
    }
    const current = await readContentPayload(db, existing.id);
    const currentHash = current ? contentPayloadHash(current) : null;
    if (currentHash === entry.acceptedReviewedHash) {
      contentPlans.push({ entry, key, levelId, existingId: existing.id, payload: "unchanged" });
    } else if (entry.expectedStructuralHash !== null && currentHash === entry.expectedStructuralHash) {
      contentPlans.push({ entry, key, levelId, existingId: existing.id, payload: "write" });
    } else {
      preflight.push(
        issue(
          "CONTENT_PAYLOAD_CONTRADICTION",
          `content ${key}`,
          `target content is neither the structural baseline nor the accepted reviewed state (target ${currentHash ?? "<none>"}, expected structural ${entry.expectedStructuralHash ?? "<n/a>"}, accepted ${entry.acceptedReviewedHash})`,
        ),
      );
    }
  }

  /* ---- the payload three-way, per assessment entry ---- */
  const assessmentPlans: AssessmentPlan[] = [];
  for (const entry of overlay.assessments) {
    const key = versionKey(entry);
    const levelId = levelIdByCode.get(entry.level);
    const existing = assessmentByKey.get(key);
    if (entry.mode === "update" && !existing) {
      preflight.push(
        issue("ASSESSMENT_NOT_FOUND", `assessment ${key}`, "overlay expects an existing assessment version"),
      );
      continue;
    }
    if (levelId === undefined) continue;
    if (!existing) {
      assessmentPlans.push({ entry, key, levelId, existingId: null, payload: "create" });
      continue;
    }
    const current = await readAssessmentPayload(db, existing.id);
    const currentHash = current ? assessmentPayloadHash(current) : null;
    if (currentHash === entry.acceptedReviewedHash) {
      assessmentPlans.push({ entry, key, levelId, existingId: existing.id, payload: "unchanged" });
    } else if (entry.expectedStructuralHash !== null && currentHash === entry.expectedStructuralHash) {
      assessmentPlans.push({ entry, key, levelId, existingId: existing.id, payload: "write" });
    } else {
      preflight.push(
        issue(
          "ASSESSMENT_PAYLOAD_CONTRADICTION",
          `assessment ${key}`,
          `target bank is neither the structural baseline nor the accepted reviewed state (target ${currentHash ?? "<none>"}, expected structural ${entry.expectedStructuralHash ?? "<n/a>"}, accepted ${entry.acceptedReviewedHash})`,
        ),
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
    const incompatible: string[] = [];
    // Address equality is not identity equality. A target account that reuses
    // the address with a different role is a DIFFERENT principal, and binding a
    // reviewer's approvals to it would be exactly the misattribution this whole
    // design exists to prevent.
    if (targetStaffRole !== principal.staffRole) {
      incompatible.push(`staffRole ${targetStaffRole ?? "<none>"} != ${principal.staffRole ?? "<none>"}`);
    }
    if (existing.role !== principal.role) {
      incompatible.push(`role ${existing.role} != ${principal.role}`);
    }
    // A historical PROCESS identity is a name for a role in a review that must
    // never be able to act. An account at the same address that can still log in
    // is a different thing entirely — very possibly a real person — and attaching
    // 78 historical approvals to it would be attributing a review to whoever
    // holds it. Refuse; never demote the account to make it fit.
    if (principal.kind === "process" && existing.status !== "blocked") {
      incompatible.push(
        `target account is ${existing.status} and therefore loginable, but the overlay declares a non-loginable historical process identity`,
      );
    }
    if (incompatible.length > 0) {
      principalIssues.push(
        issue("PRINCIPAL_INCOMPATIBLE", `principals ${principal.ref}`, incompatible.join("; ")),
      );
      resolutions.push({
        ref: principal.ref,
        targetUserId: existing.id,
        status: "incompatible",
        detail: incompatible.join("; "),
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
  const contradictions: OverlayIssue[] = [];

  for (const plan of contentPlans) {
    const row = plan.existingId === null ? null : contentByKey.get(plan.key);
    if (!row) continue;
    if (isEditorialBaseline(row)) continue;
    if (!evidenceMatches(row, plan.entry.editorial, resolvePlanned)) {
      contradictions.push(
        issue(
          "CONTENT_EVIDENCE_CONFLICT",
          `content ${plan.key}`,
          "target already carries different editorial evidence for this version",
        ),
      );
    }
  }
  for (const plan of assessmentPlans) {
    const row = plan.existingId === null ? null : assessmentByKey.get(plan.key);
    if (!row) continue;
    if (isEditorialBaseline(row)) continue;
    if (!evidenceMatches(row, plan.entry.editorial, resolvePlanned)) {
      contradictions.push(
        issue(
          "ASSESSMENT_EVIDENCE_CONFLICT",
          `assessment ${plan.key}`,
          "target already carries different editorial evidence for this version",
        ),
      );
    }
  }

  /* ---- video productions: the FULL transported state, not a sample ---- */
  const videoIdByKeyPre = new Map<string, number>();
  for (const video of overlay.videoProductions) {
    const levelId = levelIdByCode.get(video.level);
    if (levelId === undefined) continue;
    const existing = await db.videoProductionVersion.findFirst({
      where: { levelDefinitionId: levelId, versionNumber: video.versionNumber },
    });
    if (!existing) continue;
    videoIdByKeyPre.set(versionKey(video), existing.id);
    // v1 compared eight fields and reported `unchanged` for everything else, so a
    // target whose contract payload had been altered passed silently. Every
    // transported field is compared now.
    const differences: string[] = [];
    const check = (name: string, left: unknown, right: unknown) => {
      if (left !== right) differences.push(`${name} ${String(left)} != ${String(right)}`);
    };
    check("revision", existing.revision, video.revision);
    check("editorialState", existing.editorialState, video.editorialState);
    check("levelNumber", existing.levelNumber, video.levelNumber);
    check("contractVersion", existing.contractVersion, video.contractVersion);
    check("sourceProvenance", existing.sourceProvenance, video.sourceProvenance);
    check("scriptState", existing.scriptState, video.scriptState);
    check("videoState", existing.videoState, video.videoState);
    check("qaState", existing.qaState, video.qaState);
    check("contractFingerprint", existing.contractFingerprint, video.contractFingerprint);
    check("assessmentFingerprint", existing.assessmentFingerprint, video.assessmentFingerprint);
    check("productionEvidenceStale", existing.productionEvidenceStale, video.productionEvidenceStale);
    if (canonicalJson(existing.contractPayload) !== canonicalJson(video.contractPayload)) {
      differences.push("contractPayload differs");
    }
    if (!sameInstant(existing.createdAt, video.createdAt)) differences.push("createdAt differs");
    check("createdById", existing.createdById, resolvePlanned(video.evidence.createdBy));
    check("lastAuthoredById", existing.lastAuthoredById, resolvePlanned(video.evidence.lastAuthoredBy));
    check("submittedById", existing.submittedById, resolvePlanned(video.evidence.submittedBy));
    check("changesRequestedById", existing.changesRequestedById, resolvePlanned(video.evidence.changesRequestedBy));
    check("approvedById", existing.approvedById, resolvePlanned(video.evidence.approvedBy));
    if (!sameInstant(existing.lastAuthoredAt, video.evidence.lastAuthoredAt)) differences.push("lastAuthoredAt differs");
    if (!sameInstant(existing.submittedAt, video.evidence.submittedAt)) differences.push("submittedAt differs");
    if (!sameInstant(existing.changesRequestedAt, video.evidence.changesRequestedAt)) {
      differences.push("changesRequestedAt differs");
    }
    if (!sameInstant(existing.approvedAt, video.evidence.approvedAt)) differences.push("approvedAt differs");
    if (differences.length > 0) {
      contradictions.push(
        issue(
          "VIDEO_PRODUCTION_CONFLICT",
          `videoProduction ${versionKey(video)}`,
          `target already holds a different video production: ${differences.slice(0, 4).join("; ")}`,
        ),
      );
    }
  }

  /* ---- links ---- */
  for (const link of overlay.videoAssessmentLinks) {
    const videoId = videoIdByKeyPre.get(versionKey(link.video));
    if (videoId === undefined) continue;
    const existing = await db.videoProductionAssessmentLink.findUnique({
      where: { videoProductionVersionId: videoId },
    });
    if (!existing) continue;
    const wantAssessment = assessmentByKey.get(versionKey(link.assessment));
    const differences: string[] = [];
    if (wantAssessment && existing.assessmentVersionId !== wantAssessment.id) differences.push("assessment differs");
    if (existing.assessmentRevision !== link.assessmentRevision) differences.push("assessmentRevision differs");
    if (existing.assessmentBankFingerprint !== link.assessmentBankFingerprint) {
      differences.push("assessmentBankFingerprint differs");
    }
    if (existing.linkedById !== resolvePlanned(link.linkedBy)) differences.push("linkedBy differs");
    if (!sameInstant(existing.linkedAt, link.linkedAt)) differences.push("linkedAt differs");
    if (differences.length > 0) {
      contradictions.push(
        issue("LINK_CONFLICT", `link ${versionKey(link.video)}`, `target link differs: ${differences.join("; ")}`),
      );
    }
  }

  /* ---- source authority: EVERY transported historical field ---- */
  for (const row of overlay.sourceAuthorityResolutions) {
    const assessment = assessmentByKey.get(versionKey(row.assessment));
    if (!assessment) continue;
    const existing = await db.sourceAuthorityResolution.findFirst({
      where: {
        assessmentVersionId: assessment.id,
        questionIndex: row.questionIndex,
        field: row.field,
        supersededAt: null,
      },
    });
    if (!existing) continue;
    // v1 compared six of seventeen transported fields, so a target whose
    // rationale or evidence digest had been altered was reported `unchanged`.
    // Historical evidence is only evidence if all of it matches.
    const differences: string[] = [];
    const check = (name: string, left: unknown, right: unknown) => {
      if (left !== right) differences.push(name);
    };
    check("decision", existing.decision, row.decision);
    check("conflictPath", existing.conflictPath, row.conflictPath);
    check("currentValueHash", existing.currentValueHash, row.currentValueHash);
    check("blueprintValueHash", existing.blueprintValueHash, row.blueprintValueHash);
    check("blueprintSourceDocumentSha256", existing.blueprintSourceDocumentSha256, row.blueprintSourceDocumentSha256);
    check("contractFingerprintAtDecision", existing.contractFingerprintAtDecision, row.contractFingerprintAtDecision);
    check("bankFingerprintAtDecision", existing.bankFingerprintAtDecision, row.bankFingerprintAtDecision);
    check("assessmentRevisionAtDecision", existing.assessmentRevisionAtDecision, row.assessmentRevisionAtDecision);
    check("rationale", existing.rationale, row.rationale);
    check("evidenceRef", existing.evidenceRef, row.evidenceRef);
    check("evidenceSha256", existing.evidenceSha256, row.evidenceSha256);
    check("batchId", existing.batchId, row.batchId);
    check("decidedById", existing.decidedById, resolvePlanned(row.decidedBy));
    check("supersededById", existing.supersededById, resolvePlanned(row.supersededBy));
    if (!sameInstant(existing.decidedAt, row.decidedAt)) differences.push("decidedAt");
    if (!sameInstant(existing.createdAt, row.createdAt)) differences.push("createdAt");
    if (!sameInstant(existing.supersededAt, row.supersededAt)) differences.push("supersededAt");
    if (differences.length > 0) {
      contradictions.push(
        issue(
          "SOURCE_AUTHORITY_CONFLICT",
          `sourceAuthority ${authorityKey(row)}`,
          `target holds a different historical decision (${differences.join(", ")})`,
        ),
      );
    }
  }

  if (contradictions.length > 0) {
    return { ok: false, code: "TARGET_CONTRADICTION", issues: contradictions };
  }

  const counts: OverlayImportSummary["counts"] = {
    contentVersions: emptyCounts(),
    contentPayloads: emptyCounts(),
    assessmentVersions: emptyCounts(),
    assessmentPayloads: emptyCounts(),
    assessmentLineage: emptyCounts(),
    videoProductions: emptyCounts(),
    videoAssessmentLinks: emptyCounts(),
    sourceAuthorityResolutions: emptyCounts(),
    reviewNotes: emptyCounts(),
  };

  /* ---- review notes: resolved here so dry-run and apply agree exactly ---- */
  type NotePlan = { note: EditorialOverlay["reviewNotes"][number]; existingId: number | null };
  const notePlans: NotePlan[] = [];
  const noteContradictions: OverlayIssue[] = [];
  {
    // Group the target's notes by the same provenance identity the overlay uses,
    // so "which note" and "what it says" stay separate questions.
    const existingByIdentity = new Map<string, Array<{ id: number; body: string; resolvedAt: Date | null; resolvedById: number | null }>>();
    const targets: Array<{ kind: "content" | "assessment" | "video"; key: string; id: number }> = [];
    for (const plan of contentPlans) if (plan.existingId !== null) targets.push({ kind: "content", key: plan.key, id: plan.existingId });
    for (const plan of assessmentPlans) if (plan.existingId !== null) targets.push({ kind: "assessment", key: plan.key, id: plan.existingId });
    for (const [key, id] of videoIdByKeyPre) targets.push({ kind: "video", key, id });
    const refByUserId = new Map<number, string>();
    for (const [ref, id] of targetIdByRef) refByUserId.set(id, ref);
    for (const target of targets) {
      const [level, version] = target.key.split("#v");
      const where =
        target.kind === "content"
          ? { contentVersionId: target.id }
          : target.kind === "assessment"
            ? { assessmentVersionId: target.id }
            : { videoProductionVersionId: target.id };
      const rows = await db.editorialReviewNote.findMany({ where, orderBy: { id: "asc" } });
      for (const row of rows) {
        const author = row.authorId === null ? null : refByUserId.get(row.authorId);
        if (!author) continue;
        const identity = calculateNoteIdentity({
          target: { kind: target.kind, level, versionNumber: Number(version) },
          targetRevision: row.targetRevision,
          path: row.path,
          author,
          createdAt: row.createdAt.toISOString(),
        });
        const bucket = existingByIdentity.get(identity) ?? [];
        bucket.push({ id: row.id, body: row.body, resolvedAt: row.resolvedAt, resolvedById: row.resolvedById });
        existingByIdentity.set(identity, bucket);
      }
    }
    for (const note of overlay.reviewNotes) {
      const bucket = existingByIdentity.get(note.noteIdentity) ?? [];
      const existing = bucket[note.ordinal];
      if (!existing) {
        notePlans.push({ note, existingId: null });
        continue;
      }
      // Same note, different words: an import has no authority to rewrite what a
      // reviewer wrote, and writing a second copy beside it — v1's behaviour —
      // manufactures evidence. Refuse.
      const differences: string[] = [];
      if (existing.body !== note.body) differences.push("body");
      if (!sameInstant(existing.resolvedAt, note.resolvedAt)) differences.push("resolvedAt");
      if (existing.resolvedById !== resolvePlanned(note.resolvedBy)) differences.push("resolvedBy");
      if (differences.length > 0) {
        noteContradictions.push(
          issue(
            "REVIEW_NOTE_CONFLICT",
            `reviewNote ${note.noteIdentity.slice(0, 12)}#${note.ordinal}`,
            `target note with the same author, target and instant differs (${differences.join(", ")})`,
          ),
        );
        continue;
      }
      notePlans.push({ note, existingId: existing.id });
    }
  }
  if (noteContradictions.length > 0) {
    return { ok: false, code: "TARGET_CONTRADICTION", issues: noteContradictions };
  }

  /* ---- counts, shared by dry-run and apply ---- */
  for (const plan of contentPlans) {
    if (plan.payload === "create") {
      counts.contentVersions.created += 1;
      counts.contentPayloads.created += 1;
    } else {
      const row = contentByKey.get(plan.key)!;
      if (evidenceMatches(row, plan.entry.editorial, resolvePlanned)) counts.contentVersions.unchanged += 1;
      else counts.contentVersions.updated += 1;
      if (plan.payload === "write") counts.contentPayloads.updated += 1;
      else counts.contentPayloads.unchanged += 1;
    }
  }
  for (const plan of assessmentPlans) {
    if (plan.payload === "create") {
      counts.assessmentVersions.created += 1;
      counts.assessmentPayloads.created += 1;
    } else {
      const row = assessmentByKey.get(plan.key)!;
      if (evidenceMatches(row, plan.entry.editorial, resolvePlanned)) counts.assessmentVersions.unchanged += 1;
      else counts.assessmentVersions.updated += 1;
      if (plan.payload === "write") counts.assessmentPayloads.updated += 1;
      else counts.assessmentPayloads.unchanged += 1;
    }
    if (plan.entry.predecessor) {
      const successor = assessmentByKey.get(plan.key);
      const predecessor = assessmentByKey.get(versionKey(plan.entry.predecessor));
      if (successor && predecessor && successor.predecessorVersionId === predecessor.id) {
        counts.assessmentLineage.unchanged += 1;
      } else {
        counts.assessmentLineage.updated += 1;
      }
    }
  }
  for (const video of overlay.videoProductions) {
    if (videoIdByKeyPre.has(versionKey(video))) counts.videoProductions.unchanged += 1;
    else counts.videoProductions.created += 1;
  }
  for (const link of overlay.videoAssessmentLinks) {
    const videoId = videoIdByKeyPre.get(versionKey(link.video));
    const existing =
      videoId === undefined
        ? null
        : await db.videoProductionAssessmentLink.findUnique({ where: { videoProductionVersionId: videoId } });
    if (existing) counts.videoAssessmentLinks.unchanged += 1;
    else counts.videoAssessmentLinks.created += 1;
  }
  for (const row of overlay.sourceAuthorityResolutions) {
    const assessment = assessmentByKey.get(versionKey(row.assessment));
    const existing = assessment
      ? await db.sourceAuthorityResolution.findFirst({
          where: {
            assessmentVersionId: assessment.id,
            questionIndex: row.questionIndex,
            field: row.field,
            supersededAt: null,
          },
          select: { id: true },
        })
      : null;
    if (existing) counts.sourceAuthorityResolutions.unchanged += 1;
    else counts.sourceAuthorityResolutions.created += 1;
  }
  for (const plan of notePlans) {
    if (plan.existingId === null) counts.reviewNotes.created += 1;
    else counts.reviewNotes.unchanged += 1;
  }

  if (dryRun) {
    notes.push("dry run: no transaction was opened and no row was written");
    notes.push(
      `payload three-way: ${counts.contentPayloads.updated} content and ${counts.assessmentPayloads.updated} assessment payloads would move from the structural baseline to the accepted reviewed state`,
    );
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
              // A locally generated, non-recoverable placeholder. It is not a
              // bcrypt digest, so `bcrypt.compare` can never return true for it:
              // no credential is transported, none is emitted, and combined with
              // `blocked` this identity has no authentication path at all.
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

        /* ---- content: the reviewed payload FIRST, then the evidence ---- */
        const contentIdByKey = new Map<string, number>();
        for (const plan of contentPlans) {
          const { entry } = plan;
          const evidence = {
            editorialState: entry.editorial.editorialState,
            revision: entry.editorial.revision,
            // `createdById` is historical evidence like the rest of this block.
            // A structural import leaves it null; the overlay names the author
            // who actually created the version, and the round trip proves it.
            createdById: resolve(entry.editorial.createdBy),
            lastAuthoredById: resolve(entry.editorial.lastAuthoredBy),
            lastAuthoredAt: asDate(entry.editorial.lastAuthoredAt),
            submittedById: resolve(entry.editorial.submittedBy),
            submittedAt: asDate(entry.editorial.submittedAt),
            changesRequestedById: resolve(entry.editorial.changesRequestedBy),
            changesRequestedAt: asDate(entry.editorial.changesRequestedAt),
            approvedById: resolve(entry.editorial.approvedBy),
            approvedAt: asDate(entry.editorial.approvedAt),
          };

          if (plan.existingId !== null) {
            if (plan.payload === "write") {
              // The reviewed body replaces the structural one. Localizations are
              // replaced wholesale so a locale the review deleted really goes.
              await tx.contentVersion.update({
                where: { id: plan.existingId },
                data: {
                  videoDurationSeconds: entry.payload.videoDurationSeconds,
                  changeNotes: entry.payload.changeNotes,
                },
              });
              await tx.contentLocalization.deleteMany({ where: { contentVersionId: plan.existingId } });
              for (const localization of entry.payload.localizations) {
                await tx.contentLocalization.create({
                  data: {
                    contentVersionId: plan.existingId,
                    locale: localization.locale,
                    title: localization.title,
                    subtitle: localization.subtitle,
                    learningObjectiveExtension: localization.learningObjectiveExtension,
                    summary: localization.summary,
                    transcript: localization.transcript,
                    body: asJson(localization.body),
                  },
                });
              }
            }
            const row = contentByKey.get(plan.key)!;
            // Provenance is applied on its own, not as a side effect of the
            // evidence decision: a version whose four-eyes evidence already
            // matched would otherwise keep the instant the structural import
            // stamped, and read as created after it was submitted.
            if (row.createdAt.getTime() !== new Date(entry.createdAt).getTime()) {
              await tx.contentVersion.update({
                where: { id: plan.existingId },
                data: { createdAt: asDateRequired(entry.createdAt) },
              });
            }
            if (!evidenceMatches(row, entry.editorial, resolve)) {
              await tx.contentVersion.update({ where: { id: plan.existingId }, data: evidence });
            }
            contentIdByKey.set(plan.key, plan.existingId);
            continue;
          }

          const creation = entry.creation!;
          const created = await tx.contentVersion.create({
            data: {
              levelDefinitionId: plan.levelId,
              curriculumVersionId: curriculum.id,
              versionNumber: entry.versionNumber,
              status: creation.status,
              videoDurationSeconds: entry.payload.videoDurationSeconds,
              createdAt: asDateRequired(entry.createdAt),
              publishedAt: asDate(creation.publishedAt),
              archivedAt: asDate(creation.archivedAt),
              changeNotes: entry.payload.changeNotes,
              ...evidence,
            },
            select: { id: true },
          });
          contentIdByKey.set(plan.key, created.id);
          for (const localization of entry.payload.localizations) {
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
          }
        }

        /* ---- assessments ---- */
        const assessmentIdByKey = new Map<string, number>();
        for (const plan of assessmentPlans) {
          const { entry } = plan;
          const evidence = {
            editorialState: entry.editorial.editorialState,
            revision: entry.editorial.revision,
            // `createdById` is historical evidence like the rest of this block.
            // A structural import leaves it null; the overlay names the author
            // who actually created the version, and the round trip proves it.
            createdById: resolve(entry.editorial.createdBy),
            lastAuthoredById: resolve(entry.editorial.lastAuthoredBy),
            lastAuthoredAt: asDate(entry.editorial.lastAuthoredAt),
            submittedById: resolve(entry.editorial.submittedBy),
            submittedAt: asDate(entry.editorial.submittedAt),
            changesRequestedById: resolve(entry.editorial.changesRequestedBy),
            changesRequestedAt: asDate(entry.editorial.changesRequestedAt),
            approvedById: resolve(entry.editorial.approvedBy),
            approvedAt: asDate(entry.editorial.approvedAt),
          };

          const writeQuestions = async (assessmentVersionId: number) => {
            for (const question of entry.payload.questions) {
              const createdQuestion = await tx.questionDefinition.create({
                data: {
                  assessmentVersionId,
                  questionNumber: question.questionNumber,
                  stableKey: question.stableKey,
                  type: question.type as QuestionType,
                  skillTag: question.skillTag,
                  status: question.status,
                  options: jsonOrNull(question.options),
                  correctAnswer: asJson(question.correctAnswer),
                  createdAt: asDateRequired(question.createdAt),
                },
                select: { id: true },
              });
              for (const localization of question.localizations) {
                await tx.questionLocalization.create({
                  data: {
                    questionId: createdQuestion.id,
                    locale: localization.locale,
                    prompt: localization.prompt,
                    optionLabels: jsonOrNull(localization.optionLabels),
                    explanation: localization.explanation,
                  },
                });
              }
            }
          };

          if (plan.existingId !== null) {
            if (plan.payload === "write") {
              await tx.assessmentVersion.update({
                where: { id: plan.existingId },
                data: {
                  passPercent: entry.payload.passPercent,
                  maxAttempts: entry.payload.maxAttempts,
                  showExplanation: entry.payload.showExplanation,
                  changeNotes: entry.payload.changeNotes,
                },
              });
              // The reviewed bank replaces the structural one whole. Rebuilding
              // rather than patching is what makes a deleted or added question
              // land correctly, and the final verification below proves the
              // result is exactly the accepted bank.
              const old = await tx.questionDefinition.findMany({
                where: { assessmentVersionId: plan.existingId },
                select: { id: true },
              });
              await tx.questionLocalization.deleteMany({
                where: { questionId: { in: old.map((q) => q.id) } },
              });
              await tx.questionDefinition.deleteMany({ where: { assessmentVersionId: plan.existingId } });
              await writeQuestions(plan.existingId);
            }
            const row = assessmentByKey.get(plan.key)!;
            if (row.createdAt.getTime() !== new Date(entry.createdAt).getTime()) {
              await tx.assessmentVersion.update({
                where: { id: plan.existingId },
                data: { createdAt: asDateRequired(entry.createdAt) },
              });
            }
            // A bank whose reviewed payload already matched keeps its structural
            // question rows, so their creation instants are synced here rather
            // than being left behind by the one branch that does not rewrite them.
            if (plan.payload === "unchanged") {
              const current = await tx.questionDefinition.findMany({
                where: { assessmentVersionId: plan.existingId },
                select: { id: true, stableKey: true, createdAt: true },
              });
              const wantByKey = new Map(entry.payload.questions.map((q) => [q.stableKey, q.createdAt]));
              for (const question of current) {
                const want = wantByKey.get(question.stableKey);
                if (want && question.createdAt.getTime() !== new Date(want).getTime()) {
                  await tx.questionDefinition.update({
                    where: { id: question.id },
                    data: { createdAt: asDateRequired(want) },
                  });
                }
              }
            }
            if (!evidenceMatches(row, entry.editorial, resolve)) {
              await tx.assessmentVersion.update({ where: { id: plan.existingId }, data: evidence });
            }
            assessmentIdByKey.set(plan.key, plan.existingId);
            continue;
          }

          const creation = entry.creation!;
          const created = await tx.assessmentVersion.create({
            data: {
              levelDefinitionId: plan.levelId,
              curriculumVersionId: curriculum.id,
              versionNumber: entry.versionNumber,
              status: creation.status,
              passPercent: entry.payload.passPercent,
              maxAttempts: entry.payload.maxAttempts,
              showExplanation: entry.payload.showExplanation,
              createdAt: asDateRequired(entry.createdAt),
              publishedAt: asDate(creation.publishedAt),
              archivedAt: asDate(creation.archivedAt),
              changeNotes: entry.payload.changeNotes,
              ...evidence,
            },
            select: { id: true },
          });
          assessmentIdByKey.set(plan.key, created.id);
          await writeQuestions(created.id);
        }

        /* ---- lineage, after every bank exists ---- */
        for (const plan of assessmentPlans) {
          const entry = plan.entry;
          if (!entry.predecessor) continue;
          const successorId = assessmentIdByKey.get(plan.key)!;
          const predecessorId = assessmentIdByKey.get(versionKey(entry.predecessor));
          if (predecessorId === undefined) {
            throw new Error(`predecessor ${versionKey(entry.predecessor)} did not resolve in target`);
          }
          const current = await tx.assessmentVersion.findUnique({
            where: { id: successorId },
            select: { predecessorVersionId: true },
          });
          if (current?.predecessorVersionId === predecessorId) {
            /* already linked */
          } else if (current?.predecessorVersionId != null) {
            throw new Error(
              `assessment ${plan.key} already descends from a different bank in the target`,
            );
          } else {
            await tx.assessmentVersion.update({
              where: { id: successorId },
              data: { predecessorVersionId: predecessorId },
            });
          }
        }

        /* ---- video productions ---- */
        const videoIdByKey = new Map<string, number>(videoIdByKeyPre);
        for (const video of overlay.videoProductions) {
          const key = versionKey(video);
          if (videoIdByKey.has(key)) continue; // already proven identical in preflight
          const created = await tx.videoProductionVersion.create({
            data: {
              levelDefinitionId: levelIdByCode.get(video.level)!,
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
            select: { id: true },
          });
          if (existing) continue; // proven identical in preflight
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
            select: { id: true },
          });
          if (existing) continue; // proven identical in preflight
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
        }

        /* ---- review notes ---- */
        for (const plan of notePlans) {
          if (plan.existingId !== null) continue; // proven identical in preflight
          const note = plan.note;
          const targetKey = versionKey(note.target);
          await tx.editorialReviewNote.create({
            data: {
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
            },
          });
        }

        /* ---- THE INVARIANT: approval only over the accepted bytes ---- */
        // Read back what was actually written and prove it hashes to the value the
        // overlay approved. This is the check whose absence let v1 attach a
        // reviewer's signature to a pre-review skeleton, so it runs inside the
        // transaction: if it fails, none of the evidence above becomes durable.
        for (const plan of contentPlans) {
          const id = contentIdByKey.get(plan.key)!;
          const written = await readContentPayload(tx as never, id);
          const hash = written ? contentPayloadHash(written) : null;
          if (hash !== plan.entry.acceptedReviewedHash) {
            throw new Error(
              `content ${plan.key} would carry editorialState=${plan.entry.editorial.editorialState} over a payload hashing ${hash ?? "<none>"}, not the accepted ${plan.entry.acceptedReviewedHash}`,
            );
          }
        }
        for (const plan of assessmentPlans) {
          const id = assessmentIdByKey.get(plan.key)!;
          const written = await readAssessmentPayload(tx as never, id);
          const hash = written ? assessmentPayloadHash(written) : null;
          if (hash !== plan.entry.acceptedReviewedHash) {
            throw new Error(
              `assessment ${plan.key} would carry editorialState=${plan.entry.editorial.editorialState} over a bank hashing ${hash ?? "<none>"}, not the accepted ${plan.entry.acceptedReviewedHash}`,
            );
          }
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
              overlaySchemaVersion: overlay.schemaVersion,
              overlayCode: overlay.overlayCode,
              overlayRevision: overlay.overlayRevision,
              overlayFingerprint: validation.fingerprint,
              acceptedReviewedRootHash: overlay.binding.acceptedReviewedRootHash,
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
      { timeout: 600_000, maxWait: 30_000 },
    );
  } catch (error) {
    return {
      ok: false,
      code: "APPLY_FAILED",
      issues: [issue("APPLY_FAILED", "<transaction>", error instanceof Error ? error.message : String(error))],
    };
  }

  notes.push("no publication, binding or flag change was performed by this import");
  notes.push("every approved aggregate was re-read and proven to hash to its accepted reviewed value");

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
