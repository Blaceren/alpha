import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type ReportAttachmentStatus } from "@prisma/client";
import { z } from "zod";
import { CURRICULUM_AUDIT_ACTIONS, STABLE_CODE_PATTERN } from "@/lib/curriculum/constants";
import { ReportDomainError, isReportDomainError } from "@/lib/curriculum/report-errors";
import {
  getReportAttachmentScanner,
  isReportAttachmentScannerError,
  type ReportAttachmentScanner,
} from "@/lib/curriculum/report-attachment-scanner";
import {
  getReportAttachmentStorageProvider,
  isReportAttachmentStorageError,
  type ReportAttachmentStorageProvider,
} from "@/lib/curriculum/report-attachment-storage";
import {
  isCurriculumV2EnrollmentEnabled,
  isCurriculumV2ReadEnabled,
  isCurriculumV2ReportAttachmentsEnabled,
  isCurriculumV2ReportEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveUserCurriculumContext } from "@/lib/curriculum/resolver";

// Private report attachment runtime (Phase 5B.5b). Server-only services: no
// HTTP route imports this module yet. Upload and download are proxied by the
// backend; there are no public URLs, no presigned/signed capabilities and no
// caller-supplied storage keys. The caller never provides userId, enrollment,
// version, ownership, storage key, timestamps, scan results or the available
// status - every identity is derived from durable server state.

export const REPORT_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const REPORT_ATTACHMENT_MAX_PER_REVISION = 5;
export const REPORT_ATTACHMENT_MAX_AGGREGATE_BYTES = 25 * 1024 * 1024;
export const REPORT_ATTACHMENT_MAX_NAME_LENGTH = 128;
export const REPORT_ATTACHMENT_RETENTION_MS = 24 * 60 * 60 * 1_000;

const MAX_INT = 2_147_483_647;
const MAX_TRANSACTION_ATTEMPTS = 3;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{7,127}$/;
const CHECKSUM = /^sha256:[a-f0-9]{64}$/;
// Windows/POSIX-unsafe display characters, path separators and controls.
const UNSAFE_NAME = /[\u0000-\u001f\u007f/\\<>:"|?*]/;

type TransactionClient = Prisma.TransactionClient;
type CommandDb = Pick<PrismaClient, "$transaction">;
type RuntimeDb = Pick<PrismaClient, "$transaction" | "reportAttachment">;

export type ReportAttachmentPayload = Uint8Array | AsyncIterable<Uint8Array>;

export type ReportAttachmentRuntimeOptions = {
  db?: CommandDb;
  evaluationTime?: Date;
  storage?: ReportAttachmentStorageProvider;
  scanner?: ReportAttachmentScanner;
};

export type SafeReportAttachment = {
  attachmentId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: ReportAttachmentStatus;
  revisionNumber: number;
  createdAt: string;
  availableAt: string | null;
};

export type SafeReportAttachmentCommandResult = {
  created: boolean;
  retry: boolean;
  attachment: SafeReportAttachment;
};

export type SafeReportAttachmentDeleteResult = {
  created: boolean;
  storagePurged: boolean;
  attachment: SafeReportAttachment;
};

export type SafeReportAttachmentDownload = {
  attachment: SafeReportAttachment;
  bytes: Uint8Array;
};

export type ReportAttachmentCleanupResult = {
  expiredTombstoned: number;
  purged: number;
  purgeRetryRequired: number;
};

// Approved MIME allowlist. Declared MIME, filename extension, magic bytes,
// actual size and SHA-256 are all verified; SVG, HTML, XML, archives, Office
// documents and executable payloads have no entry here and fail closed.
const MIME_CONTRACTS: Record<string, { extensions: readonly string[]; magic: (bytes: Uint8Array) => boolean }> = {
  "application/pdf": {
    extensions: [".pdf"],
    magic: (bytes) => startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]),
  },
  "image/jpeg": {
    extensions: [".jpg", ".jpeg"],
    magic: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  },
  "image/png": {
    extensions: [".png"],
    magic: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  "image/webp": {
    extensions: [".webp"],
    magic: (bytes) =>
      bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
  },
};

