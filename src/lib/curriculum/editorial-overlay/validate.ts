/**
 * PHASE-G2 TRANSPORT — overlay validation, entirely offline.
 *
 * This runs BEFORE any database is opened. A malformed or internally inconsistent
 * overlay must be rejected without a connection, a transaction or a single row
 * read, so that "the artifact is wrong" and "the target is wrong" stay two
 * separately diagnosable failures.
 *
 * WHAT IT CHECKS BEYOND THE ZOD SHAPE. Shape validation proves the fields exist
 * and have the right types. It cannot prove the overlay is COHERENT — that every
 * key is unique, every cross-reference resolves inside the artifact, every
 * approval carries the evidence its state requires, and no successor claims an
 * ancestor the overlay never describes.
 *
 * v2 adds the check that matters most: EVERY DECLARED HASH IS RECOMPUTED FROM THE
 * PAYLOAD IT CLAIMS TO DESCRIBE. An `acceptedReviewedHash` that does not match the
 * bytes sitting next to it in the same file would let an artifact promise one
 * reviewed state and deliver another, and the importer's whole three-way rule is
 * built on trusting that hash. So the artifact is made to prove it about itself
 * before any target is consulted.
 *
 * ISSUES, NOT EXCEPTIONS. Validation collects every problem it can see and returns
 * them together. An operator fixing an exporter wants the whole list, not the
 * first line of it.
 */
