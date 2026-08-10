/**
 * PHASE-G2 TRANSPORT — the Editorial Overlay v1 format.
 *
 * WHAT PROBLEM THIS SOLVES. The accepted CurriculumPackage transports STRUCTURE:
 * modules, levels, content bodies, assessment banks, questions and the binding
 * baseline. It has no representation for the EDITORIAL layer that a review phase
 * produces — who authored a version, who approved it and when, which video
 * contracts were signed off, which competing sources a human adjudicated, and
 * which review notes are still open. Importing the package therefore reproduces
 * the pre-review baseline exactly and leaves every candidate `editorialState =
 * 'draft'`, which `publishContentVersion` refuses.
 *
 * An overlay carries that missing layer and nothing else. It is applied AFTER a
 * structural import, onto the curriculum that import created.
 *
 * WHY A SEPARATE FORMAT AND NOT MORE PACKAGE FIELDS. The package's
 * `contentFingerprint` is the anchor proving a target's structure came from a
 * specific reviewed file. Extending the package schema changes that fingerprint
 * and invalidates every artifact, validator and roundtrip test that depends on
 * it. Two formats, each with one job, keeps the proven half untouched.
 *
 * EVERY IDENTITY IN HERE IS SEMANTIC. Not one database id is portable between
 * the editorial checkpoint and a live target: their id spaces overlap
 * everywhere, including `User`, where checkpoint id 2 is the reviewer and live id
 * 2 is an unrelated support account. Reusing raw ids would attribute a human's
 * approvals to a stranger. So versions are addressed by
 * `(level stableCode, versionNumber)`, questions by `stableKey`, principals by
 * canonical address, and authority decisions by
 * `(assessment, questionIndex, field)` — every one of which is backed by an
 * existing unique index rather than by convention.
 *
 * STRICTNESS IS DELIBERATE. `z.strictObject` throughout: an unknown field in an
 * artifact that carries approval evidence is a hard error, never a silent drop.
 *
 * NO SECRETS. No password hash, no token, no credential of any kind travels in
 * an overlay. Principals are described by address and role; authentication
 * material is never read from the source and never written to the artifact.
 *
 * `updatedAt` IS DELIBERATELY ABSENT. Every transported model declares it
 * `@updatedAt`, which means the ORM owns it: it records when a row was last
 * written IN THIS DATABASE. After an import that genuinely is now, and carrying
 * the source's value would assert that a row nobody has touched here was last
 * written elsewhere. `createdAt` and the editorial instants — `lastAuthoredAt`,
 * `submittedAt`, `approvedAt`, `decidedAt`, note `createdAt` — are history and
 * ARE carried; `updatedAt` is storage bookkeeping and is not.
 */
import { z } from "zod";

export const EDITORIAL_OVERLAY_SCHEMA_VERSION = "ata.editorial-overlay/1" as const;
export const EDITORIAL_OVERLAY_IMPORTER_VERSION = 1 as const;

const sha256 = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest");

const gitObjectId = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "expected a 40-character git object id");

/** ISO-8601 with an explicit offset. Historical evidence, never re-stamped. */
const isoTimestamp = z
  .string()
  .datetime({ offset: true })
  .describe("historical evidence timestamp — preserved verbatim, never set to import time");

const stableCode = z.string().trim().min(1).max(120);
const versionNumber = z.number().int().positive();
const revision = z.number().int().positive();

/**
 * A canonical principal address.
 *
 * The editorial principals are process identities, not mailboxes: the accepted
 * corpus uses `.invalid`, which RFC 2606/6761 reserves as guaranteed
 * non-resolvable. The address is a STABLE NAME for a role in a review, and that
 * is precisely what makes it safe to carry across databases.
 */
const principalRef = z.string().trim().min(3).max(320).toLowerCase();

/** The editorial lifecycle vocabulary the accepted domain enforces. */
export const OVERLAY_EDITORIAL_STATES = [
  "draft",
  "submitted_for_review",
  "changes_requested",
  "approved",
] as const;

/**
 * Four-eyes evidence for one aggregate.
 *
 * Every actor is an address and every timestamp is the original one. An importer
 * that wrote `approvedAt = now()` would be claiming a review happened today, and
 * one that wrote the operator's own id would be claiming they performed it. Both
 * are the manufactured evidence the whole model exists to prevent, so both are
 * unrepresentable here: there is no field for "current actor" and no field for
 * "import time".
 */
