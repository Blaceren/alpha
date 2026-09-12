/**
 * PHASE-G0 CORRECTION — creating an immutable preview snapshot.
 *
 * G0 landed the TABLE and left creation to G1. The independent audit found the
 * table could pin a content version and an assessment version but not the video
 * production version, so a preview of a video-backed level could not prove which
 * production state it rendered. This module adds the third pin and, with it, the
 * one place a snapshot is allowed to come into existence.
 *
 * WHY A DOMAIN RATHER THAN A ROUTE. There is still no preview HTTP surface in
 * this phase and none is required. What is required is that the pairing rule can
 * never be violated: SQLite refuses a CHECK on `ALTER TABLE ADD COLUMN`, so the
 * video pair could not be a table constraint the way the content and assessment
 * pairs are. Putting creation behind a single function makes the rule
 * enforceable and testable now, instead of being a comment G1 has to remember.
 *
 * EVERY REVISION IS READ, NEVER ACCEPTED. A caller names the versions it wants
 * frozen; the server reads each one's CURRENT revision inside the transaction
 * and stores that. A caller cannot claim a snapshot was taken at a revision that
 * never existed, and cannot pin a revision that has already moved.
 *
 * THE SNAPSHOT DOES NOT FOLLOW. `payload` is written once and never updated by
 * anything in this module, and the pinned revisions are literals. When a draft
 * advances afterwards, the snapshot keeps naming what it rendered — which is the
 * entire reason the table exists.
 *
 * snapshotCode IS NOT A CREDENTIAL. It is generated here as an opaque unique
 * identifier so it can sit in a URL path. Nothing in this module, and nothing in
 * the authorization layer, treats possession of it as permission. The future
 * preview route must resolve the caller's session and re-check `curriculum_read`
 * exactly as every other authoring surface does.
 *
 * LEARNER FRAME AND INTERNAL METADATA ARE SEPARATE BY CONSTRUCTION. `payload`
 * holds the learner-facing render input only. The internal side — correct
 * answers, production metadata, the video contract — is reachable through the
 * PINNED IDS by a staff-side reader that is separately authorized. That is why
 * the pins exist as columns rather than as more JSON inside `payload`: Academy
 * can be handed the frozen learner frame without ever receiving the answer key.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthoringPreviewSnapshot } from "@prisma/client";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { prisma } from "@/lib/prisma";

type DbClient = Prisma.TransactionClient;

/** Long enough to be unguessable, short enough for a URL path. */
const SNAPSHOT_CODE_BYTES = 24;

export type PreviewSnapshotTargets = {
  contentVersionId?: number | null;
  assessmentVersionId?: number | null;
  videoProductionVersionId?: number | null;
};

export type CreatePreviewSnapshotInput = PreviewSnapshotTargets & {
  levelDefinitionId: number;
  /** Learner-facing render input ONLY. No answer keys, no production metadata. */
  payload: Prisma.InputJsonValue;
  actorId: number;
  expiresAt?: Date | null;
};

function generateSnapshotCode(): string {
  return crypto.randomBytes(SNAPSHOT_CODE_BYTES).toString("base64url");
}

/**
 * Freeze a preview.
 *
 * Reads each named version's current revision and writes the id/revision pairs
 * together. A named version that does not exist, or that belongs to a different
 * level, is refused rather than pinned — a snapshot that points across levels
 * would render one lesson while claiming to be another.
 */
