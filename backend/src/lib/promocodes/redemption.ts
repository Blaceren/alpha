import { createHash } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  Promocode,
} from "@prisma/client";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2XpEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveUserCurriculumContext } from "@/lib/curriculum/resolver";
import {
  isCurriculumXpError,
  recordCurriculumXpInTransaction,
  verifyCurriculumXpAwardInTransaction,
} from "@/lib/curriculum/xp";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CODE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{1,49}$/u;
const FINGERPRINT_VERSION = "promocode-redemption-v1";
const MAX_XP_REWARD = 1_000_000;
const DEFAULT_MAX_ATTEMPTS = 8;

export type PromocodeRedemptionErrorCode =
  | "PROMOCODE_INPUT_INVALID"
  | "PROMOCODE_NOT_FOUND"
  | "PROMOCODE_INACTIVE"
  | "PROMOCODE_EXPIRED"
  | "PROMOCODE_MAX_USES_REACHED"
  | "PROMOCODE_USER_LIMIT_REACHED"
  | "PROMOCODE_IDEMPOTENCY_CONFLICT"
  | "PROMOCODE_STATE_CORRUPT"
  | "PROMOCODE_CONCURRENCY_RETRY_EXHAUSTED"
  | "PROMOCODE_V2_STATE_CORRUPT"
  | "PROMOCODE_INTERNAL_ERROR";

export class PromocodeRedemptionError extends Error {
  readonly code: PromocodeRedemptionErrorCode;

  constructor(code: PromocodeRedemptionErrorCode, message: string) {
    super(message);
    this.name = "PromocodeRedemptionError";
    this.code = code;
  }
}

export function isPromocodeRedemptionError(
  error: unknown,
): error is PromocodeRedemptionError {
  return error instanceof PromocodeRedemptionError;
}

export type RedeemPromocodeInput = {
  userId: number;
  code: string;
  requestId: string;
  evaluationTime?: Date;
  db?: PrismaClient;
  retryPolicy?: {
    maxAttempts?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  };
};

export type RedeemPromocodeResult = {
  kind: "redeemed";
  created: boolean;
  requestId: string;
  redemptionId: number;
  xpAwarded: number | null;
  v2XpTransactionId: number | null;
  promocode: Promocode;
};

type RedemptionTransactionClient = Prisma.TransactionClient;

function fail(code: PromocodeRedemptionErrorCode, message: string): never {
  throw new PromocodeRedemptionError(code, message);
}

function normalizeInput(input: RedeemPromocodeInput) {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    fail("PROMOCODE_INPUT_INVALID", "promocode user identity is invalid");
  }
  if (typeof input.code !== "string") {
    fail("PROMOCODE_INPUT_INVALID", "promocode code is invalid");
  }
  const code = input.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    fail("PROMOCODE_INPUT_INVALID", "promocode code is invalid");
  }
  if (
    typeof input.requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(input.requestId)
  ) {
    fail("PROMOCODE_INPUT_INVALID", "promocode request identity is invalid");
  }
  const evaluationTime = input.evaluationTime ?? new Date();
  if (
    !(evaluationTime instanceof Date) ||
    Number.isNaN(evaluationTime.getTime())
  ) {
    fail("PROMOCODE_INPUT_INVALID", "promocode evaluation time is invalid");
  }
  return {
    userId: input.userId,
    code,
    requestId: input.requestId,
    evaluationTime: new Date(evaluationTime.getTime()),
  };
}

function requestFingerprint(userId: number, code: string) {
  const canonical = JSON.stringify({
    version: FINGERPRINT_VERSION,
    userId,
    code,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function xpReward(promocode: Promocode): number | null {
  if (promocode.type !== "xp_bonus") return null;
  const value = promocode.value;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("xp" in value) ||
    !Number.isInteger(value.xp) ||
    Number(value.xp) < 1 ||
    Number(value.xp) > MAX_XP_REWARD
  ) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode XP reward is corrupt");
  }
  return Number(value.xp);
}

function rewardValue(promocode: Promocode) {
  return promocode.value as {
    rewardId?: unknown;
    achievementSlug?: unknown;
  };
}

function assertPromocodeAvailable(promocode: Promocode, now: Date) {
  if (!promocode.isActive) {
    fail("PROMOCODE_INACTIVE", "promocode is inactive");
  }
  if (promocode.startsAt && promocode.startsAt > now) {
    fail("PROMOCODE_INACTIVE", "promocode is not active yet");
  }
  if (promocode.expiresAt && promocode.expiresAt < now) {
    fail("PROMOCODE_EXPIRED", "promocode is expired");
  }
  if (!Number.isSafeInteger(promocode.usedCount) || promocode.usedCount < 0) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode counter is corrupt");
  }
  if (
    !Number.isSafeInteger(promocode.perUserLimit) ||
    promocode.perUserLimit < 1
  ) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode user limit is corrupt");
  }
  if (
    promocode.maxUses !== null &&
    (!Number.isSafeInteger(promocode.maxUses) || promocode.maxUses < 1)
  ) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode global limit is corrupt");
  }
}

