import path from "node:path";
import type { FileAsset, FilePurpose, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStorageAdapter } from "@/lib/storage";

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export const allowedUploadMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
] as const;

export const filePurposes: FilePurpose[] = [
  "task_report",
  "support_attachment",
  "other",
];

export function isAllowedMimeType(mimeType: string) {
  return allowedUploadMimeTypes.includes(
    mimeType as (typeof allowedUploadMimeTypes)[number],
  );
}

export function isFilePurpose(value: string): value is FilePurpose {
  return filePurposes.includes(value as FilePurpose);
}

export function sanitizeOriginalName(name: string) {
  const baseName = path.basename(name).replace(/[^\w.\-а-яА-ЯёЁ ]/g, "_");

  return baseName.slice(0, 180) || "file";
}

export async function createStoredFile(input: {
  ownerUserId: number;
  originalName: string;
  mimeType: string;
  purpose: FilePurpose;
  bytes: Uint8Array;
}) {
  const adapter = getStorageAdapter();
  const savedFile = await adapter.save({
    buffer: input.bytes,
    originalName: input.originalName,
    mimeType: input.mimeType,
    purpose: input.purpose,
  });

  return prisma.fileAsset.create({
    data: {
      ownerUserId: input.ownerUserId,
      originalName: sanitizeOriginalName(input.originalName),
      storedName: savedFile.storedName,
      mimeType: input.mimeType,
      sizeBytes: savedFile.sizeBytes,
      storagePath: savedFile.storagePath,
      storageDriver: savedFile.driver,
      purpose: input.purpose,
    },
  });
}

export async function canDownloadFile(input: {
  file: FileAsset;
  user: { id: number; role: UserRole };
}) {
  const { file, user } = input;

  if (file.ownerUserId === user.id) {
    return true;
  }

  if (user.role === "admin") {
    return true;
  }

  if (file.purpose === "task_report" && user.role === "mentor") {
    const report = await prisma.taskReport.findFirst({
      where: { fileAssetId: file.id },
      select: { id: true },
    });

    return Boolean(report);
  }

  if (
    file.purpose === "support_attachment" &&
    (user.role === "support" || user.role === "mentor")
  ) {
    const message = await prisma.supportMessage.findFirst({
      where: { fileAssetId: file.id },
      select: { id: true },
    });

    return Boolean(message);
  }

  return false;
}
