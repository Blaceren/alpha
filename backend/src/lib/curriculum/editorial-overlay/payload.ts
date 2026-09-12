/**
 * PHASE-G2 CORRECTION-1 — the reviewed learner payload, and its one normalisation.
 *
 * WHY THIS MODULE EXISTS. Overlay v1 transported approval evidence and nothing
 * else, on the assumption that the structural package already held the bytes the
 * reviewer approved. That assumption is false for the accepted corpus: the review
 * phase EDITED content and banks after the structural baseline was cut (the
 * checkpoint's own audit log records 381 assessment-localization updates, 167
 * question updates and 115 content-localization updates, and content revisions
 * run to 21). Measured against a live-derived target, 77 of 79 content bodies and
 * 164 of 236 correct answers differed from the accepted checkpoint — while every
 * one of them received `approved`, the reviewer's id and the reviewer's timestamp.
 * An approval was being attached to bytes nobody reviewed, and publication of that
 * content then succeeded.
 *
 * So the overlay must carry the REVIEWED STATE, not metadata about a baseline.
 *
 * ONE NORMALISATION, THREE SOURCES. The same payload shape is derived from three
 * places and must hash identically when they agree:
 *
 *   • the STRUCTURAL PACKAGE  — what a target holds right after a structural
 *     import, i.e. the expected pre-editorial baseline;
 *   • the ACCEPTED CHECKPOINT — what the reviewer actually approved;
 *   • the TARGET DATABASE     — what is really there at import time.
 *
 * A hash computed from one and compared against another is only meaningful if the
 * projection is literally the same code, so there is exactly one of each shape
 * here and every caller goes through it.
 *
 * THE PACKAGE PROJECTION REUSES THE IMPORTER'S OWN MAPPING. `questionCode` is not
 * `stableKey`, `optionCodes` is not `options`, and `correctOptionCodes` is not
 * `correctAnswer` — the structural importer transforms all three. Re-deriving
 * those rules here would create a second definition that could silently drift from
 * the first, so `canonicalOptionsJson`, `canonicalOptionLabelsJson` and
 * `correctAnswerJson` are imported from the package importer rather than copied.
 *
 * WHAT THE HASH COVERS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Covered: everything the review decided — every learner-visible string and JSON
 * body, the answer key, the option set, the take/stable key, the question number,
 * the pass mark, the attempt limit, the explanation policy.
 *
 * Not covered, because none of it is the reviewed result:
 *   • row ids and foreign keys — target-local by construction;
 *   • `createdAt` / `updatedAt`   — storage bookkeeping. For a version the
 *     structural import created, `createdAt` records when THIS database made the
 *     row, and `updatedAt` is owned by Prisma's `@updatedAt`;
 *   • `status` / `publishedAt` / `archivedAt` — PUBLICATION state, which this
 *     transport never touches and which an operator legitimately changes after
 *     the import. Including them would make a replay fail the moment content was
 *     published, which is exactly when a replay most needs to still work;
 *   • `revision` and the four-eyes actor/instant fields — transported and
 *     compared separately as editorial evidence, not as reviewed payload.
 */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  canonicalOptionLabelsJson,
  canonicalOptionsJson,
  correctAnswerJson,
} from "@/lib/curriculum/package/import";
import type { PackageQuestion } from "@/lib/curriculum/package/schema";
import { expectedTakeIdFor, isAtaVideoProfileLevel } from "@/lib/curriculum/authoring-level-profile";

/* ------------------------------------------------------------------ *
 * canonical JSON
 * ------------------------------------------------------------------ */

/**
 * Recursively key-sorted JSON. Two structurally equal values serialise to the
 * same string whatever order their keys were written in, which matters because
 * one side of every comparison came out of SQLite and the other out of a file.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return value.map(canonicalise);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) out[key] = canonicalise(source[key]);
  return out;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * A Prisma Json column round-trips as a parsed value, but a package file and a
 * hand-built fixture may hand us the same thing as a string. Parse when it looks
 * like JSON so the two never hash differently for a formatting reason.
 */
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/* ------------------------------------------------------------------ *
 * the shapes
 * ------------------------------------------------------------------ */

export type ContentLocalizationPayload = {
  locale: string;
  title: string;
  subtitle: string;
  learningObjectiveExtension: string;
  summary: string;
  transcript: string | null;
  body: unknown;
};

export type ContentReviewedPayload = {
  videoDurationSeconds: number | null;
  changeNotes: string | null;
  localizations: ContentLocalizationPayload[];
};

