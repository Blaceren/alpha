/**
 * PHASE-C CORRECTIONS — the VIDEO+TEST PRODUCTION CONTRACT, first-class.
 *
 * ============================== WHY THIS EXISTS ==============================
 * Phase C shipped a correct 100-level STRUCTURE and a correct learner CONTENT
 * model, and had nowhere to put the thing editorial production actually works
 * from: the per-lesson contract that binds a video to its test. The independent
 * audit blocked the candidate for exactly that — the product's 58 × 4 = 232
 * take/question relationships were neither present as data nor representable as
 * schema, and 57 proposed question banks were recorded as `MISSING`, which
 * asserts they do not exist.
 *
 * This module is the missing domain. It is NOT learner content, and it is NOT
 * curriculum structure:
 *
 *   product-ata-100.ts      WHICH levels exist          (structure)
 *   content-blocks.ts       WHAT a learner reads        (learner content)
 *   THIS FILE               WHAT must be said on camera and what the test may
 *                           therefore ask                (production contract)
 *
 * ======================= THE CONTRACT, IN THE SOURCE'S OWN WORDS =======================
 * From the Blueprint, §1 «Контракт "видео ↔ тест"»:
 *   • Каждый урок содержит четыре тестируемых тейка T{level}.1–T{level}.4.
 *   • Каждый вопрос проверяет ровно один тейк и не требует знания, которого нет
 *     в соответствующем видео.
 *   • При изменении правильного ответа редактор обязан обновить видео/сценарий;
 *     при изменении видео — повторно проверить тест.
 *
 * The third bullet is a VERSIONING requirement, and prose cannot enforce it.
 * `contractFingerprint` and `assessmentFingerprint` below turn it into data:
 * production evidence records WHICH fingerprint it reviewed, so a contract that
 * has moved underneath a recorded video is detectable rather than remembered.
 *
 * ===================== THREE AXES, NOT ONE LIFECYCLE ENUM =====================
 * The audit's §4 finding was that one enum (`MISSING | CONFLICTING`) was being
 * asked to express provenance, approval and production at once, so «proposed but
 * awaiting approval» came out as «missing». These are three independent facts
 * about the same lesson and they move at different times, so they are three
 * fields:
 *
 *   sourceProvenance   where the material CAME FROM     (SOURCE_BACKED | PROPOSED_CANON)
 *   approval           whether product/compliance SIGNED it
 *   production         script → video → QA
 *
 * L18 is the case that proves the split is necessary: it is SOURCE_BACKED (its
 * questions already exist, authored, in the Academy source) AND still
 * AWAITING_APPROVAL as a platform assessment AND NOT_RECORDED. A single enum
 * would have to lie about two of those three.
 *
 * PLATFORM_IMPORTED is deliberately absent: whether a bank reached the database
 * is runtime state that a source artifact cannot know. Asking this file would
 * get a confident wrong answer, so the metric reports UNKNOWN instead.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { optionalSafeText, safeText } from "@/lib/curriculum/content-safe-text";

/* ------------------------------------------------------------------ *
 * The three state axes
 * ------------------------------------------------------------------ */

/**
 * WHERE THE MATERIAL CAME FROM. Never changes as a result of review — only as a
 * result of the source changing.
 *
 * SOURCE_BACKED   already exists as authored content in an accepted upstream
 *                 source; the Blueprint reproduces it rather than proposing it.
 * PROPOSED_CANON  written for the Blueprint, production-ready as a proposal,
 *                 and explicitly NOT yet platform truth.
 *
 * «Proposed» is not «missing» and this enum is the reason the distinction now
 * survives into the package.
 */
export const CONTRACT_SOURCE_PROVENANCE = ["SOURCE_BACKED", "PROPOSED_CANON"] as const;
export type ContractSourceProvenance = (typeof CONTRACT_SOURCE_PROVENANCE)[number];

