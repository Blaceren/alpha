/**
 * PHASE-G1 — the EXACT learner preview: building the frozen frame, and reading
 * it back without ever following the draft.
 *
 * ============================ THE ONE PROPERTY ============================
 * A preview renders the state that was frozen, and nothing else. G0 built the
 * snapshot table for exactly this reason: draft rows are mutable by design, so
 * naming a `ContentVersion` id names a moving target and staff would review text
 * that no longer exists while believing they reviewed what they clicked.
 *
 * The final G0 closeout recorded a TEST gap here (LOW-1): a mutant that made the
 * snapshot read follow the latest video revision survived the suite. The read
 * below returns `snapshot.payload` and the stored revision literals and performs
 * NO query against `contentVersion`, `assessmentVersion` or
 * `videoProductionVersion` — there is nothing in `readLearnerPreview` that could
 * follow anything. `curriculumAuthoringPreviewRegression` drives the real HTTP
 * route with a snapshot pinned at 4/7/3 while the aggregates stand at 5/8/4 and
 * fails if either the body or a pinned revision moves.
 *
 * ========================== LEARNER-SAFE BY BUILD ==========================
 * `buildLearnerPreviewPayload` is the ONLY producer of a snapshot payload, and
 * it never reads `QuestionDefinition.correctAnswer`. Not "reads and strips" —
 * the Prisma `select` does not contain the column, so there is no code path on
 * which an answer key could reach the frozen JSON even if a later edit forgot to
 * remove it. `assertLearnerSafe` re-checks the produced object and refuses to
 * freeze one that carries a forbidden key, so a future contributor who adds the
 * field to the select gets a failure rather than a leak.
 *
 * Explanations are excluded for the same reason. An explanation is not formally
 * the answer key, but ATA explanations routinely name the correct option in
 * prose, and a preview frame is not the place to discover that.
 *
 * `snapshotCode` IS NOT A CREDENTIAL. Nothing in this module authorizes
 * anything. Every caller must already have resolved a staff session and checked
 * `curriculum_read`.
 */
import type { Prisma } from "@prisma/client";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import {
  createPreviewSnapshot,
  readPreviewSnapshotByCode,
} from "@/lib/curriculum/authoring-preview-snapshot";
import { AUTHORING_LOCALE } from "@/lib/curriculum/authoring-read";
import { requiresLearnerTeachingContent } from "@/lib/curriculum/authoring-level-profile";
import { CANONICAL_ASSESSMENT_LOCALE } from "@/lib/curriculum/authoring-assessment-projection";
import { normalizeContentBody, parseContentBody } from "@/lib/curriculum/content-body";
import { prisma } from "@/lib/prisma";

export const LEARNER_PREVIEW_SCHEMA = "ata.authoring.preview/1" as const;

/**
 * Keys that may never appear anywhere inside a frozen preview payload.
 *
 * The accepted authority-key vocabulary from `content-validation.ts` — which
 * already refuses these in a STORED body — extended with the two an assessment
 * projection could introduce and with `explanation`. Compared lowercased, for
 * the same reason the accepted list is.
 *
 * The bare key `correct` is deliberately NOT here. It would fire on nothing a
 * preview can contain and would risk refusing a legitimate legacy body, and a
 * safety check that cries wolf is a safety check somebody deletes.
 */
const FORBIDDEN_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "correctanswer",
  "correctanswers",
  "correctoption",
  "correctoptions",
  "correctoptioncode",
  "correctoptioncodes",
  "answerkey",
  "iscorrect",
  "explanation",
]);

export type LearnerPreviewAsset = {
  assetCode: string;
  kind: string;
  url: string;
  mimeType: string;
  durationSeconds: number | null;
  sizeBytes: number | null;
};

export type LearnerPreviewQuestion = {
  questionNumber: number;
  prompt: string;
  /** Option code + label only. No `correct` flag exists on this shape. */
  options: Array<{ code: string; label: string }>;
};

