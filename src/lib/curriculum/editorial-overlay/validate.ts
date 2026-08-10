/**
 * PHASE-G2 TRANSPORT — overlay validation, entirely offline.
 *
 * This runs BEFORE any database is opened. A malformed or internally
 * inconsistent overlay must be rejected without a connection, a transaction or a
 * single row read, so that "the artifact is wrong" and "the target is wrong" stay
 * two separately diagnosable failures.
 *
 * WHAT IT CHECKS BEYOND THE ZOD SHAPE. Shape validation proves the fields exist
 * and have the right types. It cannot prove the overlay is COHERENT — that every
 * key is unique, every cross-reference resolves inside the artifact, every
 * approval carries the evidence its state requires, and no successor claims an
 * ancestor the overlay never describes. Those are the checks below, and they are
 * the ones that catch a mis-generated export.
 *
 * ISSUES, NOT EXCEPTIONS. Validation collects every problem it can see and
 * returns them together. An operator fixing an exporter wants the whole list,
 * not the first line of it.
 */
import {
  authorityKey,
  editorialOverlaySchema,
  questionKey,
  versionKey,
  type EditorialOverlay,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import { calculateNoteKey, calculateOverlayFingerprint } from "@/lib/curriculum/editorial-overlay/fingerprint";

export type OverlayIssue = { code: string; path: string; message: string };

export type OverlayValidationResult =
  | { ok: true; overlay: EditorialOverlay; fingerprint: string; warnings: OverlayIssue[] }
  | { ok: false; issues: OverlayIssue[] };

function issue(code: string, path: string, message: string): OverlayIssue {
  return { code, path, message };
}

/**
 * Approval evidence is all-or-nothing, and the domain enforces exactly that on
 * `VideoProductionVersion` with a CHECK constraint. Applying the same rule to
 * every aggregate in the artifact means a defective overlay is caught by the
 * validator rather than by a constraint violation halfway through a transaction.
 */
function checkEvidence(
  evidence: Pick<
    OverlayEditorialEvidence,
    "approvedBy" | "approvedAt" | "submittedBy" | "submittedAt" | "changesRequestedBy" | "changesRequestedAt"
  > & { editorialState?: string },
  path: string,
  issues: OverlayIssue[],
): void {
  const pairs: Array<[string, unknown, unknown]> = [
    ["approved", evidence.approvedBy, evidence.approvedAt],
    ["submitted", evidence.submittedBy, evidence.submittedAt],
    ["changesRequested", evidence.changesRequestedBy, evidence.changesRequestedAt],
  ];
  for (const [name, who, when] of pairs) {
    if ((who === null) !== (when === null)) {
      issues.push(
        issue(
          "EVIDENCE_INCOMPLETE",
          `${path}.${name}`,
          `${name} evidence must name both an actor and a time, or neither`,
        ),
      );
    }
  }
  if (evidence.editorialState === "approved" && (!evidence.approvedBy || !evidence.approvedAt)) {
    issues.push(
      issue(
        "APPROVED_WITHOUT_EVIDENCE",
        `${path}.approved`,
        "an approved version must carry both an approver and an approval time",
      ),
    );
  }
  if (evidence.editorialState !== "approved" && (evidence.approvedBy || evidence.approvedAt)) {
    issues.push(
      issue(
        "APPROVAL_EVIDENCE_WITHOUT_APPROVAL",
        `${path}.approved`,
        `a version in state ${evidence.editorialState} must not carry approval evidence`,
      ),
    );
  }
}

export function validateEditorialOverlay(raw: unknown): OverlayValidationResult {
  const parsed = editorialOverlaySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) =>
        issue("SCHEMA_INVALID", i.path.join(".") || "<root>", i.message),
      ),
    };
  }
  const overlay = parsed.data;
  const issues: OverlayIssue[] = [];
  const warnings: OverlayIssue[] = [];

  if (overlay.minImporterVersion > 1) {
    issues.push(
      issue(
        "IMPORTER_TOO_OLD",
        "minImporterVersion",
        `overlay requires importer version ${overlay.minImporterVersion}; this build implements 1`,
      ),
    );
  }

  /* ---------------- principals ---------------- */
  const principals = new Map<string, (typeof overlay.principals)[number]>();
  for (const [index, principal] of overlay.principals.entries()) {
    if (principals.has(principal.ref)) {
      issues.push(issue("DUPLICATE_PRINCIPAL", `principals[${index}]`, `duplicate principal ${principal.ref}`));
    }
    principals.set(principal.ref, principal);
  }
  const referenced = new Set<string>();
  const requirePrincipal = (ref: string | null, path: string): void => {
    if (ref === null) return;
    referenced.add(ref);
    if (!principals.has(ref)) {
      issues.push(
        issue("UNDECLARED_PRINCIPAL", path, `principal ${ref} is referenced but not declared in principals[]`),
      );
    }
  };

  /* ---------------- content ---------------- */
  const contentKeys = new Set<string>();
  for (const [index, entry] of overlay.content.entries()) {
    const key = versionKey(entry);
    const path = `content[${index}] ${key}`;
    if (contentKeys.has(key)) {
      issues.push(issue("DUPLICATE_SEMANTIC_KEY", path, `duplicate content key ${key}`));
    }
    contentKeys.add(key);
    checkEvidence(entry.editorial, path, issues);
    requirePrincipal(entry.editorial.createdBy, `${path}.createdBy`);
    requirePrincipal(entry.editorial.lastAuthoredBy, `${path}.lastAuthoredBy`);
    requirePrincipal(entry.editorial.submittedBy, `${path}.submittedBy`);
    requirePrincipal(entry.editorial.changesRequestedBy, `${path}.changesRequestedBy`);
    requirePrincipal(entry.editorial.approvedBy, `${path}.approvedBy`);
  }

  /* ---------------- assessments ---------------- */
  const assessmentKeys = new Set<string>();
  for (const [index, entry] of overlay.assessments.entries()) {
    const key = versionKey(entry);
    const path = `assessments[${index}] ${key}`;
    if (assessmentKeys.has(key)) {
      issues.push(issue("DUPLICATE_SEMANTIC_KEY", path, `duplicate assessment key ${key}`));
    }
    assessmentKeys.add(key);
    checkEvidence(entry.editorial, path, issues);
    requirePrincipal(entry.editorial.createdBy, `${path}.createdBy`);
    requirePrincipal(entry.editorial.lastAuthoredBy, `${path}.lastAuthoredBy`);
    requirePrincipal(entry.editorial.submittedBy, `${path}.submittedBy`);
    requirePrincipal(entry.editorial.changesRequestedBy, `${path}.changesRequestedBy`);
    requirePrincipal(entry.editorial.approvedBy, `${path}.approvedBy`);

    if (entry.payload) {
      const qKeys = new Set<string>();
      const qNumbers = new Set<number>();
      for (const question of entry.payload.questions) {
        const qk = questionKey(entry, question.stableKey);
        if (qKeys.has(qk)) {
          issues.push(issue("DUPLICATE_SEMANTIC_KEY", `${path}.questions`, `duplicate question key ${qk}`));
        }
        qKeys.add(qk);
        if (qNumbers.has(question.questionNumber)) {
          issues.push(
            issue(
              "DUPLICATE_QUESTION_NUMBER",
              `${path}.questions`,
              `duplicate questionNumber ${question.questionNumber}`,
            ),
          );
        }
        qNumbers.add(question.questionNumber);
      }
    }
  }
  // predecessors must resolve inside the artifact — a successor may not claim an
  // ancestor the overlay never describes, because the importer would then have
  // to guess which target row was meant.
  for (const [index, entry] of overlay.assessments.entries()) {
    if (!entry.predecessor) continue;
    const key = versionKey(entry.predecessor);
    if (!assessmentKeys.has(key)) {
      issues.push(
        issue(
          "PREDECESSOR_UNRESOLVED",
          `assessments[${index}].predecessor`,
          `predecessor ${key} is not described by this overlay`,
        ),
      );
    }
    if (entry.predecessor.versionNumber >= entry.versionNumber) {
      issues.push(
        issue(
          "PREDECESSOR_NOT_EARLIER",
          `assessments[${index}].predecessor`,
          `predecessor v${entry.predecessor.versionNumber} must precede v${entry.versionNumber}`,
        ),
      );
    }
  }

  /* ---------------- video productions ---------------- */
  const videoKeys = new Set<string>();
  for (const [index, video] of overlay.videoProductions.entries()) {
    const key = versionKey(video);
    const path = `videoProductions[${index}] ${key}`;
    if (videoKeys.has(key)) {
      issues.push(issue("DUPLICATE_SEMANTIC_KEY", path, `duplicate video key ${key}`));
    }
    videoKeys.add(key);
    checkEvidence({ ...video.evidence, editorialState: video.editorialState }, path, issues);
    requirePrincipal(video.evidence.createdBy, `${path}.createdBy`);
    requirePrincipal(video.evidence.lastAuthoredBy, `${path}.lastAuthoredBy`);
    requirePrincipal(video.evidence.submittedBy, `${path}.submittedBy`);
    requirePrincipal(video.evidence.changesRequestedBy, `${path}.changesRequestedBy`);
    requirePrincipal(video.evidence.approvedBy, `${path}.approvedBy`);
    // QA cannot have passed on an asset that was never recorded. This is the one
    // place fabricated production evidence would enter, so it is refused here.
    if (video.videoState === "NOT_RECORDED" && video.qaState !== "QA_PENDING") {
      issues.push(
        issue(
          "IMPOSSIBLE_PRODUCTION_STATE",
          `${path}.qaState`,
          `qaState ${video.qaState} is impossible while videoState is NOT_RECORDED`,
        ),
      );
    }
  }

  /* ---------------- links ---------------- */
  const linkByVideo = new Set<string>();
  for (const [index, link] of overlay.videoAssessmentLinks.entries()) {
    const vKey = versionKey(link.video);
    const path = `videoAssessmentLinks[${index}] ${vKey}`;
    if (linkByVideo.has(vKey)) {
      issues.push(issue("DUPLICATE_LINK", path, `video ${vKey} already has a link (one link per production)`));
    }
    linkByVideo.add(vKey);
    if (!videoKeys.has(vKey)) {
      issues.push(issue("LINK_VIDEO_UNRESOLVED", path, `video ${vKey} is not described by this overlay`));
    }
    if (!assessmentKeys.has(versionKey(link.assessment))) {
      issues.push(
        issue(
          "LINK_ASSESSMENT_UNRESOLVED",
          path,
          `assessment ${versionKey(link.assessment)} is not described by this overlay`,
        ),
      );
    }
    requirePrincipal(link.linkedBy, `${path}.linkedBy`);
  }

  /* ---------------- source authority ---------------- */
  const authorityKeys = new Set<string>();
  for (const [index, row] of overlay.sourceAuthorityResolutions.entries()) {
    const key = authorityKey(row);
    const path = `sourceAuthorityResolutions[${index}] ${key}`;
    // The unique index is partial — one ACTIVE row per slot — so a superseded row
    // may share a slot with its replacement and only active rows must be unique.
    if (row.supersededAt === null) {
      if (authorityKeys.has(key)) {
        issues.push(issue("DUPLICATE_AUTHORITY_SLOT", path, `duplicate active authority slot ${key}`));
      }
      authorityKeys.add(key);
    }
    if (!assessmentKeys.has(versionKey(row.assessment))) {
      issues.push(
        issue("AUTHORITY_ASSESSMENT_UNRESOLVED", path, `assessment ${versionKey(row.assessment)} is not described`),
      );
    }
    if (!videoKeys.has(versionKey(row.video))) {
      issues.push(issue("AUTHORITY_VIDEO_UNRESOLVED", path, `video ${versionKey(row.video)} is not described`));
    }
    if (row.assessment.level !== row.level) {
      issues.push(issue("AUTHORITY_LEVEL_MISMATCH", path, "level must match the adjudicated assessment's level"));
    }
    if ((row.supersededAt === null) !== (row.supersededBy === null)) {
      issues.push(issue("EVIDENCE_INCOMPLETE", `${path}.superseded`, "supersession evidence is all-or-nothing"));
    }
    if (row.currentValueHash === row.blueprintValueHash) {
      warnings.push(
        issue(
          "AUTHORITY_NO_CONFLICT",
          path,
          "the two adjudicated values hash identically, so there was no conflict to decide",
        ),
      );
    }
    requirePrincipal(row.decidedBy, `${path}.decidedBy`);
    requirePrincipal(row.supersededBy, `${path}.supersededBy`);
    if (row.blueprintSourceDocumentSha256 !== overlay.binding.blueprintSourceDocumentSha256) {
      issues.push(
        issue(
          "AUTHORITY_SOURCE_DOCUMENT_MISMATCH",
          `${path}.blueprintSourceDocumentSha256`,
          "decision names a Blueprint document the overlay binding does not declare",
        ),
      );
    }
  }

  /* ---------------- review notes ---------------- */
  const noteKeys = new Set<string>();
  for (const [index, note] of overlay.reviewNotes.entries()) {
    const path = `reviewNotes[${index}]`;
    if (noteKeys.has(note.noteKey)) {
      issues.push(issue("DUPLICATE_NOTE_KEY", path, `duplicate noteKey ${note.noteKey}`));
    }
    noteKeys.add(note.noteKey);
    const expected = calculateNoteKey(note);
    if (expected !== note.noteKey) {
      issues.push(
        issue("NOTE_KEY_MISMATCH", `${path}.noteKey`, "noteKey does not match the note's own content"),
      );
    }
    const target = versionKey(note.target);
    const known =
      note.target.kind === "content"
        ? contentKeys.has(target)
        : note.target.kind === "assessment"
          ? assessmentKeys.has(target)
          : videoKeys.has(target);
    if (!known) {
      issues.push(
        issue("NOTE_TARGET_UNRESOLVED", path, `${note.target.kind} ${target} is not described by this overlay`),
      );
    }
    if ((note.resolvedAt === null) !== (note.resolvedBy === null)) {
      issues.push(issue("EVIDENCE_INCOMPLETE", `${path}.resolved`, "resolution evidence is all-or-nothing"));
    }
    requirePrincipal(note.author, `${path}.author`);
    requirePrincipal(note.resolvedBy, `${path}.resolvedBy`);
  }

  /* ---------------- declared but unused principals ---------------- */
  for (const ref of principals.keys()) {
    if (!referenced.has(ref)) {
      warnings.push(
        issue(
          "PRINCIPAL_UNUSED",
          `principals ${ref}`,
          "declared principal is not referenced by any evidence in this overlay",
        ),
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, overlay, fingerprint: calculateOverlayFingerprint(overlay), warnings };
}