/** WHETHER PRODUCT/COMPLIANCE HAS SIGNED IT. Orthogonal to provenance. */
export const CONTRACT_APPROVAL_STATE = ["AWAITING_APPROVAL", "APPROVED"] as const;
export type ContractApprovalState = (typeof CONTRACT_APPROVAL_STATE)[number];

export const SCRIPT_STATE = ["SCRIPT_PENDING", "SCRIPT_READY"] as const;
export type ScriptState = (typeof SCRIPT_STATE)[number];

export const VIDEO_STATE = ["NOT_RECORDED", "VIDEO_RECORDED"] as const;
export type VideoState = (typeof VIDEO_STATE)[number];

export const QA_STATE = ["QA_PENDING", "QA_PASSED", "QA_FAILED"] as const;
export type QaState = (typeof QA_STATE)[number];

/* ------------------------------------------------------------------ *
 * Stable section identity — §22
 * ------------------------------------------------------------------ */

/**
 * The CLOSED section vocabulary for a video+test lesson.
 *
 * THE PROBLEM THIS SOLVES. `UserLessonProgress.completedSections` stores section
 * CODES, and they are durable learner state. Phase C generated codes from
 * whichever brief slots happened to be populated (`hook`, `soderzhanie`,
 * `glavnaya-mysl`, `zadanie`), which meant that the moment a real script
 * replaced a draft body, the anchor vocabulary would change under any learner
 * who had already read it. No package has been imported yet, so this is the
 * cheap moment to freeze it.
 *
 * THE FIX. The five codes below come from the Blueprint's own «Единый формат
 * ролика» — the recording structure every one of the 58 videos follows. They are
 * therefore the sections a FINAL script will have, not the sections a draft
 * happens to have, so a draft anchor survives authoring instead of being
 * replaced by it.
 *
 * A generated draft emits only the sections it has real material for; it never
 * invents one to fill the list. What it may not do is invent a code OUTSIDE this
 * list, which is what the ATA video profile enforces.
 */
export const VIDEO_LESSON_SECTION_CODES = [
  /** 0:00–0:20 — the hook. */
  "hook",
  /** 0:20–1:20 — definition and bounds of the concept. */
  "opredelenie",
  /** 1:20–4:30 — the four testable takes. */
  "teyki",
  /** 4:30–6:30 — correct vs mistaken scenario. */
  "stsenarii",
  /** Final — recap of the four takes. */
  "itog",
] as const;
export type VideoLessonSectionCode = (typeof VIDEO_LESSON_SECTION_CODES)[number];

export const VIDEO_LESSON_SECTION_TITLES: Record<VideoLessonSectionCode, string> = {
  hook: "С чего начинается урок",
  opredelenie: "Определение и границы",
  teyki: "Что разбирает урок",
  stsenarii: "Корректный и ошибочный сценарий",
  itog: "Итог",
};