function v2FlagsEnabled() {
  return (
    isCurriculumV2ReadEnabled() &&
    isCurriculumV2EnrollmentEnabled() &&
    isCurriculumV2XpEnabled()
  );
}

function v2Metadata(promocodeId: number, redemptionId: number) {
  return { promocodeId, redemptionId };
}

async function verifyExactResult(
  tx: RedemptionTransactionClient,
  stored: NonNullable<
    Awaited<
      ReturnType<
        RedemptionTransactionClient["promocodeRedemptionRequest"]["findUnique"]
      >
    >
  > & {
    promocode: Promocode;
    redemption: { id: number; userId: number; promocodeId: number };
    v2XpTransaction: {
      id: number;
      enrollmentId: number;
      amount: number;
      sourceType: string;
      sourceId: string | null;
      levelDefinitionId: number | null;
      userId: number;
    } | null;
  },
  fingerprint: string,
): Promise<RedeemPromocodeResult> {
  if (stored.requestFingerprint !== fingerprint) {
    fail(
      "PROMOCODE_IDEMPOTENCY_CONFLICT",
      "promocode request identity conflicts with stored input",
    );
  }
  if (
    stored.redemption.userId !== stored.userId ||
    stored.redemption.promocodeId !== stored.promocodeId
  ) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode request ownership is corrupt");
  }

  const sourceId = String(stored.redemptionId);
  if (stored.v2XpTransactionId === null) {
    const unexpected = await tx.xPTransaction.findFirst({
      where: { sourceType: "promocode", sourceId },
      select: { id: true },
    });
    if (unexpected) {
      fail(
        "PROMOCODE_V2_STATE_CORRUPT",
        "V1-only promocode request has an unexpected V2 award",
      );
    }
  } else {
    if (
      stored.xpAwarded === null ||
      !stored.v2XpTransaction ||
      stored.v2XpTransaction.id !== stored.v2XpTransactionId ||
      stored.v2XpTransaction.userId !== stored.userId
    ) {
      fail("PROMOCODE_V2_STATE_CORRUPT", "promocode V2 relation is corrupt");
    }
    const verified = await verifyCurriculumXpAwardInTransaction(tx, {
      enrollmentId: stored.v2XpTransaction.enrollmentId,
      sourceType: "promocode",
      sourceId,
      levelDefinitionId: null,
      amount: stored.xpAwarded,
      actorId: stored.userId,
      metadata: v2Metadata(stored.promocodeId, stored.redemptionId),
    });
    if (
      verified.kind !== "recorded" ||
      verified.transaction.id !== stored.v2XpTransactionId
    ) {
      fail("PROMOCODE_V2_STATE_CORRUPT", "promocode V2 award is missing");
    }
  }

  return {
    kind: "redeemed",
    created: false,
    requestId: stored.requestId,
    redemptionId: stored.redemptionId,
    xpAwarded: stored.xpAwarded,
    v2XpTransactionId: stored.v2XpTransactionId,
    promocode: stored.promocode,
  };
}