export type QuestionLocalizationPayload = {
  locale: string;
  prompt: string;
  optionLabels: unknown;
  explanation: string | null;
};

export type QuestionPayload = {
  stableKey: string;
  questionNumber: number;
  type: string;
  skillTag: string | null;
  status: string;
  options: unknown;
  correctAnswer: unknown;
  localizations: QuestionLocalizationPayload[];
};

export type AssessmentReviewedPayload = {
  passPercent: number;
  maxAttempts: number | null;
  showExplanation: boolean;
  changeNotes: string | null;
  questions: QuestionPayload[];
};

/* ------------------------------------------------------------------ *
 * normalisation + hashing
 * ------------------------------------------------------------------ */

const byLocale = (a: { locale: string }, b: { locale: string }) => (a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0);
const byStableKey = (a: { stableKey: string }, b: { stableKey: string }) =>
  a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0;

export function normalizeContentPayload(payload: ContentReviewedPayload): unknown {
  return {
    videoDurationSeconds: payload.videoDurationSeconds ?? null,
    changeNotes: payload.changeNotes ?? null,
    localizations: [...payload.localizations].sort(byLocale).map((l) => ({
      locale: l.locale,
      title: l.title,
      subtitle: l.subtitle,
      learningObjectiveExtension: l.learningObjectiveExtension,
      summary: l.summary,
      transcript: l.transcript ?? null,
      body: canonicalise(jsonValue(l.body)),
    })),
  };
}

export function contentPayloadHash(payload: ContentReviewedPayload): string {
  return sha256(canonicalJson(normalizeContentPayload(payload)));
}

export function normalizeAssessmentPayload(payload: AssessmentReviewedPayload): unknown {
  return {
    passPercent: payload.passPercent,
    maxAttempts: payload.maxAttempts ?? null,
    showExplanation: payload.showExplanation,
    changeNotes: payload.changeNotes ?? null,
    // Sorted by stableKey, and questionNumber is a hashed FIELD rather than the
    // sort order: a reorder that changes which take a question answers to is a
    // different bank, but the physical row order in the target is not.
    questions: [...payload.questions].sort(byStableKey).map((q) => ({
      stableKey: q.stableKey,
      questionNumber: q.questionNumber,
      type: q.type,
      skillTag: q.skillTag ?? null,
      status: q.status,
      options: canonicalise(jsonValue(q.options)),
      correctAnswer: canonicalise(jsonValue(q.correctAnswer)),
      localizations: [...q.localizations].sort(byLocale).map((l) => ({
        locale: l.locale,
        prompt: l.prompt,
        optionLabels: canonicalise(jsonValue(l.optionLabels)),
        explanation: l.explanation ?? null,
      })),
    })),
  };
}

export function assessmentPayloadHash(payload: AssessmentReviewedPayload): string {
  return sha256(canonicalJson(normalizeAssessmentPayload(payload)));
}

/* ------------------------------------------------------------------ *
 * source 1 — a live database (accepted checkpoint, or the import target)
 * ------------------------------------------------------------------ */

export type PayloadReadDb = Pick<
  PrismaClient,
  "contentVersion" | "contentLocalization" | "assessmentVersion" | "questionDefinition" | "questionLocalization"
>;

export async function readContentPayload(
  db: PayloadReadDb,
  contentVersionId: number,
): Promise<ContentReviewedPayload | null> {
  const row = await db.contentVersion.findUnique({
    where: { id: contentVersionId },
    select: { videoDurationSeconds: true, changeNotes: true },
  });
  if (!row) return null;
  const localizations = await db.contentLocalization.findMany({
    where: { contentVersionId },
    select: {
      locale: true,
      title: true,
      subtitle: true,
      learningObjectiveExtension: true,
      summary: true,
      transcript: true,
      body: true,
    },
  });
  return {
    videoDurationSeconds: row.videoDurationSeconds,
    changeNotes: row.changeNotes,
    localizations: localizations.map((l) => ({ ...l, body: l.body as unknown })),
  };
}

