import { createHash } from "node:crypto";
import {
  CurriculumXpSourceType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { isCurriculumV2XpEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { CURRICULUM_AUDIT_ACTIONS } from "./constants";

const MAX_AWARD_AMOUNT = 1_000_000;
const MAX_TOTAL_XP = BigInt(2_147_483_647);
const MAX_SOURCE_ID_LENGTH = 200;
const MAX_METADATA_BYTES = 4_096;
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_NODES = 128;
const MAX_METADATA_KEYS = 64;
const MAX_METADATA_ARRAY_ITEMS = 64;
const MAX_METADATA_STRING_LENGTH = 512;
const FINGERPRINT_VERSION = "xp-v2-fingerprint-v1";

const APPROVED_SOURCES = new Set<CurriculumXpSourceType>([
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
  "promocode",
  "migration_adjustment",
  "admin_correction",
]);

// PHASE-1 ADMIN — `admin_correction` IS DELIBERATELY ABSENT, and that is a
// ROLLBACK decision rather than a modelling preference.
//
// An administrative correction does credit one specific level, so linking the
// row to it was the obvious modelling choice and it is what this phase shipped
// first. It was wrong for a reason that only shows up on the way back out.
//
// This contract is SYMMETRIC: a level-linked source MUST name a level and a
// non-level-linked source MUST NOT. The currently-deployed Backend does not have
// `admin_correction` in this set, so a row written with a level would be read by
// it as `xp_source_level_contract_invalid` — and that verdict is not scoped to
// the row, it fails the WHOLE enrollment resolution, which takes the learner's
// XP total, their level states and therefore their Academy down. One correction
// applied before a rollback would have broken the learner it was meant to fix,
// and the live release would have stopped being a valid rollback anchor the
// moment the feature was used once.
//
// Writing the row with `levelDefinitionId = null` is read identically by both
// releases, and costs nothing: `admin_correction` is already in
// `APPROVED_SOURCES` on both sides, the resolver sums every approved row into
// the enrollment total whether or not it names a level, and the level this row
// belongs to is still recoverable four other ways — the progress row's
// `completionMethod`/`completionEvidence`, the per-level completion audit, the
// adjustment envelope, and the award's own `sourceId`
// (`admin-correction:<requestId>:l<levelNumber>`).
const LEVEL_LINKED_SOURCES = new Set<CurriculumXpSourceType>([
  "level_completion",
  "assessment_pass",
  "report_approval",
  "mentor_completion",
]);

const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FORBIDDEN_METADATA_KEY =
  /(?:secret|password|token|cookie|authorization|api[_-]?key|session|raw|payload|content|evidence|provider)/i;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type CurriculumXpErrorCode =
  | "XP_DISABLED"
  | "XP_INPUT_INVALID"
  | "XP_ENROLLMENT_NOT_FOUND"
  | "XP_ENROLLMENT_CORRUPT"
  | "XP_LEVEL_VERSION_MISMATCH"
  | "XP_SOURCE_INVALID"
  | "XP_IDEMPOTENCY_CONFLICT"
  | "XP_SOURCE_CONFLICT"
  | "XP_TOTAL_CORRUPT"
  | "XP_ACTOR_INVALID"
  | "XP_INTERNAL_ERROR";

export class CurriculumXpError extends Error {
  readonly code: CurriculumXpErrorCode;

  constructor(code: CurriculumXpErrorCode, message: string) {
    super(message);
    this.name = "CurriculumXpError";
    this.code = code;
  }
}

export function isCurriculumXpError(error: unknown): error is CurriculumXpError {
  return error instanceof CurriculumXpError;
}

type JsonScalar = string | number | boolean | null;
type NormalizedJson = JsonScalar | NormalizedJson[] | { [key: string]: NormalizedJson };
type NormalizedMetadata = { [key: string]: NormalizedJson };

type XpTransactionClient = Prisma.TransactionClient;
type XpDb = PrismaClient | XpTransactionClient;

export type ResolveEnrollmentXpInput = {
  enrollmentId: number;
  asOf?: Date;
  db?: XpDb;
};

export type XpCorruptReason =
  | "xp_input_invalid"
  | "enrollment_owner_missing"
  | "enrollment_pin_missing"
  | "enrollment_pin_mismatch"
  | "enrollment_pin_status_invalid"
  | "xp_owner_mismatch"
  | "xp_version_mismatch"
  | "xp_level_version_mismatch"
  | "xp_source_invalid"
  | "xp_source_identity_invalid"
  | "xp_source_level_contract_invalid"
  | "xp_idempotency_key_invalid"
  | "xp_fingerprint_invalid"
  | "xp_actor_invalid"
  | "xp_metadata_invalid"
  | "xp_amount_out_of_range"
  | "xp_total_out_of_range";

export type ResolveEnrollmentXpResult =
  | { kind: "disabled" }
  | { kind: "not_found" }
  | {
      kind: "corrupt";
      code: "XP_TOTAL_CORRUPT";
      reason: XpCorruptReason;
    }
  | {
      kind: "available";
      enrollmentId: number;
      curriculumVersion: {
        id: number;
        code: string;
        versionNumber: number;
      };
      totalXp: number;
      transactionCount: number;
      lastTransactionAt: Date | null;
      asOf?: Date;
    };

export type RecordCurriculumXpInput = {
  enrollmentId: number;
  sourceType: CurriculumXpSourceType;
  sourceId: string;
  levelDefinitionId?: number | null;
  amount: number;
  actorId?: number | null;
  metadata?: unknown;
  db?: XpDb;
};

export type RecordCurriculumXpInTransactionInput = Omit<
  RecordCurriculumXpInput,
  "db"
>;

export type CurriculumXpTransactionSummary = {
  id: number;
  enrollmentId: number;
  userId: number;
  curriculumVersionId: number;
  levelDefinitionId: number | null;
  sourceType: CurriculumXpSourceType;
  sourceId: string;
  amount: number;
  createdById: number | null;
  createdAt: Date;
};

export type RecordCurriculumXpResult = {
  kind: "recorded";
  created: boolean;
  transaction: CurriculumXpTransactionSummary;
};

export type VerifyCurriculumXpAwardResult =
  | { kind: "missing" }
  | RecordCurriculumXpResult;

type EnrollmentHeaderRow = {
  enrollmentId: bigint | number;
  userId: bigint | number;
  curriculumVersionId: bigint | number;
  curriculumCode: string;
  enrollmentStatus: string;
  userExists: bigint | number | null;
  pinnedVersionId: bigint | number | null;
  pinnedVersionCode: string | null;
  pinnedVersionNumber: bigint | number | null;
  pinnedVersionStatus: string | null;
};

type LedgerRow = {
  id: bigint | number;
  userId: bigint | number;
  enrollmentId: bigint | number;
  curriculumVersionId: bigint | number;
  levelDefinitionId: bigint | number | null;
  sourceType: string;
  sourceId: string | null;
  idempotencyKey: string;
  payloadFingerprint: string;
  amount: bigint | number;
  metadata: unknown;
  createdAt: Date | string;
  createdById: bigint | number | null;
  actorExists: bigint | number | null;
  levelVersionId: bigint | number | null;
};

type CanonicalAward = {
  enrollmentId: number;
  userId: number;
  curriculumVersionId: number;
  levelDefinitionId: number | null;
  sourceType: CurriculumXpSourceType;
  sourceId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  amount: number;
  actorId: number | null;
  metadata: NormalizedMetadata | null;
};

function invalidInput(message: string) {
  return new CurriculumXpError("XP_INPUT_INVALID", message);
}

function internalError() {
  return new CurriculumXpError(
    "XP_INTERNAL_ERROR",
    "curriculum XP operation failed",
  );
}

function positiveId(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw invalidInput(`${field} must be a positive integer`);
  }
  return Number(value);
}

function normalizeSourceId(value: unknown) {
  if (typeof value !== "string") {
    throw new CurriculumXpError(
      "XP_SOURCE_INVALID",
      "XP source identity is invalid",
    );
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SOURCE_ID_LENGTH ||
    !SOURCE_ID_PATTERN.test(normalized)
  ) {
    throw new CurriculumXpError(
      "XP_SOURCE_INVALID",
      "XP source identity is invalid",
    );
  }
  return normalized;
}

function isApprovedSource(value: unknown): value is CurriculumXpSourceType {
  return typeof value === "string" && APPROVED_SOURCES.has(value as CurriculumXpSourceType);
}

function assertSourceLevelContract(
  sourceType: CurriculumXpSourceType,
  levelDefinitionId: number | null,
) {
  const requiresLevel = LEVEL_LINKED_SOURCES.has(sourceType);
  if (requiresLevel && levelDefinitionId === null) {
    throw new CurriculumXpError(
      "XP_SOURCE_INVALID",
      "level-linked XP source requires a level",
    );
  }
  if (!requiresLevel && levelDefinitionId !== null) {
    throw new CurriculumXpError(
      "XP_SOURCE_INVALID",
      "non-level XP source cannot reference a level",
    );
  }
}

function normalizeJson(
  value: unknown,
  depth: number,
  state: { nodes: number; keys: number },
): NormalizedJson {
  state.nodes += 1;
  if (state.nodes > MAX_METADATA_NODES || depth > MAX_METADATA_DEPTH) {
    throw invalidInput("XP metadata exceeds the allowed shape");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_METADATA_STRING_LENGTH) {
      throw invalidInput("XP metadata string is too long");
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidInput("XP metadata contains a non-finite number");
    }
    return value;
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    throw invalidInput("XP metadata contains a non-JSON value");
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_METADATA_ARRAY_ITEMS) {
      throw invalidInput("XP metadata array is too large");
    }
    return value.map((item) => normalizeJson(item, depth + 1, state));
  }
  if (typeof value !== "object") {
    throw invalidInput("XP metadata contains an unsupported value");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidInput("XP metadata must contain plain JSON objects");
  }
  const output: { [key: string]: NormalizedJson } = {};
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  state.keys += entries.length;
  if (state.keys > MAX_METADATA_KEYS) {
    throw invalidInput("XP metadata has too many keys");
  }
  for (const [key, nested] of entries) {
    if (
      key.length === 0 ||
      PROTOTYPE_KEYS.has(key.toLowerCase()) ||
      FORBIDDEN_METADATA_KEY.test(key)
    ) {
      throw invalidInput("XP metadata contains a forbidden key");
    }
    output[key] = normalizeJson(nested, depth + 1, state);
  }
  return output;
}

