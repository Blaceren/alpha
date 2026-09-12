/**
 * PHASE-C CORRECTIONS — normalize the video-production Blueprint into source.
 *
 * ============================== WHAT IT DOES ==============================
 * Reads `ATA_VIDEO_LESSONS_PRODUCTION_BLUEPRINT_V1.docx` and writes
 * `curriculum/canonical/ata-video-production-contracts.v1.json`: 58 video+test
 * production contracts, 232 testable takes, 232 single-choice questions with
 * their options and correct answers, and the 232 one-to-one take↔question
 * mappings.
 *
 * ========================= WHY THE DOCX IS NOT COMMITTED =========================
 * The binary is an EDITORIAL DELIVERABLE, not application data. Committing it
 * would put a 100 KB opaque blob on the platform's source path, where nothing
 * can diff it, review it or validate it, and where a later edit would be
 * invisible in review. What is committed instead is the normalized artifact —
 * reviewable, diffable, schema-validated — carrying the document's sha256 so the
 * extraction can always be re-proved against the exact original.
 *
 * ============================ DETERMINISM ============================
 * Same document → byte-identical JSON. No clock, no randomness, no host path, no
 * filesystem ordering, no network. `--check` re-extracts and compares against the
 * committed artifact, which is how editorial drift is caught in review rather
 * than at import.
 *
 * ============================ WHAT IT REFUSES ============================
 * It does not write, paraphrase, reorder, "improve" or regenerate a single
 * question. Every prompt, option and correct answer is transferred verbatim. The
 * ONE transformation applied to text is the canonical brand substitution
 * (`TradeQuest` → `Alfa Trade Academy`), which is recorded per occurrence in the
 * output so it is reviewable rather than silent — and which the document does not
 * currently trigger.
 *
 * It also does not decide anything about approval. Every contract it emits is
 * `AWAITING_APPROVAL`, including the one whose questions already exist in the
 * Academy source: being source-backed is a fact about PROVENANCE, and approving a
 * platform assessment is a separate human act.
 *
 * USAGE (dev/audit only — nothing in `src/` reaches this file)
 *   npm run curriculum:blueprint:extract -- --docx /path/to/blueprint.docx
 *   npm run curriculum:blueprint:check   -- --docx /path/to/blueprint.docx
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readDocxBlocks, readDocxCoreProperties, type DocxBlock } from "./lib/docxText";
import {
  ATA_VIDEO_OPTIONS_PER_QUESTION,
  ATA_VIDEO_QUESTIONS_PER_LESSON,
  ATA_VIDEO_TAKES_PER_LESSON,
  PENDING_PRODUCTION_EVIDENCE,
  VIDEO_CONTRACTS_EXTRACTION_FORMAT_VERSION,
  VIDEO_CONTRACTS_SCHEMA_ID,
  parseVideoProductionContracts,
  takeIdFor,
  type VideoProductionContract,
} from "@/lib/curriculum/video-production-contract";
import { ATA_LEVELS, canonicalLevelCode } from "@/lib/curriculum/product-ata-100";
import { findObsoleteBrand, replaceObsoleteBrands } from "@/lib/curriculum/product-vocabulary";

const REPO_ROOT = process.cwd();
const OUTPUT = path.join(REPO_ROOT, "curriculum/canonical/ata-video-production-contracts.v1.json");
const APPROVED_SLICE = path.join(REPO_ROOT, "curriculum/packages/ata-v2-first-slice.rev3.approved.json");

/** The accepted Academy reference this repository transferred structure from. */
const ACCEPTED_ACADEMY_REFERENCE = "4c4ced398d2b2a73cdf8d95652b9171b425fdf06";

/* ------------------------------------------------------------------ *
 * Section/label vocabulary — the document's own headings
 * ------------------------------------------------------------------ */

const H3_OBJECTIVE = "Цель урока";
const H3_TAKES = "Основные тейки — обязаны прозвучать";
const H3_VISUAL = "Что показать на экране";
const H3_STRUCTURE = "Структура записи";
const H3_TEST = "Тест после видео";
const H3_STOP_LIST = "Редакторский стоп-лист";
const H3_ACCEPTANCE = "Приёмка ролика";

