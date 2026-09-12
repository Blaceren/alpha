import type { FilePurpose } from "@prisma/client";

export type StorageDriver = "local" | "s3" | "r2";

export type SaveFileInput = {
  buffer: Uint8Array;
  originalName: string;
  mimeType: string;
  purpose: FilePurpose;
};

export type SavedFile = {
  storedName: string;
  storagePath: string;
  sizeBytes: number;
  driver: StorageDriver;
};

export interface FileStorageAdapter {
  driver: StorageDriver;
  save(input: SaveFileInput): Promise<SavedFile>;
  read(storagePath: string): Promise<Uint8Array>;
  delete(storagePath: string): Promise<void>;
  exists(storagePath: string): Promise<boolean>;
}
