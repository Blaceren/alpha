/**
 * PHASE-G0 — append-only editorial review notes.
 *
 * NOT `ReportReview`. That domain reviews a LEARNER's submitted report: it is
 * keyed to a `ReportSubmission`, carries rubric scores and rejection reasons,
 * and its rows are evidence a learner is entitled to see. These rows are
 * internal staff commentary about staff authoring work and no learner surface
 * may ever read them. Reusing the learner model would have placed staff notes
 * one join away from a learner response, which is the exact leak this domain
 * must not have.
 *
 * APPEND-ONLY BY CONSTRUCTION. This module exposes `addReviewNote`,
 * `resolveReviewNote` and two readers. There is no update, no delete and no
 * `deletedAt` column to soft-delete into. A note is CLOSED by resolution, which
 * preserves both what was asked and who accepted it — a reviewer cannot quietly
 * erase a concern after the fact, and an author cannot erase one they would
 * rather not answer.
 *
 * EXACTLY ONE TARGET. The database enforces it with a CHECK constraint and this
 * module re-asserts it before every insert. Both, not either: the CHECK is what
 * makes the invariant true of the DATA even if a future caller bypasses this
 * module, and the domain check is what turns a violation into a typed
 * `AUTHORING_NOTE_TARGET_INVALID` instead of a raw SQLite error.
 */
import { Prisma } from "@prisma/client";
import type { EditorialReviewNote } from "@prisma/client";
import { CURRICULUM_AUDIT_ACTIONS } from "@/lib/curriculum/constants";
import { AuthoringDomainError } from "@/lib/curriculum/authoring-errors";
import type { AuthoringTargetKind } from "@/lib/curriculum/authoring-lifecycle";
import { prisma } from "@/lib/prisma";

const MAX_BODY_LENGTH = 4_000;
const MAX_PATH_LENGTH = 200;

/**
 * A bounded field/block path such as `sections[2].blocks[0].alt` or
 * `questions[3].options[1]`.
 *
 * The grammar is closed on purpose. A free-form string would eventually carry a
 * selector, a URL or a snippet of prose, and the UI that resolves a path to a
 * highlighted block would then have to guess. Only identifiers, dots and
 * bracketed non-negative integers are accepted.
 */
const PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\[\d{1,4}\]|\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

export type ReviewNoteTarget =
  | { kind: "content"; contentVersionId: number }
  | { kind: "assessment"; assessmentVersionId: number }
  | { kind: "video_production"; videoProductionVersionId: number };

function targetColumns(target: ReviewNoteTarget) {
  switch (target.kind) {
    case "content":
      return {
        contentVersionId: target.contentVersionId,
        assessmentVersionId: null,
        videoProductionVersionId: null,
      };
    case "assessment":
      return {
        contentVersionId: null,
        assessmentVersionId: target.assessmentVersionId,
        videoProductionVersionId: null,
      };
    case "video_production":
      return {
        contentVersionId: null,
        assessmentVersionId: null,
        videoProductionVersionId: target.videoProductionVersionId,
      };
  }
}

function targetId(target: ReviewNoteTarget): number {
  switch (target.kind) {
    case "content":
      return target.contentVersionId;
    case "assessment":
      return target.assessmentVersionId;
    case "video_production":
      return target.videoProductionVersionId;
  }
}

const ENTITY_TYPE: Record<AuthoringTargetKind, string> = {
  content: "ContentVersion",
  assessment: "AssessmentVersion",
  video_production: "VideoProductionVersion",
};

function assertValidTarget(target: ReviewNoteTarget) {
  const columns = targetColumns(target);
  const set = [
    columns.contentVersionId,
    columns.assessmentVersionId,
    columns.videoProductionVersionId,
  ].filter((value) => value !== null);
  if (set.length !== 1) {
    throw new AuthoringDomainError(
      "AUTHORING_NOTE_TARGET_INVALID",
      "a review note must name exactly one target",
    );
  }
  const id = targetId(target);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AuthoringDomainError(
      "AUTHORING_NOTE_TARGET_INVALID",
      "target id must be a positive integer",
    );
  }
}

function normalizeBody(raw: string): string {
  const body = raw.trim();
  if (body.length === 0 || body.length > MAX_BODY_LENGTH) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      `note body must be between 1 and ${MAX_BODY_LENGTH} characters`,
    );
  }
  return body;
}

function normalizePath(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const path = raw.trim();
  if (path.length === 0) return null;
  if (path.length > MAX_PATH_LENGTH || !PATH_PATTERN.test(path)) {
    throw new AuthoringDomainError(
      "AUTHORING_INPUT_INVALID",
      "note path must be a bounded field or block path",
    );
  }
  return path;
}

/**
 * Append a note.
 *
 * `authorId` is supplied by the GATE, never by the caller's body — see
 * `authoring-authorization.ts`. `targetRevision` is read from the target INSIDE
 * the transaction rather than accepted, so a note can never claim to be about a
 * revision that never existed, and a reviewer commenting while an author saves
 * still gets an accurate "this was written against revision N".
 */
