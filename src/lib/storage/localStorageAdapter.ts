import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  FileStorageAdapter,
  SavedFile,
  SaveFileInput,
} from "@/lib/storage/types";

const extensionByMimeType: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

export function getLocalUploadsDir() {
  // MVP/dev storage only. In production replace local disk with S3, R2,
  // DigitalOcean Spaces, or another object storage provider.
  return path.resolve(
    process.cwd(),
    process.env.LOCAL_UPLOADS_DIR ?? path.join("storage", "uploads"),
  );
}

function sanitizeOriginalName(name: string) {
  const baseName = path.basename(name).replace(/[^\w.\-а-яА-ЯёЁ ]/g, "_");

  return baseName.slice(0, 180) || "file";
}

function resolveInsideUploads(storagePathOrName: string) {
  const uploadsDir = getLocalUploadsDir();
  const absolutePath = path.isAbsolute(storagePathOrName)
    ? storagePathOrName
    : path.resolve(process.cwd(), storagePathOrName);
  const resolvedUploadsDir = path.resolve(uploadsDir);
  const resolvedPath = path.resolve(absolutePath);

  if (
    resolvedPath !== resolvedUploadsDir &&
    !resolvedPath.startsWith(`${resolvedUploadsDir}${path.sep}`)
  ) {
    throw new Error("Invalid storage path");
  }

  return resolvedPath;
}

export const localStorageAdapter: FileStorageAdapter = {
  driver: "local",

  async save(input: SaveFileInput): Promise<SavedFile> {
    const uploadsDir = getLocalUploadsDir();
    await fs.mkdir(uploadsDir, { recursive: true });

    const extension =
      extensionByMimeType[input.mimeType] ||
      path.extname(sanitizeOriginalName(input.originalName)).slice(0, 12);
    const storedName = `${crypto.randomUUID()}${extension}`;
    const storagePath = path.join(
      process.env.LOCAL_UPLOADS_DIR ?? path.join("storage", "uploads"),
      storedName,
    );
    const absolutePath = resolveInsideUploads(path.join(uploadsDir, storedName));

    await fs.writeFile(absolutePath, input.buffer, { flag: "wx" });

    return {
      storedName,
      storagePath,
      sizeBytes: input.buffer.byteLength,
      driver: "local",
    };
  },

  async read(storagePath: string) {
    return fs.readFile(resolveInsideUploads(storagePath));
  },

  async delete(storagePath: string) {
    await fs.rm(resolveInsideUploads(storagePath), { force: true });
  },

  async exists(storagePath: string) {
    try {
      await fs.access(resolveInsideUploads(storagePath));
      return true;
    } catch {
      return false;
    }
  },
};
