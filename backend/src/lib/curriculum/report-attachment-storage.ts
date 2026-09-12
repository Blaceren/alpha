import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { isReportAttachmentTestBackendEnabled } from "@/lib/env";

// Private S3-compatible object storage boundary for V2 report attachments.
// Every object lives in a fully private bucket and is reachable only through
// the authenticated backend; there are no public URLs, no presigned upload or
// download capabilities and no caller-supplied keys anywhere in this module.

export type ReportAttachmentStorageErrorCode =
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_KEY_EXISTS"
  | "STORAGE_OBJECT_MISSING";

export class ReportAttachmentStorageError extends Error {
  readonly code: ReportAttachmentStorageErrorCode;
  readonly retryable: boolean;

  constructor(code: ReportAttachmentStorageErrorCode, message: string, retryable = false) {
    // Messages stay generic: endpoint, bucket, region, credentials and raw
    // provider errors must never leak through this boundary.
    super(message);
    this.name = "ReportAttachmentStorageError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function isReportAttachmentStorageError(
  error: unknown,
  code?: ReportAttachmentStorageErrorCode,
): error is ReportAttachmentStorageError {
  if (!(error instanceof ReportAttachmentStorageError)) return false;
  return code === undefined || error.code === code;
}

export type ReportAttachmentStorageProvider = {
  readonly id: string;
  /**
   * Conditional create: writes the object only when the key does not exist.
   * A repeated upload into an existing key throws STORAGE_KEY_EXISTS so an
   * accepted object can never be replaced with a new payload.
   */
  putObjectIfAbsent(input: { key: string; body: Uint8Array; contentType: string }): Promise<void>;
  getObject(input: { key: string }): Promise<Uint8Array>;
  headObject(input: { key: string }): Promise<{ exists: boolean; sizeBytes: number | null }>;
  /** Idempotent: deleting a missing key succeeds. */
  deleteObject(input: { key: string }): Promise<void>;
};

type S3ProviderConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  serverSideEncryption?: string;
};

function s3StatusCode(error: unknown): number | null {
  if (error && typeof error === "object") {
    const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    if (metadata && typeof metadata.httpStatusCode === "number") return metadata.httpStatusCode;
  }
  return null;
}

function s3ErrorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
}

// AWS SDK v3 owns request signing; no local Signature V4 implementation exists.
export function createS3ReportAttachmentStorageProvider(config: S3ProviderConfig): ReportAttachmentStorageProvider {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle,
  });
  const encryption = config.serverSideEncryption && config.serverSideEncryption !== "off"
    ? config.serverSideEncryption
    : undefined;

  function unavailable(): never {
    throw new ReportAttachmentStorageError("STORAGE_UNAVAILABLE", "report attachment storage is unavailable", true);
  }

  return {
    id: "s3",
    async putObjectIfAbsent({ key, body, contentType }) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
          IfNoneMatch: "*",
          ...(encryption ? { ServerSideEncryption: encryption as never } : {}),
        }));
      } catch (error) {
        if (s3StatusCode(error) === 412 || s3ErrorName(error) === "PreconditionFailed") {
          throw new ReportAttachmentStorageError("STORAGE_KEY_EXISTS", "report attachment object already exists");
        }
        unavailable();
      }
    },
    async getObject({ key }) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (!result.Body) unavailable();
        return await result.Body.transformToByteArray();
      } catch (error) {
        if (error instanceof ReportAttachmentStorageError) throw error;
        if (s3StatusCode(error) === 404 || s3ErrorName(error) === "NoSuchKey" || s3ErrorName(error) === "NotFound") {
          throw new ReportAttachmentStorageError("STORAGE_OBJECT_MISSING", "report attachment object is missing");
        }
        unavailable();
      }
    },
    async headObject({ key }) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return { exists: true, sizeBytes: typeof result.ContentLength === "number" ? result.ContentLength : null };
      } catch (error) {
        if (s3StatusCode(error) === 404 || s3ErrorName(error) === "NotFound" || s3ErrorName(error) === "NoSuchKey") {
          return { exists: false, sizeBytes: null };
        }
        unavailable();
      }
    },
    async deleteObject({ key }) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        if (s3StatusCode(error) === 404) return;
        unavailable();
      }
    },
  };
}

