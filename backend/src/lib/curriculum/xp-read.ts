import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { CurriculumXpSourceType, Prisma } from "@prisma/client";
import { getSessionSecret } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveUserCurriculumContext } from "./resolver";
import { resolveEnrollmentXp } from "./xp";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const CURSOR_VERSION = 1;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{40,512}$/;
const LEVEL_LINKED_SOURCES = new Set<CurriculumXpSourceType>([
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
]);
const APPROVED_SOURCES = new Set<CurriculumXpSourceType>([
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
  "promocode",
  "migration_adjustment",
  "admin_correction",
]);

export type CurriculumXpReadErrorCode =
  | "INVALID_QUERY"
  | "CURRICULUM_STATE_CORRUPT"
  | "XP_STATE_CORRUPT"
  | "INTERNAL_ERROR";

export class CurriculumXpReadError extends Error {
  readonly code: CurriculumXpReadErrorCode;
  readonly issueCode?: string;

  constructor(code: CurriculumXpReadErrorCode, issueCode?: string) {
    super("curriculum XP read failed");
    this.name = "CurriculumXpReadError";
    this.code = code;
    this.issueCode = issueCode;
  }
}

export function isCurriculumXpReadError(
  error: unknown,
): error is CurriculumXpReadError {
  return error instanceof CurriculumXpReadError;
}

export type CurriculumXpHistoryQuery = {
  limit: number;
  cursor: string | null;
};

export function parseCurriculumXpHistoryQuery(
  request: Request,
): CurriculumXpHistoryQuery {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (key !== "limit" && key !== "cursor") {
      throw new CurriculumXpReadError("INVALID_QUERY");
    }
  }
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) {
    throw new CurriculumXpReadError("INVALID_QUERY");
  }

  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (
    (rawLimit !== null && !/^[1-9][0-9]*$/.test(rawLimit)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    throw new CurriculumXpReadError("INVALID_QUERY");
  }

  const cursor = params.get("cursor");
  if (cursor !== null && !CURSOR_PATTERN.test(cursor)) {
    throw new CurriculumXpReadError("INVALID_QUERY");
  }
  return { limit, cursor };
}

type CursorPosition = { createdAt: Date; id: number };
type CursorPayload = { v: 1; t: string; i: number };

function cursorKey(purpose: "enc" | "iv") {
  return createHash("sha256")
    .update(`ata:curriculum:xp-history:cursor:${purpose}:v1\0`)
    .update(getSessionSecret())
    .digest();
}

function cursorAad(userId: number, enrollmentId: number) {
  return Buffer.from(
    `ata:curriculum:xp-history:v1:user:${userId}:enrollment:${enrollmentId}`,
    "utf8",
  );
}

function cursorIv(plaintext: Buffer, aad: Buffer) {
  return createHmac("sha256", cursorKey("iv"))
    .update(aad)
    .update(Buffer.from([0]))
    .update(plaintext)
    .digest()
    .subarray(0, 12);
}

function encodeCursor(
  position: CursorPosition,
  userId: number,
  enrollmentId: number,
) {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    t: position.createdAt.toISOString(),
    i: position.id,
  };
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const aad = cursorAad(userId, enrollmentId);
  const iv = cursorIv(plaintext, aad);
  const cipher = createCipheriv("aes-256-gcm", cursorKey("enc"), iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function decodeCursor(
  cursor: string,
  userId: number,
  enrollmentId: number,
): CursorPosition {
  try {
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.length < 29 || bytes.toString("base64url") !== cursor) {
      throw new Error("invalid cursor encoding");
    }
    const iv = bytes.subarray(0, 12);
    const tag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const aad = cursorAad(userId, enrollmentId);
    const decipher = createDecipheriv("aes-256-gcm", cursorKey("enc"), iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const expectedIv = cursorIv(plaintext, aad);
    if (!timingSafeEqual(iv, expectedIv)) throw new Error("invalid cursor iv");

    const parsed = JSON.parse(plaintext.toString("utf8")) as Partial<CursorPayload>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Object.keys(parsed).sort().join(",") !== "i,t,v" ||
      parsed.v !== CURSOR_VERSION ||
      typeof parsed.t !== "string" ||
      typeof parsed.i !== "number" ||
      !Number.isSafeInteger(parsed.i) ||
      parsed.i <= 0
    ) {
      throw new Error("invalid cursor payload");
    }
    const createdAt = new Date(parsed.t);
    if (
      Number.isNaN(createdAt.getTime()) ||
      createdAt.toISOString() !== parsed.t
    ) {
      throw new Error("invalid cursor time");
    }
    return { createdAt, id: parsed.i };
  } catch {
    throw new CurriculumXpReadError("INVALID_QUERY");
  }
}