export async function readAssessmentPayload(
  db: PayloadReadDb,
  assessmentVersionId: number,
): Promise<AssessmentReviewedPayload | null> {
  const row = await db.assessmentVersion.findUnique({
    where: { id: assessmentVersionId },
    select: { passPercent: true, maxAttempts: true, showExplanation: true, changeNotes: true },
  });
  if (!row) return null;
  const questions = await db.questionDefinition.findMany({
    where: { assessmentVersionId },
    select: {
      id: true,
      stableKey: true,
      questionNumber: true,
      type: true,
      skillTag: true,
      status: true,
      options: true,
      correctAnswer: true,
    },
  });
  const built: QuestionPayload[] = [];
  for (const question of questions) {
    const localizations = await db.questionLocalization.findMany({
      where: { questionId: question.id },
      select: { locale: true, prompt: true, optionLabels: true, explanation: true },
    });
    built.push({
      stableKey: question.stableKey,
      questionNumber: question.questionNumber,
      type: question.type as string,
      skillTag: question.skillTag,
      status: question.status as string,
      options: question.options as unknown,
      correctAnswer: question.correctAnswer as unknown,
      localizations: localizations.map((l) => ({ ...l, optionLabels: l.optionLabels as unknown })),
    });
  }
  return { ...row, questions: built };
}

/* ------------------------------------------------------------------ *
 * source 2 — the structural package (the EXPECTED baseline)
 * ------------------------------------------------------------------ */

export type PackageLevelShape = {
  levelCode: string;
  levelNumber: number;
  type: string;
  content?: {
    versionNumber: number;
    videoDurationSeconds: number | null;
    localizations: ContentLocalizationPayload[];
  } | null;
  assessment?: {
    versionNumber: number;
    passPercent: number;
    maxAttempts: number | null;
    showExplanation: boolean;
    questions: Array<
      PackageQuestion & {
        localizations: Array<{ locale: string; prompt: string; optionLabels: string[]; explanation: string | null }>;
      }
    >;
  } | null;
};

export type PackageShape = {
  curriculumCode: string;
  curriculumVersionNumber: number;
  packageCode: string;
  packageRevision: number;
  contentFingerprint: string;
  modules: Array<{ moduleCode: string; moduleNumber: number; levels: PackageLevelShape[] }>;
};

/** Exactly what a structural import writes for this level's content. */
export function projectPackageContent(level: PackageLevelShape): ContentReviewedPayload | null {
  if (!level.content) return null;
  return {
    videoDurationSeconds: level.content.videoDurationSeconds,
    // The structural importer sets no changeNotes; the column defaults to NULL.
    changeNotes: null,
    localizations: level.content.localizations.map((l) => ({
      locale: l.locale,
      title: l.title,
      subtitle: l.subtitle,
      learningObjectiveExtension: l.learningObjectiveExtension,
      summary: l.summary,
      transcript: l.transcript,
      body: l.body,
    })),
  };
}

/** Exactly what a structural import writes for this level's bank. */
export function projectPackageAssessment(level: PackageLevelShape): AssessmentReviewedPayload | null {
  if (!level.assessment) return null;
  const ataVideoBank = isAtaVideoProfileLevel({
    levelNumber: level.levelNumber,
    stableCode: level.levelCode,
    type: level.type,
  });
  return {
    passPercent: level.assessment.passPercent,
    maxAttempts: level.assessment.maxAttempts,
    showExplanation: level.assessment.showExplanation,
    changeNotes: null,
    questions: level.assessment.questions.map((question) => ({
      stableKey: ataVideoBank
        ? expectedTakeIdFor(level.levelNumber, question.questionNumber)
        : question.questionCode,
      questionNumber: question.questionNumber,
      type: question.type,
      skillTag: question.skillTag,
      // The importer hard-codes `active` for every imported question.
      status: "active",
      options: canonicalOptionsJson(question) ?? null,
      correctAnswer: correctAnswerJson(question),
      localizations: question.localizations.map((l) => ({
        locale: l.locale,
        prompt: l.prompt,
        optionLabels: canonicalOptionLabelsJson(question, l.optionLabels) ?? null,
        explanation: l.explanation,
      })),
    })),
  };
}

/**
 * The structural identity of a level, as the package declares it.
 *
 * This is what kills the stableCode swap: a target whose set of level codes is
 * correct but whose codes have been moved between rows still fails, because the
 * code is checked against the levelNumber and module it is supposed to name.
 */
export type LevelStructuralIdentity = {
  level: string;
  levelNumber: number;
  moduleCode: string;
  moduleNumber: number;
  type: string;
};

export function projectPackageLevelIdentities(pkg: PackageShape): LevelStructuralIdentity[] {
  const out: LevelStructuralIdentity[] = [];
  for (const packageModule of pkg.modules) {
    for (const level of packageModule.levels) {
      out.push({
        level: level.levelCode,
        levelNumber: level.levelNumber,
        moduleCode: packageModule.moduleCode,
        moduleNumber: packageModule.moduleNumber,
        type: level.type,
      });
    }
  }
  return out.sort((a, b) => (a.level < b.level ? -1 : a.level > b.level ? 1 : 0));
}