function startsWith(bytes: Uint8Array, prefix: number[]) {
  if (bytes.byteLength < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, from: number, to: number) {
  return Buffer.from(bytes.subarray(from, to)).toString("latin1");
}

function flagsEnabled() {
  return (
    isCurriculumV2ReadEnabled() &&
    isCurriculumV2EnrollmentEnabled() &&
    isCurriculumV2ReportEnabled() &&
    isCurriculumV2ReportAttachmentsEnabled()
  );
}

function fail(code: ConstructorParameters<typeof ReportDomainError>[0], message: string): never {
  throw new ReportDomainError(code, message);
}

function assertEnabled() {
  if (!flagsEnabled()) fail("REPORT_ATTACHMENTS_DISABLED", "report attachments are disabled");
}

function parseActor(actorUserId: number) {
  if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) fail("REPORT_INPUT_INVALID", "actor user id is invalid");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function hash(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function sha256(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isRetryableTransactionError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return true;
  const text = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY/i.test(text);
}

async function runTx<T>(db: CommandDb, operation: (tx: TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(operation);
    } catch (error) {
      if (isReportDomainError(error)) throw error;
      if (isReportAttachmentStorageError(error) || isReportAttachmentScannerError(error)) throw error;
      if (isRetryableTransactionError(error) && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
      throw new ReportDomainError("REPORT_INTERNAL_ERROR", "report attachment command failed");
    }
  }
  throw new ReportDomainError("REPORT_INTERNAL_ERROR", "report attachment command failed");
}

function normalizeFileName(raw: string): string {
  const normalized = raw.normalize("NFC").trim();
  if (
    normalized.length < 1 ||
    normalized.length > REPORT_ATTACHMENT_MAX_NAME_LENGTH ||
    UNSAFE_NAME.test(normalized) ||
    normalized.startsWith(".") ||
    normalized.includes("..")
  ) fail("REPORT_ATTACHMENT_NAME_INVALID", "attachment file name is invalid");
  return normalized;
}

function assertMimeContract(fileName: string, mimeType: string) {
  const contract = MIME_CONTRACTS[mimeType];
  if (!contract) fail("REPORT_ATTACHMENT_TYPE_INVALID", "attachment MIME type is not allowed");
  const lower = fileName.toLowerCase();
  if (!contract.extensions.some((extension) => lower.endsWith(extension) && lower.length > extension.length)) {
    fail("REPORT_ATTACHMENT_TYPE_INVALID", "attachment file extension does not match its MIME type");
  }
  return contract;
}

function assertDeclaredSize(sizeBytes: number) {
  if (!Number.isSafeInteger(sizeBytes)) fail("REPORT_INPUT_INVALID", "attachment size is invalid");
  if (sizeBytes <= 0) fail("REPORT_ATTACHMENT_EMPTY", "empty attachments are forbidden");
  if (sizeBytes > REPORT_ATTACHMENT_MAX_FILE_BYTES) fail("REPORT_ATTACHMENT_TOO_LARGE", "attachment exceeds the size limit");
}

// Bounded in-memory collection: never holds more than the approved 10 MiB
// (plus one chunk boundary) and never spills to temp files or public dirs.
async function collectPayload(payload: ReportAttachmentPayload): Promise<Buffer> {
  if (payload instanceof Uint8Array) {
    assertDeclaredSize(payload.byteLength);
    return Buffer.from(payload);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of payload) {
    if (!(chunk instanceof Uint8Array)) fail("REPORT_INPUT_INVALID", "attachment payload chunk is invalid");
    total += chunk.byteLength;
    if (total > REPORT_ATTACHMENT_MAX_FILE_BYTES) {
      fail("REPORT_ATTACHMENT_TOO_LARGE", "attachment exceeds the size limit");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (total <= 0) fail("REPORT_ATTACHMENT_EMPTY", "empty attachments are forbidden");
  return Buffer.concat(chunks, total);
}

function storageFor(options: ReportAttachmentRuntimeOptions): ReportAttachmentStorageProvider {
  try {
    return options.storage ?? getReportAttachmentStorageProvider();
  } catch {
    fail("REPORT_ATTACHMENT_STORAGE_UNAVAILABLE", "report attachment storage is unavailable");
  }
}

function scannerFor(options: ReportAttachmentRuntimeOptions): ReportAttachmentScanner {
  try {
    return options.scanner ?? getReportAttachmentScanner();
  } catch {
    fail("REPORT_ATTACHMENT_SCANNER_UNAVAILABLE", "report attachment scanner is unavailable");
  }
}

const attachmentInclude = {
  revision: { select: { id: true, revisionNumber: true, kind: true, submissionId: true } },
  submission: {
    select: {
      id: true,
      userId: true,
      enrollmentId: true,
      curriculumVersionId: true,
      levelDefinitionId: true,
      status: true,
      workflowVersion: true,
      activeRevisionId: true,
      submittedRevisionId: true,
      claimedById: true,
      claimExpiresAt: true,
      enrollment: { select: { id: true, userId: true, curriculumVersionId: true, status: true } },
      progress: { select: { id: true, status: true } },
      // No orderBy: every consumer below is order-independent (max/find scans).
      revisions: {
        select: { id: true, revisionNumber: true, kind: true },
      },
    },
  },
} as const;

type AttachmentGraph = Prisma.ReportAttachmentGetPayload<{ include: typeof attachmentInclude }>;

function assertGraphSane(attachment: AttachmentGraph) {
  const submission = attachment.submission;
  if (
    attachment.ownerUserId !== submission.userId ||
    attachment.revision.submissionId !== submission.id ||
    submission.enrollment.userId !== submission.userId ||
    submission.enrollment.id !== submission.enrollmentId ||
    submission.enrollment.curriculumVersionId !== submission.curriculumVersionId ||
    (attachment.checksum !== null && !CHECKSUM.test(attachment.checksum)) ||
    !MIME_CONTRACTS[attachment.mimeType]
  ) fail("REPORT_STATE_CORRUPT", "report attachment ownership state is corrupt");
}

// The last submitted revision number splits history into the immutable
// submitted sets and the current mutable working set. Attachments always bind
// to the draft revision that was active when they were initiated; membership
// windows are derived from immutable revision numbers.
function lastSubmittedRevisionNumber(revisions: Array<{ revisionNumber: number; kind: string }>) {
  let last = 0;
  for (const revision of revisions) {
    if (revision.kind !== "draft_autosave" && revision.revisionNumber > last) last = revision.revisionNumber;
  }
  return last;
}

type MutableScope = {
  activeRevisionId: number;
  lastSubmitted: number;
};

function assertMutableForAttachments(attachmentOrNull: AttachmentGraph | null, submission: AttachmentGraph["submission"]): MutableScope {
  if (submission.enrollment.status !== "active") fail("REPORT_SUBMISSION_IMMUTABLE", "completed enrollment is immutable");
  if (submission.status === "pending_review") fail("REPORT_ALREADY_SUBMITTED", "submitted report attachments are immutable");
  if (submission.status === "approved") fail("REPORT_SUBMISSION_IMMUTABLE", "approved report attachments are immutable");
  if (submission.status !== "draft" && submission.status !== "rejected") fail("REPORT_STATE_CORRUPT", "report submission status is corrupt");
  if (!submission.progress || submission.progress.status !== "in_progress") {
    fail("REPORT_ATTACHMENT_REVISION_STALE", "report progress is not writable");
  }
  const active = submission.revisions.find((revision) => revision.id === submission.activeRevisionId);
  if (!active) fail("REPORT_STATE_CORRUPT", "report active revision is corrupt");
  if (active.kind !== "draft_autosave") fail("REPORT_CORRECTION_REQUIRED", "a correction draft is required before attachments can change");
  const lastSubmitted = lastSubmittedRevisionNumber(submission.revisions);
  if (attachmentOrNull && attachmentOrNull.revision.revisionNumber <= lastSubmitted) {
    fail("REPORT_ATTACHMENT_REVISION_IMMUTABLE", "attachments of a submitted revision are immutable");
  }
  return { activeRevisionId: active.id, lastSubmitted };
}

async function workingSetUsage(
  tx: TransactionClient,
  submissionId: number,
  lastSubmitted: number,
  excludeAttachmentId?: number,
) {
  const rows = await tx.reportAttachment.findMany({
    where: {
      submissionId,
      status: { in: ["initiated", "uploaded", "quarantined", "available"] },
      ...(excludeAttachmentId ? { id: { not: excludeAttachmentId } } : {}),
    },
    select: { sizeBytes: true, revision: { select: { revisionNumber: true } } },
  });
  let count = 0;
  let aggregateBytes = 0;
  for (const row of rows) {
    if (row.revision.revisionNumber > lastSubmitted) {
      count += 1;
      aggregateBytes += row.sizeBytes;
    }
  }
  return { count, aggregateBytes };
}

function assertLimits(usage: { count: number; aggregateBytes: number }, addedBytes: number) {
  if (usage.count + 1 > REPORT_ATTACHMENT_MAX_PER_REVISION) {
    fail("REPORT_ATTACHMENT_COUNT_EXCEEDED", "attachment count limit is exceeded for this revision");
  }
  if (usage.aggregateBytes + addedBytes > REPORT_ATTACHMENT_MAX_AGGREGATE_BYTES) {
    fail("REPORT_ATTACHMENT_AGGREGATE_EXCEEDED", "attachment aggregate size limit is exceeded for this revision");
  }
}

function safeAttachment(row: {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: ReportAttachmentStatus;
  createdAt: Date;
  availableAt: Date | null;
}, revisionNumber: number): SafeReportAttachment {
  return {
    attachmentId: row.id,
    fileName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    revisionNumber,
    createdAt: row.createdAt.toISOString(),
    availableAt: row.availableAt ? row.availableAt.toISOString() : null,
  };
}

function attachmentAuditMetadata(input: {
  attachment: AttachmentGraph | { id: number; submissionId: number; revisionId: number; mimeType: string; sizeBytes: number };
  actorUserId: number | null;
  reason: "scan_clean" | "malware_detected" | "owner_deleted" | "retention_expired";
}) {
  // Allowlist only: attachment/submission/revision ids, actor, MIME, size and
  // a safe reason code. Never the filename, storage key, checksum, content,
  // credentials or scanner response.
  return {
    attachmentId: input.attachment.id,
    submissionId: input.attachment.submissionId,
    revisionId: input.attachment.revisionId,
    actorUserId: input.actorUserId,
    mimeType: input.attachment.mimeType,
    sizeBytes: input.attachment.sizeBytes,
    reason: input.reason,
  };
}

async function loadOwnAttachment(tx: TransactionClient, actorUserId: number, attachmentId: number) {
  const attachment = await tx.reportAttachment.findUnique({ where: { id: attachmentId }, include: attachmentInclude });
  if (!attachment || attachment.ownerUserId !== actorUserId) {
    fail("REPORT_ATTACHMENT_NOT_FOUND", "report attachment was not found");
  }
  assertGraphSane(attachment);
  return attachment;
}

async function requireActiveUser(tx: TransactionClient, actorUserId: number) {
  const user = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, status: true } });
  if (!user || user.status !== "active") fail("REPORT_USER_NOT_FOUND", "report actor was not found");
}

// --- initiate -------------------------------------------------------------

const initiateSchema = z.strictObject({
  levelNumber: z.number().int().positive().max(MAX_INT).optional(),
  stableCode: z.string().trim().regex(STABLE_CODE_PATTERN).optional(),
  requestId: z.string().trim().regex(REQUEST_ID),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).refine((value) => Number(value.levelNumber !== undefined) + Number(value.stableCode !== undefined) === 1, {
  message: "exactly one level selector is required",
});

const initiateReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("attachment_initiated"),
  attachmentId: z.number().int().positive(),
  revisionNumber: z.number().int().positive(),
});

const finalizeReceiptSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("attachment_available"),
  attachmentId: z.number().int().positive(),
  revisionNumber: z.number().int().positive(),
});

async function resolveOwnReportSubmission(
  tx: TransactionClient,
  actorUserId: number,
  selector: { levelNumber?: number; stableCode?: string },
  evaluationTime: Date,
) {
  await requireActiveUser(tx, actorUserId);
  const context = await resolveUserCurriculumContext({ userId: actorUserId, asOf: evaluationTime, db: tx });
  if (context.kind === "disabled") fail("REPORT_ATTACHMENTS_DISABLED", "report attachments are disabled");
  if (context.kind === "user_not_found") fail("REPORT_USER_NOT_FOUND", "report actor was not found");
  if (context.kind === "corrupt") fail("REPORT_STATE_CORRUPT", "curriculum state is corrupt");
  if (context.kind !== "enrolled" && context.kind !== "completed") fail("REPORT_NOT_ENROLLED", "report actor is not enrolled");
  if (context.kind === "completed") fail("REPORT_SUBMISSION_IMMUTABLE", "completed enrollment is immutable");
  const level = context.levels.find((item) =>
    selector.levelNumber !== undefined ? item.levelNumber === selector.levelNumber : item.stableCode === selector.stableCode,
  );
  if (!level) fail("REPORT_LEVEL_NOT_STARTED", "report level is not accessible");
  const moduleDefinition = context.modules.find((item) => item.id === level.moduleId);
  if (!moduleDefinition || level.status !== "active" || moduleDefinition.status !== "active") {
    fail("REPORT_LEVEL_NOT_STARTED", "report level is not accessible");
  }
  if (level.type !== "report" || level.completionMethod !== "report_approval") {
    fail("REPORT_LEVEL_WRONG_TYPE", "level is not a report level");
  }
  const submission = await tx.reportSubmission.findUnique({
    where: { enrollmentId_levelDefinitionId: { enrollmentId: context.enrollment.id, levelDefinitionId: level.id } },
    select: attachmentInclude.submission.select,
  });
  if (!submission) fail("REPORT_SUBMISSION_NOT_FOUND", "report submission was not found");
  if (submission.userId !== actorUserId) fail("REPORT_STATE_CORRUPT", "report submission ownership is corrupt");
  return submission;
}

