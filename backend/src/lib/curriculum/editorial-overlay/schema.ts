/**
 * PHASE-G2 TRANSPORT — the Editorial Overlay v2 format.
 *
 * WHAT PROBLEM THIS SOLVES. The accepted CurriculumPackage transports the
 * PRE-EDITORIAL baseline: modules, levels, the content bodies and banks as they
 * stood when the structural file was cut. It has no representation for what a
 * review phase then produces — neither the EDITS the reviewer made nor the
 * EVIDENCE that they made them.
 *
 * WHY v2 AND NOT v1. Overlay v1 carried only the evidence. It assumed the target's
 * structural rows were already the bytes the reviewer approved, and for the
 * accepted corpus that assumption is false: the review phase rewrote 77 of 79
 * content bodies and changed 164 of 236 correct answers after the baseline was
 * cut. A v1 overlay applied to a correctly-imported target therefore produced
 * content marked `approved`, signed by the reviewer, at the reviewer's timestamp —
 * over the pre-review skeleton. `publishContentVersion` then accepted it.
 *
 * That is not a bug that can be fixed inside v1's shape: v1 has nowhere to put the
 * reviewed bytes. So the discriminator moves. `ata.editorial-overlay/1` is refused
 * outright by this build rather than reinterpreted, because silently reading an
 * old artifact under new rules would mean treating "no payload" as "payload
 * unchanged" — the precise mistake being corrected.
 *
 * THREE-WAY, NOT TWO-WAY. Every entry that the structural package also carries
 * declares BOTH hashes:
 *
 *   expectedStructuralHash — what the target must hold if it has had the
 *                            structural import and nothing else;
 *   acceptedReviewedHash   — what the reviewer approved, and what the target must
 *                            hold when the import is finished.
 *
 * The importer then has exactly three answers and no fourth:
 *
 *   target == expectedStructuralHash  → write the reviewed payload;
 *   target == acceptedReviewedHash    → already imported, unchanged;
 *   anything else                     → CONTRADICTION, refuse before any write.
 *
 * There is no "overwrite whatever is there". A target holding a third state is a
 * fact this import has no authority to erase.
 *
 * EVERY IDENTITY IN HERE IS SEMANTIC. Not one database id is portable between the
 * editorial checkpoint and a live target: their id spaces overlap everywhere,
 * including `User`, where checkpoint id 2 is the reviewer and live id 2 is an
 * unrelated support account. Versions are addressed by
 * `(level stableCode, versionNumber)`, questions by `stableKey`, principals by
 * canonical address, authority decisions by `(assessment, questionIndex, field)` —
 * every one backed by an existing unique index rather than by convention.
 *
 * LEVELS CARRY THEIR STRUCTURAL IDENTITY. A stableCode is only a name. `levels`
 * binds each code to the levelNumber, module and type the package gives it, so a
 * target where two levels have swapped codes — same set, wrong rows — fails
 * preflight instead of receiving one level's approval on another's content.
 *
 * STRICTNESS IS DELIBERATE. `z.strictObject` throughout: an unknown field in an
 * artifact that carries approval evidence is a hard error, never a silent drop.
 *
 * NO SECRETS. No password hash, no token, no credential of any kind travels in an
 * overlay. Principals are described by address, role and KIND; authentication
 * material is never read from the source and never written to the artifact.
 *
 * `updatedAt` IS DELIBERATELY ABSENT — Prisma's `@updatedAt` owns it and it records
 * when a row was last written IN THIS DATABASE. So are `status`/`publishedAt`/
 * `archivedAt` for versions the package already carries: PUBLICATION is the
 * target's own lifecycle and this transport never touches it.
 *
 * Everything that is HISTORY is carried, including the version's own `createdAt`.
 * A structural import stamps the instant it ran, so an imported version would
 * otherwise read as created today and submitted for review a week earlier — a
 * chronology that is not untidy but false. See `editorial-overlay/payload.ts` for
 * the full statement of what the reviewed hash covers and why `createdAt` sits
 * outside it: it is history, but it is not reviewed CONTENT.
 */
import { z } from "zod";

export const EDITORIAL_OVERLAY_SCHEMA_VERSION = "ata.editorial-overlay/2" as const;
export const EDITORIAL_OVERLAY_IMPORTER_VERSION = 2 as const;

/**
 * Refused by name, so the failure says why rather than reading as a shape error.
 * v1 is not a subset of v2: it asserts approval without asserting content.
 */
