/**
 * MEDIA → S3 (2026-10-07, owner: «подготовь продукт к работе с amazon cdn видео
 * уроков и на главной лежат на нем»).
 *
 * Copies the media directory — the lessons' files and the public film — to the
 * bucket CloudFront serves, under the SAME keys the rows and the pages already
 * use, so nothing in a lesson row or on the home page changes when delivery
 * moves to the CDN (academy `server/media/delivery.ts`):
 *
 *   <media root>/lessons/<level>/<hash>.<ext>   →   s3://<bucket>/lessons/<level>/<hash>.<ext>
 *   <media root>/public/film/hero.<ext>         →   s3://<bucket>/public/film/hero.<ext>
 *
 *   tsx scripts/ops/syncMediaToS3.ts --media-root /srv/ata-data/media --bucket ata-preprod-media \
 *       [--region eu-central-1] [--prefix lessons|public] [--apply]
 *
 * A DRY RUN UNTIL `--apply`: it lists what it would upload and what is already
 * there. An object that is already in the bucket with the same size and the
 * same checksum (the SHA-256 the file is named by, kept as the object's
 * `sha256` metadata) is left alone; a lesson file is never overwritten — its
 * name IS its content, so a different file has a different name. The film's
 * fixed names are the one exception: a new cut replaces the old one.
 *
 * Credentials come from the AWS SDK's default chain (an instance role, or
 * AWS_PROFILE / AWS_ACCESS_KEY_ID in the environment the script is run under)
 * and are never read, printed or stored here. Nothing is deleted, ever.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".vtt": "text/vtt; charset=utf-8",
};

/** The two areas the CDN serves, and whether a key may be replaced. */
const AREAS = [
  { prefix: "lessons", replace: false },
  { prefix: "public", replace: true },
] as const;

export type Plan = {
  readonly key: string;
  readonly file: string;
  readonly size: number;
  readonly contentType: string;
  readonly sha256: string;
  readonly action: "upload" | "replace" | "skip-same" | "skip-exists";
};

export type ObjectHead = { readonly size: number; readonly sha256: string | null } | null;

export type S3Like = {
  head(key: string): Promise<ObjectHead>;
  put(input: { key: string; file: string; size: number; contentType: string; sha256: string; cacheControl: string }): Promise<void>;
};

class UsageError extends Error {}

function parseArgs(argv: readonly string[]) {
  const flags = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (token === "--apply") {
      apply = true;
      continue;
    }
    if (!token.startsWith("--")) throw new UsageError(`unexpected argument ${token}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${token} needs a value`);
    flags.set(token.slice(2), value);
    i += 1;
  }
  const mediaRoot = flags.get("media-root");
  const bucket = flags.get("bucket");
  if (!mediaRoot || !path.isAbsolute(mediaRoot)) throw new UsageError("--media-root must be an absolute path");
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new UsageError("--bucket must be a bucket name");
  const prefix = flags.get("prefix");
  if (prefix !== undefined && !AREAS.some((area) => area.prefix === prefix)) throw new UsageError("--prefix is lessons or public");
  return { mediaRoot: path.resolve(mediaRoot), bucket, region: flags.get("region") ?? "eu-central-1", prefix, apply };
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
}

/** Every media file under the root's areas, as `prefix/…` keys, in a stable order. */
export function listMediaFiles(mediaRoot: string, onlyPrefix?: string): Array<{ key: string; file: string; size: number; contentType: string; replace: boolean }> {
  const out: Array<{ key: string; file: string; size: number; contentType: string; replace: boolean }> = [];
  for (const area of AREAS) {
    if (onlyPrefix && area.prefix !== onlyPrefix) continue;
    const dir = path.join(mediaRoot, area.prefix);
    if (!fs.existsSync(dir)) continue;
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const contentType = CONTENT_TYPES[path.extname(entry.name).toLowerCase()];
        if (!contentType) continue;
        const key = path.relative(mediaRoot, full).split(path.sep).join("/");
        out.push({ key, file: full, size: fs.statSync(full).size, contentType, replace: area.replace });
      }
    };
    walk(dir);
  }
  return out;
}

/** What to do with each file, against what the bucket already holds. */
export async function planSync(mediaRoot: string, s3: S3Like, onlyPrefix?: string): Promise<Plan[]> {
  const plans: Plan[] = [];
  for (const entry of listMediaFiles(mediaRoot, onlyPrefix)) {
    const sha256 = await sha256Of(entry.file);
    const existing = await s3.head(entry.key);
    let action: Plan["action"];
    if (!existing) action = "upload";
    else if (existing.size === entry.size && existing.sha256 === sha256) action = "skip-same";
    else action = entry.replace ? "replace" : "skip-exists";
    plans.push({ key: entry.key, file: entry.file, size: entry.size, contentType: entry.contentType, sha256, action });
  }
  return plans;
}

/** The cache life CloudFront and browsers may give an object: a lesson file's name is its content; the film is replaced in place. */
export function cacheControlFor(key: string): string {
  return key.startsWith("lessons/") ? "public, max-age=31536000, immutable" : "public, max-age=300";
}

export async function applySync(plans: readonly Plan[], s3: S3Like, log: (line: string) => void): Promise<void> {
  for (const plan of plans) {
    if (plan.action !== "upload" && plan.action !== "replace") continue;
    await s3.put({ key: plan.key, file: plan.file, size: plan.size, contentType: plan.contentType, sha256: plan.sha256, cacheControl: cacheControlFor(plan.key) });
    log(`${plan.action === "replace" ? "replaced" : "uploaded"} ${plan.key} (${plan.size} bytes)`);
  }
}

export function s3Of(client: S3Client, bucket: string): S3Like {
  return {
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: out.ContentLength ?? -1, sha256: out.Metadata?.sha256 ?? null };
      } catch (error) {
        const name = (error as { name?: string }).name;
        if (name === "NotFound" || name === "NoSuchKey" || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async put(input) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: fs.createReadStream(input.file),
          ContentLength: input.size,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
          Metadata: { sha256: input.sha256 },
        }),
      );
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = new S3Client({ region: args.region });
  const s3 = s3Of(client, args.bucket);
  const plans = await planSync(args.mediaRoot, s3, args.prefix);
  const counts = { upload: 0, replace: 0, "skip-same": 0, "skip-exists": 0 };
  for (const plan of plans) {
    counts[plan.action] += 1;
    console.log(`${plan.action.padEnd(11)} ${plan.key}  ${plan.size} bytes`);
  }
  console.log(`\n${plans.length} files: ${counts.upload} to upload, ${counts.replace} to replace, ${counts["skip-same"]} already there, ${counts["skip-exists"]} kept as they are in the bucket`);
  if (!args.apply) {
    console.log("dry run: nothing was uploaded. Add --apply to upload.");
    return;
  }
  await applySync(plans, s3, (line) => console.log(line));
  console.log("done.");
}

if (process.argv[1] && process.argv[1].endsWith("syncMediaToS3.ts")) {
  main().catch((error) => {
    if (error instanceof UsageError) {
      console.error(`usage: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exitCode = 1;
  });
}