export type LearnerPreviewPayload = {
  schema: typeof LEARNER_PREVIEW_SCHEMA;
  level: {
    levelNumber: number;
    stableCode: string;
    title: string;
    levelType: string;
    completionMethod: string;
    xpReward: number;
    moduleNumber: number;
    moduleTitle: string;
    learningObjective: string;
    shortDescription: string;
  };
  content: {
    locale: string;
    title: string;
    subtitle: string;
    learningObjectiveExtension: string;
    summary: string;
    sourceFormat: "legacy_v1" | "blocks_v2";
    sections: Array<{ code: string; title: string; blocks: unknown[] }>;
    appendix: unknown[];
    assets: LearnerPreviewAsset[];
  } | null;
  assessment: {
    passPercent: number;
    maxAttempts: number | null;
    questionCount: number;
    questions: LearnerPreviewQuestion[];
  } | null;
};

/**
 * Refuse to freeze anything carrying an answer key.
 *
 * Defence in depth: the SELECT above cannot produce one, and this catches the
 * day somebody widens it. Recursive over arrays and objects, because a key one
 * level down is exactly as visible to a browser as a key at the root.
 */
export function assertLearnerSafe(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertLearnerSafe(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) {
      throw new AuthoringDomainError(
        "AUTHORING_PREVIEW_UNSAFE",
        `preview payload may not contain "${key}" (at ${path}.${key})`,
      );
    }
    assertLearnerSafe(child, `${path}.${key}`);
  }
}

/**
 * Build the learner frame for one level from the versions named.
 *
 * The versions are named by the CALLER (the Studio knows which draft the editor
 * is looking at) but every value is read from the database here, and the level
 * ownership of each version is re-checked by `createPreviewSnapshot` before
 * anything is frozen.
 */
export async function buildLearnerPreviewPayload(input: {
  levelDefinitionId: number;
  contentVersionId: number | null;
  assessmentVersionId: number | null;
}): Promise<LearnerPreviewPayload> {
  const level = await prisma.levelDefinition.findUnique({
    where: { id: input.levelDefinitionId },
    select: {
      levelNumber: true,
      stableCode: true,
      title: true,
      type: true,
      completionMethod: true,
      xpReward: true,
      learningObjective: true,
      shortDescription: true,
      module: { select: { moduleNumber: true, title: true } },
    },
  });
  if (!level) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `LevelDefinition ${input.levelDefinitionId} does not exist`,
    );
  }

  let content: LearnerPreviewPayload["content"] = null;
  if (input.contentVersionId !== null) {
    const version = await prisma.contentVersion.findUnique({
      where: { id: input.contentVersionId },
      select: {
        localizations: {
          where: { locale: AUTHORING_LOCALE },
          select: {
            locale: true,
            title: true,
            subtitle: true,
            learningObjectiveExtension: true,
            summary: true,
            body: true,
          },
        },
        assets: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            assetCode: true,
            kind: true,
            url: true,
            mimeType: true,
            durationSeconds: true,
            sizeBytes: true,
          },
        },
      },
    });
    const localization = version?.localizations[0] ?? null;
    if (!localization) {
      throw new AuthoringDomainError(
        "AUTHORING_INPUT_INVALID",
        `ContentVersion ${input.contentVersionId} has no "${AUTHORING_LOCALE}" localization to preview`,
      );
    }
    const parsed = parseContentBody(localization.body);
    if (!parsed.ok) {
      throw new AuthoringDomainError(
        "AUTHORING_INPUT_INVALID",
        "content body does not parse — fix validation before previewing",
        { issues: parsed.issues.map((i) => ({ code: "CONTENT_BODY_INVALID", path: i.path.join("."), message: i.message })) },
      );
    }
    // The ACCEPTED normalizer, so the preview frame is exactly the shape the
    // learner renderer receives in production — including the v1 → v2 anchor
    // projection. A second normalizer here would be a second renderer.
    const normalized = normalizeContentBody(parsed.body);
    content = {
      locale: localization.locale,
      title: localization.title,
      subtitle: localization.subtitle,
      learningObjectiveExtension: localization.learningObjectiveExtension,
      summary: localization.summary,
      sourceFormat: normalized.sourceFormat,
      sections: normalized.sections.map((section) => ({
        code: section.code,
        title: section.title,
        blocks: section.blocks as unknown[],
      })),
      appendix: normalized.appendix as unknown[],
      assets: version?.assets ?? [],
    };
  }

  let assessment: LearnerPreviewPayload["assessment"] = null;
  if (input.assessmentVersionId !== null) {
    const version = await prisma.assessmentVersion.findUnique({
      where: { id: input.assessmentVersionId },
      select: {
        passPercent: true,
        maxAttempts: true,
        questions: {
          where: { status: "active" },
          orderBy: { questionNumber: "asc" },
          select: {
            questionNumber: true,
            options: true,
            // `correctAnswer` is DELIBERATELY ABSENT from this select.
            localizations: {
              where: { locale: CANONICAL_ASSESSMENT_LOCALE },
              select: { prompt: true, optionLabels: true },
            },
          },
        },
      },
    });
    if (!version) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `AssessmentVersion ${input.assessmentVersionId} does not exist`,
      );
    }
    assessment = {
      passPercent: version.passPercent,
      maxAttempts: version.maxAttempts,
      questionCount: version.questions.length,
      questions: version.questions.map((question) => ({
        questionNumber: question.questionNumber,
        prompt: question.localizations[0]?.prompt ?? "",
        options: learnerOptions(question.options, question.localizations[0]?.optionLabels),
      })),
    };
  }

  const payload: LearnerPreviewPayload = {
    schema: LEARNER_PREVIEW_SCHEMA,
    level: {
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      title: level.title,
      levelType: level.type,
      completionMethod: level.completionMethod,
      xpReward: level.xpReward,
      moduleNumber: level.module.moduleNumber,
      moduleTitle: level.module.title,
      learningObjective: level.learningObjective,
      shortDescription: level.shortDescription,
    },
    content,
    assessment,
  };

  assertLearnerSafe(payload);
  return payload;
}