export const REJECTED_OVERLAY_SCHEMA_VERSIONS: readonly string[] = ["ata.editorial-overlay/1"];

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
 * `update` targets a row the structural import already created — so it declares
 * the baseline that row must be in.
 * `create` is for a version the package does not carry — an editorial successor
 * authored after the structural baseline was cut — so there is no baseline to
 * expect and the row's creation facts travel with it.
 */
const applyMode = z.enum(["update", "create"]);

/**
 * PUBLICATION facts, carried only when the overlay itself creates the row.
 *
 * They are absent for `update` on purpose: publication is the target's own
 * lifecycle, this transport never touches it, and an operator publishes content
 * AFTER the import. Carrying them would either fight that or make a replay fail
 * the moment it happened.
 */
const creationSchema = z.strictObject({
  status: z.enum(["draft", "published", "archived"]),
  publishedAt: isoTimestamp.nullable(),
  archivedAt: isoTimestamp.nullable(),
});

/* ------------------------------------------------------------------ *
 * level structural identity
 * ------------------------------------------------------------------ */

/**
 * What the package says a level IS, not merely what it is called.
 *
 * Checked against the target before anything is written. A target whose level
 * codes are individually present but attached to the wrong rows — the swap that
 * the previous format accepted — fails here.
 */
const levelIdentitySchema = z.strictObject({
  level: stableCode,
  levelNumber: z.number().int().min(1),
  moduleCode: z.string().trim().min(1).max(120),
  moduleNumber: z.number().int().min(1),
  type: z.string().trim().min(1).max(40),
});
export type OverlayLevelIdentity = z.infer<typeof levelIdentitySchema>;

/* ------------------------------------------------------------------ *
 * content
 * ------------------------------------------------------------------ */

const contentLocalizationSchema = z.strictObject({
  locale: z.string().trim().min(2).max(35),
  title: z.string(),
  subtitle: z.string(),
  learningObjectiveExtension: z.string(),
  summary: z.string(),
  transcript: z.string().nullable(),
  body: z.unknown(),
});

/** The reviewed learner payload. Always present — this is the correction. */
const contentPayloadSchema = z.strictObject({
  videoDurationSeconds: z.number().int().positive().nullable(),
  changeNotes: z.string().nullable(),
  localizations: z.array(contentLocalizationSchema).min(1),
});

const contentEntrySchema = z
  .strictObject({
    level: stableCode,
    versionNumber,
    mode: applyMode,
    editorial: editorialEvidenceSchema,
    /** Null only for `create`: there is no package row to have a baseline. */
    expectedStructuralHash: sha256.nullable(),
    /** What the target must hash to when this import is done. */
    acceptedReviewedHash: sha256,
    /**
     * When this VERSION came into being, in the editorial history.
     *
     * Carried for `update` as well as `create`. A structural import stamps the
     * instant it ran, so without this a transported version reads as created
     * today and submitted for review a week ago — a chronology that is not merely
     * untidy but false. It is history, exactly like `submittedAt`, and it is not
     * part of the reviewed payload hash because it is not reviewed content.
     */
    createdAt: isoTimestamp,
    payload: contentPayloadSchema,
    creation: creationSchema.nullable(),
  })
  .refine((entry) => (entry.mode === "create") === (entry.creation !== null), {
    message: "mode=create requires creation facts and mode=update forbids them",
    path: ["creation"],
  })
  .refine((entry) => (entry.mode === "update") === (entry.expectedStructuralHash !== null), {
    message: "mode=update requires an expectedStructuralHash and mode=create forbids one",
    path: ["expectedStructuralHash"],
  });

/* ------------------------------------------------------------------ *
 * assessment
 * ------------------------------------------------------------------ */

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
  /** Row bookkeeping, used only when the overlay creates the question. */
  createdAt: isoTimestamp,
  localizations: z.array(questionLocalizationSchema),
});