async function applyLegacyReward(
  tx: RedemptionTransactionClient,
  promocode: Promocode,
  userId: number,
  xpAwarded: number | null,
) {
  if (xpAwarded !== null) {
    await tx.user.update({
      where: { id: userId },
      data: { xp: { increment: xpAwarded } },
    });
    await tx.xpEvent.create({
      data: {
        userId,
        amount: xpAwarded,
        source: "promocode",
        sourceId: String(promocode.id),
      },
    });
    return;
  }

  const value = rewardValue(promocode);
  if (
    promocode.type === "unlock_reward" &&
    typeof value.rewardId === "number" &&
    Number.isSafeInteger(value.rewardId) &&
    value.rewardId > 0
  ) {
    await tx.userReward.upsert({
      where: { userId_rewardId: { userId, rewardId: value.rewardId } },
      update: {},
      create: {
        userId,
        rewardId: value.rewardId,
        status: "received",
        receivedAt: new Date(),
      },
    });
  }
  if (
    promocode.type === "grant_achievement" &&
    typeof value.achievementSlug === "string" &&
    value.achievementSlug.length > 0
  ) {
    const achievement = await tx.achievement.findUnique({
      where: { slug: value.achievementSlug },
      select: { id: true },
    });
    if (achievement) {
      await tx.userAchievement.upsert({
        where: {
          userId_achievementId: {
            userId,
            achievementId: achievement.id,
          },
        },
        update: {},
        create: {
          userId,
          achievementId: achievement.id,
          source: "promocode",
        },
      });
    }
  }
}

async function dualWriteV2(
  tx: RedemptionTransactionClient,
  userId: number,
  promocodeId: number,
  redemptionId: number,
  xpAwarded: number | null,
) {
  if (xpAwarded === null || !v2FlagsEnabled()) return null;
  const context = await resolveUserCurriculumContext({ userId, db: tx });
  if (context.kind === "enrolled") {
    const award = await recordCurriculumXpInTransaction(tx, {
      enrollmentId: context.enrollment.id,
      sourceType: "promocode",
      sourceId: String(redemptionId),
      levelDefinitionId: null,
      amount: xpAwarded,
      actorId: userId,
      metadata: v2Metadata(promocodeId, redemptionId),
    });
    if (!award.created) {
      fail("PROMOCODE_V2_STATE_CORRUPT", "unexpected existing promocode V2 award");
    }
    return award.transaction.id;
  }
  if (
    context.kind === "candidate" ||
    context.kind === "completed" ||
    context.kind === "unavailable"
  ) {
    return null;
  }
  fail("PROMOCODE_V2_STATE_CORRUPT", "curriculum V2 state is corrupt");
}

async function claimGlobalUse(
  tx: RedemptionTransactionClient,
  promocode: Promocode,
) {
  if (promocode.maxUses === null) {
    await tx.promocode.update({
      where: { id: promocode.id },
      data: { usedCount: { increment: 1 } },
    });
    return;
  }
  const claimed = await tx.promocode.updateMany({
    where: {
      id: promocode.id,
      usedCount: { lt: promocode.maxUses },
    },
    data: { usedCount: { increment: 1 } },
  });
  if (claimed.count === 1) return;

  const current = await tx.promocode.findUnique({
    where: { id: promocode.id },
    select: { usedCount: true, maxUses: true },
  });
  const redemptionCount = await tx.promocodeRedemption.count({
    where: { promocodeId: promocode.id },
  });
  if (!current || current.usedCount !== redemptionCount) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode counter drift detected");
  }
  if (current.maxUses !== null && current.usedCount >= current.maxUses) {
    fail("PROMOCODE_MAX_USES_REACHED", "promocode global limit reached");
  }
  fail("PROMOCODE_STATE_CORRUPT", "promocode global claim failed");
}

