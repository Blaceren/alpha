/**
 * PHASE-G0 — server-authoritative validation of an UNPUBLISHED authoring
 * version.
 *
 * WHY IT EXISTS. Every validator this file calls already existed, but all of
 * them were reachable only through PUBLISH or through the package pipeline. An
 * editor therefore could not learn whether a draft was acceptable without
 * attempting to publish it — which is both the wrong question and an irreversible
 * one. This module answers "would this pass?" without publishing, importing or
 * mutating anything.
 *
 * IT VALIDATES NOTHING ITSELF. Read the imports: the block contract, the safe
 * text policy, the asset-kind compatibility table, the CTA and tool
 * vocabularies, the assessment cardinality rules, the ATA video profile and the
 * Unicode placeholder matcher are all the ACCEPTED implementations. This file is
 * an orchestrator and a translator into `AuthoringIssue`. Any rule that appears
 * to be defined here rather than delegated is a bug.
 *
 * THE ONE THING IT DOES DECIDE is leak detection between the three panels —
 * learner body, assessment, production contract — because nothing previously
 * held all three at once and so nothing could compare them.
 *
 * READ-ONLY. No function here writes to the database.
 */
import {
  CONTENT_BLOCK_TYPES,
  contentBodyV2Schema,
  CTA_ACTIONS,
  type ContentBlock,
} from "@/lib/curriculum/content-blocks";
import {
  contentBodyAssetReferences,
  contentBodyBlocks,
  contentBodyTeachingCharacters,
  contentBodyToolReferences,
  parseContentBody,
} from "@/lib/curriculum/content-body";
import type { AuthoringIssue } from "@/lib/curriculum/authoring-errors";
import { containsPlaceholder } from "@/lib/curriculum/package/validate";
import { isProductToolCode } from "@/lib/curriculum/product-vocabulary";
import { expectedTakeIdFor } from "@/lib/curriculum/authoring-level-profile";
import {
  ATA_VIDEO_OPTIONS_PER_QUESTION,
  ATA_VIDEO_QUESTIONS_PER_LESSON,
  ATA_VIDEO_TAKES_PER_LESSON,
  parseTakeId,
  takeIdFor,
  TAKE_ID_PATTERN,
  type VideoProductionContract,
} from "@/lib/curriculum/video-production-contract";

export type AuthoringValidationResult = {
  ok: boolean;
  /** Blocking. An approval may not proceed while any of these is present. */
  issues: AuthoringIssue[];
  /** Non-blocking observations an editor should see but may accept. */
  warnings: AuthoringIssue[];
};

function issue(list: AuthoringIssue[], code: string, path: string, message: string) {
  list.push({ code, path, message });
}

/* ------------------------------------------------------------------ *
 * Learner content
 * ------------------------------------------------------------------ */

export type ContentValidationInput = {
  /** The stored `ContentLocalization.body` — v1 or v2, exactly as persisted. */
  body: unknown;
  title: string;
  /** `assetCode` -> `kind`, from the version's ContentAsset rows. */
  assets: ReadonlyMap<string, string>;
  /**
   * Whether this level is required to teach. Checkpoints and the registration
   * gate carry system copy, so the prose floor does not apply to them — the same
   * distinction `ata-profile.ts` draws with EDITORIAL_REQUIRED_KINDS.
   */
  requiresTeaching: boolean;
};

/**
 * The minimum prose a version must carry before it may be SUBMITTED.
 *
 * Deliberately the generic publication floor (400), not the ATA-100 editorial
 * completeness floor (1 200). Those two numbers answer different questions:
 * 400 separates "a lesson" from "a heading and a CTA" and is a correctness bar,
 * 1 200 separates "written" from "sketched" and is a PRODUCT completeness bar
 * that the package profile applies. Enforcing 1 200 here would block an editor
 * from submitting a legitimately short level for review, which is not this
 * validator's call to make. Falling below 1 200 is reported as a WARNING so the
 * editor still learns the ATA-100 profile will not count it as complete.
 */
const MIN_SUBMITTABLE_TEACHING_CHARACTERS = 400;
const ATA_EDITORIAL_COMPLETENESS_CHARACTERS = 1_200;