export async function initiateOwnReportAttachment(
  actorUserId: number,
  input: unknown,
  options: ReportAttachmentRuntimeOptions = {},
): Promise<SafeReportAttachmentCommandResult> {
  assertEnabled();
  parseActor(actorUserId);
  const parsed = initiateSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "attachment initiate command is invalid");
  const command = parsed.data;
  const fileName = normalizeFileName(command.fileName);
  assertMimeContract(fileName, command.mimeType);
  assertDeclaredSize(command.sizeBytes);
  const evaluationTime = options.evaluationTime ?? new Date();
  return runTx(options.db ?? prisma, async (tx) => {
    const submission = await resolveOwnReportSubmission(tx, actorUserId, command, evaluationTime);
    const fingerprint = hash({
      version: 1,
      actorUserId,
      submissionId: submission.id,
      commandType: "attachment_initiate",
      fileName,
      mimeType: command.mimeType,
      sizeBytes: command.sizeBytes,
    });
    const receipt = await tx.reportCommandReceipt.findUnique({
      where: { actorUserId_requestId: { actorUserId, requestId: command.requestId } },
    });
    if (receipt) {
      if (receipt.commandType !== "attachment_initiate" || receipt.payloadFingerprint !== fingerprint || receipt.submissionId !== submission.id) {
        fail("REPORT_IDEMPOTENCY_CONFLICT", "request id was already used with a different attachment command");
      }
      const safe = initiateReceiptSchema.safeParse(receipt.safeResult);
      if (!safe.success) fail("REPORT_STATE_CORRUPT", "attachment receipt is corrupt");
      const durable = await loadOwnAttachment(tx, actorUserId, safe.data.attachmentId);
      return { created: false, retry: true, attachment: safeAttachment(durable, durable.revision.revisionNumber) };
    }
    const scope = assertMutableForAttachments(null, submission);
    const usage = await workingSetUsage(tx, submission.id, scope.lastSubmitted);
    assertLimits(usage, command.sizeBytes);
    // Server-generated cryptographically random key: opaque, collision-safe,
    // free of user-controlled data, immutable and never reused after creation.
    const storageKey = `ata-v2/report-attachments/${submission.id}/${randomBytes(24).toString("base64url")}`;
    const attachment = await tx.reportAttachment.create({
      data: {
        submissionId: submission.id,
        revisionId: scope.activeRevisionId,
        ownerUserId: actorUserId,
        storageKey,
        originalName: fileName,
        mimeType: command.mimeType,
        sizeBytes: command.sizeBytes,
        status: "initiated",
        createdAt: evaluationTime,
      },
      include: attachmentInclude,
    });
    await tx.reportCommandReceipt.create({
      data: {
        actorUserId,
        submissionId: submission.id,
        commandType: "attachment_initiate",
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        targetRevisionId: scope.activeRevisionId,
        resultRevisionId: scope.activeRevisionId,
        resultingWorkflowVersion: submission.workflowVersion,
        safeResult: {
          version: 1,
          kind: "attachment_initiated",
          attachmentId: attachment.id,
          revisionNumber: attachment.revision.revisionNumber,
        },
        appliedAt: evaluationTime,
      },
    });
    return { created: true, retry: false, attachment: safeAttachment(attachment, attachment.revision.revisionNumber) };
  });
}