import {
  authorityKey,
  editorialOverlaySchema,
  questionKey,
  REJECTED_OVERLAY_SCHEMA_VERSIONS,
  versionKey,
  type EditorialOverlay,
  type OverlayEditorialEvidence,
} from "@/lib/curriculum/editorial-overlay/schema";
import {
  assessmentPayloadOf,
  calculateAcceptedReviewedRootHash,
  calculateNoteIdentity,
  calculateOverlayFingerprint,
  contentPayloadOf,
} from "@/lib/curriculum/editorial-overlay/fingerprint";
import {
  assessmentPayloadHash,
  contentPayloadHash,
} from "@/lib/curriculum/editorial-overlay/payload";

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
  // An overlay from the superseded format is named and refused, rather than
  // failing as an unrecognisable shape. v1 asserted approval without asserting
  // content; reading one under v2's rules would mean assuming its silence about
  // the payload meant "unchanged", which is the defect being corrected.
  const declaredVersion =
    typeof raw === "object" && raw !== null
      ? (raw as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (typeof declaredVersion === "string" && REJECTED_OVERLAY_SCHEMA_VERSIONS.includes(declaredVersion)) {
    return {
      ok: false,
      issues: [
        issue(
          "OVERLAY_SCHEMA_SUPERSEDED",
          "schemaVersion",
          `${declaredVersion} carried approval evidence without the reviewed payload it approves and is refused; re-export as an editorial overlay v2`,
        ),
      ],
    };
  }

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

  if (overlay.minImporterVersion > 2) {
    issues.push(
      issue(
        "IMPORTER_TOO_OLD",
        "minImporterVersion",
        `overlay requires importer version ${overlay.minImporterVersion}; this build implements 2`,
      ),
    );
  }

  /* ---------------- levels ---------------- */
  const levelIdentities = new Map<string, (typeof overlay.levels)[number]>();
  const levelNumbers = new Map<number, string>();
  for (const [index, level] of overlay.levels.entries()) {
    if (levelIdentities.has(level.level)) {
      issues.push(issue("DUPLICATE_LEVEL", `levels[${index}]`, `duplicate level ${level.level}`));
    }
    levelIdentities.set(level.level, level);
    // Two codes claiming one levelNumber is the artifact-side form of the swap
    // the target-side preflight exists to catch.
    const already = levelNumbers.get(level.levelNumber);
    if (already && already !== level.level) {
      issues.push(
        issue(
          "DUPLICATE_LEVEL_NUMBER",
          `levels[${index}]`,
          `levelNumber ${level.levelNumber} is claimed by both ${already} and ${level.level}`,
        ),
      );
    }
    levelNumbers.set(level.levelNumber, level.level);
  }
  const requireLevel = (code: string, path: string): void => {
    if (!levelIdentities.has(code)) {
      issues.push(
        issue("LEVEL_NOT_DECLARED", path, `level ${code} is referenced but not declared in levels[]`),
      );
    }
  };

  /* ---------------- principals ---------------- */
  const principals = new Map<string, (typeof overlay.principals)[number]>();
  for (const [index, principal] of overlay.principals.entries()) {
    if (principals.has(principal.ref)) {
      issues.push(issue("DUPLICATE_PRINCIPAL", `principals[${index}]`, `duplicate principal ${principal.ref}`));
    }
    principals.set(principal.ref, principal);
    // Only a process identity may be minted by an import. Creating a lookalike of
    // a human being is never this tool's business.
    if (principal.kind === "human" && principal.provisionIfMissing) {
      issues.push(
        issue(
          "HUMAN_PRINCIPAL_PROVISIONABLE",
          `principals[${index}]`,
          `${principal.ref} is declared a human account and must not be marked provisionable`,
        ),
      );
    }
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
    requireLevel(entry.level, `${path}.level`);
    checkEvidence(entry.editorial, path, issues);
    requirePrincipal(entry.editorial.createdBy, `${path}.createdBy`);
    requirePrincipal(entry.editorial.lastAuthoredBy, `${path}.lastAuthoredBy`);
    requirePrincipal(entry.editorial.submittedBy, `${path}.submittedBy`);
    requirePrincipal(entry.editorial.changesRequestedBy, `${path}.changesRequestedBy`);
    requirePrincipal(entry.editorial.approvedBy, `${path}.approvedBy`);

    // THE v2 CHECK: the declared accepted hash must describe the payload in this
    // very file. Without it the importer would enforce a promise the artifact
    // never actually made.
    const actual = contentPayloadHash(contentPayloadOf(entry));
    if (actual !== entry.acceptedReviewedHash) {
      issues.push(
        issue(
          "ACCEPTED_HASH_MISMATCH",
          `${path}.acceptedReviewedHash`,
          `declared ${entry.acceptedReviewedHash} but the payload in this overlay hashes to ${actual}`,
        ),
      );
    }
    if (entry.expectedStructuralHash === entry.acceptedReviewedHash) {
      warnings.push(
        issue(
          "NO_EDITORIAL_DELTA",
          path,
          "the reviewed payload is identical to the structural baseline for this version",
        ),
      );
    }
    const locales = new Set<string>();
    for (const localization of entry.payload.localizations) {
      if (locales.has(localization.locale)) {
        issues.push(issue("DUPLICATE_LOCALE", `${path}.localizations`, `duplicate locale ${localization.locale}`));
      }
      locales.add(localization.locale);
    }
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
    requireLevel(entry.level, `${path}.level`);
    checkEvidence(entry.editorial, path, issues);
    requirePrincipal(entry.editorial.createdBy, `${path}.createdBy`);
    requirePrincipal(entry.editorial.lastAuthoredBy, `${path}.lastAuthoredBy`);
    requirePrincipal(entry.editorial.submittedBy, `${path}.submittedBy`);
    requirePrincipal(entry.editorial.changesRequestedBy, `${path}.changesRequestedBy`);
    requirePrincipal(entry.editorial.approvedBy, `${path}.approvedBy`);

    const actual = assessmentPayloadHash(assessmentPayloadOf(entry));
    if (actual !== entry.acceptedReviewedHash) {
      issues.push(
        issue(
          "ACCEPTED_HASH_MISMATCH",
          `${path}.acceptedReviewedHash`,
          `declared ${entry.acceptedReviewedHash} but the bank in this overlay hashes to ${actual}`,
        ),
      );
    }
    if (entry.expectedStructuralHash === entry.acceptedReviewedHash) {
      warnings.push(
        issue("NO_EDITORIAL_DELTA", path, "the reviewed bank is identical to the structural baseline"),
      );
    }

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
      const locales = new Set<string>();
      for (const localization of question.localizations) {
        if (locales.has(localization.locale)) {
          issues.push(
            issue("DUPLICATE_LOCALE", `${path}.questions ${question.stableKey}`, `duplicate locale ${localization.locale}`),
          );
        }
        locales.add(localization.locale);
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

  /* ---------------- the reviewed root ---------------- */
  const expectedRoot = calculateAcceptedReviewedRootHash({
    content: overlay.content,
    assessments: overlay.assessments,
    levels: overlay.levels,
  });
  if (expectedRoot !== overlay.binding.acceptedReviewedRootHash) {
    issues.push(
      issue(
        "REVIEWED_ROOT_MISMATCH",
        "binding.acceptedReviewedRootHash",
        `declared ${overlay.binding.acceptedReviewedRootHash} but this overlay's entries produce ${expectedRoot}`,
      ),
    );
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
    requireLevel(video.level, `${path}.level`);
    const declared = levelIdentities.get(video.level);
    if (declared && declared.levelNumber !== video.levelNumber) {
      issues.push(
        issue(
          "VIDEO_LEVEL_NUMBER_MISMATCH",
          `${path}.levelNumber`,
          `video declares levelNumber ${video.levelNumber} but ${video.level} is level ${declared.levelNumber}`,
        ),
      );
    }
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
  const noteSlots = new Set<string>();
  for (const [index, note] of overlay.reviewNotes.entries()) {
    const path = `reviewNotes[${index}]`;
    const slot = `${note.noteIdentity}#${note.ordinal}`;
    if (noteSlots.has(slot)) {
      issues.push(issue("DUPLICATE_NOTE_IDENTITY", path, `duplicate note identity ${slot}`));
    }
    noteSlots.add(slot);
    const expected = calculateNoteIdentity(note);
    if (expected !== note.noteIdentity) {
      issues.push(
        issue("NOTE_IDENTITY_MISMATCH", `${path}.noteIdentity`, "noteIdentity does not match the note's own provenance"),
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