function mapCurriculum(version: {
  code: string;
  versionNumber: number;
  status: string;
}) {
  return {
    code: version.code,
    versionNumber: version.versionNumber,
    status: version.status,
  };
}

function emptyPage() {
  return { items: [] as never[], page: { nextCursor: null as string | null } };
}

async function readWithin(
  tx: Prisma.TransactionClient,
  userId: number,
  query: CurriculumXpHistoryQuery,
) {
  const context = await resolveUserCurriculumContext({ userId, db: tx });
  if (context.kind === "disabled" || context.kind === "user_not_found") {
    throw new CurriculumXpReadError("INTERNAL_ERROR");
  }
  if (context.kind === "corrupt") {
    throw new CurriculumXpReadError(
      "CURRICULUM_STATE_CORRUPT",
      context.reason,
    );
  }
  if (context.kind === "candidate") {
    if (query.cursor) throw new CurriculumXpReadError("INVALID_QUERY");
    return {
      kind: "not_enrolled" as const,
      curriculum: mapCurriculum(context.curriculumVersion),
      summary: null,
      ...emptyPage(),
    };
  }
  if (context.kind === "unavailable") {
    if (query.cursor) throw new CurriculumXpReadError("INVALID_QUERY");
    return {
      kind: "unavailable" as const,
      curriculum: null,
      summary: null,
      ...emptyPage(),
    };
  }

  const enrollmentId = context.enrollment.id;
  const position = query.cursor
    ? decodeCursor(query.cursor, userId, enrollmentId)
    : null;
  const xp = await resolveEnrollmentXp({ enrollmentId, db: tx });
  if (xp.kind !== "available") {
    throw new CurriculumXpReadError("XP_STATE_CORRUPT", "XP_STATE_CORRUPT");
  }

  const rows = await tx.xPTransaction.findMany({
    where: {
      enrollmentId,
      ...(position
        ? {
            OR: [
              { createdAt: { lt: position.createdAt } },
              { createdAt: position.createdAt, id: { lt: position.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: {
      id: true,
      amount: true,
      sourceType: true,
      createdAt: true,
      levelDefinitionId: true,
      levelDefinition: {
        select: {
          curriculumVersionId: true,
          levelNumber: true,
          stableCode: true,
        },
      },
    },
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const items = pageRows.map((row) => {
    if (
      !Number.isSafeInteger(row.amount) ||
      row.amount <= 0 ||
      !APPROVED_SOURCES.has(row.sourceType) ||
      Number.isNaN(row.createdAt.getTime()) ||
      (LEVEL_LINKED_SOURCES.has(row.sourceType) && !row.levelDefinition) ||
      (!LEVEL_LINKED_SOURCES.has(row.sourceType) && row.levelDefinition) ||
      (row.levelDefinition &&
        row.levelDefinition.curriculumVersionId !==
          context.curriculumVersion.id)
    ) {
      throw new CurriculumXpReadError("XP_STATE_CORRUPT", "XP_STATE_CORRUPT");
    }
    return {
      amount: row.amount,
      sourceType: row.sourceType,
      createdAt: row.createdAt.toISOString(),
      level: row.levelDefinition
        ? {
            levelNumber: row.levelDefinition.levelNumber,
            stableCode: row.levelDefinition.stableCode,
          }
        : null,
    };
  });
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          { createdAt: last.createdAt, id: last.id },
          userId,
          enrollmentId,
        )
      : null;

  return {
    kind: context.kind === "completed" ? ("completed" as const) : ("available" as const),
    curriculum: mapCurriculum(context.curriculumVersion),
    summary: {
      currentXp: xp.totalXp,
      transactionCount: xp.transactionCount,
      lastTransactionAt: xp.lastTransactionAt?.toISOString() ?? null,
    },
    items,
    page: { nextCursor },
  };
}

export async function readCurriculumXpHistory(
  userId: number,
  query: CurriculumXpHistoryQuery,
) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new CurriculumXpReadError("INTERNAL_ERROR");
  }
  try {
    return await prisma.$transaction((tx) => readWithin(tx, userId, query));
  } catch (error) {
    if (isCurriculumXpReadError(error)) throw error;
    throw new CurriculumXpReadError("INTERNAL_ERROR");
  }
}