// --- finalize ---------------------------------------------------------------

const finalizeSchema = z.strictObject({
  attachmentId: z.number().int().positive().max(MAX_INT),
  requestId: z.string().trim().regex(REQUEST_ID),
});

async function purgeProviderObject(
  db: RuntimeDb,
  storage: ReportAttachmentStorageProvider,
  attachment: { id: number; storageKey: string },
  evaluationTime: Date,
): Promise<boolean> {
  try {
    await storage.deleteObject({ key: attachment.storageKey });
  } catch {
    // Durable pending purge: storagePurgedAt stays NULL and the bounded
    // cleanup service retries the idempotent provider delete later.
    return false;
  }
  await db.reportAttachment.updateMany({
    where: { id: attachment.id, storagePurgedAt: null },
    data: { storagePurgedAt: evaluationTime },
  });
  return true;
}

export async function finalizeOwnReportAttachment(
  actorUserId: number,
  input: unknown,
  payload: ReportAttachmentPayload,
  options: ReportAttachmentRuntimeOptions = {},
): Promise<SafeReportAttachmentCommandResult> {
  assertEnabled();
  parseActor(actorUserId);
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "attachment finalize command is invalid");
  const command = parsed.data;
  const bytes = await collectPayload(payload);
  const checksum = sha256(bytes);
  const db = (options.db ?? prisma) as RuntimeDb & CommandDb;
  const storage = storageFor(options);
  const evaluationTime = options.evaluationTime ?? new Date();
  const fingerprint = hash({
    version: 1,
    actorUserId,
    attachmentId: command.attachmentId,
    commandType: "attachment_finalize",
    checksum,
    sizeBytes: bytes.byteLength,
  });

  type PhaseA =
    | { kind: "retry"; attachment: AttachmentGraph }
    | { kind: "already_available"; attachment: AttachmentGraph }
    | { kind: "proceed"; attachment: AttachmentGraph };

  const phaseA = await runTx(db, async (tx): Promise<PhaseA> => {
    await requireActiveUser(tx, actorUserId);
    const receipt = await tx.reportCommandReceipt.findUnique({
      where: { actorUserId_requestId: { actorUserId, requestId: command.requestId } },
    });
    const attachment = await loadOwnAttachment(tx, actorUserId, command.attachmentId);
    if (receipt) {
      if (receipt.commandType !== "attachment_finalize" || receipt.payloadFingerprint !== fingerprint || receipt.submissionId !== attachment.submissionId) {
        fail("REPORT_IDEMPOTENCY_CONFLICT", "request id was already used with a different attachment command");
      }
      const safe = finalizeReceiptSchema.safeParse(receipt.safeResult);
      if (!safe.success || safe.data.attachmentId !== attachment.id) fail("REPORT_STATE_CORRUPT", "attachment receipt is corrupt");
      if (attachment.status !== "available" || attachment.checksum !== checksum) {
        fail("REPORT_STATE_CORRUPT", "attachment durable state does not match its receipt");
      }
      return { kind: "retry", attachment };
    }
    if (attachment.status === "deleted") fail("REPORT_ATTACHMENT_NOT_FOUND", "report attachment was not found");
    if (attachment.status === "rejected") fail("REPORT_ATTACHMENT_SCAN_REJECTED", "report attachment was rejected");
    if (attachment.status === "available") {
      if (attachment.checksum === checksum) return { kind: "already_available", attachment };
      fail("REPORT_ATTACHMENT_CHECKSUM_MISMATCH", "attachment payload does not match the accepted object");
    }
    assertMutableForAttachments(attachment, attachment.submission);
    if (bytes.byteLength !== attachment.sizeBytes) {
      fail("REPORT_ATTACHMENT_UPLOAD_INCOMPLETE", "attachment payload size does not match the initiated size");
    }
    const contract = MIME_CONTRACTS[attachment.mimeType];
    if (!contract || !contract.magic(bytes)) {
      fail("REPORT_ATTACHMENT_TYPE_INVALID", "attachment content does not match its declared MIME type");
    }
    if (attachment.checksum !== null && attachment.checksum !== checksum) {
      fail("REPORT_ATTACHMENT_CHECKSUM_MISMATCH", "attachment payload does not match the uploaded object");
    }
    return { kind: "proceed", attachment };
  });
  if (phaseA.kind === "retry") {
    return { created: false, retry: true, attachment: safeAttachment(phaseA.attachment, phaseA.attachment.revision.revisionNumber) };
  }
  if (phaseA.kind === "already_available") {
    return { created: false, retry: false, attachment: safeAttachment(phaseA.attachment, phaseA.attachment.revision.revisionNumber) };
  }
  const attachment = phaseA.attachment;

  // Provider write happens after the durable ownership row exists and before
  // any state can become available. Conditional create means the immutable key
  // can never be overwritten with a different payload.
  if (attachment.status === "initiated") {
    try {
      await storage.putObjectIfAbsent({ key: attachment.storageKey, body: bytes, contentType: attachment.mimeType });
    } catch (error) {
      if (isReportAttachmentStorageError(error, "STORAGE_KEY_EXISTS")) {
        let existing: Uint8Array;
        try {
          existing = await storage.getObject({ key: attachment.storageKey });
        } catch {
          fail("REPORT_ATTACHMENT_STORAGE_UNAVAILABLE", "report attachment storage is unavailable");
        }
        if (sha256(existing) !== checksum) fail("REPORT_STATE_CORRUPT", "attachment object key was reused with different content");
      } else {
        fail("REPORT_ATTACHMENT_STORAGE_UNAVAILABLE", "report attachment storage is unavailable");
      }
    }
  } else {
    const head = await (async () => {
      try {
        return await storage.headObject({ key: attachment.storageKey });
      } catch {
        fail("REPORT_ATTACHMENT_STORAGE_UNAVAILABLE", "report attachment storage is unavailable");
      }
    })();
    if (!head.exists) fail("REPORT_ATTACHMENT_UPLOAD_INCOMPLETE", "attachment object is missing from storage");
  }

  await runTx(db, async (tx) => {
    await tx.reportAttachment.updateMany({
      where: { id: attachment.id, ownerUserId: actorUserId, status: "initiated", checksum: null },
      data: { status: "uploaded", checksum },
    });
  });

  let verdict: Awaited<ReturnType<ReportAttachmentScanner["scan"]>> | null = null;
  let scanFailure: unknown = null;
  try {
    const scanner = scannerFor(options);
    verdict = await scanner.scan({ bytes });
  } catch (error) {
    scanFailure = error;
  }
  if (!verdict) {
    // Fail closed: the object stays private and non-available in quarantine;
    // the caller receives a retryable typed error.
    await runTx(db, async (tx) => {
      await tx.reportAttachment.updateMany({
        where: { id: attachment.id, ownerUserId: actorUserId, status: "uploaded", checksum },
        data: { status: "quarantined" },
      });
    });
    if (isReportDomainError(scanFailure)) throw scanFailure;
    if (isReportAttachmentScannerError(scanFailure)) {
      fail("REPORT_ATTACHMENT_SCANNER_UNAVAILABLE", "report attachment scanner is unavailable");
    }
    throw scanFailure;
  }

  if (verdict.verdict === "infected") {
    await runTx(db, async (tx) => {
      const cas = await tx.reportAttachment.updateMany({
        where: { id: attachment.id, ownerUserId: actorUserId, status: { in: ["uploaded", "quarantined"] }, checksum },
        data: {
          status: "rejected",
          scanProvider: verdict.provider,
          scanReference: verdict.reference,
          scanCompletedAt: evaluationTime,
        },
      });
      if (cas.count !== 1) {
        const current = await tx.reportAttachment.findUnique({ where: { id: attachment.id }, select: { status: true } });
        if (current?.status !== "rejected" && current?.status !== "deleted") {
          fail("REPORT_STATE_CORRUPT", "attachment scan rejection lost a concurrent race");
        }
        return;
      }
      await tx.auditLog.create({
        data: {
          userId: actorUserId,
          action: CURRICULUM_AUDIT_ACTIONS.reportAttachmentRejected,
          entityType: "ReportAttachment",
          entityId: String(attachment.id),
          metadata: attachmentAuditMetadata({ attachment, actorUserId, reason: "malware_detected" }),
        },
      });
    });
    // An infected object is removed at the first safe opportunity; a failed
    // provider delete leaves the durable pending-purge state for cleanup.
    await purgeProviderObject(db, storage, attachment, evaluationTime);
    fail("REPORT_ATTACHMENT_SCAN_REJECTED", "report attachment was rejected by the malware scan");
  }

  return runTx(db, async (tx) => {
    const fresh = await loadOwnAttachment(tx, actorUserId, attachment.id);
    if (fresh.status === "available") {
      if (fresh.checksum !== checksum) fail("REPORT_ATTACHMENT_CHECKSUM_MISMATCH", "attachment payload does not match the accepted object");
      return { created: false, retry: false, attachment: safeAttachment(fresh, fresh.revision.revisionNumber) };
    }
    if (fresh.status === "deleted") fail("REPORT_ATTACHMENT_NOT_FOUND", "report attachment was not found");
    if (fresh.status === "rejected") fail("REPORT_ATTACHMENT_SCAN_REJECTED", "report attachment was rejected");
    // Approved limits are re-verified inside the write transaction before the
    // final accepted state.
    assertMutableForAttachments(fresh, fresh.submission);
    const usage = await workingSetUsage(tx, fresh.submissionId, lastSubmittedRevisionNumber(fresh.submission.revisions), fresh.id);
    assertLimits(usage, fresh.sizeBytes);
    if (fresh.checksum !== checksum) fail("REPORT_ATTACHMENT_CHECKSUM_MISMATCH", "attachment payload does not match the uploaded object");
    const cas = await tx.reportAttachment.updateMany({
      where: { id: fresh.id, ownerUserId: actorUserId, status: { in: ["uploaded", "quarantined"] }, checksum },
      data: {
        status: "available",
        availableAt: evaluationTime,
        scanProvider: verdict.provider,
        scanReference: verdict.reference,
        scanCompletedAt: evaluationTime,
      },
    });
    if (cas.count !== 1) fail("REPORT_REVISION_CONFLICT", "attachment changed concurrently");
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: CURRICULUM_AUDIT_ACTIONS.reportAttachmentAvailable,
        entityType: "ReportAttachment",
        entityId: String(fresh.id),
        metadata: attachmentAuditMetadata({ attachment: fresh, actorUserId, reason: "scan_clean" }),
      },
    });
    await tx.reportCommandReceipt.create({
      data: {
        actorUserId,
        submissionId: fresh.submissionId,
        commandType: "attachment_finalize",
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        targetRevisionId: fresh.revisionId,
        resultRevisionId: fresh.revisionId,
        resultingWorkflowVersion: fresh.submission.workflowVersion,
        safeResult: {
          version: 1,
          kind: "attachment_available",
          attachmentId: fresh.id,
          revisionNumber: fresh.revision.revisionNumber,
        },
        appliedAt: evaluationTime,
      },
    });
    const accepted = await tx.reportAttachment.findUniqueOrThrow({ where: { id: fresh.id }, include: attachmentInclude });
    return { created: true, retry: false, attachment: safeAttachment(accepted, accepted.revision.revisionNumber) };
  });
}

