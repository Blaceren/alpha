import { NextResponse } from "next/server";
import {
  apiAuthErrorResponse,
  forbiddenResponse,
  requireUser,
} from "@/lib/apiAuth";
import { createAuditLog } from "@/lib/audit";
import { canDownloadFile } from "@/lib/fileStorage";
import { prisma } from "@/lib/prisma";
import { getStorageAdapter, type StorageDriver } from "@/lib/storage";
import { notFoundResponse, validateNumericParam } from "@/lib/validation";

export const runtime = "nodejs";

type FileDownloadRouteProps = {
  params: Promise<{
    id: string;
  }>;
};

function isStorageDriver(value: string): value is StorageDriver {
  return value === "local" || value === "s3" || value === "r2";
}

export async function GET(request: Request, { params }: FileDownloadRouteProps) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const fileId = validateNumericParam(id, "id");

    if (!fileId.success) {
      return fileId.response;
    }

    const file = await prisma.fileAsset.findUnique({
      where: { id: fileId.id },
    });

    if (!file) {
      return notFoundResponse("Файл не найден");
    }

    if (!(await canDownloadFile({ file, user }))) {
      return forbiddenResponse();
    }

    if (!isStorageDriver(file.storageDriver)) {
      return NextResponse.json(
        {
          error: "STORAGE_DRIVER_NOT_IMPLEMENTED",
          message: `Storage driver ${file.storageDriver} is not supported`,
        },
        { status: 500 },
      );
    }

    let bytes: Uint8Array;
    try {
      const adapter = getStorageAdapter(file.storageDriver);
      bytes = await adapter.read(file.storagePath);
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

      return notFoundResponse("Файл не найден в хранилище");
    }

    await createAuditLog({
      userId: user.id,
      action: "FILE_DOWNLOADED",
      entityType: "FileAsset",
      entityId: file.id,
      metadata: {
        ownerUserId: file.ownerUserId,
        purpose: file.purpose,
        mimeType: file.mimeType,
        storageDriver: file.storageDriver,
      },
      request,
    });

    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);

    return new NextResponse(new Blob([arrayBuffer], { type: file.mimeType }), {
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.sizeBytes),
        "content-disposition": `attachment; filename="${encodeURIComponent(file.originalName)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiAuthErrorResponse(error, request);
  }
}