/**
 * Option code + label, with no correctness anywhere in the produced shape.
 *
 * Built from the option SET so the order is the authored order, and a code with
 * no label is dropped rather than rendered as an empty radio a learner could
 * select.
 */
function learnerOptions(options: unknown, labels: unknown): Array<{ code: string; label: string }> {
  if (!Array.isArray(options)) return [];
  const record =
    labels && typeof labels === "object" && !Array.isArray(labels)
      ? (labels as Record<string, unknown>)
      : {};
  const result: Array<{ code: string; label: string }> = [];
  for (const option of options) {
    if (!option || typeof option !== "object" || Array.isArray(option)) continue;
    const code = (option as { code?: unknown }).code;
    if (typeof code !== "string") continue;
    const label = record[code];
    if (typeof label !== "string") continue;
    result.push({ code, label });
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Creating a snapshot
 * ------------------------------------------------------------------ */

export type CreateLevelPreviewResult = {
  snapshotCode: string;
  levelDefinitionId: number;
  contentVersionId: number | null;
  contentRevision: number | null;
  assessmentVersionId: number | null;
  assessmentRevision: number | null;
  videoProductionVersionId: number | null;
  videoProductionRevision: number | null;
  createdAt: Date;
};

/**
 * Freeze a preview of one level.
 *
 * The revisions are NOT parameters — `createPreviewSnapshot` reads each named
 * version's current revision inside its own transaction, so a caller cannot
 * claim a snapshot was taken at a revision that never existed.
 */
export async function createLevelPreviewSnapshot(input: {
  levelDefinitionId: number;
  contentVersionId: number | null;
  assessmentVersionId: number | null;
  videoProductionVersionId: number | null;
  actorId: number;
}): Promise<CreateLevelPreviewResult> {
  const payload = await buildLearnerPreviewPayload({
    levelDefinitionId: input.levelDefinitionId,
    contentVersionId: input.contentVersionId,
    assessmentVersionId: input.assessmentVersionId,
  });

  const snapshot = await createPreviewSnapshot({
    levelDefinitionId: input.levelDefinitionId,
    contentVersionId: input.contentVersionId,
    assessmentVersionId: input.assessmentVersionId,
    videoProductionVersionId: input.videoProductionVersionId,
    payload: payload as unknown as Prisma.InputJsonValue,
    actorId: input.actorId,
  });

  return {
    snapshotCode: snapshot.snapshotCode,
    levelDefinitionId: snapshot.levelDefinitionId,
    contentVersionId: snapshot.contentVersionId,
    contentRevision: snapshot.contentRevision,
    assessmentVersionId: snapshot.assessmentVersionId,
    assessmentRevision: snapshot.assessmentRevision,
    videoProductionVersionId: snapshot.videoProductionVersionId,
    videoProductionRevision: snapshot.videoProductionRevision,
    createdAt: snapshot.createdAt,
  };
}

/* ------------------------------------------------------------------ *
 * Reading a snapshot
 * ------------------------------------------------------------------ */

export type LearnerPreviewRead = {
  snapshotCode: string;
  levelDefinitionId: number;
  createdAt: Date;
  /** The revisions this preview IS. Literals from the row; never re-derived. */
  pinned: {
    contentVersionId: number | null;
    contentRevision: number | null;
    assessmentVersionId: number | null;
    assessmentRevision: number | null;
    videoProductionVersionId: number | null;
    videoProductionRevision: number | null;
  };
  payload: LearnerPreviewPayload;
};

/**
 * THE LEARNER-SAFE READ.
 *
 * Reads the snapshot row and returns its frozen payload. There is deliberately
 * no query here against any version table: this function CANNOT follow a draft,
 * which is the property the G0 LOW-1 gate exists to hold.
 *
 * The payload is re-checked with `assertLearnerSafe` on the way out. It was
 * checked before it was frozen, so a failure here means the row was written by
 * something other than `createLevelPreviewSnapshot` — in which case refusing is
 * the only safe answer.
 */
export async function readLearnerPreview(
  snapshotCode: string,
): Promise<LearnerPreviewRead | null> {
  const snapshot = await readPreviewSnapshotByCode(snapshotCode);
  if (!snapshot) return null;
  if (snapshot.expiresAt !== null && snapshot.expiresAt.getTime() <= Date.now()) return null;

  const payload = snapshot.payload as unknown;
  assertLearnerSafe(payload);

  return {
    snapshotCode: snapshot.snapshotCode,
    levelDefinitionId: snapshot.levelDefinitionId,
    createdAt: snapshot.createdAt,
    pinned: {
      contentVersionId: snapshot.contentVersionId,
      contentRevision: snapshot.contentRevision,
      assessmentVersionId: snapshot.assessmentVersionId,
      assessmentRevision: snapshot.assessmentRevision,
      videoProductionVersionId: snapshot.videoProductionVersionId,
      videoProductionRevision: snapshot.videoProductionRevision,
    },
    payload: payload as LearnerPreviewPayload,
  };
}

/**
 * The STAFF-SIDE inspection of a snapshot.
 *
 * Separate function, separate route, separate shape — because the learner frame
 * and internal authoring metadata must not be reachable through one response
 * (G0 §10). This one DOES read the current rows, and labels what it finds as
 * CURRENT: it exists to answer "has the draft moved since I froze this?", which
 * is the opposite of following the draft.
 */
export type InternalPreviewRead = {
  snapshotCode: string;
  levelDefinitionId: number;
  createdAt: Date;
  pinned: LearnerPreviewRead["pinned"];
  current: {
    contentRevision: number | null;
    assessmentRevision: number | null;
    videoProductionRevision: number | null;
  };
  /** True when any pinned revision no longer matches its aggregate. */
  outdated: boolean;
};

export async function readInternalPreview(
  snapshotCode: string,
): Promise<InternalPreviewRead | null> {
  const snapshot = await readPreviewSnapshotByCode(snapshotCode);
  if (!snapshot) return null;

  const [content, assessment, video] = await Promise.all([
    snapshot.contentVersionId === null
      ? Promise.resolve(null)
      : prisma.contentVersion.findUnique({
          where: { id: snapshot.contentVersionId },
          select: { revision: true },
        }),
    snapshot.assessmentVersionId === null
      ? Promise.resolve(null)
      : prisma.assessmentVersion.findUnique({
          where: { id: snapshot.assessmentVersionId },
          select: { revision: true },
        }),
    snapshot.videoProductionVersionId === null
      ? Promise.resolve(null)
      : prisma.videoProductionVersion.findUnique({
          where: { id: snapshot.videoProductionVersionId },
          select: { revision: true },
        }),
  ]);

  const current = {
    contentRevision: content?.revision ?? null,
    assessmentRevision: assessment?.revision ?? null,
    videoProductionRevision: video?.revision ?? null,
  };

  const pinned = {
    contentVersionId: snapshot.contentVersionId,
    contentRevision: snapshot.contentRevision,
    assessmentVersionId: snapshot.assessmentVersionId,
    assessmentRevision: snapshot.assessmentRevision,
    videoProductionVersionId: snapshot.videoProductionVersionId,
    videoProductionRevision: snapshot.videoProductionRevision,
  };

  const outdated =
    (pinned.contentRevision !== null && pinned.contentRevision !== current.contentRevision) ||
    (pinned.assessmentRevision !== null &&
      pinned.assessmentRevision !== current.assessmentRevision) ||
    (pinned.videoProductionRevision !== null &&
      pinned.videoProductionRevision !== current.videoProductionRevision);

  return {
    snapshotCode: snapshot.snapshotCode,
    levelDefinitionId: snapshot.levelDefinitionId,
    createdAt: snapshot.createdAt,
    pinned,
    current,
    outdated,
  };
}

/* ------------------------------------------------------------------ *
 * PHASE-G1 CORRECTION — the STRUCTURAL preview of a source-owned level
 * ------------------------------------------------------------------ */

/**
 * WHY THIS IS NOT A SNAPSHOT.
 *
 * G1 required the Studio to preview every level kind, including the report
 * level, the external registration gate and the twenty financial checkpoints.
 * Those levels legitimately carry no ContentVersion and no AssessmentVersion, so
 * `createLevelPreviewSnapshot` refused them outright — and the refusal was not a
 * bug in the guard: `AuthoringPreviewSnapshot_has_target` is a DATABASE CHECK
 * requiring a content or assessment target, so no snapshot row for such a level
 * can exist without a migration.
 *
 * A snapshot exists to FREEZE something that moves. Nothing here moves: a
 * source-owned level's structure is `LevelDefinition` inside a published
 * `CurriculumVersion`, and the Studio has no command that can mutate either —
 * publication and binding stay `UserRole=admin`, and level definitions are
 * source-controlled. Manufacturing a dummy ContentVersion so that an immutable
 * row could point at it would fabricate authoring state that no editor owns, and
 * adding a migration to relax the CHECK would buy immutability that the data
 * already has.
 *
 * So this is a PROJECTION, pinned by identity rather than by revision: the
 * curriculum version and the level definition are named in the response, and two
 * reads of the same pair produce the same learner frame.
 *
 * IT IS THE SAME LEARNER-SAFE SHAPE. `buildLearnerPreviewPayload` builds it with
 * both authoring targets null, so the Academy renders it through exactly the
 * component it renders a snapshot with, and `assertLearnerSafe` runs over it
 * unchanged. There is no second payload contract and no second renderer.
 */
export type StructuralPreviewRead = {
  structural: true;
  levelDefinitionId: number;
  pinned: {
    curriculumVersionId: number;
    curriculumVersionCode: string;
    curriculumVersionNumber: number;
    levelDefinitionId: number;
    stableCode: string;
  };
  payload: LearnerPreviewPayload;
};

export async function readStructuralPreview(
  levelDefinitionId: number,
): Promise<StructuralPreviewRead> {
  const level = await prisma.levelDefinition.findUnique({
    where: { id: levelDefinitionId },
    select: {
      id: true,
      levelNumber: true,
      stableCode: true,
      type: true,
      curriculumVersion: { select: { id: true, code: true, versionNumber: true } },
    },
  });
  if (!level) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `LevelDefinition ${levelDefinitionId} does not exist`,
    );
  }

  // A level that OWES the product a lesson must be previewed through the frozen
  // snapshot, because its body is draft material that moves under the reviewer.
  // Answering here would show an empty frame for a lesson that simply has not
  // been written yet, which is a different and misleading statement.
  if (
    requiresLearnerTeachingContent({
      levelNumber: level.levelNumber,
      stableCode: level.stableCode,
      type: level.type,
    })
  ) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      "this level carries authored learner content — preview it through a snapshot",
    );
  }

  const payload = await buildLearnerPreviewPayload({
    levelDefinitionId: level.id,
    contentVersionId: null,
    assessmentVersionId: null,
  });

  return {
    structural: true,
    levelDefinitionId: level.id,
    pinned: {
      curriculumVersionId: level.curriculumVersion.id,
      curriculumVersionCode: level.curriculumVersion.code,
      curriculumVersionNumber: level.curriculumVersion.versionNumber,
      levelDefinitionId: level.id,
      stableCode: level.stableCode,
    },
    payload,
  };
}