// --- downloads --------------------------------------------------------------

const downloadSchema = z.strictObject({
  attachmentId: z.number().int().positive().max(MAX_INT),
});

async function fetchVerifiedBytes(
  storage: ReportAttachmentStorageProvider,
  attachment: { storageKey: string; checksum: string | null; sizeBytes: number },
): Promise<Uint8Array> {
  if (!attachment.checksum) fail("REPORT_STATE_CORRUPT", "available attachment has no durable checksum");
  let bytes: Uint8Array;
  try {
    bytes = await storage.getObject({ key: attachment.storageKey });
  } catch (error) {
    if (isReportAttachmentStorageError(error, "STORAGE_OBJECT_MISSING")) {
      fail("REPORT_STATE_CORRUPT", "available attachment object is missing from storage");
    }
    fail("REPORT_ATTACHMENT_STORAGE_UNAVAILABLE", "report attachment storage is unavailable");
  }
  if (bytes.byteLength !== attachment.sizeBytes || sha256(bytes) !== attachment.checksum) {
    fail("REPORT_STATE_CORRUPT", "attachment object does not match its durable checksum");
  }
  return bytes;
}

export async function resolveOwnReportAttachmentDownload(
  actorUserId: number,
  input: unknown,
  options: ReportAttachmentRuntimeOptions = {},
): Promise<SafeReportAttachmentDownload> {
  assertEnabled();
  parseActor(actorUserId);
  const parsed = downloadSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "attachment download command is invalid");
  const storage = storageFor(options);
  const attachment = await runTx(options.db ?? prisma, async (tx) => {
    await requireActiveUser(tx, actorUserId);
    const loaded = await loadOwnAttachment(tx, actorUserId, parsed.data.attachmentId);
    if (loaded.status === "deleted") fail("REPORT_ATTACHMENT_NOT_FOUND", "report attachment was not found");
    if (loaded.status === "rejected") fail("REPORT_ATTACHMENT_SCAN_REJECTED", "report attachment was rejected");
    if (loaded.status !== "available") fail("REPORT_ATTACHMENT_SCAN_PENDING", "report attachment is not available yet");
    return loaded;
  });
  const bytes = await fetchVerifiedBytes(storage, attachment);
  return { attachment: safeAttachment(attachment, attachment.revision.revisionNumber), bytes };
}

