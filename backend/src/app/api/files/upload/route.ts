import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  rateLimitedResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { csrfFailureResponse, validateCsrfToken } from "@/lib/csrf";
import {
  createStoredFile,
  isAllowedMimeType,
  isFilePurpose,
  MAX_UPLOAD_SIZE_BYTES,
} from "@/lib/fileStorage";
import { rateLimit } from "@/lib/rateLimit";
import { validationErrorResponse } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!validateCsrfToken(request)) {
    return csrfFailureResponse(request);
  }

  try {
    const user = await requireUser();
    const limit = rateLimit(`file:upload:${user.id}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });

    if (!limit.allowed) {
      await createAuditLog({
        userId: user.id,
        action: "RATE_LIMITED",
        entityType: "API_ROUTE",
        entityId: "/api/files/upload",
        metadata: { resetAt: limit.resetAt },
        request,
      });
      return rateLimitedResponse();
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const purpose = formData.get("purpose");

    if (!(file instanceof File)) {
      return validationErrorResponse([
        { field: "file", message: "Нужно прикрепить файл" },
      ]);
    }

    if (typeof purpose !== "string" || !isFilePurpose(purpose)) {
      return validationErrorResponse([
        { field: "purpose", message: "Некорректное назначение файла" },
      ]);
    }

    if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE_BYTES) {
      return validationErrorResponse([
        { field: "file", message: "Размер файла должен быть от 1 байта до 10 MB" },
      ]);
    }

    if (!isAllowedMimeType(file.type)) {
      return validationErrorResponse([
        { field: "file", message: "Тип файла не разрешён" },
      ]);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const fileAsset = await createStoredFile({
      ownerUserId: user.id,
      originalName: file.name,
      mimeType: file.type,
      purpose,
      bytes,
    });

    await createAuditLog({
      userId: user.id,
      action: "FILE_UPLOADED",
      entityType: "FileAsset",
      entityId: fileAsset.id,
      metadata: {
        originalName: fileAsset.originalName,
        mimeType: fileAsset.mimeType,
        sizeBytes: fileAsset.sizeBytes,
        purpose: fileAsset.purpose,
        storageDriver: fileAsset.storageDriver,
      },
      request,
    });

    return NextResponse.json(
      {
        file: {
          id: fileAsset.id,
          originalName: fileAsset.originalName,
          mimeType: fileAsset.mimeType,
          sizeBytes: fileAsset.sizeBytes,
          purpose: fileAsset.purpose,
          storageDriver: fileAsset.storageDriver,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("adapter is not implemented yet")
    ) {
      return NextResponse.json(
        {
          error: "STORAGE_DRIVER_NOT_IMPLEMENTED",
          message: error.message,
        },
        { status: 500 },
      );
    }

    return apiAuthErrorResponse(error, request);
  }
}