async function redeemInsideTransaction(
  tx: RedemptionTransactionClient,
  input: ReturnType<typeof normalizeInput>,
): Promise<RedeemPromocodeResult> {
  const fingerprint = requestFingerprint(input.userId, input.code);
  const stored = await tx.promocodeRedemptionRequest.findUnique({
    where: {
      userId_requestId: { userId: input.userId, requestId: input.requestId },
    },
    include: {
      promocode: true,
      redemption: {
        select: { id: true, userId: true, promocodeId: true },
      },
      v2XpTransaction: {
        select: {
          id: true,
          enrollmentId: true,
          amount: true,
          sourceType: true,
          sourceId: true,
          levelDefinitionId: true,
          userId: true,
        },
      },
    },
  });
  if (stored) return verifyExactResult(tx, stored, fingerprint);

  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: { id: true, status: true },
  });
  if (!user || user.status !== "active") {
    fail("PROMOCODE_INPUT_INVALID", "promocode user is unavailable");
  }
  const promocode = await tx.promocode.findUnique({ where: { code: input.code } });
  if (!promocode) fail("PROMOCODE_NOT_FOUND", "promocode does not exist");
  assertPromocodeAvailable(promocode, input.evaluationTime);

  const globalRedemptions = await tx.promocodeRedemption.count({
    where: { promocodeId: promocode.id },
  });
  if (globalRedemptions !== promocode.usedCount) {
    fail("PROMOCODE_STATE_CORRUPT", "promocode counter drift detected");
  }
  if (promocode.maxUses !== null && promocode.usedCount >= promocode.maxUses) {
    fail("PROMOCODE_MAX_USES_REACHED", "promocode global limit reached");
  }
  const userRedemptions = await tx.promocodeRedemption.count({
    where: { promocodeId: promocode.id, userId: input.userId },
  });
  if (userRedemptions >= promocode.perUserLimit) {
    fail("PROMOCODE_USER_LIMIT_REACHED", "promocode user limit reached");
  }

  const xpAwarded = xpReward(promocode);
  await claimGlobalUse(tx, promocode);
  const redemption = await tx.promocodeRedemption.create({
    data: { promocodeId: promocode.id, userId: input.userId },
  });
  await applyLegacyReward(tx, promocode, input.userId, xpAwarded);

  let v2XpTransactionId: number | null;
  try {
    v2XpTransactionId = await dualWriteV2(
      tx,
      input.userId,
      promocode.id,
      redemption.id,
      xpAwarded,
    );
  } catch (error) {
    if (isPromocodeRedemptionError(error)) throw error;
    if (isCurriculumXpError(error)) {
      if (error.code === "XP_INTERNAL_ERROR") {
        fail("PROMOCODE_INTERNAL_ERROR", "curriculum V2 award failed");
      }
      fail("PROMOCODE_V2_STATE_CORRUPT", "curriculum V2 award failed");
    }
    throw error;
  }

  await tx.promocodeRedemptionRequest.create({
    data: {
      userId: input.userId,
      promocodeId: promocode.id,
      redemptionId: redemption.id,
      requestId: input.requestId,
      requestFingerprint: fingerprint,
      xpAwarded,
      v2XpTransactionId,
    },
  });

  return {
    kind: "redeemed",
    created: true,
    requestId: input.requestId,
    redemptionId: redemption.id,
    xpAwarded,
    v2XpTransactionId,
    promocode,
  };
}

export function isTransientSqliteLockError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const sqliteDatasource = process.env.DATABASE_URL?.startsWith("file:") ?? false;
  const sqliteLock =
    /SQLITE_BUSY|SQLITE_LOCKED|database(?: table)? is locked/i.test(message) ||
    (sqliteDatasource &&
      ["P1008", "P2028", "P2034"].includes(code) &&
      /transaction|timed out|timeout|write conflict|deadlock/i.test(message));
  return sqliteLock && ["P1008", "P2028", "P2034", "5", "6", ""].includes(code);
}

function isRequestIdentityUniqueConflict(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  const target = JSON.stringify(
    (error as { meta?: { target?: unknown } }).meta?.target ?? "",
  );
  return (
    target.includes("PromocodeRedemptionRequest_userId_requestId_key") ||
    (target.includes("userId") && target.includes("requestId"))
  );
}

async function defaultSleep(milliseconds: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function redeemPromocode(
  input: RedeemPromocodeInput,
): Promise<RedeemPromocodeResult> {
  const normalized = normalizeInput(input);
  const db = input.db ?? prisma;
  const maxAttempts = input.retryPolicy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = input.retryPolicy?.sleep ?? defaultSleep;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) {
    fail("PROMOCODE_INPUT_INVALID", "promocode retry policy is invalid");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(
        (tx) => redeemInsideTransaction(tx, normalized),
        { maxWait: 5_000, timeout: 10_000 },
      );
    } catch (error) {
      if (isPromocodeRedemptionError(error)) throw error;
      if (isRequestIdentityUniqueConflict(error) && attempt < maxAttempts) {
        continue;
      }
      if (!isTransientSqliteLockError(error)) {
        throw new PromocodeRedemptionError(
          "PROMOCODE_INTERNAL_ERROR",
          "promocode redemption failed",
        );
      }
      if (attempt === maxAttempts) {
        fail(
          "PROMOCODE_CONCURRENCY_RETRY_EXHAUSTED",
          "promocode concurrency retry exhausted",
        );
      }
      await sleep(Math.min(25 * 2 ** (attempt - 1), 200));
    }
  }
  fail("PROMOCODE_INTERNAL_ERROR", "promocode redemption failed");
}