const editorialEvidenceSchema = z.strictObject({
  editorialState: z.enum(OVERLAY_EDITORIAL_STATES),
  revision,
  createdBy: principalRef.nullable(),
  lastAuthoredBy: principalRef.nullable(),
  lastAuthoredAt: isoTimestamp.nullable(),
  submittedBy: principalRef.nullable(),
  submittedAt: isoTimestamp.nullable(),
  changesRequestedBy: principalRef.nullable(),
  changesRequestedAt: isoTimestamp.nullable(),
  approvedBy: principalRef.nullable(),
  approvedAt: isoTimestamp.nullable(),
});
export type OverlayEditorialEvidence = z.infer<typeof editorialEvidenceSchema>;

/** Addresses one version of one aggregate, without touching a database id. */
const versionRefSchema = z.strictObject({
  level: stableCode,
  versionNumber,
});
export type OverlayVersionRef = z.infer<typeof versionRefSchema>;

/**
 * `update` targets a row the structural import already created.
 * `create` is for a version the package does not carry — an editorial successor
 * authored after the structural baseline was cut. The distinction is declared
 * rather than inferred so an importer never invents a row because a lookup
 * happened to miss.
 */
const applyMode = z.enum(["update", "create"]);

const contentLocalizationSchema = z.strictObject({
  locale: z.string().trim().min(2).max(35),
  title: z.string(),
  subtitle: z.string(),
  learningObjectiveExtension: z.string(),
  summary: z.string(),
  transcript: z.string().nullable(),
  body: z.unknown(),
});

const contentEntrySchema = z
  .strictObject({
    level: stableCode,
    versionNumber,
    mode: applyMode,
    editorial: editorialEvidenceSchema,
    /** Only for `create`: the payload the structural package never carried. */
    payload: z
      .strictObject({
        status: z.enum(["draft", "published", "archived"]),
        videoDurationSeconds: z.number().int().positive().nullable(),
        changeNotes: z.string().nullable(),
        createdAt: isoTimestamp,
        publishedAt: isoTimestamp.nullable(),
        archivedAt: isoTimestamp.nullable(),
        localizations: z.array(contentLocalizationSchema).min(1),
      })
      .nullable(),
  })
  .refine((entry) => (entry.mode === "create") === (entry.payload !== null), {
    message: "mode=create requires a payload and mode=update forbids one",
    path: ["payload"],
  });

const questionLocalizationSchema = z.strictObject({
  locale: z.string().trim().min(2).max(35),
  prompt: z.string(),
  optionLabels: z.unknown().nullable(),
  explanation: z.string().nullable(),
});

const questionSchema = z.strictObject({
  stableKey: z.string().trim().min(1).max(64),
  questionNumber: z.number().int().positive(),
  type: z.string().trim().min(1).max(40),
  skillTag: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
  options: z.unknown().nullable(),
  correctAnswer: z.unknown(),
  createdAt: isoTimestamp,
  localizations: z.array(questionLocalizationSchema),
});

const assessmentEntrySchema = z
  .strictObject({
    level: stableCode,
    versionNumber,
    mode: applyMode,
    editorial: editorialEvidenceSchema,
    /**
     * The successor's ancestor, as an explicit tuple.
     *
     * Deliberately NOT `versionNumber - 1`. That arithmetic is true of the
     * accepted corpus but it is a property of this data, not a rule of the
     * domain, and an importer that assumed it would silently invent a lineage
     * the moment a level ever skipped a version. The overlay states the
     * ancestor; the importer resolves what it is told.
     */
    predecessor: versionRefSchema.nullable(),
    payload: z
      .strictObject({
        status: z.enum(["draft", "published", "archived"]),
        passPercent: z.number().int().min(1).max(100),
        maxAttempts: z.number().int().positive().nullable(),
        showExplanation: z.boolean(),
        changeNotes: z.string().nullable(),
        createdAt: isoTimestamp,
        publishedAt: isoTimestamp.nullable(),
        archivedAt: isoTimestamp.nullable(),
        questions: z.array(questionSchema).min(1),
      })
      .nullable(),
  })
  .refine((entry) => (entry.mode === "create") === (entry.payload !== null), {
    message: "mode=create requires a payload and mode=update forbids one",
    path: ["payload"],
  })
  .refine(
    (entry) => entry.predecessor === null || entry.predecessor.level === entry.level,
    {
      message: "an assessment predecessor must belong to the same level",
      path: ["predecessor"],
    },
  );

