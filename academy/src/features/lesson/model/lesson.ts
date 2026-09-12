/**
 * Lesson domain types (Phase D2B). Pure types — no UI, no data, no progress.
 *
 * The curriculum fixture (src/data/curriculum/fixture.ts) stays the canon for
 * level number, module, title, kind, artifact, mentor review and sequence.
 * This module owns only what a lesson NEEDS ON TOP of that: media, sections,
 * outcomes, requirements, assessment and the completion rule. Lesson bodies are
 * deliberately NOT stored on the curriculum fixture (see DD-243).
 *
 * Stable codes (level.018, q.018.1) are NEVER rendered to the user — only
 * human-readable RU labels are.
 */

import type { CurriculumLevel } from "@/domain/curriculum";

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

/**
 * Lesson media descriptor.
 *
 * `kind: "simulated"` is honest: no approved lesson recording exists yet, so the
 * player drives a deterministic local timeline over an abstract educational
 * frame. It never pretends to be a loaded production stream and it never points
 * at an external URL / CDN (DD-244).
 */
export interface LessonMedia {
  kind: "simulated";
  /** Accessible name of the media region. */
  title: string;
  /** Total length in seconds. Deterministic — no Date.now(), no random. */
  durationSeconds: number;
  /** Whether a captions affordance is offered for this media. */
  captionsAvailable: boolean;
  /** Short RU note explaining the media state honestly. */
  provisionalNote: string;
}

/* ------------------------------------------------------------------ *
 * Body
 * ------------------------------------------------------------------ */

/** One chapter of the lesson body, anchored to a position on the timeline. */
export interface LessonSection {
  /** Stable code, e.g. "section.018.zones". */
  id: string;
  /** RU heading. */
  title: string;
  /** Start position in seconds (used for the outline, not for unlocking). */
  startSeconds: number;
  /** RU body — one restrained paragraph. */
  body: string;
}

/** A single "after this lesson you can…" statement. */
export interface LessonLearningOutcome {
  id: string;
  text: string;
}

/* ------------------------------------------------------------------ *
 * Assessment
 * ------------------------------------------------------------------ */

export interface AssessmentOption {
  /** Stable code, unique within its question, e.g. "q.018.1.b". */
  id: string;
  /** RU option text. */
  text: string;
  /** Never revealed to the user before submit. */
  correct: boolean;
}

/** Explanation shown AFTER submit — educational, never punitive. */
export interface AssessmentFeedback {
  /** Shown when the submitted option is correct. */
  correct: string;
  /** Shown when the submitted option is not correct. Explains the idea; it does
   *  NOT reveal which option is correct, because the question stays open for a
   *  calm retry (DD-247). */
  incorrect: string;
}

export interface AssessmentQuestion {
  /** Stable code, e.g. "q.018.1". */
  id: string;
  /** RU prompt. */
  prompt: string;
  /** D2B supports single choice only (DD-246). */
  kind: "single-choice";
  /** Exactly one option has correct: true (enforced by tests). */
  options: AssessmentOption[];
  feedback: AssessmentFeedback;
  /** Required questions gate completion. D2B: every question is required. */
  required: boolean;
}

export interface LessonAssessment {
  /** Stable code, e.g. "assessment.018". */
  id: string;
  /** RU section heading. */
  title: string;
  /** Deterministic order — never shuffled (DD-248). */
  questions: AssessmentQuestion[];
}

/* ------------------------------------------------------------------ *
 * Requirements & completion
 * ------------------------------------------------------------------ */

/** What the level asks of the user, in plain RU, for the context rail. */
export interface LessonRequirement {
  id: string;
  kind: "watch" | "assessment" | "mentor-review" | "artifact";
  label: string;
}

/**
 * Provisional frontend completion rule (DD-245). NOT a backend contract:
 * no editorial or backend source defines a passing score, so every question is
 * required and there is no percentage threshold.
 */
export interface LessonCompletionRule {
  /** Verified watch percent that unlocks the assessment. Canon: 50 (DD-062). */
  unlockWatchPercent: number;
  /** Full watch is never required. */
  requiresFullWatch: false;
  /** Every required question must be answered correctly at least once. */
  requiresAllRequiredQuestionsCorrect: true;
  /** Marks the rule as a frontend development rule, not a server contract. */
  provisional: true;
}

/* ------------------------------------------------------------------ *
 * Lesson definition
 * ------------------------------------------------------------------ */

/**
 * Everything the lesson experience needs for one level. `level` is the
 * curriculum record — the fixture never duplicates title/module/sequence.
 */
export interface LessonDefinition {
  /** Mirrors level.code, e.g. "level.018". */
  code: string;
  /** The canonical curriculum record (title, module, kind, sequence). */
  level: CurriculumLevel;
  /** One-sentence RU goal of the lesson. */
  goal: string;
  media: LessonMedia;
  outcomes: LessonLearningOutcome[];
  sections: LessonSection[];
  requirements: LessonRequirement[];
  assessment: LessonAssessment;
  completionRule: LessonCompletionRule;
  /** True while the wording is a development fixture awaiting editorial content. */
  contentProvisional: boolean;
}

/**
 * A level that is reachable but whose full experience is not built in D2B
 * (e.g. L19 is a practical/report level). Carries curriculum context only — it
 * never fabricates a body, media or an assessment, and it exists so the
 * next-lesson gate has an honest destination instead of a 404 or a fake unlock.
 */
export interface LessonStub {
  code: string;
  level: CurriculumLevel;
  /** RU explanation of what this level asks and when its experience arrives. */
  note: string;
}

/** What the lesson route resolved for a level number. */
export type LessonEntry =
  | { kind: "full"; lesson: LessonDefinition }
  | { kind: "stub"; stub: LessonStub };

/* ------------------------------------------------------------------ *
 * Level code helpers
 * ------------------------------------------------------------------ */

/** Canonical route segment for a level number: 18 → "level.018". */
export function levelCodeFor(levelNumber: number): string {
  return `level.${String(levelNumber).padStart(3, "0")}`;
}

/**
 * Parse a route segment back to a level number. Returns null for anything that
 * is not a canonical `level.NNN` in 1–100, so the route can answer with a
 * proper "unknown lesson" state instead of throwing.
 */
export function parseLevelCode(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /^level\.(\d{3})$/.exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 100) return null;
  return value;
}

/** RU duration label from seconds: 480 → "8:00". Deterministic, no locale. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