function normalizeMetadata(metadata: unknown): NormalizedMetadata | null {
  if (metadata === undefined || metadata === null) return null;
  if (
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    (Object.getPrototypeOf(metadata) !== Object.prototype &&
      Object.getPrototypeOf(metadata) !== null)
  ) {
    throw invalidInput("XP metadata must be a JSON object");
  }
  const normalized = normalizeJson(metadata, 0, { nodes: 0, keys: 0 });
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > MAX_METADATA_BYTES) {
    throw invalidInput("XP metadata is too large");
  }
  return normalized as NormalizedMetadata;
}

function parseStoredMetadata(metadata: unknown) {
  if (metadata === null || metadata === undefined) return null;
  if (typeof metadata === "string") {
    try {
      return normalizeMetadata(JSON.parse(metadata));
    } catch (error) {
      if (isCurriculumXpError(error)) throw error;
      throw invalidInput("stored XP metadata is invalid");
    }
  }
  return normalizeMetadata(metadata);
}

function sourceNamespace(sourceType: CurriculumXpSourceType) {
  return sourceType.replaceAll("_", "-");
}

function buildIdempotencyKey(
  enrollmentId: number,
  sourceType: CurriculumXpSourceType,
  sourceId: string,
) {
  if (sourceType === "migration_adjustment") {
    const parts = sourceId.split(":");
    if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
      throw new CurriculumXpError(
        "XP_SOURCE_INVALID",
        "migration XP source identity is invalid",
      );
    }
    return `xp:v2:migration-adjustment:${encodeURIComponent(parts[0])}:${enrollmentId}:${encodeURIComponent(parts[1])}`;
  }
  if (sourceType === "admin_correction") {
    return `xp:v2:admin-correction:${encodeURIComponent(sourceId)}`;
  }
  return `xp:v2:${sourceNamespace(sourceType)}:${enrollmentId}:${encodeURIComponent(sourceId)}`;
}