/**
 * A video production contract as the reviewer approved it.
 *
 * `videoState` and `qaState` are transported exactly as the checkpoint holds
 * them. The accepted corpus is `NOT_RECORDED` / `QA_PENDING` on all 58, because
 * no asset has been recorded and no QA has run. Writing anything else would be
 * fabricated production evidence, so the importer copies and never derives.
 */
const videoProductionSchema = z.strictObject({
  level: stableCode,
  versionNumber,
  levelNumber: z.number().int().min(1).max(100),
  revision,
  editorialState: z.enum(OVERLAY_EDITORIAL_STATES),
  contractVersion: z.number().int().positive(),
  sourceProvenance: z.enum(["SOURCE_BACKED", "PROPOSED_CANON"]),
  scriptState: z.enum(["SCRIPT_PENDING", "SCRIPT_READY"]),
  videoState: z.enum(["NOT_RECORDED", "VIDEO_RECORDED"]),
  qaState: z.enum(["QA_PENDING", "QA_PASSED", "QA_FAILED"]),
  contractPayload: z.unknown(),
  contractFingerprint: sha256,
  assessmentFingerprint: sha256,
  productionEvidenceStale: z.boolean(),
  createdAt: isoTimestamp,
  evidence: editorialEvidenceSchema.omit({ editorialState: true, revision: true }),
});

/**
 * The durable video-to-bank link.
 *
 * One link per video production, and the assessment end is whatever the
 * checkpoint recorded — which is NOT always the level's latest bank. In the
 * accepted corpus L2's video links to assessment v1, the PREDECESSOR, and the
 * approved successor derives its source through lineage instead. Rewriting that
 * to point at the successor would look tidier and would destroy the evidence
 * that `linkOrigin = "lineage"` exists to express.
 */
const videoAssessmentLinkSchema = z.strictObject({
  video: versionRefSchema,
  assessment: versionRefSchema,
  assessmentRevision: revision,
  assessmentBankFingerprint: sha256,
  linkedBy: principalRef.nullable(),
  linkedAt: isoTimestamp,
});

/**
 * One historical adjudication.
 *
 * This is evidence transfer, not adjudication. Every field below is the value a
 * named human recorded at a named time against two exact hashes; the importer
 * writes them verbatim and never calls the adjudication command, which would
 * stamp a fresh actor, a fresh timestamp and a fresh batch and thereby claim the
 * decision was made during an import.
 *
 * What is NOT here: `application` (APPLIED / STALE / DECIDED_NOT_APPLIED),
 * `inherited`, `inheritanceDepth`. Those are recomputed by the accepted domain
 * from these hashes against the target's live values. Transporting a conclusion
 * the domain derives would let an overlay assert a decision is in force when the
 * bank no longer serves the value that won.
 */
const sourceAuthoritySchema = z.strictObject({
  assessment: versionRefSchema,
  video: versionRefSchema,
  level: stableCode,
  questionIndex: z.number().int().min(0),
  field: z.enum(["prompt", "correctAnswerText"]),
  conflictPath: z.string().trim().min(1).max(400),
  decision: z.enum(["CURRENT", "BLUEPRINT"]),
  currentValueHash: sha256,
  blueprintValueHash: sha256,
  blueprintSourceDocumentSha256: sha256,
  contractFingerprintAtDecision: sha256,
  bankFingerprintAtDecision: sha256,
  assessmentRevisionAtDecision: revision,
  rationale: z.string().trim().min(1),
  evidenceRef: z.string().trim().min(1),
  evidenceSha256: sha256,
  batchId: z.string().trim().min(1).max(200),
  decidedBy: principalRef,
  decidedAt: isoTimestamp,
  createdAt: isoTimestamp,
  supersededAt: isoTimestamp.nullable(),
  supersededBy: principalRef.nullable(),
});

/**
 * A review note.
 *
 * `EditorialReviewNote` has no unique index, so replay cannot be made idempotent
 * by natural key. `noteKey` is the overlay's own deterministic identity — a hash
 * over target, revision, author, timestamp and body — and it is what lets a
 * second apply recognise a note it already wrote instead of duplicating it.
 */