const LABEL_MODULE = "Модуль:";
const LABEL_FORMAT = "Формат:";
const LABEL_STATUS = "Статус теста:";
const LABEL_HOOK = "Хук:";
const LABEL_TOPICS = "Обязательные темы:";
const LABEL_MAIN_IDEA = "Главная мысль:";
const LABEL_CORRECT = "Правильный ответ:";
const LABEL_COVERAGE = "Покрытие в видео:";

const OPTION_CODES = ["a", "b", "c", "d"] as const;
const CORRECT_MARKER = "✓";

function fail(message: string): never {
  throw new Error(`blueprint extraction: ${message}`);
}

function stripBullet(value: string): string {
  return value.replace(/^[••]\s*/, "").replace(/^☐\s*/, "").trim();
}

function afterLabel(text: string, label: string): string {
  return text.slice(label.length).trim();
}

/* ------------------------------------------------------------------ *
 * Brand substitution — reviewable, never silent
 * ------------------------------------------------------------------ */

type BrandSubstitution = { levelNumber: number; field: string; brand: string };
const brandSubstitutions: BrandSubstitution[] = [];

function clean(value: string, levelNumber: number, field: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  const brand = findObsoleteBrand(collapsed);
  if (!brand) return collapsed;
  brandSubstitutions.push({ levelNumber, field, brand });
  return replaceObsoleteBrands(collapsed);
}

/* ------------------------------------------------------------------ *
 * Duration
 * ------------------------------------------------------------------ */

/** «7–9 минут» → 420..540 seconds. The label is kept verbatim beside them. */
function parseDuration(label: string): { label: string; minSeconds: number; maxSeconds: number } {
  const match = /^(\d+)\s*[–—-]\s*(\d+)\s*минут/u.exec(label.trim());
  if (!match) fail(`unrecognised duration «${label}»`);
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!(min > 0 && max >= min)) fail(`implausible duration «${label}»`);
  return { label: label.trim(), minSeconds: min * 60, maxSeconds: max * 60 };
}

/* ------------------------------------------------------------------ *
 * Slicing the document into lessons
 * ------------------------------------------------------------------ */

type Paragraph = { style: string; text: string };

type RawLesson = {
  levelNumber: number;
  title: string;
  moduleNumber: number;
  moduleTitle: string;
  paragraphs: Paragraph[];
};

function sliceLessons(blocks: DocxBlock[]): RawLesson[] {
  const lessons: RawLesson[] = [];
  let moduleNumber = 0;
  let moduleTitle = "";
  let current: RawLesson | null = null;

  for (const block of blocks) {
    if (block.kind === "table") continue;
    const text = block.text.replace(/ /g, " ").trim();

    if (block.style === "Heading1") {
      const moduleMatch = /^Модуль\s+(\d{1,2})\.\s*(.+)$/u.exec(text);
      if (moduleMatch) {
        moduleNumber = Number(moduleMatch[1]);
        moduleTitle = moduleMatch[2].trim();
      }
      // A non-module Heading1 (§4/§5/§6) closes the lesson run.
      if (!moduleMatch) current = null;
      continue;
    }

    if (block.style === "Heading2") {
      const lessonMatch = /^L(\d{1,3})\.\s*(.+)$/u.exec(text);
      if (!lessonMatch) {
        current = null;
        continue;
      }
      current = {
        levelNumber: Number(lessonMatch[1]),
        title: lessonMatch[2].trim(),
        moduleNumber,
        moduleTitle,
        paragraphs: [],
      };
      lessons.push(current);
      continue;
    }

    if (current && text.length > 0) current.paragraphs.push({ style: block.style, text });
  }
  return lessons;
}