export function isVideoLessonSectionCode(value: string): value is VideoLessonSectionCode {
  return (VIDEO_LESSON_SECTION_CODES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * The take / question contract
 * ------------------------------------------------------------------ */

/** ATA VIDEO_TEST product constants. NOT generic curriculum facts — see §4. */
export const ATA_VIDEO_TAKES_PER_LESSON = 4 as const;
export const ATA_VIDEO_QUESTIONS_PER_LESSON = 4 as const;
export const ATA_VIDEO_OPTIONS_PER_QUESTION = 4 as const;

/** `T{level}.{1..4}` — the durable take identity from the Blueprint. */
export const TAKE_ID_PATTERN = /^T(\d{1,3})\.([1-4])$/;

export function takeIdFor(levelNumber: number, ordinal: number): string {
  return `T${levelNumber}.${ordinal}`;
}

export function parseTakeId(takeId: string): { levelNumber: number; ordinal: number } | null {
  const match = TAKE_ID_PATTERN.exec(takeId);
  if (!match) return null;
  return { levelNumber: Number(match[1]), ordinal: Number(match[2]) };
}

const takeSchema = z.strictObject({
  takeId: z.string().trim().regex(TAKE_ID_PATTERN),
  ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  /** The thing that must be said on camera, verbatim from the source. */
  text: safeText(2_000, "take text", "legacy_v1"),
});
export type ProductionTake = z.infer<typeof takeSchema>;

const optionSchema = z.strictObject({
  optionCode: z.enum(["a", "b", "c", "d"]),
  text: safeText(1_000, "option text", "legacy_v1"),
  correct: z.boolean(),
});

const questionSchema = z.strictObject({
  questionId: z.string().trim().min(1).max(64),
  ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  prompt: safeText(1_000, "question prompt", "legacy_v1"),
  options: z.array(optionSchema).length(ATA_VIDEO_OPTIONS_PER_QUESTION),
  correctOptionCode: z.enum(["a", "b", "c", "d"]),
  /** The ONE take this question tests. One question per take, one take per question. */
  takeId: z.string().trim().regex(TAKE_ID_PATTERN),
});
export type ProductionQuestion = z.infer<typeof questionSchema>;

/* ------------------------------------------------------------------ *
 * Production evidence — representable today, produced later
 * ------------------------------------------------------------------ */

/**
 * What production has actually done, and WHICH contract it did it against.
 *
 * `reviewedContractFingerprint` is the whole point. A recorded, QA-passed video
 * is only evidence about the contract it was reviewed against; if the contract
 * has since moved, the evidence is stale and `isProductionEvidenceStale` says so
 * without anybody having to remember. Today every field is at its pending value
 * and every fingerprint reference is null — nothing here fabricates a timestamp,
 * a QA pass or a coverage mark for work that has not happened.
 */
const productionEvidenceSchema = z.strictObject({
  script: z.enum(SCRIPT_STATE),
  video: z.enum(VIDEO_STATE),
  qa: z.enum(QA_STATE),
  /** Per-take timecode coverage in the recorded video. Empty until recorded. */
  takeCoverage: z
    .array(
      z.strictObject({
        takeId: z.string().trim().regex(TAKE_ID_PATTERN),
        /** Seconds into the video where this take is delivered. */
        atSeconds: z.number().int().min(0).max(36_000),
      }),
    )
    .max(ATA_VIDEO_TAKES_PER_LESSON),
  /** The contract version this evidence was produced against. */
  reviewedContractVersion: z.number().int().positive().nullable(),
  /** The exact fingerprint this evidence was produced against. */
  reviewedContractFingerprint: z.string().trim().regex(/^[0-9a-f]{64}$/).nullable(),
  note: optionalSafeText(1_000, "production note", "legacy_v1").nullable(),
});
export type ProductionEvidence = z.infer<typeof productionEvidenceSchema>;

export const PENDING_PRODUCTION_EVIDENCE: ProductionEvidence = {
  script: "SCRIPT_PENDING",
  video: "NOT_RECORDED",
  qa: "QA_PENDING",
  takeCoverage: [],
  reviewedContractVersion: null,
  reviewedContractFingerprint: null,
  note: null,
};

/* ------------------------------------------------------------------ *
 * The contract
 * ------------------------------------------------------------------ */

export const videoProductionContractSchema = z.strictObject({
  /* identity */
  levelCode: z.string().trim().min(1).max(128),
  levelNumber: z.number().int().min(1).max(100),
  moduleNumber: z.number().int().min(1).max(20),
  title: safeText(300, "contract title", "legacy_v1"),

  /* contract identity */
  contractVersion: z.number().int().positive(),

  /* state — three axes */
  sourceProvenance: z.enum(CONTRACT_SOURCE_PROVENANCE),
  /** The source's own words for its status, kept so provenance is reviewable. */
  sourceStatusLabel: safeText(300, "source status label", "legacy_v1"),
  approval: z.enum(CONTRACT_APPROVAL_STATE),

  /* editorial semantics */
  hook: safeText(1_000, "hook", "legacy_v1"),
  /** Verbatim source sentence. `requiredTopics` is the derived split of it. */
  requiredTopicsText: safeText(2_000, "required topics", "legacy_v1"),
  requiredTopics: z.array(safeText(300, "required topic", "legacy_v1")).min(1).max(20),
  mainIdea: safeText(1_000, "main idea", "legacy_v1").nullable(),
  learningObjective: safeText(2_000, "learning objective", "legacy_v1"),

  /* the four takes */
  takes: z.array(takeSchema).length(ATA_VIDEO_TAKES_PER_LESSON),

  /* production brief */
  targetDuration: z.strictObject({
    label: safeText(60, "target duration label", "legacy_v1"),
    minSeconds: z.number().int().positive().max(7_200),
    maxSeconds: z.number().int().positive().max(7_200),
  }),
  visualBrief: z.array(safeText(500, "visual brief item", "legacy_v1")).min(1).max(20),
  productionStructure: z
    .array(
      z.strictObject({
        marker: safeText(40, "structure marker", "legacy_v1"),
        instruction: safeText(1_000, "structure instruction", "legacy_v1"),
      }),
    )
    .min(1)
    .max(20),
  editorialStopList: z.array(safeText(500, "stop list item", "legacy_v1")).min(1).max(20),
  acceptanceChecklist: z.array(safeText(500, "acceptance item", "legacy_v1")).min(1).max(20),

  /* the four questions */
  questions: z.array(questionSchema).length(ATA_VIDEO_QUESTIONS_PER_LESSON),

  /* production evidence */
  production: productionEvidenceSchema,
});

export type VideoProductionContract = z.infer<typeof videoProductionContractSchema>;

/* ------------------------------------------------------------------ *
 * Fingerprints — §7
 * ------------------------------------------------------------------ */

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * The ASSESSMENT half of the contract: takes, questions, options, correct
 * answers, and the take↔question binding.
 *
 * This is what a QA reviewer answers against while watching the video, so it is
 * the exact set whose change invalidates a QA pass. Projected key-by-key in a
 * fixed order — never `JSON.stringify` over author key order — so re-serialising
 * the artifact with different key ordering cannot move the hash.
 */
export function calculateAssessmentFingerprint(
  contract: Pick<VideoProductionContract, "levelCode" | "takes" | "questions">,
): string {
  const projection = {
    levelCode: contract.levelCode,
    takes: contract.takes.map((take) => ({
      takeId: take.takeId,
      ordinal: take.ordinal,
      text: take.text,
    })),
    questions: contract.questions.map((question) => ({
      questionId: question.questionId,
      ordinal: question.ordinal,
      prompt: question.prompt,
      takeId: question.takeId,
      correctOptionCode: question.correctOptionCode,
      options: question.options.map((option) => ({
        optionCode: option.optionCode,
        text: option.text,
        correct: option.correct,
      })),
    })),
  };
  return sha256(JSON.stringify(projection));
}

/**
 * The WHOLE semantic contract: the assessment half plus the editorial meaning a
 * script must deliver.
 *
 * WHAT IS DELIBERATELY EXCLUDED, AND WHY (§7 asks for this to be stated).
 * `targetDuration`, `visualBrief`, `productionStructure`, `editorialStopList`
 * and `acceptanceChecklist` are PRODUCTION DIRECTION, not meaning. Re-timing a
 * lesson from 7–9 to 8–10 minutes, or rewording a shot list, cannot change which
 * answer is correct and cannot invalidate a QA pass — while including them would
 * make every cosmetic edit to a shot list mark 58 recorded videos stale, which
 * is how a staleness signal becomes noise nobody reads.
 *
 * `sourceStatusLabel`, `approval` and `production` are excluded for a stronger
 * reason: they are facts ABOUT the contract, not the contract. Including them
 * would mean approving a contract changes its fingerprint, which would instantly
 * invalidate the approval that had just been recorded.
 */
export function calculateContractFingerprint(
  contract: Pick<
    VideoProductionContract,
    "levelCode" | "levelNumber" | "moduleNumber" | "title" | "hook" | "requiredTopics" | "mainIdea" | "learningObjective" | "takes" | "questions"
  >,
): string {
  const projection = {
    levelCode: contract.levelCode,
    levelNumber: contract.levelNumber,
    moduleNumber: contract.moduleNumber,
    title: contract.title,
    hook: contract.hook,
    requiredTopics: [...contract.requiredTopics],
    mainIdea: contract.mainIdea,
    learningObjective: contract.learningObjective,
    assessment: calculateAssessmentFingerprint(contract),
  };
  return sha256(JSON.stringify(projection));
}

/**
 * Is this contract's production evidence stale?
 *
 * Evidence is stale when something was reviewed against a contract that has
 * since moved. Evidence that claims nothing (`NOT_RECORDED`, `QA_PENDING`, no
 * reviewed fingerprint) is not stale — it is simply absent, which is today's
 * honest state for all 58.
 */
export function isProductionEvidenceStale(contract: VideoProductionContract): boolean {
  const claimsSomething =
    contract.production.video === "VIDEO_RECORDED" ||
    contract.production.qa === "QA_PASSED" ||
    contract.production.takeCoverage.length > 0;
  if (!claimsSomething) return false;
  if (contract.production.reviewedContractFingerprint === null) return true;
  return contract.production.reviewedContractFingerprint !== calculateContractFingerprint(contract);
}

/* ------------------------------------------------------------------ *
 * The normalized source artifact
 * ------------------------------------------------------------------ */

export const VIDEO_CONTRACTS_SCHEMA_ID = "ata.curriculum.video-production-contracts/1" as const;
export const VIDEO_CONTRACTS_EXTRACTION_FORMAT_VERSION = 1 as const;

export const videoProductionContractsFileSchema = z.strictObject({
  $schema: z.literal(VIDEO_CONTRACTS_SCHEMA_ID),
  $comment: z.string(),
  extractionFormatVersion: z.literal(VIDEO_CONTRACTS_EXTRACTION_FORMAT_VERSION),
  provenance: z.strictObject({
    sourceDocument: z.string().trim().min(1),
    sourceTitle: z.string().trim().min(1),
    sourceVersion: z.string().trim().min(1),
    sourceDocumentSha256: z.string().trim().regex(/^[0-9a-f]{64}$/),
    declaredSourceRepository: z.string().trim().min(1),
    declaredSourceCommit: z.string().trim().min(1),
    acceptedAcademyReference: z.string().trim().min(1),
    sourceCommitReconciliation: z.string().trim().min(1),
    extractedBy: z.string().trim().min(1),
    globalEditorialConstraints: z.array(z.string()).min(1),
    globalVideoFormat: z.array(z.string()).min(1),
    productionHandoff: z.array(z.string()).min(1),
    sourceAuthorities: z.array(z.string()).min(1),
  }),
  counts: z.strictObject({
    lessons: z.number().int(),
    takes: z.number().int(),
    questions: z.number().int(),
    correctAnswers: z.number().int(),
    takeQuestionMappings: z.number().int(),
  }),
  /** Conflicts between the Blueprint and another accepted source. Never resolved silently. */
  sourceConflicts: z.array(
    z.strictObject({
      levelNumber: z.number().int().min(1).max(100),
      field: z.string().trim().min(1),
      blueprintValue: z.string(),
      otherSource: z.string().trim().min(1),
      otherValue: z.string(),
      note: z.string(),
    }),
  ),
  contracts: z.array(videoProductionContractSchema),
});

export type VideoProductionContractsFile = z.infer<typeof videoProductionContractsFileSchema>;

/** Parse the normalized artifact, or explain exactly why it is not one. */
export function parseVideoProductionContracts(
  value: unknown,
): { ok: true; file: VideoProductionContractsFile } | { ok: false; issues: string[] } {
  const parsed = videoProductionContractsFileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  return { ok: true, file: parsed.data };
}

export function contractByLevelNumber(
  file: VideoProductionContractsFile,
  levelNumber: number,
): VideoProductionContract | null {
  return file.contracts.find((contract) => contract.levelNumber === levelNumber) ?? null;
}

export { takeSchema, questionSchema, productionEvidenceSchema };