const reviewNoteSchema = z.strictObject({
  noteKey: sha256,
  target: z.strictObject({
    kind: z.enum(["content", "assessment", "video"]),
    level: stableCode,
    versionNumber,
  }),
  targetRevision: revision,
  path: z.string().nullable(),
  body: z.string().trim().min(1).max(4000),
  author: principalRef,
  createdAt: isoTimestamp,
  resolvedAt: isoTimestamp.nullable(),
  resolvedBy: principalRef.nullable(),
});

/**
 * A principal the overlay's evidence refers to.
 *
 * `provisionIfMissing` is how an overlay declares that an identity may be
 * created in the target when it is absent. It is scoped to the addresses named
 * here and to nothing else: an importer may never invent a principal an overlay
 * did not declare, and may never substitute a different account — not the
 * operator, not an admin, not a live user whose integer id happens to collide.
 */
const principalSchema = z.strictObject({
  ref: principalRef,
  displayName: z.string().trim().min(1).max(200),
  role: z.enum(["user", "mentor", "support", "admin"]),
  staffRole: z.string().trim().min(1).max(64).nullable(),
  provisionIfMissing: z.boolean(),
});

/**
 * What this overlay may be applied to.
 *
 * Every field is checked before the transaction opens. The point is that a
 * VALID overlay pointed at the WRONG database fails just as loudly as a
 * malformed one: identity of the file and identity of the contents are separate
 * questions and both get asked.
 */
const bindingSchema = z.strictObject({
  curriculumCode: z.string().trim().min(1).max(80),
  curriculumVersionNumber: versionNumber,
  structuralPackageCode: z.string().trim().min(1).max(120),
  structuralPackageRevision: z.number().int().positive(),
  structuralPackageFingerprint: sha256,
  sourceCheckpointSha256: sha256,
  sourceBackendCommit: gitObjectId,
  sourceBackendTree: gitObjectId,
  blueprintSourceDocumentSha256: sha256,
});

export const editorialOverlaySchema = z.strictObject({
  schemaVersion: z.literal(EDITORIAL_OVERLAY_SCHEMA_VERSION),
  minImporterVersion: z.number().int().positive(),
  overlayCode: z.string().trim().min(1).max(120),
  overlayRevision: z.number().int().positive(),
  /** Evidence only. Never part of identity, matching or idempotency. */
  generatedAt: isoTimestamp,
  binding: bindingSchema,
  principals: z.array(principalSchema).min(1),
  content: z.array(contentEntrySchema),
  assessments: z.array(assessmentEntrySchema),
  videoProductions: z.array(videoProductionSchema),
  videoAssessmentLinks: z.array(videoAssessmentLinkSchema),
  sourceAuthorityResolutions: z.array(sourceAuthoritySchema),
  reviewNotes: z.array(reviewNoteSchema),
});

export type EditorialOverlay = z.infer<typeof editorialOverlaySchema>;
export type OverlayContentEntry = z.infer<typeof contentEntrySchema>;
export type OverlayAssessmentEntry = z.infer<typeof assessmentEntrySchema>;
export type OverlayVideoProduction = z.infer<typeof videoProductionSchema>;
export type OverlayVideoAssessmentLink = z.infer<typeof videoAssessmentLinkSchema>;
export type OverlaySourceAuthority = z.infer<typeof sourceAuthoritySchema>;
export type OverlayReviewNote = z.infer<typeof reviewNoteSchema>;
export type OverlayPrincipal = z.infer<typeof principalSchema>;

/** The semantic key for a version-addressed row. */
export function versionKey(ref: { level: string; versionNumber: number }): string {
  return `${ref.level}#v${ref.versionNumber}`;
}

/** The semantic key for one question inside one bank. */
export function questionKey(
  assessment: { level: string; versionNumber: number },
  stableKey: string,
): string {
  return `${versionKey(assessment)}#${stableKey}`;
}

/** The semantic key for one adjudicated slot, mirroring the active-slot index. */
export function authorityKey(row: {
  assessment: { level: string; versionNumber: number };
  questionIndex: number;
  field: string;
}): string {
  return `${versionKey(row.assessment)}#q${row.questionIndex}#${row.field}`;
}
