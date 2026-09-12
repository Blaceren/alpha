import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getSessionSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { Phase4HttpError } from "./phase4-http";

type Cursor = { v: 1; u: number; e: number; t: string; i: number };

function key() { return createHash("sha256").update(`phase4-assessment-history:${getSessionSecret()}`).digest(); }

function encodeCursor(value: Cursor) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  try {
    const packed = Buffer.from(raw, "base64url");
    if (packed.length < 29) throw new Error("short cursor");
    const decipher = createDecipheriv("aes-256-gcm", key(), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8")) as Partial<Cursor>;
    if (value.v !== 1 || !Number.isSafeInteger(value.u) || !Number.isSafeInteger(value.e) || !Number.isSafeInteger(value.i) || typeof value.t !== "string" || Number.isNaN(new Date(value.t).getTime())) throw new Error("invalid cursor");
    return value as Cursor;
  } catch {
    throw new Phase4HttpError("CURSOR_INVALID", 400);
  }
}

export async function resolveOwnAssessmentAttemptHistory(input: {
  actorUserId: number;
  limit: number;
  cursor?: string;
}) {
  const enrollment = await prisma.userCurriculumEnrollment.findFirst({
    where: { userId: input.actorUserId, status: { in: ["active", "completed"] } },
    orderBy: [{ status: "asc" }, { enrolledAt: "desc" }, { id: "desc" }],
    select: { id: true, userId: true, curriculumVersionId: true, status: true },
  });
  if (!enrollment) throw new Phase4HttpError("ASSESSMENT_NOT_ENROLLED", 409);

  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (cursor && (cursor.u !== input.actorUserId || cursor.e !== enrollment.id)) {
    throw new Phase4HttpError("CURSOR_INVALID", 400);
  }
  const boundary = cursor ? new Date(cursor.t) : null;
  const rows = await prisma.assessmentAttempt.findMany({
    where: {
      userId: input.actorUserId,
      enrollmentId: enrollment.id,
      curriculumVersionId: enrollment.curriculumVersionId,
      ...(cursor && boundary ? { OR: [
        { startedAt: { lt: boundary } },
        { startedAt: boundary, id: { lt: cursor.i } },
      ] } : {}),
    },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: {
      id: true, curriculumVersionId: true, levelDefinitionId: true, assessmentVersionId: true,
      attemptNumber: true, status: true, totalQuestions: true, correctCount: true,
      scoreBasisPoints: true, startedAt: true, submittedAt: true,
      levelDefinition: { select: { id: true, curriculumVersionId: true, levelNumber: true, stableCode: true, title: true } },
      assessmentVersion: { select: { id: true, curriculumVersionId: true, levelDefinitionId: true, versionNumber: true } },
    },
  });
  const page = rows.slice(0, input.limit);
  for (const row of page) {
    if (row.curriculumVersionId !== enrollment.curriculumVersionId || row.levelDefinition.id !== row.levelDefinitionId || row.levelDefinition.curriculumVersionId !== enrollment.curriculumVersionId || row.assessmentVersion.id !== row.assessmentVersionId || row.assessmentVersion.levelDefinitionId !== row.levelDefinitionId || row.assessmentVersion.curriculumVersionId !== enrollment.curriculumVersionId) {
      throw new Phase4HttpError("ASSESSMENT_STATE_CORRUPT", 409);
    }
  }
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      level: { levelNumber: row.levelDefinition.levelNumber, stableCode: row.levelDefinition.stableCode, title: row.levelDefinition.title },
      assessment: { versionNumber: row.assessmentVersion.versionNumber },
      attemptNumber: row.attemptNumber,
      status: row.status,
      totalQuestions: row.totalQuestions,
      correctCount: row.correctCount,
      scoreBasisPoints: row.scoreBasisPoints,
      startedAt: row.startedAt,
      submittedAt: row.submittedAt,
    })),
    nextCursor: rows.length > input.limit && last ? encodeCursor({ v: 1, u: input.actorUserId, e: enrollment.id, t: last.startedAt.toISOString(), i: last.id }) : null,
  };
}