export async function resolveReviewerReportAttachmentDownload(
  actorUserId: number,
  input: unknown,
  options: ReportAttachmentRuntimeOptions = {},
): Promise<SafeReportAttachmentDownload> {
  assertEnabled();
  parseActor(actorUserId);
  const parsed = downloadSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "attachment download command is invalid");
  const storage = storageFor(options);
  const evaluationTime = options.evaluationTime ?? new Date();
  const attachment = await runTx(options.db ?? prisma, async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorUserId }, select: { id: true, role: true, status: true } });
    if (!actor || actor.status !== "active" || (actor.role !== "admin" && actor.role !== "mentor")) {
      fail("REPORT_REVIEWER_FORBIDDEN", "reviewer is forbidden");
    }
    // Authorization is verified before the attachment's existence can leak:
    // every unauthorized combination below resolves to the same not-found.
    const loaded = await tx.reportAttachment.findUnique({ where: { id: parsed.data.attachmentId }, include: attachmentInclude });
    if (!loaded) fail("REPORT_ATTACHMENT_NOT_FOUND", "report attachment was not found");
    assertGraphSane(loaded);
    const submission = loaded.submission;
    const authorized =
      submission.userId !== actorUserId &&
      submission.status === "pending_review" &&
      submission.claimedById === actorUserId &&
      submission.claimExpiresAt !== null &&
      submission.claimExpiresAt.getTime() > evaluationTime.getTime() &&
      loaded.status === "available" &&
      isInCurrentSubmittedSet(loaded, submission);
    if (!authorized) fail("REPORT_ATTACHMENT_NOT_FOUND", "report attachment was not found");
    return loaded;
  });
  const bytes = await fetchVerifiedBytes(storage, attachment);
  return { attachment: safeAttachment(attachment, attachment.revision.revisionNumber), bytes };
}

function isInCurrentSubmittedSet(attachment: AttachmentGraph, submission: AttachmentGraph["submission"]) {
  const submitted = submission.revisions.find((revision) => revision.id === submission.submittedRevisionId);
  if (!submitted) return false;
  let previousSubmitted = 0;
  for (const revision of submission.revisions) {
    if (revision.kind !== "draft_autosave" && revision.revisionNumber < submitted.revisionNumber && revision.revisionNumber > previousSubmitted) {
      previousSubmitted = revision.revisionNumber;
    }
  }
  const number = attachment.revision.revisionNumber;
  return number > previousSubmitted && number < submitted.revisionNumber;
}

// --- delete -----------------------------------------------------------------