/** Internal production identifiers must never appear in learner-facing prose. */
const TAKE_ID_ANYWHERE = /\bT\d{1,3}\.[1-4]\b/;

function blockText(block: ContentBlock): string[] {
  switch (block.type) {
    case "heading":
    case "rich_text":
      return [block.text];
    case "callout":
      return [block.title, block.body];
    case "image":
      return [block.alt, block.caption];
    case "video":
      return [block.title, block.caption];
    case "list":
      return block.items;
    case "table":
      return [block.caption, ...block.headers, ...block.rows.flat()];
    case "example":
      return [block.title, block.body];
    case "common_mistake":
      return [block.mistake, block.correction];
    case "glossary":
      return block.entries.flatMap((entry) => [entry.term, entry.definition]);
    case "exercise":
      return [block.title, block.instructions, block.expectedAction];
    case "tool_link":
      return [block.label, block.context];
    case "cta":
      return [block.label, block.body];
    case "divider":
      return [];
    case "download":
      return [block.label, block.description];
  }
}

export function validateAuthoringContent(
  input: ContentValidationInput,
): AuthoringValidationResult {
  const issues: AuthoringIssue[] = [];
  const warnings: AuthoringIssue[] = [];

  // 1. SCHEMA. The accepted parser, which accepts legacy v1 and v2 and refuses
  //    anything else. A v2 body additionally goes through the strict block
  //    union, which is what closes the CTA and callout vocabularies and the
  //    table rectangularity rule.
  const parsed = parseContentBody(input.body);
  if (!parsed.ok) {
    for (const problem of parsed.issues) {
      issue(issues, "CONTENT_BODY_INVALID", problem.path.join("."), problem.message);
    }
    return { ok: false, issues, warnings };
  }

  const body = parsed.body;
  const isV2 = typeof body === "object" && body !== null && "format" in body;
  if (isV2) {
    const strict = contentBodyV2Schema.safeParse(body);
    if (!strict.success) {
      for (const problem of strict.error.issues) {
        issue(issues, "CONTENT_BLOCK_INVALID", problem.path.join("."), problem.message);
      }
    }
  } else {
    // Legacy v1 is still valid at runtime and still renders, but it cannot
    // express the 15-block contract the studio authors against.
    issue(
      warnings,
      "CONTENT_BODY_LEGACY_V1",
      "body.format",
      "body is legacy v1 — the block editor writes v2 and this version will need migrating before block-level review is possible",
    );
  }

  const blocks = contentBodyBlocks(body);

  // 2. BLOCK TYPE CLOSURE. Belt and braces over the discriminated union: if a
  //    block type ever reaches storage that the catalog does not name, say so
  //    rather than rendering it as nothing.
  for (const [index, block] of blocks.entries()) {
    if (!(CONTENT_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      issue(issues, "CONTENT_BLOCK_UNKNOWN", `blocks[${index}].type`, `unsupported block type ${block.type}`);
    }
  }

  // 3. ASSET REFERENCES. Existence AND kind compatibility. The accepted
  //    `contentBodyAssetReferences` already carries the acceptable kinds for
  //    each reference, derived from BLOCK_ASSET_REFERENCES, so the rule is read
  //    from it rather than re-derived here — one table, one answer.
  for (const reference of contentBodyAssetReferences(body)) {
    const kind = input.assets.get(reference.assetCode);
    if (kind === undefined) {
      issue(
        issues,
        "CONTENT_ASSET_MISSING",
        reference.path,
        `block references assetCode "${reference.assetCode}" which this version does not carry`,
      );
      continue;
    }
    if (!reference.kinds.includes(kind)) {
      issue(
        issues,
        "CONTENT_ASSET_KIND_MISMATCH",
        reference.path,
        `this reference accepts ${reference.kinds.join(" or ")}, but "${reference.assetCode}" is a ${kind} asset`,
      );
    }
  }

  // 4. TOOL AND CTA VOCABULARIES. `isProductToolCode` is the canonical product
  //    list — a tool_link to a tool the product does not have is a dead link the
  //    editor cannot see from inside the editor.
  for (const reference of contentBodyToolReferences(body)) {
    if (!isProductToolCode(reference.toolCode)) {
      issue(
        issues,
        "CONTENT_TOOL_CODE_UNKNOWN",
        reference.path,
        `"${reference.toolCode}" is not a canonical product tool code`,
      );
    }
  }
  for (const [index, block] of blocks.entries()) {
    if (block.type !== "cta") continue;
    if (!(CTA_ACTIONS as readonly string[]).includes(block.action)) {
      issue(issues, "CONTENT_CTA_ACTION_UNKNOWN", `blocks[${index}].action`, `unsupported CTA action ${block.action}`);
    }
    if (block.action === "open_tool" && block.toolCode === null) {
      issue(issues, "CONTENT_CTA_TOOL_REQUIRED", `blocks[${index}].toolCode`, "cta action open_tool requires a toolCode");
    }
    if (block.action !== "open_tool" && block.toolCode !== null) {
      issue(issues, "CONTENT_CTA_TOOL_UNEXPECTED", `blocks[${index}].toolCode`, `cta action ${block.action} must not carry a toolCode`);
    }
  }

  // 5. PLACEHOLDERS. The shared Unicode-aware matcher, applied to the title and
  //    to every learner-visible string in every block. Not a second regex.
  const titleMarker = containsPlaceholder(input.title);
  if (titleMarker) {
    issue(issues, "CONTENT_PLACEHOLDER", "title", `title contains the placeholder marker ${titleMarker}`);
  }
  for (const [index, block] of blocks.entries()) {
    for (const text of blockText(block)) {
      if (!text) continue;
      const marker = containsPlaceholder(text);
      if (marker) {
        issue(
          issues,
          "CONTENT_PLACEHOLDER",
          `blocks[${index}]`,
          `${block.type} block contains the placeholder marker ${marker}`,
        );
        break;
      }
    }
  }

  // 6. INTERNAL PRODUCTION LEAKAGE. A take id is an internal production
  //    identifier — it names a shot a script must deliver. It has no meaning to
  //    a learner and its presence means production notes were pasted into the
  //    lesson.
  for (const [index, block] of blocks.entries()) {
    for (const text of blockText(block)) {
      if (text && TAKE_ID_ANYWHERE.test(text)) {
        issue(
          issues,
          "CONTENT_PRODUCTION_LEAK",
          `blocks[${index}]`,
          `${block.type} block contains an internal take identifier`,
        );
        break;
      }
    }
  }

  // 7. TEACHING FLOOR.
  if (input.requiresTeaching) {
    const characters = contentBodyTeachingCharacters(body);
    if (characters < MIN_SUBMITTABLE_TEACHING_CHARACTERS) {
      issue(
        issues,
        "CONTENT_LEARNER_EMPTY",
        "body",
        `only ${characters} teaching characters — below the ${MIN_SUBMITTABLE_TEACHING_CHARACTERS} floor for a level that must teach`,
      );
    } else if (characters < ATA_EDITORIAL_COMPLETENESS_CHARACTERS) {
      issue(
        warnings,
        "CONTENT_BELOW_ATA_COMPLETENESS",
        "body",
        `${characters} teaching characters — the ATA-100 profile counts a level as editorially complete from ${ATA_EDITORIAL_COMPLETENESS_CHARACTERS}`,
      );
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}

/* ------------------------------------------------------------------ *
 * Assessment
 * ------------------------------------------------------------------ */

export type AssessmentQuestionInput = {
  questionNumber: number;
  stableKey: string;
  prompt: string;
  optionLabels: readonly string[];
  correctAnswer: unknown;
  explanation: string | null;
};

export type AssessmentValidationInput = {
  questions: readonly AssessmentQuestionInput[];
  /**
   * The level number, used to derive the expected take ids. Null for a level
   * that is not on the ATA video profile, which switches off the 4x4 rules
   * rather than inventing different ones.
   */
  ataVideoLevelNumber: number | null;
};

export function validateAuthoringAssessment(
  input: AssessmentValidationInput,
): AuthoringValidationResult {
  const issues: AuthoringIssue[] = [];
  const warnings: AuthoringIssue[] = [];

  for (const [index, question] of input.questions.entries()) {
    const marker = containsPlaceholder(question.prompt);
    if (marker) {
      issue(issues, "ASSESSMENT_PLACEHOLDER", `questions[${index}].prompt`, `prompt contains the placeholder marker ${marker}`);
    }
    for (const [optionIndex, label] of question.optionLabels.entries()) {
      const optionMarker = containsPlaceholder(label);
      if (optionMarker) {
        issue(
          issues,
          "ASSESSMENT_PLACEHOLDER",
          `questions[${index}].options[${optionIndex}]`,
          `option contains the placeholder marker ${optionMarker}`,
        );
      }
    }
    if (question.explanation) {
      const explanationMarker = containsPlaceholder(question.explanation);
      if (explanationMarker) {
        issue(
          issues,
          "ASSESSMENT_PLACEHOLDER",
          `questions[${index}].explanation`,
          `explanation contains the placeholder marker ${explanationMarker}`,
        );
      }
    }
  }

  // The ATA video profile: exactly four questions, four options each, exactly
  // one take per question, and the four takes are T{level}.1 .. T{level}.4 with
  // no repeats and no gaps. All four numbers come from the accepted contract
  // constants, never from a literal typed here.
  if (input.ataVideoLevelNumber !== null) {
    const level = input.ataVideoLevelNumber;

    if (input.questions.length !== ATA_VIDEO_QUESTIONS_PER_LESSON) {
      issue(
        issues,
        "ASSESSMENT_CARDINALITY",
        "questions",
        `ATA video levels carry exactly ${ATA_VIDEO_QUESTIONS_PER_LESSON} questions, found ${input.questions.length}`,
      );
    }

    for (const [index, question] of input.questions.entries()) {
      if (question.optionLabels.length !== ATA_VIDEO_OPTIONS_PER_QUESTION) {
        issue(
          issues,
          "ASSESSMENT_OPTION_CARDINALITY",
          `questions[${index}].options`,
          `expected exactly ${ATA_VIDEO_OPTIONS_PER_QUESTION} options, found ${question.optionLabels.length}`,
        );
      }
      if (question.correctAnswer === null || question.correctAnswer === undefined) {
        issue(issues, "ASSESSMENT_ANSWER_MISSING", `questions[${index}].correctAnswer`, "no correct answer recorded");
      }
    }

    // PHASE-G1 TAKE-SLOT CORRECTION — POSITIONAL identity, not set membership.
    //
    // This used to assert only that the four canonical takes appeared SOMEWHERE
    // across the bank, which accepted any permutation. That was insufficient:
    // the accepted assessment projection derives each question's take as
    // `takeIdFor(level, questionNumber)`, so a permuted-but-complete bank made
    // the durable key and the fingerprinted binding describe different things,
    // and the handoff shipped the durable one. The rule is now the one the
    // fingerprint has always used, asked of each question individually.
    const expected = Array.from({ length: ATA_VIDEO_TAKES_PER_LESSON }, (_, i) => takeIdFor(level, i + 1));
    const seen = new Map<string, number>();
    for (const [index, question] of input.questions.entries()) {
      const takeId = question.stableKey;
      if (!TAKE_ID_PATTERN.test(takeId)) {
        issue(
          issues,
          "ASSESSMENT_TAKE_MAPPING_INVALID",
          `questions[${index}].stableKey`,
          `"${takeId}" is not a take identifier of the form T{level}.{1-4}`,
        );
        continue;
      }
      const parsedTake = parseTakeId(takeId);
      if (parsedTake && parsedTake.levelNumber !== level) {
        issue(
          issues,
          "ASSESSMENT_TAKE_LEVEL_MISMATCH",
          `questions[${index}].stableKey`,
          `take ${takeId} belongs to level ${parsedTake.levelNumber}, not ${level}`,
        );
      }
      if (seen.has(takeId)) {
        issue(
          issues,
          "ASSESSMENT_TAKE_DUPLICATE",
          `questions[${index}].stableKey`,
          `take ${takeId} is already mapped by question ${seen.get(takeId)! + 1}`,
        );
      }
      seen.set(takeId, index);

      // The slot itself. Reported even when the value is a perfectly good take
      // of this level, because "a real take, in the wrong slot" is exactly the
      // permuted state that used to pass.
      const slot = expectedTakeIdFor(level, question.questionNumber);
      if (parsedTake && parsedTake.levelNumber === level && takeId !== slot) {
        issue(
          issues,
          "ASSESSMENT_TAKE_SLOT_MISMATCH",
          `questions[${index}].stableKey`,
          `question ${question.questionNumber} carries ${takeId} but its take slot is ${slot} — ATA take slots are positional and cannot be reassigned`,
        );
      }
    }
    for (const takeId of expected) {
      if (!seen.has(takeId)) {
        issue(issues, "ASSESSMENT_TAKE_UNMAPPED", "questions", `no question maps take ${takeId}`);
      }
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}

/* ------------------------------------------------------------------ *
 * Cross-panel leak detection
 * ------------------------------------------------------------------ */

/**
 * Does the learner body give away an answer, or carry production direction?
 *
 * This is the one rule that could not exist before G0, because no single place
 * held the learner body, the answer key and the production contract at once.
 *
 * The match is on the exact correct-option text, normalised for whitespace and
 * case and only when it is long enough to be a real sentence rather than a
 * word two documents could share innocently. A shorter threshold produced false
 * positives on ordinary vocabulary, and a false leak warning that fires on
 * every lesson is a warning editors learn to click past.
 */
const MIN_ANSWER_LEAK_LENGTH = 24;

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru");
}

export function detectAnswerLeakage(input: {
  body: unknown;
  correctAnswerTexts: readonly string[];
}): AuthoringIssue[] {
  const found: AuthoringIssue[] = [];
  const parsed = parseContentBody(input.body);
  if (!parsed.ok) return found;

  const haystack = contentBodyBlocks(parsed.body)
    .flatMap((block) => blockText(block))
    .filter((text): text is string => Boolean(text))
    .map(normalize)
    .join("   ");

  for (const [index, answer] of input.correctAnswerTexts.entries()) {
    const needle = normalize(answer);
    if (needle.length < MIN_ANSWER_LEAK_LENGTH) continue;
    if (haystack.includes(needle)) {
      found.push({
        code: "CONTENT_ANSWER_LEAK",
        path: `questions[${index}].correctAnswer`,
        message: "the learner body contains the correct answer text verbatim",
      });
    }
  }
  return found;
}

/**
 * Coherence between a stored assessment bank and its production contract.
 *
 * Reports only what the ACCEPTED fingerprint semantics already decide. It does
 * not recompute a fingerprint and it does not define staleness — both come from
 * `video-production-contract.ts`.
 */
export function validateVideoContractCoherence(input: {
  contract: VideoProductionContract;
  storedAssessmentFingerprint: string;
  currentAssessmentFingerprint: string;
  productionEvidenceStale: boolean;
}): AuthoringValidationResult {
  const issues: AuthoringIssue[] = [];
  const warnings: AuthoringIssue[] = [];

  if (input.storedAssessmentFingerprint !== input.currentAssessmentFingerprint) {
    issue(
      issues,
      "VIDEO_ASSESSMENT_FINGERPRINT_DRIFT",
      "assessmentFingerprint",
      "the stored assessment fingerprint does not match the contract payload — the row was written outside the authoring domain",
    );
  }

  if (input.productionEvidenceStale) {
    issue(
      warnings,
      "VIDEO_EVIDENCE_STALE",
      "production",
      "Видео QA устарело после изменения контракта — production evidence was reviewed against a different contract fingerprint",
    );
  }

  if (input.contract.takes.length !== ATA_VIDEO_TAKES_PER_LESSON) {
    issue(
      issues,
      "VIDEO_TAKE_CARDINALITY",
      "takes",
      `expected exactly ${ATA_VIDEO_TAKES_PER_LESSON} takes, found ${input.contract.takes.length}`,
    );
  }

  return { ok: issues.length === 0, issues, warnings };
}

/** Merge several results into the single verdict an approval gate consumes. */
export function mergeValidation(
  ...results: AuthoringValidationResult[]
): AuthoringValidationResult {
  const issues = results.flatMap((result) => result.issues);
  const warnings = results.flatMap((result) => result.warnings);
  return { ok: issues.length === 0, issues, warnings };
}