function fingerprintFor(input: Omit<CanonicalAward, "payloadFingerprint">) {
  const canonical = JSON.stringify({
    version: FINGERPRINT_VERSION,
    enrollmentId: input.enrollmentId,
    userId: input.userId,
    curriculumVersionId: input.curriculumVersionId,
    levelDefinitionId: input.levelDefinitionId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amount: input.amount,
    actorId: input.actorId,
    metadata: input.metadata,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

function sourceIdHash(sourceId: string) {
  return `sha256:${createHash("sha256").update(sourceId, "utf8").digest("hex")}`;
}

function toNumber(value: bigint | number | null) {
  if (value === null) return null;
  return typeof value === "bigint" ? Number(value) : value;
}

function toBigInt(value: bigint | number) {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw new Error("unsafe integer");
  return BigInt(value);
}

function toDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("invalid date");
  return date;
}

function corrupt(reason: XpCorruptReason): ResolveEnrollmentXpResult {
  return { kind: "corrupt", code: "XP_TOTAL_CORRUPT", reason };
}

async function loadEnrollmentHeader(db: XpDb, enrollmentId: number) {
  const rows = await db.$queryRaw<EnrollmentHeaderRow[]>(Prisma.sql`
    SELECT
      e."id" AS "enrollmentId",
      e."userId" AS "userId",
      e."curriculumVersionId" AS "curriculumVersionId",
      e."curriculumCode" AS "curriculumCode",
      e."status" AS "enrollmentStatus",
      u."id" AS "userExists",
      v."id" AS "pinnedVersionId",
      v."code" AS "pinnedVersionCode",
      v."versionNumber" AS "pinnedVersionNumber",
      v."status" AS "pinnedVersionStatus"
    FROM "UserCurriculumEnrollment" e
    LEFT JOIN "User" u ON u."id" = e."userId"
    LEFT JOIN "CurriculumVersion" v ON v."id" = e."curriculumVersionId"
    WHERE e."id" = ${enrollmentId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function loadLedgerRows(db: XpDb, enrollmentId: number, asOf?: Date) {
  const asOfClause = asOf ? Prisma.sql`AND x."createdAt" <= ${asOf}` : Prisma.empty;
  return db.$queryRaw<LedgerRow[]>(Prisma.sql`
    SELECT
      x."id",
      x."userId",
      x."enrollmentId",
      x."curriculumVersionId",
      x."levelDefinitionId",
      x."sourceType",
      x."sourceId",
      x."idempotencyKey",
      x."payloadFingerprint",
      x."amount",
      x."metadata",
      x."createdAt",
      x."createdById",
      actor."id" AS "actorExists",
      level."curriculumVersionId" AS "levelVersionId"
    FROM "XPTransaction" x
    LEFT JOIN "User" actor ON actor."id" = x."createdById"
    LEFT JOIN "LevelDefinition" level ON level."id" = x."levelDefinitionId"
    WHERE x."enrollmentId" = ${enrollmentId}
    ${asOfClause}
    ORDER BY x."createdAt" ASC, x."id" ASC
  `);
}

export async function resolveEnrollmentXp({
  enrollmentId,
  asOf,
  db = prisma,
}: ResolveEnrollmentXpInput): Promise<ResolveEnrollmentXpResult> {
  if (!isCurriculumV2XpEnabled()) return { kind: "disabled" };
  if (
    !Number.isSafeInteger(enrollmentId) ||
    enrollmentId <= 0 ||
    (asOf !== undefined &&
      (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())))
  ) {
    return corrupt("xp_input_invalid");
  }

  try {
    const header = await loadEnrollmentHeader(db, enrollmentId);
    if (!header) return { kind: "not_found" };
    if (header.userExists === null) return corrupt("enrollment_owner_missing");
    if (header.pinnedVersionId === null) return corrupt("enrollment_pin_missing");

    const userId = toNumber(header.userId)!;
    const curriculumVersionId = toNumber(header.curriculumVersionId)!;
    const pinnedVersionId = toNumber(header.pinnedVersionId)!;
    if (
      pinnedVersionId !== curriculumVersionId ||
      header.pinnedVersionCode !== header.curriculumCode
    ) {
      return corrupt("enrollment_pin_mismatch");
    }
    if (
      header.pinnedVersionStatus !== "published" &&
      header.pinnedVersionStatus !== "archived"
    ) {
      return corrupt("enrollment_pin_status_invalid");
    }

    const rows = await loadLedgerRows(db, enrollmentId, asOf);
    let total = BigInt(0);
    let lastTransactionAt: Date | null = null;

    for (const row of rows) {
      if (toNumber(row.enrollmentId) !== enrollmentId || toNumber(row.userId) !== userId) {
        return corrupt("xp_owner_mismatch");
      }
      if (toNumber(row.curriculumVersionId) !== curriculumVersionId) {
        return corrupt("xp_version_mismatch");
      }
      if (!isApprovedSource(row.sourceType)) return corrupt("xp_source_invalid");
      let sourceId: string;
      try {
        sourceId = normalizeSourceId(row.sourceId);
      } catch {
        return corrupt("xp_source_identity_invalid");
      }

      const levelDefinitionId = toNumber(row.levelDefinitionId);
      const requiresLevel = LEVEL_LINKED_SOURCES.has(row.sourceType);
      if (
        (requiresLevel && levelDefinitionId === null) ||
        (!requiresLevel && levelDefinitionId !== null)
      ) {
        return corrupt("xp_source_level_contract_invalid");
      }
      if (
        levelDefinitionId !== null &&
        toNumber(row.levelVersionId) !== curriculumVersionId
      ) {
        return corrupt("xp_level_version_mismatch");
      }
      if (row.createdById !== null && row.actorExists === null) {
        return corrupt("xp_actor_invalid");
      }

      let amount: bigint;
      let metadata: NormalizedMetadata | null;
      try {
        amount = toBigInt(row.amount);
        metadata = parseStoredMetadata(row.metadata);
      } catch {
        return corrupt("xp_metadata_invalid");
      }
      if (amount < BigInt(1) || amount > BigInt(MAX_AWARD_AMOUNT)) {
        return corrupt("xp_amount_out_of_range");
      }
      const numericAmount = Number(amount);
      let expectedKey: string;
      try {
        expectedKey = buildIdempotencyKey(enrollmentId, row.sourceType, sourceId);
      } catch {
        return corrupt("xp_source_identity_invalid");
      }
      if (row.idempotencyKey !== expectedKey) {
        return corrupt("xp_idempotency_key_invalid");
      }
      const actorId = toNumber(row.createdById);
      const expectedFingerprint = fingerprintFor({
        enrollmentId,
        userId,
        curriculumVersionId,
        levelDefinitionId,
        sourceType: row.sourceType,
        sourceId,
        idempotencyKey: expectedKey,
        amount: numericAmount,
        actorId,
        metadata,
      });
      if (
        !FINGERPRINT_PATTERN.test(row.payloadFingerprint) ||
        row.payloadFingerprint !== expectedFingerprint
      ) {
        return corrupt("xp_fingerprint_invalid");
      }

      total += amount;
      if (total > MAX_TOTAL_XP) return corrupt("xp_total_out_of_range");
      try {
        lastTransactionAt = toDate(row.createdAt);
      } catch {
        return corrupt("xp_total_out_of_range");
      }
    }

    const result: ResolveEnrollmentXpResult = {
      kind: "available",
      enrollmentId,
      curriculumVersion: {
        id: curriculumVersionId,
        code: header.curriculumCode,
        versionNumber: toNumber(header.pinnedVersionNumber)!,
      },
      totalXp: Number(total),
      transactionCount: rows.length,
      lastTransactionAt,
    };
    if (asOf) result.asOf = new Date(asOf.getTime());
    return result;
  } catch (error) {
    if (isCurriculumXpError(error)) throw error;
    throw internalError();
  }
}

function summarize(transaction: {
  id: number;
  enrollmentId: number;
  userId: number;
  curriculumVersionId: number;
  levelDefinitionId: number | null;
  sourceType: CurriculumXpSourceType;
  sourceId: string | null;
  amount: number;
  createdById: number | null;
  createdAt: Date;
}): CurriculumXpTransactionSummary {
  if (transaction.sourceId === null) throw internalError();
  return {
    id: transaction.id,
    enrollmentId: transaction.enrollmentId,
    userId: transaction.userId,
    curriculumVersionId: transaction.curriculumVersionId,
    levelDefinitionId: transaction.levelDefinitionId,
    sourceType: transaction.sourceType,
    sourceId: transaction.sourceId,
    amount: transaction.amount,
    createdById: transaction.createdById,
    createdAt: transaction.createdAt,
  };
}

function exactStoredAward(
  transaction: {
    enrollmentId: number;
    userId: number;
    curriculumVersionId: number;
    levelDefinitionId: number | null;
    sourceType: CurriculumXpSourceType;
    sourceId: string | null;
    idempotencyKey: string;
    payloadFingerprint: string;
    amount: number;
    createdById: number | null;
  },
  expected: CanonicalAward,
) {
  return (
    transaction.enrollmentId === expected.enrollmentId &&
    transaction.userId === expected.userId &&
    transaction.curriculumVersionId === expected.curriculumVersionId &&
    transaction.levelDefinitionId === expected.levelDefinitionId &&
    transaction.sourceType === expected.sourceType &&
    transaction.sourceId === expected.sourceId &&
    transaction.idempotencyKey === expected.idempotencyKey &&
    transaction.payloadFingerprint === expected.payloadFingerprint &&
    transaction.amount === expected.amount &&
    transaction.createdById === expected.actorId
  );
}

function classifyP2002(error: unknown): "idempotency" | "source" | null {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") {
    return null;
  }
  const target = JSON.stringify((error as { meta?: { target?: unknown } }).meta?.target ?? "");
  if (target.includes("idempotencyKey")) return "idempotency";
  if (
    target.includes("enrollmentId_sourceType_sourceId") ||
    (target.includes("enrollmentId") &&
      target.includes("sourceType") &&
      target.includes("sourceId"))
  ) {
    return "source";
  }
  return null;
}

async function findExistingByKey(tx: XpTransactionClient, key: string) {
  return tx.xPTransaction.findUnique({ where: { idempotencyKey: key } });
}

async function findExistingBySource(tx: XpTransactionClient, award: CanonicalAward) {
  return tx.xPTransaction.findFirst({
    where: {
      enrollmentId: award.enrollmentId,
      sourceType: award.sourceType,
      sourceId: award.sourceId,
    },
  });
}

function recoveredResult(
  existing: NonNullable<Awaited<ReturnType<typeof findExistingByKey>>>,
  award: CanonicalAward,
  conflict: "idempotency" | "source",
): RecordCurriculumXpResult {
  if (!exactStoredAward(existing, award)) {
    throw new CurriculumXpError(
      conflict === "idempotency" ? "XP_IDEMPOTENCY_CONFLICT" : "XP_SOURCE_CONFLICT",
      conflict === "idempotency"
        ? "XP idempotency identity conflicts with the stored award"
        : "XP source identity conflicts with the stored award",
    );
  }
  return { kind: "recorded", created: false, transaction: summarize(existing) };
}

async function canonicalAward(
  tx: XpTransactionClient,
  input: RecordCurriculumXpInTransactionInput,
  allowCompletedEnrollment = false,
): Promise<CanonicalAward> {
  const enrollmentId = positiveId(input.enrollmentId, "enrollmentId");
  if (!isApprovedSource(input.sourceType)) {
    throw new CurriculumXpError("XP_SOURCE_INVALID", "XP source is not approved");
  }
  const sourceId = normalizeSourceId(input.sourceId);
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > MAX_AWARD_AMOUNT) {
    throw invalidInput("XP amount must be an integer between 1 and 1000000");
  }
  const levelDefinitionId =
    input.levelDefinitionId === undefined || input.levelDefinitionId === null
      ? null
      : positiveId(input.levelDefinitionId, "levelDefinitionId");
  assertSourceLevelContract(input.sourceType, levelDefinitionId);
  const actorId =
    input.actorId === undefined || input.actorId === null
      ? null
      : positiveId(input.actorId, "actorId");
  const metadata = normalizeMetadata(input.metadata);

  const enrollment = await tx.userCurriculumEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      userId: true,
      curriculumVersionId: true,
      curriculumCode: true,
      status: true,
      curriculumVersion: {
        select: { id: true, code: true, status: true },
      },
    },
  });
  if (!enrollment) {
    throw new CurriculumXpError(
      "XP_ENROLLMENT_NOT_FOUND",
      "curriculum enrollment does not exist",
    );
  }
  if (
    (enrollment.status !== "active" &&
      !(allowCompletedEnrollment && enrollment.status === "completed")) ||
    enrollment.curriculumVersion.id !== enrollment.curriculumVersionId ||
    enrollment.curriculumVersion.code !== enrollment.curriculumCode ||
    (enrollment.curriculumVersion.status !== "published" &&
      enrollment.curriculumVersion.status !== "archived")
  ) {
    throw new CurriculumXpError(
      "XP_ENROLLMENT_CORRUPT",
      "curriculum enrollment pin is not awardable",
    );
  }

  if (levelDefinitionId !== null) {
    const level = await tx.levelDefinition.findUnique({
      where: { id: levelDefinitionId },
      select: { id: true, curriculumVersionId: true },
    });
    if (!level || level.curriculumVersionId !== enrollment.curriculumVersionId) {
      throw new CurriculumXpError(
        "XP_LEVEL_VERSION_MISMATCH",
        "XP level does not belong to the enrollment version",
      );
    }
  }

  if (actorId !== null) {
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { id: true, status: true },
    });
    if (!actor || actor.status !== "active") {
      throw new CurriculumXpError("XP_ACTOR_INVALID", "XP actor is invalid");
    }
  }

  const idempotencyKey = buildIdempotencyKey(enrollmentId, input.sourceType, sourceId);
  const partial = {
    enrollmentId,
    userId: enrollment.userId,
    curriculumVersionId: enrollment.curriculumVersionId,
    levelDefinitionId,
    sourceType: input.sourceType,
    sourceId,
    idempotencyKey,
    amount: input.amount,
    actorId,
    metadata,
  };
  return { ...partial, payloadFingerprint: fingerprintFor(partial) };
}

async function recordInsideTransaction(
  tx: XpTransactionClient,
  input: RecordCurriculumXpInTransactionInput,
): Promise<RecordCurriculumXpResult> {
  const award = await canonicalAward(tx, input);
  const existingByKey = await findExistingByKey(tx, award.idempotencyKey);
  if (existingByKey) return recoveredResult(existingByKey, award, "idempotency");
  const existingBySource = await findExistingBySource(tx, award);
  if (existingBySource) return recoveredResult(existingBySource, award, "source");

  let transaction;
  try {
    transaction = await tx.xPTransaction.create({
      data: {
        enrollmentId: award.enrollmentId,
        userId: award.userId,
        curriculumVersionId: award.curriculumVersionId,
        levelDefinitionId: award.levelDefinitionId,
        sourceType: award.sourceType,
        sourceId: award.sourceId,
        idempotencyKey: award.idempotencyKey,
        payloadFingerprint: award.payloadFingerprint,
        amount: award.amount,
        metadata: award.metadata === null ? Prisma.DbNull : award.metadata,
        createdById: award.actorId,
      },
    });
  } catch (error) {
    const unique = classifyP2002(error);
    if (!unique) throw error;
    const existing =
      unique === "idempotency"
        ? await findExistingByKey(tx, award.idempotencyKey)
        : await findExistingBySource(tx, award);
    if (!existing) throw internalError();
    return recoveredResult(existing, award, unique);
  }

  await tx.auditLog.create({
    data: {
      userId: award.actorId,
      action: CURRICULUM_AUDIT_ACTIONS.xpAwarded,
      entityType: "XPTransaction",
      entityId: String(transaction.id),
      metadata: {
        transactionId: transaction.id,
        enrollmentId: award.enrollmentId,
        userId: award.userId,
        curriculumVersionId: award.curriculumVersionId,
        sourceType: award.sourceType,
        sourceIdHash: sourceIdHash(award.sourceId),
        levelDefinitionId: award.levelDefinitionId,
        amount: award.amount,
        actorId: award.actorId,
      },
    },
  });

  return { kind: "recorded", created: true, transaction: summarize(transaction) };
}

export async function recordCurriculumXpInTransaction(
  tx: XpTransactionClient,
  input: RecordCurriculumXpInTransactionInput,
): Promise<RecordCurriculumXpResult> {
  if (!isCurriculumV2XpEnabled()) {
    throw new CurriculumXpError("XP_DISABLED", "curriculum XP is disabled");
  }
  try {
    return await recordInsideTransaction(tx, input);
  } catch (error) {
    if (isCurriculumXpError(error)) throw error;
    throw internalError();
  }
}

// Read-only durable retry verifier for transaction coordinators. It deliberately
// permits a completed enrollment because terminal completion retries happen after
// the enrollment transition. The ordinary record path above still requires an
// active enrollment and therefore cannot create XP for completed history.
export async function verifyCurriculumXpAwardInTransaction(
  tx: XpTransactionClient,
  input: RecordCurriculumXpInTransactionInput,
): Promise<VerifyCurriculumXpAwardResult> {
  try {
    const award = await canonicalAward(tx, input, true);
    const existingByKey = await findExistingByKey(tx, award.idempotencyKey);
    if (existingByKey) {
      return recoveredResult(existingByKey, award, "idempotency");
    }
    const existingBySource = await findExistingBySource(tx, award);
    if (existingBySource) {
      return recoveredResult(existingBySource, award, "source");
    }
    return { kind: "missing" };
  } catch (error) {
    if (isCurriculumXpError(error)) throw error;
    throw internalError();
  }
}

function ownsTransactions(db: XpDb): db is PrismaClient {
  return "$transaction" in db && typeof db.$transaction === "function";
}

export async function recordCurriculumXp({
  db = prisma,
  ...input
}: RecordCurriculumXpInput): Promise<RecordCurriculumXpResult> {
  if (!isCurriculumV2XpEnabled()) {
    throw new CurriculumXpError("XP_DISABLED", "curriculum XP is disabled");
  }
  try {
    if (!ownsTransactions(db)) {
      return await recordCurriculumXpInTransaction(db, input);
    }
    return await db.$transaction((tx) => recordCurriculumXpInTransaction(tx, input));
  } catch (error) {
    if (isCurriculumXpError(error)) throw error;
    throw internalError();
  }
}