const deleteSchema = z.strictObject({
  attachmentId: z.number().int().positive().max(MAX_INT),
  requestId: z.string().trim().regex(REQUEST_ID),
});

export async function deleteOwnReportAttachment(
  actorUserId: number,
  input: unknown,
  options: ReportAttachmentRuntimeOptions = {},
): Promise<SafeReportAttachmentDeleteResult> {
  assertEnabled();
  parseActor(actorUserId);
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "attachment delete command is invalid");
  const storage = storageFor(options);
  const db = (options.db ?? prisma) as RuntimeDb & CommandDb;
  const evaluationTime = options.evaluationTime ?? new Date();
  // Delete idempotency is durable-state based: the pre-provisioned receipt
  // command allowlist has no attachment_delete member and widening a SQLite
  // CHECK would require a forbidden table rebuild. A repeated delete of the
  // same attachment observes the durable tombstone and reports created=false.
  const result = await runTx(db, async (tx) => {
    await requireActiveUser(tx, actorUserId);
    const attachment = await loadOwnAttachment(tx, actorUserId, parsed.data.attachmentId);
    if (attachment.status === "deleted" || attachment.status === "rejected") {
      return { created: false, attachment };
    }
    assertMutableForAttachments(attachment, attachment.submission);
    const cas = await tx.reportAttachment.updateMany({
      where: { id: attachment.id, ownerUserId: actorUserId, status: attachment.status },
      data: { status: "deleted", deletedAt: evaluationTime },
    });
    if (cas.count !== 1) {
      const current = await tx.reportAttachment.findUnique({ where: { id: attachment.id }, select: { status: true } });
      if (current?.status === "deleted") return { created: false, attachment };
      fail("REPORT_REVISION_CONFLICT", "attachment changed concurrently");
    }
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: CURRICULUM_AUDIT_ACTIONS.reportAttachmentDeleted,
        entityType: "ReportAttachment",
        entityId: String(attachment.id),
        metadata: attachmentAuditMetadata({ attachment, actorUserId, reason: "owner_deleted" }),
      },
    });
    return { created: true, attachment };
  });
  // Bytes become inaccessible immediately through the durable tombstone; the
  // provider object is purged best-effort here and retried by cleanup.
  let storagePurged = false;
  if (result.created) {
    storagePurged = await purgeProviderObject(db, storage, result.attachment, evaluationTime);
  } else {
    const current = await db.reportAttachment.findUnique({
      where: { id: result.attachment.id },
      select: { storagePurgedAt: true },
    });
    storagePurged = current?.storagePurgedAt !== null;
  }
  const fresh = await db.reportAttachment.findUniqueOrThrow({ where: { id: result.attachment.id }, include: attachmentInclude });
  return { created: result.created, storagePurged, attachment: safeAttachment(fresh, fresh.revision.revisionNumber) };
}

// --- cleanup ----------------------------------------------------------------

const cleanupSchema = z.strictObject({
  limit: z.number().int().min(1).max(200).optional(),
});

export async function cleanupExpiredReportAttachments(
  input: unknown = {},
  options: ReportAttachmentRuntimeOptions = {},
): Promise<ReportAttachmentCleanupResult> {
  assertEnabled();
  const parsed = cleanupSchema.safeParse(input);
  if (!parsed.success) fail("REPORT_INPUT_INVALID", "attachment cleanup command is invalid");
  const limit = parsed.data.limit ?? 50;
  const storage = storageFor(options);
  const db = (options.db ?? prisma) as RuntimeDb & CommandDb;
  const evaluationTime = options.evaluationTime ?? new Date();
  const cutoff = new Date(evaluationTime.getTime() - REPORT_ATTACHMENT_RETENTION_MS);

  // Abandoned non-available uploads become durable tombstones after 24 hours.
  const expired = await db.reportAttachment.findMany({
    where: { status: { in: ["initiated", "uploaded", "quarantined"] }, createdAt: { lte: cutoff } },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, submissionId: true, revisionId: true, mimeType: true, sizeBytes: true },
  });
  let expiredTombstoned = 0;
  for (const row of expired) {
    await runTx(db, async (tx) => {
      const cas = await tx.reportAttachment.updateMany({
        where: { id: row.id, status: { in: ["initiated", "uploaded", "quarantined"] } },
        data: { status: "deleted", deletedAt: evaluationTime },
      });
      if (cas.count !== 1) return;
      await tx.auditLog.create({
        data: {
          userId: null,
          action: CURRICULUM_AUDIT_ACTIONS.reportAttachmentDeleted,
          entityType: "ReportAttachment",
          entityId: String(row.id),
          metadata: attachmentAuditMetadata({ attachment: row, actorUserId: null, reason: "retention_expired" }),
        },
      });
      expiredTombstoned += 1;
    });
  }

  // Idempotent provider purge with a durable receipt; a failed delete keeps
  // storagePurgedAt NULL so the retry remains discoverable and bounded.
  const pending = await db.reportAttachment.findMany({
    where: { status: { in: ["rejected", "deleted"] }, storagePurgedAt: null },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, storageKey: true },
  });
  let purged = 0;
  let purgeRetryRequired = 0;
  for (const row of pending) {
    const success = await purgeProviderObject(db, storage, row, evaluationTime);
    if (success) purged += 1;
    else purgeRetryRequired += 1;
  }
  return { expiredTombstoned, purged, purgeRetryRequired };
}
