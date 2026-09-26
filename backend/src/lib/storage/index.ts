import { localStorageAdapter } from "@/lib/storage/localStorageAdapter";
import type { FileStorageAdapter, StorageDriver } from "@/lib/storage/types";

function parseStorageDriver(value?: string): StorageDriver {
  if (value === "s3" || value === "r2" || value === "local") {
    return value;
  }

  return "local";
}

export function getStorageAdapter(driver = parseStorageDriver(process.env.STORAGE_DRIVER)): FileStorageAdapter {
  if (driver === "local") {
    return localStorageAdapter;
  }

  throw new Error(
    `Storage driver ${driver} is configured but adapter is not implemented yet`,
  );
}

export type {
  FileStorageAdapter,
  SavedFile,
  SaveFileInput,
  StorageDriver,
} from "@/lib/storage/types";