export type InMemoryStorageHooks = {
  beforePut?: (key: string) => void;
  beforeGet?: (key: string) => void;
  beforeDelete?: (key: string) => void;
};

export type InMemoryReportAttachmentStorage = ReportAttachmentStorageProvider & {
  readonly objects: Map<string, { body: Uint8Array; contentType: string }>;
  readonly hooks: InMemoryStorageHooks;
};

// Deterministic injected fake for regression tests. Real object storage is
// never contacted from tests; conditional-write semantics are enforced here
// exactly like the production adapter.
export function createInMemoryReportAttachmentStorageProvider(): InMemoryReportAttachmentStorage {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const hooks: InMemoryStorageHooks = {};
  return {
    id: "in-memory",
    objects,
    hooks,
    async putObjectIfAbsent({ key, body, contentType }) {
      hooks.beforePut?.(key);
      if (objects.has(key)) {
        throw new ReportAttachmentStorageError("STORAGE_KEY_EXISTS", "report attachment object already exists");
      }
      objects.set(key, { body: new Uint8Array(body), contentType });
    },
    async getObject({ key }) {
      hooks.beforeGet?.(key);
      const stored = objects.get(key);
      if (!stored) throw new ReportAttachmentStorageError("STORAGE_OBJECT_MISSING", "report attachment object is missing");
      return new Uint8Array(stored.body);
    },
    async headObject({ key }) {
      const stored = objects.get(key);
      return stored ? { exists: true, sizeBytes: stored.body.byteLength } : { exists: false, sizeBytes: null };
    },
    async deleteObject({ key }) {
      hooks.beforeDelete?.(key);
      objects.delete(key);
    },
  };
}

let cachedProvider: { signature: string; provider: ReportAttachmentStorageProvider } | null = null;
let regressionProvider: InMemoryReportAttachmentStorage | null = null;

// Production provider resolution. Configuration comes only from server-side
// env; absent configuration fails closed as a retryable unavailable storage.
export function getReportAttachmentStorageProvider(env: NodeJS.ProcessEnv = process.env): ReportAttachmentStorageProvider {
  if (isReportAttachmentTestBackendEnabled(env)) {
    // Guarded regression-only backend: never reachable in production (see
    // isReportAttachmentTestBackendEnabled) and never contacts real object
    // storage.
    if (!regressionProvider) regressionProvider = createInMemoryReportAttachmentStorageProvider();
    return regressionProvider;
  }
  const bucket = env.REPORT_ATTACHMENT_S3_BUCKET?.trim();
  if (!bucket) {
    throw new ReportAttachmentStorageError("STORAGE_UNAVAILABLE", "report attachment storage is not configured", true);
  }
  const config: S3ProviderConfig = {
    bucket,
    region: env.REPORT_ATTACHMENT_S3_REGION?.trim() || "us-east-1",
    ...(env.REPORT_ATTACHMENT_S3_ENDPOINT?.trim() ? { endpoint: env.REPORT_ATTACHMENT_S3_ENDPOINT.trim() } : {}),
    forcePathStyle: env.REPORT_ATTACHMENT_S3_FORCE_PATH_STYLE === "true",
    ...(env.REPORT_ATTACHMENT_S3_SSE?.trim() ? { serverSideEncryption: env.REPORT_ATTACHMENT_S3_SSE.trim() } : {}),
  };
  const signature = JSON.stringify(config);
  if (!cachedProvider || cachedProvider.signature !== signature) {
    cachedProvider = { signature, provider: createS3ReportAttachmentStorageProvider(config) };
  }
  return cachedProvider.provider;
}
