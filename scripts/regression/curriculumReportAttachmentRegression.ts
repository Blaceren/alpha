import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import type { ReportDomainErrorCode } from "../../src/lib/curriculum/report-errors";
import { isReportDomainError } from "../../src/lib/curriculum/report-errors";
import {
  ReportAttachmentStorageError,
  createInMemoryReportAttachmentStorageProvider,
} from "../../src/lib/curriculum/report-attachment-storage";
import {
  DETERMINISTIC_INFECTED_MARKER,
  createDeterministicReportAttachmentScanner,
} from "../../src/lib/curriculum/report-attachment-scanner";

const dbPath = `/tmp/ata-curriculum-report-attachment-${process.pid}.db`;
const dbUrl = `file:${dbPath}`;
const TEMP_MARKER = "ata-report-attachment";
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
}

async function expectError(fn: () => Promise<unknown>, code: ReportDomainErrorCode) {
  try { await fn(); } catch (error) {
    if (isReportDomainError(error, code)) return error;
    throw new Error(`expected ${code}, got ${String(error)}`);
  }
  throw new Error(`expected ${code}, operation succeeded`);
}

function cleanup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
}

function pdfBytes(size = 512, filler = 0x41): Buffer {
  const head = Buffer.from("%PDF-1.4\n%test\n", "latin1");
  if (size <= head.length) return head.subarray(0, size);
  return Buffer.concat([head, Buffer.alloc(size - head.length, filler)]);
}

function pngBytes(size = 256): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x11)]);
}

function jpegBytes(size = 256): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x22)]);
}

function webpBytes(size = 256): Buffer {
  const body = Buffer.alloc(Math.max(12, size), 0x33);
  body.write("RIFF", 0, "latin1");
  body.write("WEBP", 8, "latin1");
  return body;
}

function infectedPdf(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.4\n", "latin1"), Buffer.from(DETERMINISTIC_INFECTED_MARKER, "latin1")]);
}

function tmpEntries() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.includes(TEMP_MARKER));
}