/** Paragraphs under one `###` heading, bounded by the next heading of any level. */
function sectionOf(lesson: RawLesson, heading: string): Paragraph[] {
  const out: Paragraph[] = [];
  let inside = false;
  for (const paragraph of lesson.paragraphs) {
    if (paragraph.style === "Heading3") {
      inside = paragraph.text === heading;
      continue;
    }
    if (inside) out.push(paragraph);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * One lesson → one contract
 * ------------------------------------------------------------------ */

function buildContract(lesson: RawLesson): VideoProductionContract {
  const level = lesson.levelNumber;
  const source = ATA_LEVELS.find((item) => item.levelNumber === level);
  if (!source) fail(`L${level} is not a canonical ATA level`);
  if (source.kind !== "video_test") {
    fail(`L${level} is «${source.kind}» in the canonical structure, not video_test`);
  }

  /* --- the meta block, before the first Heading3 --- */
  const meta: Record<string, string> = {};
  for (const paragraph of lesson.paragraphs) {
    if (paragraph.style === "Heading3") break;
    for (const label of [LABEL_MODULE, LABEL_FORMAT, LABEL_STATUS, LABEL_HOOK, LABEL_TOPICS, LABEL_MAIN_IDEA]) {
      if (paragraph.text.startsWith(label)) meta[label] = afterLabel(paragraph.text, label);
    }
  }
  for (const required of [LABEL_MODULE, LABEL_FORMAT, LABEL_STATUS, LABEL_HOOK, LABEL_TOPICS]) {
    if (!meta[required]) fail(`L${level} is missing «${required}»`);
  }

  const moduleMatch = /^(\d{1,2})\.\s*(.+)$/u.exec(meta[LABEL_MODULE]);
  if (!moduleMatch) fail(`L${level} has an unreadable module line`);
  const declaredModule = Number(moduleMatch[1]);
  if (declaredModule !== lesson.moduleNumber) {
    fail(`L${level} declares module ${declaredModule} inside module ${lesson.moduleNumber}`);
  }

  const formatMatch = /·\s*(.+)$/u.exec(meta[LABEL_FORMAT]);
  if (!formatMatch) fail(`L${level} has an unreadable format line`);
  const targetDuration = parseDuration(formatMatch[1]);

  const statusLabel = meta[LABEL_STATUS];
  const sourceProvenance = statusLabel.startsWith("IMPLEMENTED")
    ? "SOURCE_BACKED"
    : statusLabel.startsWith("PROPOSED CANON")
      ? "PROPOSED_CANON"
      : fail(`L${level} has an unrecognised test status «${statusLabel}»`);

  /* --- objective --- */
  const objectiveParagraphs = sectionOf(lesson, H3_OBJECTIVE);
  if (objectiveParagraphs.length !== 1) fail(`L${level} must have exactly one objective paragraph`);
  const learningObjective = clean(objectiveParagraphs[0].text, level, "learningObjective");

  /* --- takes --- */
  const takeParagraphs = sectionOf(lesson, H3_TAKES).filter((p) => p.style === "Takeaway");
  if (takeParagraphs.length !== ATA_VIDEO_TAKES_PER_LESSON) {
    fail(`L${level} has ${takeParagraphs.length} takes, expected ${ATA_VIDEO_TAKES_PER_LESSON}`);
  }
  const takes = takeParagraphs.map((paragraph, index) => {
    const match = /^(T\d{1,3}\.[1-4])\s*[—–-]\s*(.+)$/u.exec(paragraph.text);
    if (!match) fail(`L${level} take ${index + 1} is unreadable: «${paragraph.text.slice(0, 60)}»`);
    const ordinal = (index + 1) as 1 | 2 | 3 | 4;
    const expected = takeIdFor(level, ordinal);
    if (match[1] !== expected) fail(`L${level} take ${index + 1} is «${match[1]}», expected «${expected}»`);
    return { takeId: match[1], ordinal, text: clean(match[2], level, `take.${expected}`) };
  });

  /* --- production brief --- */
  const visualBrief = sectionOf(lesson, H3_VISUAL)
    .map((p) => clean(stripBullet(p.text), level, "visualBrief"))
    .filter((v) => v.length > 0);
  if (visualBrief.length === 0) fail(`L${level} has an empty visual brief`);

  const productionStructure = sectionOf(lesson, H3_STRUCTURE)
    .map((p) => {
      const raw = stripBullet(p.text);
      const match = /^([^—]+?)\s*—\s*(.+)$/u.exec(raw);
      if (!match) fail(`L${level} has an unreadable structure line «${raw.slice(0, 60)}»`);
      return {
        marker: clean(match[1], level, "productionStructure.marker"),
        instruction: clean(match[2], level, "productionStructure.instruction"),
      };
    })
    .filter((item) => item.instruction.length > 0);
  if (productionStructure.length === 0) fail(`L${level} has an empty production structure`);

  const editorialStopList = sectionOf(lesson, H3_STOP_LIST)
    .map((p) => clean(stripBullet(p.text), level, "editorialStopList"))
    .filter((v) => v.length > 0);
  if (editorialStopList.length === 0) fail(`L${level} has an empty editorial stop list`);

  const acceptanceChecklist = sectionOf(lesson, H3_ACCEPTANCE)
    .map((p) => clean(stripBullet(p.text), level, "acceptanceChecklist"))
    .filter((v) => v.length > 0);
  if (acceptanceChecklist.length === 0) fail(`L${level} has an empty acceptance checklist`);

  /* --- questions --- */
  const questions = parseQuestions(lesson, level);

  /* --- required topics: verbatim sentence + derived split --- */
  const requiredTopicsText = clean(meta[LABEL_TOPICS], level, "requiredTopics");
  const requiredTopics = requiredTopicsText
    .replace(/\.$/u, "")
    .split(",")
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0);
  if (requiredTopics.length === 0) fail(`L${level} has no required topics`);

  return {
    levelCode: canonicalLevelCode(source),
    levelNumber: level,
    moduleNumber: lesson.moduleNumber,
    title: clean(lesson.title, level, "title"),
    contractVersion: 1,
    sourceProvenance,
    sourceStatusLabel: clean(statusLabel, level, "sourceStatusLabel"),
    // Being source-backed is provenance, not approval. Nothing this script reads
    // can establish that a platform assessment was approved, so nothing it emits
    // claims one was.
    approval: "AWAITING_APPROVAL",
    hook: clean(meta[LABEL_HOOK], level, "hook"),
    requiredTopicsText,
    requiredTopics,
    mainIdea: meta[LABEL_MAIN_IDEA] ? clean(meta[LABEL_MAIN_IDEA], level, "mainIdea") : null,
    learningObjective,
    takes,
    targetDuration,
    visualBrief,
    productionStructure,
    editorialStopList,
    acceptanceChecklist,
    questions,
    production: { ...PENDING_PRODUCTION_EVIDENCE, takeCoverage: [] },
  };
}

function parseQuestions(lesson: RawLesson, level: number) {
  const paragraphs = sectionOf(lesson, H3_TEST);
  type Draft = {
    prompt: string;
    options: { optionCode: (typeof OPTION_CODES)[number]; text: string; correct: boolean }[];
    correctAnswerLine: string | null;
    takeId: string | null;
  };
  const drafts: Draft[] = [];
  let current: Draft | null = null;

  for (const paragraph of paragraphs) {
    const text = paragraph.text;
    if (paragraph.style === "Question") {
      const match = /^Вопрос\s+(\d+)\.\s*(.+)$/u.exec(text);
      if (!match) fail(`L${level} has an unreadable question heading «${text.slice(0, 60)}»`);
      if (Number(match[1]) !== drafts.length + 1) {
        fail(`L${level} question numbering jumps at «${text.slice(0, 40)}»`);
      }
      current = { prompt: match[2].trim(), options: [], correctAnswerLine: null, takeId: null };
      drafts.push(current);
      continue;
    }
    if (!current) continue;

    const optionMatch = /^([A-D])\.\s*(.+)$/u.exec(text);
    if (optionMatch) {
      const index = optionMatch[1].charCodeAt(0) - "A".charCodeAt(0);
      if (index !== current.options.length) fail(`L${level} option letters are out of order`);
      const body = optionMatch[2];
      const correct = body.includes(CORRECT_MARKER);
      current.options.push({
        optionCode: OPTION_CODES[index],
        text: clean(body.replace(CORRECT_MARKER, ""), level, "option"),
        correct,
      });
      continue;
    }
    if (text.startsWith(LABEL_CORRECT)) {
      current.correctAnswerLine = afterLabel(text, LABEL_CORRECT);
      continue;
    }
    if (text.startsWith(LABEL_COVERAGE)) {
      const match = /^(T\d{1,3}\.[1-4])\.?$/u.exec(afterLabel(text, LABEL_COVERAGE));
      if (!match) fail(`L${level} has an unreadable coverage line «${text.slice(0, 60)}»`);
      current.takeId = match[1];
      continue;
    }
  }

  if (drafts.length !== ATA_VIDEO_QUESTIONS_PER_LESSON) {
    fail(`L${level} has ${drafts.length} questions, expected ${ATA_VIDEO_QUESTIONS_PER_LESSON}`);
  }

  return drafts.map((draft, index) => {
    const ordinal = (index + 1) as 1 | 2 | 3 | 4;
    if (draft.options.length !== ATA_VIDEO_OPTIONS_PER_QUESTION) {
      fail(`L${level} Q${ordinal} has ${draft.options.length} options`);
    }
    const marked = draft.options.filter((option) => option.correct);
    if (marked.length !== 1) fail(`L${level} Q${ordinal} marks ${marked.length} correct options`);
    if (!draft.takeId) fail(`L${level} Q${ordinal} declares no take coverage`);
    if (!draft.correctAnswerLine) fail(`L${level} Q${ordinal} has no «${LABEL_CORRECT}» line`);

    // The document states the correct answer twice — a ✓ on the option and a
    // «Правильный ответ:» line. They are cross-checked rather than trusted, so a
    // document whose two statements disagree is refused instead of silently
    // resolved in favour of whichever one the parser happened to read first.
    const declared = clean(draft.correctAnswerLine, level, "correctAnswerLine");
    const declaredMatch = /^([A-D])\.\s*(.+)$/u.exec(declared);
    if (!declaredMatch) fail(`L${level} Q${ordinal} has an unreadable correct-answer line`);
    const declaredCode = OPTION_CODES[declaredMatch[1].charCodeAt(0) - "A".charCodeAt(0)];
    if (declaredCode !== marked[0].optionCode) {
      fail(
        `L${level} Q${ordinal}: the ✓ marks option ${marked[0].optionCode} but the correct-answer line names ${declaredCode}`,
      );
    }
    const declaredText = declaredMatch[2].replace(/\s+/g, " ").trim();
    if (declaredText !== marked[0].text) {
      fail(`L${level} Q${ordinal}: the correct-answer line text disagrees with the marked option`);
    }

    return {
      questionId: `bp.l${String(level).padStart(3, "0")}.q${ordinal}`,
      ordinal,
      prompt: clean(draft.prompt, level, "prompt"),
      options: draft.options,
      correctOptionCode: marked[0].optionCode,
      takeId: draft.takeId,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Reconciliation against Backend's own approved package — §6 / §24
 * ------------------------------------------------------------------ */

type SourceConflict = {
  levelNumber: number;
  field: string;
  blueprintValue: string;
  otherSource: string;
  otherValue: string;
  note: string;
};

/**
 * Compare the Blueprint's PROPOSED banks against the assessments Backend has
 * already APPROVED, and record every incompatible claim.
 *
 * WHY THIS RUNS HERE AND NOT IN AN AUDIT SCRIPT. The approved package is
 * committed to THIS repository, so the comparison is deterministic, needs no
 * other checkout, and can therefore be part of the artifact rather than a report
 * somebody has to remember to run. The Academy comparison (L18) cannot be — it
 * needs an Academy checkout — and lives in `verifyAcademyTransfer.ts`.
 *
 * A DIFFERENCE IS NOT AUTOMATICALLY A CONFLICT. Structure disagreeing with
 * editorial content is not a conflict; the two sources are answering different
 * questions. A conflict is two sources making INCOMPATIBLE claims about the same
 * semantic field — here, what the assessment for a given level asks and which
 * answer is correct. Those are recorded and NEVER silently resolved: the
 * approved package keeps its approved bank, the Blueprint keeps its proposal,
 * and a human decides which becomes canon.
 */
function reconcileWithApprovedPackage(contracts: VideoProductionContract[]): SourceConflict[] {
  const conflicts: SourceConflict[] = [];
  let approvedPackage: {
    status: string;
    modules: Array<{
      levels: Array<{
        levelNumber: number;
        assessment: {
          status: string;
          questions: Array<{
            questionCode: string;
            correctOptionCodes: string[];
            optionCodes: string[];
            lessonTakeawayRef: string | null;
            localizations: Array<{ locale: string; prompt: string; optionLabels: string[] }>;
          }>;
        } | null;
      }>;
    }>;
  };
  try {
    approvedPackage = JSON.parse(readFileSync(APPROVED_SLICE, "utf8"));
  } catch {
    fail(`the approved first slice is required for reconciliation and could not be read: ${APPROVED_SLICE}`);
  }
  if (approvedPackage.status !== "approved") return conflicts;

  const approvedLevels = approvedPackage.modules.flatMap((moduleDefinition) => moduleDefinition.levels);

  for (const contract of contracts) {
    const approvedLevel = approvedLevels.find((level) => level.levelNumber === contract.levelNumber);
    const approvedAssessment = approvedLevel?.assessment;
    if (!approvedAssessment) continue;

    const otherSource = "curriculum/packages/ata-v2-first-slice.rev3.approved.json";
    const note =
      "The Blueprint proposes a question bank for a level whose assessment is ALREADY APPROVED in " +
      "Backend with different wording. Both banks cover the same four takes. Neither is rewritten: " +
      "the package keeps the approved bank as platform truth, the contract keeps the proposal, and " +
      "promoting one over the other is an explicit editorial decision.";

    contract.questions.forEach((question, index) => {
      const approvedQuestion = approvedAssessment.questions[index];
      if (!approvedQuestion) return;
      const localization =
        approvedQuestion.localizations.find((item) => item.locale === "ru") ?? approvedQuestion.localizations[0];
      if (!localization) return;

      if (localization.prompt !== question.prompt) {
        conflicts.push({
          levelNumber: contract.levelNumber,
          field: `questions[${index}].prompt`,
          blueprintValue: question.prompt,
          otherSource,
          otherValue: localization.prompt,
          note,
        });
      }
      const blueprintCorrect = question.options.find((option) => option.correct)?.text ?? "";
      const approvedCorrectCode = approvedQuestion.correctOptionCodes[0] ?? "";
      const approvedCorrect =
        localization.optionLabels[approvedQuestion.optionCodes.indexOf(approvedCorrectCode)] ?? "";
      if (blueprintCorrect !== approvedCorrect) {
        conflicts.push({
          levelNumber: contract.levelNumber,
          field: `questions[${index}].correctAnswerText`,
          blueprintValue: blueprintCorrect,
          otherSource,
          otherValue: approvedCorrect,
          note,
        });
      }
    });
  }
  return conflicts.sort((a, b) =>
    a.levelNumber - b.levelNumber || (a.field < b.field ? -1 : a.field > b.field ? 1 : 0),
  );
}

/* ------------------------------------------------------------------ *
 * Document-level provenance
 * ------------------------------------------------------------------ */

function bulletsUnder(blocks: DocxBlock[], heading: string, headingStyle: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const block of blocks) {
    if (block.kind === "table") {
      if (inside) continue;
      continue;
    }
    const text = block.text.trim();
    if (block.style === "Heading1" || block.style === "Heading2" || block.style === "Heading3") {
      inside = block.style === headingStyle && text === heading;
      continue;
    }
    if (inside && text.length > 0) out.push(stripBullet(text).replace(/\s+/g, " "));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function build(docxPath: string) {
  const archive = readFileSync(docxPath);
  const sourceDocumentSha256 = createHash("sha256").update(archive).digest("hex");
  const core = readDocxCoreProperties(archive);
  const blocks = readDocxBlocks(archive);

  const cover = blocks
    .filter((block): block is Extract<DocxBlock, { kind: "paragraph" }> => block.kind === "paragraph")
    .map((block) => block.text.trim());
  const versionLine = cover.find((line) => line.startsWith("Версия ")) ?? "";
  const versionMatch = /^Версия\s+([\d.]+)\s*·\s*источник:\s*Academy commit\s+([0-9a-f]+)/u.exec(versionLine);
  if (!versionMatch) fail("the cover does not declare «Версия … · источник: Academy commit …»");

  const lessons = sliceLessons(blocks);
  const contracts = lessons.map(buildContract).sort((a, b) => a.levelNumber - b.levelNumber);

  const counts = {
    lessons: contracts.length,
    takes: contracts.reduce((total, contract) => total + contract.takes.length, 0),
    questions: contracts.reduce((total, contract) => total + contract.questions.length, 0),
    correctAnswers: contracts.reduce(
      (total, contract) =>
        total + contract.questions.filter((question) => question.options.some((option) => option.correct)).length,
      0,
    ),
    takeQuestionMappings: contracts.reduce(
      (total, contract) => total + contract.questions.filter((question) => question.takeId.length > 0).length,
      0,
    ),
  };

  const file = {
    $schema: VIDEO_CONTRACTS_SCHEMA_ID,
    $comment:
      "NORMALIZED VIDEO-PRODUCTION CONTRACTS, not learner content. Extracted verbatim from the " +
      "editorial Blueprint by scripts/curriculum/extractVideoBlueprint.ts. Questions, options and " +
      "correct answers are transferred unchanged. Every contract is AWAITING_APPROVAL: " +
      "sourceProvenance records where the material came from, approval records whether the platform " +
      "has signed it, and the two are never the same question. Read only by build/audit scripts and " +
      "by the ATA video profile — never at runtime.",
    extractionFormatVersion: VIDEO_CONTRACTS_EXTRACTION_FORMAT_VERSION,
    provenance: {
      sourceDocument: path.basename(docxPath),
      sourceTitle: core["dc:title"] ?? "",
      sourceVersion: versionMatch[1],
      sourceDocumentSha256,
      declaredSourceRepository: "academy",
      declaredSourceCommit: versionMatch[2],
      acceptedAcademyReference: ACCEPTED_ACADEMY_REFERENCE,
      sourceCommitReconciliation:
        `The Blueprint declares Academy commit ${versionMatch[2]}; this repository transferred structure from ` +
        `${ACCEPTED_ACADEMY_REFERENCE}. The former is an ancestor of the latter and the four cited source files ` +
        "(src/data/curriculum/fixture.ts, les-prog.txt, docs/CURRICULUM_AND_UNLOCKS.md, " +
        "src/features/lesson/data/lesson-fixtures.ts) are byte-identical between the two commits, so the two " +
        "snapshots agree exactly and this is provenance, not a conflict. Verified by " +
        "scripts/curriculum/verifyAcademyTransfer.ts, which needs an explicit Academy checkout path.",
      extractedBy: "scripts/curriculum/extractVideoBlueprint.ts",
      globalEditorialConstraints: bulletsUnder(blocks, "Редакционные ограничения", "Heading2"),
      globalVideoFormat: bulletsUnder(blocks, "Единый формат ролика", "Heading2"),
      productionHandoff: bulletsUnder(blocks, "5. Передача в продакшен и инженерную команду", "Heading1"),
      sourceAuthorities: bulletsUnder(blocks, "6. Источники и статус достоверности", "Heading1"),
    },
    counts,
    sourceConflicts: reconcileWithApprovedPackage(contracts),
    contracts,
  };

  const parsed = parseVideoProductionContracts(file);
  if (!parsed.ok) fail(`the extracted artifact does not satisfy its own schema:\n  ${parsed.issues.slice(0, 8).join("\n  ")}`);

  if (brandSubstitutions.length > 0) {
    // Recorded rather than hidden. The current document triggers none.
    console.error(`brand substitutions applied: ${JSON.stringify(brandSubstitutions)}`);
  }

  return { file, serialized: serialize(file), counts, sourceDocumentSha256 };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function main() {
  const args = process.argv.slice(2);
  const docxIndex = args.indexOf("--docx");
  if (docxIndex === -1 || !args[docxIndex + 1]) {
    console.error(
      "usage: extractVideoBlueprint.ts --docx <path to ATA_VIDEO_LESSONS_PRODUCTION_BLUEPRINT_V1.docx> [--check]\n" +
        "The document is an editorial deliverable and is deliberately NOT committed; pass its path explicitly.",
    );
    process.exitCode = 2;
    return;
  }
  const docxPath = path.resolve(args[docxIndex + 1]);
  const { serialized, counts, sourceDocumentSha256 } = build(docxPath);

  if (args.includes("--check")) {
    const existing = readFileSync(OUTPUT, "utf8");
    if (existing !== serialized) {
      console.error(`DRIFT: ${OUTPUT} does not match a fresh extraction of ${docxPath}`);
      process.exitCode = 1;
      return;
    }
    console.log(`ok ${OUTPUT} matches the Blueprint`);
  } else {
    writeFileSync(OUTPUT, serialized);
    console.log(`written ${OUTPUT}`);
  }

  console.log(
    JSON.stringify(
      {
        sourceDocument: path.basename(docxPath),
        sourceDocumentSha256,
        bytes: Buffer.byteLength(serialized, "utf8"),
        counts,
        brandSubstitutions: brandSubstitutions.length,
      },
      null,
      2,
    ),
  );
}

main();