export async function addReviewNote(input: {
  target: ReviewNoteTarget;
  body: string;
  path?: string | null;
  authorId: number;
}): Promise<EditorialReviewNote> {
  assertValidTarget(input.target);
  const body = normalizeBody(input.body);
  const path = normalizePath(input.path);
  const columns = targetColumns(input.target);
  const kind = input.target.kind;

  return prisma.$transaction(async (tx) => {
    const revision = await readTargetRevision(tx, input.target);

    const note = await tx.editorialReviewNote.create({
      data: {
        ...columns,
        targetRevision: revision,
        path,
        body,
        authorId: input.authorId,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: input.authorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringReviewNoteAdded,
        entityType: ENTITY_TYPE[kind],
        entityId: String(targetId(input.target)),
        // The note BODY is deliberately not copied into the audit metadata. The
        // note row is already the durable record of it, and duplicating staff
        // prose into AuditLog would put it in a table with a different retention
        // story for no gain.
        metadata: { kind, noteId: note.id, targetRevision: revision, hasPath: path !== null },
      },
    });

    return note;
  });
}

async function readTargetRevision(
  tx: Prisma.TransactionClient,
  target: ReviewNoteTarget,
): Promise<number> {
  const row =
    target.kind === "content"
      ? await tx.contentVersion.findUnique({
          where: { id: target.contentVersionId },
          select: { revision: true },
        })
      : target.kind === "assessment"
        ? await tx.assessmentVersion.findUnique({
            where: { id: target.assessmentVersionId },
            select: { revision: true },
          })
        : await tx.videoProductionVersion.findUnique({
            where: { id: target.videoProductionVersionId },
            select: { revision: true },
          });

  if (!row) {
    throw new AuthoringDomainError(
      "AUTHORING_TARGET_NOT_FOUND",
      `${ENTITY_TYPE[target.kind]} ${targetId(target)} does not exist`,
    );
  }
  return row.revision;
}

/**
 * Close a note.
 *
 * Resolution is idempotent-hostile on purpose: resolving an already-resolved
 * note is an ERROR rather than a silent no-op, because the second caller
 * believes they closed something and would otherwise never learn that someone
 * else's name is on it.
 */
export async function resolveReviewNote(input: {
  noteId: number;
  /**
   * PHASE-G0 CORRECTION — the aggregate the caller believes this note belongs
   * to. REQUIRED. Without it, `noteId` alone was sufficient to resolve any note
   * in the database, so a caller authorized for one lesson could close a
   * reviewer's concern on another simply by counting upwards. Ids are not
   * capabilities, and the note's own target is the only thing that can say which
   * aggregate a caller must have been authorized for.
   */
  target: ReviewNoteTarget;
  actorId: number;
}): Promise<EditorialReviewNote> {
  assertValidTarget(input.target);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.editorialReviewNote.findUnique({ where: { id: input.noteId } });
    if (!existing) {
      throw new AuthoringDomainError("AUTHORING_NOTE_NOT_FOUND", "review note does not exist");
    }
    // The note must actually live on the named target. A mismatch is reported as
    // NOT_FOUND rather than as a distinct code on purpose: telling a caller
    // "that note exists, but not here" would confirm the existence of notes on
    // aggregates they were never authorized to see.
    const expected = targetColumns(input.target);
    if (
      existing.contentVersionId !== expected.contentVersionId ||
      existing.assessmentVersionId !== expected.assessmentVersionId ||
      existing.videoProductionVersionId !== expected.videoProductionVersionId
    ) {
      throw new AuthoringDomainError(
        "AUTHORING_NOTE_NOT_FOUND",
        "review note does not belong to the named target",
      );
    }
    if (existing.resolvedAt !== null) {
      throw new AuthoringDomainError(
        "AUTHORING_NOTE_ALREADY_RESOLVED",
        "review note is already resolved",
      );
    }

    const resolved = await tx.editorialReviewNote.update({
      where: { id: input.noteId },
      data: { resolvedAt: new Date(), resolvedById: input.actorId },
    });

    const kind: AuthoringTargetKind = existing.contentVersionId !== null
      ? "content"
      : existing.assessmentVersionId !== null
        ? "assessment"
        : "video_production";
    const entityId =
      existing.contentVersionId ?? existing.assessmentVersionId ?? existing.videoProductionVersionId;

    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        action: CURRICULUM_AUDIT_ACTIONS.authoringReviewNoteResolved,
        entityType: ENTITY_TYPE[kind],
        entityId: String(entityId),
        metadata: { kind, noteId: resolved.id, authoredBy: existing.authorId },
      },
    });

    return resolved;
  });
}

/** All notes for one target, newest last. Open notes are the reviewer's queue. */
export async function listReviewNotes(
  target: ReviewNoteTarget,
  options: { openOnly?: boolean } = {},
): Promise<EditorialReviewNote[]> {
  assertValidTarget(target);
  const columns = targetColumns(target);
  return prisma.editorialReviewNote.findMany({
    where: {
      contentVersionId: columns.contentVersionId,
      assessmentVersionId: columns.assessmentVersionId,
      videoProductionVersionId: columns.videoProductionVersionId,
      ...(options.openOnly ? { resolvedAt: null } : {}),
    },
    orderBy: { id: "asc" },
  });
}

/** How many notes are still open. Used by the approval readiness view. */
export async function countOpenReviewNotes(target: ReviewNoteTarget): Promise<number> {
  const notes = await listReviewNotes(target, { openOnly: true });
  return notes.length;
}