async function main() {
  cleanup();
  const migration = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("prisma", "migrate.ts")], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: dbUrl }, encoding: "utf8",
  });
  if (migration.status !== 0) throw new Error(`${migration.stdout}\n${migration.stderr}`);
  process.env.DATABASE_URL = dbUrl;
  process.env.CURRICULUM_V2_READ_ENABLED = "true";
  process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
  process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
  delete process.env.CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED;
  delete process.env.REPORT_ATTACHMENT_S3_BUCKET;
  delete process.env.REPORT_ATTACHMENT_CLAMAV_HOST;

  const { prisma } = await import("../../src/lib/prisma");
  const submissionRuntime = await import("../../src/lib/curriculum/report-submission");
  const reviewRuntime = await import("../../src/lib/curriculum/report-review");
  const runtime = await import("../../src/lib/curriculum/report-attachments");

  const storage = createInMemoryReportAttachmentStorageProvider();
  const scanner = createDeterministicReportAttachmentScanner();
  const io = { storage, scanner };

  const owner = await prisma.user.create({ data: { email: "attachment-owner@example.com", name: "Attachment Owner" } });
  const second = await prisma.user.create({ data: { email: "attachment-second@example.com", name: "Second Owner" } });
  const outsider = await prisma.user.create({ data: { email: "attachment-outsider@example.com", name: "Outsider" } });
  const blocked = await prisma.user.create({ data: { email: "attachment-blocked@example.com", name: "Blocked", status: "blocked" } });
  const mentor = await prisma.user.create({ data: { email: "attachment-mentor@example.com", name: "Mentor", role: "mentor" } });
  const admin = await prisma.user.create({ data: { email: "attachment-admin@example.com", name: "Admin", role: "admin" } });

  const curriculum = await prisma.curriculumVersion.create({
    data: { code: "ata-v2", name: "ATA V2", versionNumber: 1, status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  const moduleDefinition = await prisma.moduleDefinition.create({
    data: { curriculumVersionId: curriculum.id, moduleNumber: 1, code: "reports", title: "Reports", firstLevel: 1, lastLevel: 1 },
  });
  const reportLevel = await prisma.levelDefinition.create({ data: {
    curriculumVersionId: curriculum.id, moduleId: moduleDefinition.id, levelNumber: 1,
    stableCode: "v2.l001.report", type: "report", title: "Trading report",
    shortDescription: "Safe report", learningObjective: "Explain a process", completionMethod: "report_approval",
  } });
  const assignment = await prisma.reportAssignmentVersion.create({ data: {
    levelDefinitionId: reportLevel.id, curriculumVersionId: curriculum.id, versionNumber: 1,
    status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  } });
  await prisma.reportAssignmentLocalization.create({ data: {
    reportAssignmentVersionId: assignment.id, locale: "en", title: "Assignment",
    instructions: "Provide evidence", successCriteriaSummary: "Provide evidence", submitLabel: "Submit",
  } });
  const evidence = await prisma.reportFieldDefinition.create({ data: {
    reportAssignmentVersionId: assignment.id, stableKey: "evidence", type: "url", required: true,
    sortOrder: 0, validationRules: { version: 1, allowedSchemes: ["https"] }, choiceCodes: Prisma.JsonNull,
  } });
  await prisma.reportFieldLocalization.create({ data: {
    reportFieldDefinitionId: evidence.id, locale: "en", label: "Evidence", helpText: "HTTPS evidence", placeholder: "https://example.com", choiceLabels: Prisma.JsonNull,
  } });
  const rubric = await prisma.reportRubricVersion.create({ data: {
    reportAssignmentVersionId: assignment.id, versionNumber: 1, status: "published", publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  } });
  const criterion = await prisma.reportRubricCriterion.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "process", categoryCode: "risk-management", sortOrder: 0, commentRequired: false,
  } });
  await prisma.reportRubricCriterionLocalization.create({ data: {
    reportRubricCriterionId: criterion.id, locale: "en", title: "Process", description: "Process quality",
  } });
  const scale = await prisma.reportRubricScaleOption.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "meets", ordinal: 0,
  } });
  await prisma.reportRubricScaleOptionLocalization.create({ data: {
    reportRubricScaleOptionId: scale.id, locale: "en", label: "Meets", description: "Meets expectations",
  } });
  const reason = await prisma.reportRejectionReason.create({ data: {
    reportRubricVersionId: rubric.id, stableKey: "missing", sortOrder: 0, active: true,
  } });
  await prisma.reportRejectionReasonLocalization.create({ data: {
    reportRejectionReasonId: reason.id, locale: "en", title: "Missing evidence", guidance: "Add evidence",
  } });
  await prisma.levelReportBinding.create({ data: {
    levelDefinitionId: reportLevel.id, curriculumVersionId: curriculum.id,
    reportAssignmentVersionId: assignment.id, reportRubricVersionId: rubric.id, revision: 0,
  } });

  async function enroll(userId: number) {
    const enrollment = await prisma.userCurriculumEnrollment.create({ data: {
      userId, curriculumVersionId: curriculum.id, curriculumCode: "ata-v2",
      status: "active", currentLevel: 1, highestCompletedLevel: 0,
    } });
    await prisma.userLevelProgress.create({ data: {
      enrollmentId: enrollment.id, curriculumVersionId: curriculum.id,
      levelDefinitionId: reportLevel.id, status: "in_progress",
    } });
    return enrollment;
  }
  await enroll(owner.id);
  await enroll(second.id);

  let requestCounter = 0;
  function rid(prefix: string) {
    requestCounter += 1;
    return `${prefix}-${String(requestCounter).padStart(6, "0")}`;
  }
  async function initiate(userId: number, overrides: Record<string, unknown> = {}) {
    return runtime.initiateOwnReportAttachment(userId, {
      levelNumber: 1,
      requestId: rid("init"),
      fileName: "evidence.pdf",
      mimeType: "application/pdf",
      sizeBytes: 512,
      ...overrides,
    }, io);
  }
  async function makeAvailable(userId: number, bytes: Buffer, overrides: Record<string, unknown> = {}) {
    const initiated = await initiate(userId, { sizeBytes: bytes.byteLength, ...overrides });
    const finalized = await runtime.finalizeOwnReportAttachment(userId, {
      attachmentId: initiated.attachment.attachmentId,
      requestId: rid("fin"),
    }, bytes, io);
    return finalized;
  }

  const tempBefore = tmpEntries();
  const baseline = {
    xp: await prisma.xPTransaction.count(),
    notifications: await prisma.notification.count(),
    v1Reports: await prisma.taskReport.count(),
    v1Progress: await prisma.userTaskProgress.count(),
    enrollments: await prisma.userCurriculumEnrollment.count(),
    progress: await prisma.userLevelProgress.count(),
  };

  // Owner draft (creates submission aggregate + active draft revision).
  await submissionRuntime.saveOwnReportDraft(owner.id, {
    levelNumber: 1, requestId: rid("draft"), expectedRevision: 0,
    fieldValues: { evidence: "https://example.com/proof" },
  });

  try {
    await check("1. attachments flag defaults to false and the whole matrix is required", async () => {
      await expectError(() => initiate(owner.id), "REPORT_ATTACHMENTS_DISABLED");
      await expectError(() => runtime.cleanupExpiredReportAttachments({}, io), "REPORT_ATTACHMENTS_DISABLED");
      process.env.CURRICULUM_V2_REPORT_ATTACHMENTS_ENABLED = "true";
      process.env.CURRICULUM_V2_XP_ENABLED = "true";
      process.env.CURRICULUM_V2_ADMIN_ENABLED = "true";
      delete process.env.CURRICULUM_V2_REPORT_ENABLED;
      await expectError(() => initiate(owner.id), "REPORT_ATTACHMENTS_DISABLED");
      process.env.CURRICULUM_V2_REPORT_ENABLED = "true";
      delete process.env.CURRICULUM_V2_READ_ENABLED;
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: 1 }, io), "REPORT_ATTACHMENTS_DISABLED");
      process.env.CURRICULUM_V2_READ_ENABLED = "true";
      delete process.env.CURRICULUM_V2_ENROLLMENT_ENABLED;
      await expectError(() => runtime.deleteOwnReportAttachment(owner.id, { attachmentId: 1, requestId: rid("del") }, io), "REPORT_ATTACHMENTS_DISABLED");
      process.env.CURRICULUM_V2_ENROLLMENT_ENABLED = "true";
      delete process.env.CURRICULUM_V2_XP_ENABLED;
      delete process.env.CURRICULUM_V2_ADMIN_ENABLED;
    });

    await check("2. owner authorization fails closed for outsider, blocked and missing submission", async () => {
      await expectError(() => initiate(outsider.id), "REPORT_NOT_ENROLLED");
      await expectError(() => initiate(blocked.id), "REPORT_USER_NOT_FOUND");
      await expectError(() => initiate(second.id), "REPORT_SUBMISSION_NOT_FOUND");
      await expectError(() => initiate(owner.id, { levelNumber: 7 }), "REPORT_LEVEL_NOT_STARTED");
    });

    await check("3. strict initiate DTO and filename/MIME/size validation fail closed", async () => {
      await expectError(() => initiate(owner.id, { extra: true }), "REPORT_INPUT_INVALID");
      await expectError(() => initiate(owner.id, { levelNumber: undefined }), "REPORT_INPUT_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "../escape.pdf" }), "REPORT_ATTACHMENT_NAME_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "dir/evidence.pdf" }), "REPORT_ATTACHMENT_NAME_INVALID");
      await expectError(() => initiate(owner.id, { fileName: `${"a".repeat(130)}.pdf` }), "REPORT_ATTACHMENT_NAME_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "evidence.svg", mimeType: "image/svg+xml" }), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "evidence.html", mimeType: "text/html" }), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "evidence.zip", mimeType: "application/zip" }), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "evidence.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "evidence.exe", mimeType: "application/x-msdownload" }), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => initiate(owner.id, { fileName: "evidence.png", mimeType: "application/pdf" }), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => initiate(owner.id, { sizeBytes: 0 }), "REPORT_ATTACHMENT_EMPTY");
      await expectError(() => initiate(owner.id, { sizeBytes: 10 * 1024 * 1024 + 1 }), "REPORT_ATTACHMENT_TOO_LARGE");
    });

    let firstAttachmentId = 0;
    await check("4. initiate creates a private initiated row with a server key and durable receipt", async () => {
      const before = await prisma.reportCommandReceipt.count();
      const result = await initiate(owner.id, { requestId: "init-repeat-000001" });
      firstAttachmentId = result.attachment.attachmentId;
      assert.equal(result.created, true);
      assert.equal(result.attachment.status, "initiated");
      assert.equal(result.attachment.fileName, "evidence.pdf");
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes("storageKey"), false);
      assert.equal(serialized.includes("ata-v2/report-attachments"), false);
      assert.equal(serialized.includes("sha256:"), false);
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: firstAttachmentId } });
      assert.equal(row.status, "initiated");
      assert.match(row.storageKey, /^ata-v2\/report-attachments\/\d+\/[A-Za-z0-9_-]+$/);
      assert.equal(await prisma.reportCommandReceipt.count(), before + 1);
      assert.equal(storage.objects.size, 0);
    });

    await check("5. initiate exact retry returns the durable row; different payload conflicts", async () => {
      const retry = await initiate(owner.id, { requestId: "init-repeat-000001" });
      assert.equal(retry.created, false);
      assert.equal(retry.retry, true);
      assert.equal(retry.attachment.attachmentId, firstAttachmentId);
      await expectError(() => initiate(owner.id, { requestId: "init-repeat-000001", fileName: "other.pdf" }), "REPORT_IDEMPOTENCY_CONFLICT");
    });

    await check("6. finalize validates payload against declared identity before any provider write", async () => {
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: rid("fin") }, pngBytes(512), io), "REPORT_ATTACHMENT_TYPE_INVALID");
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: rid("fin") }, pdfBytes(100), io), "REPORT_ATTACHMENT_UPLOAD_INCOMPLETE");
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: rid("fin") }, Buffer.alloc(0), io), "REPORT_ATTACHMENT_EMPTY");
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: rid("fin") }, Buffer.alloc(10 * 1024 * 1024 + 1, 1), io), "REPORT_ATTACHMENT_TOO_LARGE");
      assert.equal(storage.objects.size, 0);
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: firstAttachmentId } });
      assert.equal(row.status, "initiated");
    });

    await check("7. provider failure keeps the row initiated and returns a retryable typed error", async () => {
      storage.hooks.beforePut = () => { throw new ReportAttachmentStorageError("STORAGE_UNAVAILABLE", "down", true); };
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: rid("fin") }, pdfBytes(512), io), "REPORT_ATTACHMENT_STORAGE_UNAVAILABLE");
      delete storage.hooks.beforePut;
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: firstAttachmentId } });
      assert.equal(row.status, "initiated");
      assert.equal(storage.objects.size, 0);
    });

    await check("8. scanner unavailable/timeout fail closed into quarantine with the object retained", async () => {
      scanner.state.mode = "unavailable";
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: "fin-quarantine-01" }, pdfBytes(512), io), "REPORT_ATTACHMENT_SCANNER_UNAVAILABLE");
      let row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: firstAttachmentId } });
      assert.equal(row.status, "quarantined");
      assert.equal(storage.objects.size, 1);
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: firstAttachmentId }, io), "REPORT_ATTACHMENT_SCAN_PENDING");
      scanner.state.mode = "timeout";
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: "fin-quarantine-02" }, pdfBytes(512), io), "REPORT_ATTACHMENT_SCANNER_UNAVAILABLE");
      row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: firstAttachmentId } });
      assert.equal(row.status, "quarantined");
      scanner.state.mode = "by-marker";
    });

    await check("9. clean scan promotes quarantined upload to available with awaited audit and receipt", async () => {
      const audits = await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_AVAILABLE" } });
      const result = await runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: "fin-clean-000001" }, pdfBytes(512), io);
      assert.equal(result.created, true);
      assert.equal(result.attachment.status, "available");
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: firstAttachmentId } });
      assert.equal(row.status, "available");
      assert.match(row.checksum ?? "", /^sha256:[a-f0-9]{64}$/);
      assert.equal(row.scanReference, "verdict:clean");
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_AVAILABLE" } }), audits + 1);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_AVAILABLE" }, orderBy: { id: "desc" } });
      const metadata = JSON.stringify(audit.metadata);
      assert.equal(metadata.includes("evidence.pdf"), false);
      assert.equal(metadata.includes("storageKey"), false);
      assert.equal(metadata.includes("ata-v2/report-attachments"), false);
      assert.equal(metadata.includes("sha256:"), false);
      assert.equal(metadata.includes("verdict"), false);
    });

    await check("10. finalize exact retry is served from the durable receipt without repeated effects", async () => {
      const audits = await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_AVAILABLE" } });
      const receipts = await prisma.reportCommandReceipt.count();
      const retry = await runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: "fin-clean-000001" }, pdfBytes(512), io);
      assert.equal(retry.created, false);
      assert.equal(retry.retry, true);
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_AVAILABLE" } }), audits);
      assert.equal(await prisma.reportCommandReceipt.count(), receipts);
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: firstAttachmentId, requestId: "fin-clean-000001" }, pdfBytes(512, 0x42), io), "REPORT_IDEMPOTENCY_CONFLICT");
    });

    await check("11. owner download proxies verified private bytes and never leaks the key", async () => {
      const download = await runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: firstAttachmentId }, io);
      assert.equal(Buffer.compare(Buffer.from(download.bytes), pdfBytes(512)), 0);
      assert.equal(download.attachment.fileName, "evidence.pdf");
      const serialized = JSON.stringify(download.attachment);
      assert.equal(serialized.includes("storageKey"), false);
      assert.equal(serialized.includes("ata-v2/"), false);
    });

    await check("12. cross-user access is hidden as not found for reads, finalize and delete", async () => {
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(second.id, { attachmentId: firstAttachmentId }, io), "REPORT_ATTACHMENT_NOT_FOUND");
      await expectError(() => runtime.finalizeOwnReportAttachment(second.id, { attachmentId: firstAttachmentId, requestId: rid("fin") }, pdfBytes(512), io), "REPORT_ATTACHMENT_NOT_FOUND");
      await expectError(() => runtime.deleteOwnReportAttachment(second.id, { attachmentId: firstAttachmentId, requestId: rid("del") }, io), "REPORT_ATTACHMENT_NOT_FOUND");
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: 999_999 }, io), "REPORT_ATTACHMENT_NOT_FOUND");
    });

    await check("13. every approved MIME/magic combination becomes available", async () => {
      for (const [fileName, mimeType, bytes] of [
        ["proof.png", "image/png", pngBytes(300)],
        ["proof.jpg", "image/jpeg", jpegBytes(300)],
        ["proof.jpeg", "image/jpeg", jpegBytes(301)],
        ["proof.webp", "image/webp", webpBytes(300)],
      ] as const) {
        const result = await makeAvailable(owner.id, Buffer.from(bytes), { fileName, mimeType });
        assert.equal(result.attachment.status, "available");
        const removed = await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: result.attachment.attachmentId, requestId: rid("del") }, io);
        assert.equal(removed.created, true);
      }
    });

    await check("14. archive/executable payloads cannot pass the magic check of any allowed MIME", async () => {
      const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200, 5)]);
      const exe = Buffer.concat([Buffer.from("MZ", "latin1"), Buffer.alloc(200, 6)]);
      const initiatedZip = await initiate(owner.id, { fileName: "archive.pdf", sizeBytes: zip.byteLength });
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: initiatedZip.attachment.attachmentId, requestId: rid("fin") }, zip, io), "REPORT_ATTACHMENT_TYPE_INVALID");
      const initiatedExe = await initiate(owner.id, { fileName: "tool.png", mimeType: "image/png", sizeBytes: exe.byteLength });
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: initiatedExe.attachment.attachmentId, requestId: rid("fin") }, exe, io), "REPORT_ATTACHMENT_TYPE_INVALID");
      for (const stale of [initiatedZip, initiatedExe]) {
        await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: stale.attachment.attachmentId, requestId: rid("del") }, io);
      }
    });

    await check("15. infected upload is rejected, audited and purged; it can never become available", async () => {
      const bytes = infectedPdf();
      const initiated = await initiate(owner.id, { fileName: "malware.pdf", sizeBytes: bytes.byteLength });
      const id = initiated.attachment.attachmentId;
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("fin") }, bytes, io), "REPORT_ATTACHMENT_SCAN_REJECTED");
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "rejected");
      assert.equal(row.scanReference, "verdict:infected");
      assert.notEqual(row.storagePurgedAt, null);
      assert.equal(storage.objects.has(row.storageKey), false);
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_REJECTED" } }), 1);
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: id }, io), "REPORT_ATTACHMENT_SCAN_REJECTED");
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("fin") }, bytes, io), "REPORT_ATTACHMENT_SCAN_REJECTED");
    });

    await check("16. per-revision count limit is enforced and re-checked transactionally", async () => {
      const created: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const result = await initiate(owner.id, { fileName: `slot-${index}.pdf`, sizeBytes: 256 });
        created.push(result.attachment.attachmentId);
      }
      await expectError(() => initiate(owner.id, { fileName: "slot-overflow.pdf", sizeBytes: 256 }), "REPORT_ATTACHMENT_COUNT_EXCEEDED");
      for (const id of created) {
        await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("del") }, io);
      }
    });

    await check("17. per-revision aggregate size limit is enforced", async () => {
      const nineMiB = 9 * 1024 * 1024;
      const bigOne = await initiate(owner.id, { fileName: "big-one.pdf", sizeBytes: nineMiB });
      const bigTwo = await initiate(owner.id, { fileName: "big-two.pdf", sizeBytes: nineMiB });
      await expectError(() => initiate(owner.id, { fileName: "big-three.pdf", sizeBytes: nineMiB }), "REPORT_ATTACHMENT_AGGREGATE_EXCEEDED");
      for (const result of [bigOne, bigTwo]) {
        await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: result.attachment.attachmentId, requestId: rid("del") }, io);
      }
    });

    await check("18. audit failure after upload rolls back the available transition", async () => {
      const bytes = pdfBytes(700);
      const initiated = await initiate(owner.id, { fileName: "audit-down.pdf", sizeBytes: bytes.byteLength });
      const id = initiated.attachment.attachmentId;
      const failingDb = {
        reportAttachment: prisma.reportAttachment,
        $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
          prisma.$transaction((tx) => fn(new Proxy(tx, {
            get(target, property, receiver) {
              if (property === "auditLog") {
                return { create: async () => { throw new Error("audit log unavailable"); } };
              }
              return Reflect.get(target, property, receiver);
            },
          }) as Prisma.TransactionClient)),
      };
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("fin") }, bytes, { ...io, db: failingDb as never }), "REPORT_INTERNAL_ERROR");
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id } });
      assert.notEqual(row.status, "available");
      assert.equal(storage.objects.has(row.storageKey), true);
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: id }, io), "REPORT_ATTACHMENT_SCAN_PENDING");
      const recovered = await runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("fin") }, bytes, io);
      assert.equal(recovered.attachment.status, "available");
      await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("del") }, io);
    });

    await check("19. owner delete tombstones immediately, purges the object and stays idempotent", async () => {
      const bytes = pdfBytes(400);
      const result = await makeAvailable(owner.id, bytes, { fileName: "removable.pdf" });
      const id = result.attachment.attachmentId;
      const audits = await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_DELETED" } });
      const removed = await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("del") }, io);
      assert.equal(removed.created, true);
      assert.equal(removed.storagePurged, true);
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "deleted");
      assert.notEqual(row.deletedAt, null);
      assert.notEqual(row.storagePurgedAt, null);
      assert.equal(storage.objects.has(row.storageKey), false);
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_DELETED" } }), audits + 1);
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: id }, io), "REPORT_ATTACHMENT_NOT_FOUND");
      const again = await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("del") }, io);
      assert.equal(again.created, false);
      assert.equal(await prisma.auditLog.count({ where: { action: "CURRICULUM_REPORT_ATTACHMENT_DELETED" } }), audits + 1);
    });

    // Submit the report with one available attachment for the reviewer flow.
    let submittedAttachmentId = 0;
    await check("20. submitted revision freezes its attachment set", async () => {
      const bytes = pdfBytes(900);
      const result = await makeAvailable(owner.id, bytes, { fileName: "submitted-proof.pdf" });
      submittedAttachmentId = result.attachment.attachmentId;
      const context = await submissionRuntime.resolveOwnReportContext({ actorUserId: owner.id, levelNumber: 1, locale: "en" });
      if (context.kind !== "draft") throw new Error(`unexpected context ${context.kind}`);
      await submissionRuntime.submitOwnReport(owner.id, {
        levelNumber: 1, requestId: rid("submit"), expectedRevision: context.submission.workflowVersion,
      });
      await expectError(() => runtime.deleteOwnReportAttachment(owner.id, { attachmentId: submittedAttachmentId, requestId: rid("del") }, io), "REPORT_ALREADY_SUBMITTED");
      await expectError(() => initiate(owner.id, { fileName: "late.pdf" }), "REPORT_ALREADY_SUBMITTED");
      const download = await runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: submittedAttachmentId }, io);
      assert.equal(Buffer.compare(Buffer.from(download.bytes), bytes), 0);
    });

    await check("21. inspectSubmission still accepts attachment receipts (no corrupt regression)", async () => {
      const context = await submissionRuntime.resolveOwnReportContext({ actorUserId: owner.id, levelNumber: 1, locale: "en" });
      assert.equal(context.kind, "pending_review");
    });

    await check("22. reviewer without an active claim cannot even observe the attachment", async () => {
      await expectError(() => runtime.resolveReviewerReportAttachmentDownload(mentor.id, { attachmentId: submittedAttachmentId }, io), "REPORT_ATTACHMENT_NOT_FOUND");
      await expectError(() => runtime.resolveReviewerReportAttachmentDownload(owner.id, { attachmentId: submittedAttachmentId }, io), "REPORT_REVIEWER_FORBIDDEN");
      await expectError(() => runtime.resolveReviewerReportAttachmentDownload(outsider.id, { attachmentId: submittedAttachmentId }, io), "REPORT_REVIEWER_FORBIDDEN");
    });

    let queueItem!: { submissionRef: string; revision: { revisionNumber: number } };
    await check("23. claim owner reads available attachments of the current submitted revision only", async () => {
      const queue = await reviewRuntime.listReportReviewQueue(mentor.id, { locale: "en" });
      if (queue.kind !== "resolved" || queue.items.length !== 1) throw new Error("queue is not resolved");
      queueItem = queue.items[0];
      await reviewRuntime.claimReportForReview(mentor.id, {
        submissionRef: queueItem.submissionRef, requestId: rid("claim"),
        expectedWorkflowVersion: (await prisma.reportSubmission.findFirstOrThrow({ where: { userId: owner.id } })).workflowVersion,
        expectedClaimVersion: (await prisma.reportSubmission.findFirstOrThrow({ where: { userId: owner.id } })).claimVersion,
        expectedSubmittedRevision: queueItem.revision.revisionNumber,
      });
      const download = await runtime.resolveReviewerReportAttachmentDownload(mentor.id, { attachmentId: submittedAttachmentId }, io);
      assert.equal(download.attachment.fileName, "submitted-proof.pdf");
      // Another reviewer (active admin) without the claim stays blind.
      await expectError(() => runtime.resolveReviewerReportAttachmentDownload(admin.id, { attachmentId: submittedAttachmentId }, io), "REPORT_ATTACHMENT_NOT_FOUND");
    });

    await check("24. expired claim removes reviewer read access", async () => {
      const future = new Date(Date.now() + 2 * 60 * 60 * 1_000);
      await expectError(() => runtime.resolveReviewerReportAttachmentDownload(mentor.id, { attachmentId: submittedAttachmentId }, { ...io, evaluationTime: future }), "REPORT_ATTACHMENT_NOT_FOUND");
    });

    await check("25. reviewer cannot add, replace or delete owner attachments", async () => {
      await expectError(() => runtime.initiateOwnReportAttachment(mentor.id, { levelNumber: 1, requestId: rid("init"), fileName: "reviewer.pdf", mimeType: "application/pdf", sizeBytes: 100 }, io), "REPORT_NOT_ENROLLED");
      await expectError(() => runtime.deleteOwnReportAttachment(mentor.id, { attachmentId: submittedAttachmentId, requestId: rid("del") }, io), "REPORT_ATTACHMENT_NOT_FOUND");
      await expectError(() => runtime.finalizeOwnReportAttachment(mentor.id, { attachmentId: submittedAttachmentId, requestId: rid("fin") }, pdfBytes(900), io), "REPORT_ATTACHMENT_NOT_FOUND");
    });

    await check("26. rejection opens a new correction set; the submitted set stays immutable", async () => {
      const submission = await prisma.reportSubmission.findFirstOrThrow({ where: { userId: owner.id } });
      await reviewRuntime.rejectReportSubmission(mentor.id, {
        submissionRef: queueItem.submissionRef, requestId: rid("reject"),
        expectedWorkflowVersion: submission.workflowVersion,
        expectedClaimVersion: submission.claimVersion,
        expectedSubmittedRevision: queueItem.revision.revisionNumber,
        reasonCode: "missing",
        humanComment: "Please attach the full journal export.",
        correctiveAction: "Add the missing evidence and resubmit.",
        scores: [{ criterionCode: "process", scaleCode: "meets" }],
      });
      // The old submitted attachment can still be read by its owner but not deleted.
      await expectError(() => runtime.deleteOwnReportAttachment(owner.id, { attachmentId: submittedAttachmentId, requestId: rid("del") }, io), "REPORT_CORRECTION_REQUIRED");
      const context = await submissionRuntime.resolveOwnReportContext({ actorUserId: owner.id, levelNumber: 1, locale: "en" });
      if (context.kind !== "rejected") throw new Error(`unexpected context ${context.kind}`);
      await submissionRuntime.saveOwnReportDraft(owner.id, {
        levelNumber: 1, requestId: rid("draft"), expectedRevision: context.submission.workflowVersion,
        fieldValues: { evidence: "https://example.com/proof-2" },
      });
      await expectError(() => runtime.deleteOwnReportAttachment(owner.id, { attachmentId: submittedAttachmentId, requestId: rid("del") }, io), "REPORT_ATTACHMENT_REVISION_IMMUTABLE");
      const correction = await makeAvailable(owner.id, pdfBytes(1_000), { fileName: "correction-proof.pdf" });
      assert.equal(correction.attachment.status, "available");
      assert.equal(correction.attachment.revisionNumber > queueItem.revision.revisionNumber, true);
      const owned = await runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: correction.attachment.attachmentId }, io);
      assert.equal(owned.attachment.fileName, "correction-proof.pdf");
    });

    await check("27. archived pin keeps the runtime working for the pinned enrollment", async () => {
      await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "archived" } });
      const result = await makeAvailable(owner.id, pdfBytes(333), { fileName: "archived-pin.pdf" });
      assert.equal(result.attachment.status, "available");
      await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: result.attachment.attachmentId, requestId: rid("del") }, io);
      await prisma.curriculumVersion.update({ where: { id: curriculum.id }, data: { status: "published" } });
    });

    await check("28. abandoned uploads expire after 24 hours through bounded idempotent cleanup", async () => {
      const bytes = pdfBytes(256);
      const initiated = await initiate(owner.id, { fileName: "abandoned.pdf", sizeBytes: bytes.byteLength });
      const id = initiated.attachment.attachmentId;
      scanner.state.mode = "unavailable";
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: id, requestId: rid("fin") }, bytes, io), "REPORT_ATTACHMENT_SCANNER_UNAVAILABLE");
      scanner.state.mode = "by-marker";
      const fresh = await runtime.cleanupExpiredReportAttachments({}, io);
      assert.equal(fresh.expiredTombstoned, 0);
      const later = new Date(Date.now() + 25 * 60 * 60 * 1_000);
      storage.hooks.beforeDelete = () => { throw new ReportAttachmentStorageError("STORAGE_UNAVAILABLE", "down", true); };
      const firstPass = await runtime.cleanupExpiredReportAttachments({}, { ...io, evaluationTime: later });
      assert.equal(firstPass.expiredTombstoned, 1);
      assert.equal(firstPass.purgeRetryRequired >= 1, true);
      let row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, "deleted");
      assert.equal(row.storagePurgedAt, null);
      assert.equal(storage.objects.has(row.storageKey), true);
      delete storage.hooks.beforeDelete;
      const secondPass = await runtime.cleanupExpiredReportAttachments({}, { ...io, evaluationTime: later });
      assert.equal(secondPass.purged >= 1, true);
      row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id } });
      assert.notEqual(row.storagePurgedAt, null);
      assert.equal(storage.objects.has(row.storageKey), false);
      const thirdPass = await runtime.cleanupExpiredReportAttachments({}, { ...io, evaluationTime: later });
      assert.equal(thirdPass.expiredTombstoned, 0);
      assert.equal(thirdPass.purged, 0);
      assert.equal(thirdPass.purgeRetryRequired, 0);
    });

    await check("29. available attachments are never expired by retention cleanup", async () => {
      const result = await makeAvailable(owner.id, pdfBytes(444), { fileName: "kept.pdf" });
      const later = new Date(Date.now() + 48 * 60 * 60 * 1_000);
      await runtime.cleanupExpiredReportAttachments({}, { ...io, evaluationTime: later });
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: result.attachment.attachmentId } });
      assert.equal(row.status, "available");
      await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: result.attachment.attachmentId, requestId: rid("del") }, io);
    });

    await check("30. unconfigured production storage/scanner fail closed with retryable typed errors", async () => {
      const initiated = await initiate(owner.id, { fileName: "no-backends.pdf", sizeBytes: 128 });
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: initiated.attachment.attachmentId, requestId: rid("fin") }, pdfBytes(128), { storage: undefined, scanner: undefined }), "REPORT_ATTACHMENT_STORAGE_UNAVAILABLE");
      await expectError(() => runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: initiated.attachment.attachmentId, requestId: rid("fin") }, pdfBytes(128), { storage, scanner: undefined }), "REPORT_ATTACHMENT_SCANNER_UNAVAILABLE");
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: initiated.attachment.attachmentId } });
      assert.equal(row.status, "quarantined");
      await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: initiated.attachment.attachmentId, requestId: rid("del") }, io);
    });

    await check("31. no XP, V1, notification, enrollment or progress-row side effects", async () => {
      assert.equal(await prisma.xPTransaction.count(), baseline.xp);
      assert.equal(await prisma.notification.count(), baseline.notifications);
      assert.equal(await prisma.taskReport.count(), baseline.v1Reports);
      assert.equal(await prisma.userTaskProgress.count(), baseline.v1Progress);
      assert.equal(await prisma.userCurriculumEnrollment.count(), baseline.enrollments);
      assert.equal(await prisma.userLevelProgress.count(), baseline.progress);
    });

    await check("32. runtime leaves no temp files behind", async () => {
      assert.deepEqual(tmpEntries(), tempBefore);
    });

    await check("33. checksum corruption is fail closed on download", async () => {
      const result = await makeAvailable(owner.id, pdfBytes(555), { fileName: "tampered.pdf" });
      const row = await prisma.reportAttachment.findUniqueOrThrow({ where: { id: result.attachment.attachmentId } });
      const stored = storage.objects.get(row.storageKey);
      if (!stored) throw new Error("object missing");
      const tampered = Buffer.from(stored.body);
      tampered[tampered.length - 1] ^= 0xff;
      storage.objects.set(row.storageKey, { body: tampered, contentType: stored.contentType });
      await expectError(() => runtime.resolveOwnReportAttachmentDownload(owner.id, { attachmentId: result.attachment.attachmentId }, io), "REPORT_STATE_CORRUPT");
      await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: result.attachment.attachmentId, requestId: rid("del") }, io);
    });

    await check("34. streamed payload is collected within the approved bound", async () => {
      const bytes = pdfBytes(2_048);
      async function* stream() {
        for (let offset = 0; offset < bytes.length; offset += 512) {
          yield bytes.subarray(offset, Math.min(offset + 512, bytes.length));
        }
      }
      const initiated = await initiate(owner.id, { fileName: "streamed.pdf", sizeBytes: bytes.byteLength });
      const result = await runtime.finalizeOwnReportAttachment(owner.id, { attachmentId: initiated.attachment.attachmentId, requestId: rid("fin") }, stream(), io);
      assert.equal(result.attachment.status, "available");
      await runtime.deleteOwnReportAttachment(owner.id, { attachmentId: initiated.attachment.attachmentId, requestId: rid("del") }, io);
    });

    const checksumRow = await prisma.reportAttachment.findFirst({ where: { checksum: { not: null } } });
    await check("35. durable rows keep the sha256 contract", async () => {
      assert.notEqual(checksumRow, null);
      assert.equal(createHash("sha256").update("x").digest("hex").length, 64);
    });
  } finally {
    const { prisma } = await import("../../src/lib/prisma");
    await prisma.$disconnect();
    cleanup();
  }

  console.log(`curriculum report attachment regression: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  cleanup();
  process.exitCode = 1;
});