/** The reviewed bank. Always present — this is the correction. */
const assessmentPayloadSchema = z.strictObject({
  passPercent: z.number().int().min(1).max(100),
  maxAttempts: z.number().int().positive().nullable(),
  showExplanation: z.boolean(),
  changeNotes: z.string().nullable(),
  questions: z.array(questionSchema).min(1),
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
    expectedStructuralHash: sha256.nullable(),
    acceptedReviewedHash: sha256,
    /** See the content entry: version creation is history, not bookkeeping. */
    createdAt: isoTimestamp,
    payload: assessmentPayloadSchema,
    creation: creationSchema.nullable(),
  })
  .refine((entry) => (entry.mode === "create") === (entry.creation !== null), {
    message: "mode=create requires creation facts and mode=update forbids them",
    path: ["creation"],
  })
  .refine((entry) => (entry.mode === "update") === (entry.expectedStructuralHash !== null), {
    message: "mode=update requires an expectedStructuralHash and mode=create forbids one",
    path: ["expectedStructuralHash"],
  })
  .refine(
    (entry) => entry.predecessor === null || entry.predecessor.level === entry.level,
    {
      message: "an assessment predecessor must belong to the same level",
      path: ["predecessor"],
    },
  );

/* ------------------------------------------------------------------ *
 * video production
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * source authority
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * review notes
 * ------------------------------------------------------------------ */

/**
 * A review note.
 *
 * `EditorialReviewNote` has no unique index, so replay cannot be made idempotent
 * by natural key. v1 hashed the note's own BODY into its key, which made a
 * target note with the same identity but a different body look like a different
 * note — so a replay silently wrote a second one instead of reporting a
 * contradiction.
 *
 * v2 splits the two questions. `noteIdentity` is WHICH note: target, revision,
 * path, author, instant, and an ordinal that only moves when a single author
 * really did write two notes at the same millisecond on the same target. The
 * body is then COMPARED against the note carrying that identity — equal is
 * `unchanged`, different is a contradiction, and neither creates a duplicate.
 */
const reviewNoteSchema = z.strictObject({
  noteIdentity: sha256,
  target: z.strictObject({
    kind: z.enum(["content", "assessment", "video"]),
    level: stableCode,
    versionNumber,
  }),
  targetRevision: revision,
  path: z.string().nullable(),
  /** Disambiguates notes identical on every other identity axis. */
  ordinal: z.number().int().min(0),
  body: z.string().trim().min(1).max(4000),
  author: principalRef,
  createdAt: isoTimestamp,
  resolvedAt: isoTimestamp.nullable(),
  resolvedBy: principalRef.nullable(),
});

/* ------------------------------------------------------------------ *
 * principals
 * ------------------------------------------------------------------ */

/**
 * A principal the overlay's evidence refers to.
 *
 * `kind` is DECLARED, not inferred. A historical `process` identity is a named
 * role in a review that must never be able to act: matching one against an
 * existing account requires that account to be non-loginable, and provisioning
 * one creates it blocked. Inferring that from an address suffix would mean the
 * safety property depended on a naming convention an artifact could simply not
 * follow.
 *
 * `provisionIfMissing` is how an overlay declares that an identity may be created
 * in the target when it is absent. It is scoped to the addresses named here and to
 * nothing else: an importer may never invent a principal an overlay did not
 * declare, and may never substitute a different account — not the operator, not an
 * admin, not a live user whose integer id happens to collide.
 */
const principalSchema = z.strictObject({
  ref: principalRef,
  displayName: z.string().trim().min(1).max(200),
  kind: z.enum(["process", "human"]),
  role: z.enum(["user", "mentor", "support", "admin"]),
  staffRole: z.string().trim().min(1).max(64).nullable(),
  provisionIfMissing: z.boolean(),
});

/* ------------------------------------------------------------------ *
 * binding
 * ------------------------------------------------------------------ */

/**
 * What this overlay may be applied to.
 *
 * Every field is checked before the transaction opens. The point is that a
 * VALID overlay pointed at the WRONG database fails just as loudly as a
 * malformed one: identity of the file and identity of the contents are separate
 * questions and both get asked.
 *
 * `acceptedReviewedRootHash` is the v2 addition: one digest over every
 * per-entity accepted hash, so the root of the artifact commits to the reviewed
 * bytes and not merely to the paperwork about them.
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
  acceptedReviewedRootHash: sha256,
});

export const editorialOverlaySchema = z.strictObject({
  schemaVersion: z.literal(EDITORIAL_OVERLAY_SCHEMA_VERSION),
  minImporterVersion: z.number().int().positive(),
  overlayCode: z.string().trim().min(1).max(120),
  overlayRevision: z.number().int().positive(),
  /** Evidence only. Never part of identity, matching or idempotency. */
  generatedAt: isoTimestamp,
  binding: bindingSchema,
  levels: z.array(levelIdentitySchema).min(1),
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
export type OverlayQuestion = z.infer<typeof questionSchema>;
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