export async function createPreviewSnapshot(
  input: CreatePreviewSnapshotInput,
): Promise<AuthoringPreviewSnapshot> {
  const contentVersionId = input.contentVersionId ?? null;
  const assessmentVersionId = input.assessmentVersionId ?? null;
  const videoProductionVersionId = input.videoProductionVersionId ?? null;

  // The accepted table CHECK already requires a content or assessment target.
  // Asserting it here too turns a raw SQLite error into a typed refusal.
  if (contentVersionId === null && assessmentVersionId === null) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      "a preview snapshot must pin a content or an assessment version",
    );
  }

  return prisma.$transaction(async (tx) => {
    const level = await tx.levelDefinition.findUnique({
      where: { id: input.levelDefinitionId },
      select: { id: true, curriculumVersionId: true },
    });
    if (!level) {
      throw new AuthoringDomainError(
        "AUTHORING_TARGET_NOT_FOUND",
        `LevelDefinition ${input.levelDefinitionId} does not exist`,
      );
    }

    const contentRevision = await pinContent(tx, contentVersionId, level.id);
    const assessmentRevision = await pinAssessment(tx, assessmentVersionId, level.id);
    const videoProductionRevision = await pinVideo(tx, videoProductionVersionId, level.id);

    const snapshot = await tx.authoringPreviewSnapshot.create({
      data: {
        snapshotCode: generateSnapshotCode(),
        levelDefinitionId: level.id,
        curriculumVersionId: level.curriculumVersionId,
        contentVersionId,
        contentRevision,
        assessmentVersionId,
        assessmentRevision,
        videoProductionVersionId,
        videoProductionRevision,
        payload: input.payload,
        createdById: input.actorId,
        expiresAt: input.expiresAt ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringPreviewSnapshotCreated,
        entityType: "AuthoringPreviewSnapshot",
        entityId: String(snapshot.id),
        // The pins, not the payload: the trail proves WHAT was frozen without
        // copying a lesson into the audit table.
        metadata: {
          levelDefinitionId: level.id,
          contentVersionId,
          contentRevision,
          assessmentVersionId,
          assessmentRevision,
          videoProductionVersionId,
          videoProductionRevision,
        },
      },
    });

    return snapshot;
  });
}

async function pinContent(tx: DbClient, id: number | null, levelDefinitionId: number) {
  if (id === null) return null;
  const row = await tx.contentVersion.findUnique({
    where: { id },
    select: { revision: true, levelDefinitionId: true },
  });
  if (!row) {
    throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", `ContentVersion ${id} does not exist`);
  }
  if (row.levelDefinitionId !== levelDefinitionId) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      `ContentVersion ${id} does not belong to LevelDefinition ${levelDefinitionId}`,
    );
  }
  return row.revision;
}

async function pinAssessment(tx: DbClient, id: number | null, levelDefinitionId: number) {
  if (id === null) return null;
  const row = await tx.assessmentVersion.findUnique({
    where: { id },
    select: { revision: true, levelDefinitionId: true },
  });
  if (!row) {
    throw new AuthoringDomainError("AUTHORING_TARGET_NOT_FOUND", `AssessmentVersion ${id} does not exist`);
  }
  if (row.levelDefinitionId !== levelDefinitionId) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      `AssessmentVersion ${id} does not belong to LevelDefinition ${levelDefinitionId}`,
    );
  }
  return row.revision;
}

async function pinVideo(tx: DbClient, id: number | null, levelDefinitionId: number) {
  if (id === null) return null;
  const row = await tx.videoProductionVersion.findUnique({
    where: { id },
    select: { revision: true, levelDefinitionId: true },
  });
  if (!row) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `VideoProductionVersion ${id} does not exist`,
    );
  }
  if (row.levelDefinitionId !== levelDefinitionId) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      `VideoProductionVersion ${id} does not belong to LevelDefinition ${levelDefinitionId}`,
    );
  }
  return row.revision;
}

/**
 * Read a snapshot by its code.
 *
 * Deliberately takes NO authorization decision and says so in its name's
 * absence of any "authorized" qualifier: the caller must already have resolved
 * and checked the staff session. Knowing a snapshotCode is not permission to see
 * a snapshot.
 */
export async function readPreviewSnapshotByCode(
  snapshotCode: string,
): Promise<AuthoringPreviewSnapshot | null> {
  return prisma.authoringPreviewSnapshot.findUnique({ where: { snapshotCode } });
}
