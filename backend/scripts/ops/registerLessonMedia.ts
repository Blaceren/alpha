/**
 * LESSON MEDIA (2026-10-02) — put a lesson's video (or its poster, or its
 * captions) on the platform.
 *
 *   tsx scripts/ops/registerLessonMedia.ts \
 *     --level 4 \
 *     --file /abs/path/to/lesson-04.mp4 \
 *     --media-root /srv/ata-data/media \
 *     [--kind video|image|subtitles] [--asset-code video] [--locale ru] \
 *     [--duration-seconds 612] [--curriculum-code ata-v2] [--dry-run]
 *
 * WHAT IT DOES, IN ORDER
 *   1. finds the level in the PUBLISHED version of the curriculum (by number or
 *      by stable code) and takes its stable code — the registry is keyed by it,
 *      so a successor version that keeps the code keeps the video;
 *   2. reads the file: its size, its SHA-256, and for an MP4 its length (from
 *      the file's own `mvhd` box — no external tool is needed or used);
 *   3. copies it under the media root as
 *        lessons/<stableCode>/<first 16 hex of its sha256>.<ext>
 *      so the address cannot be guessed from a level number, and a re-encoded
 *      file gets a NEW address instead of fighting a cache for the old one;
 *   4. writes (or replaces) the lesson's one row for that asset code.
 *
 * WHAT IT NEVER DOES
 *   * It deletes nothing. A replaced video's previous file stays where it was;
 *     the script prints its path so a person can decide what to do with it.
 *   * It publishes nothing and touches no curriculum row: a content version is
 *     immutable, which is exactly why the video is not part of one.
 *   * It takes no URL and stores none. Where the bytes are served from is the
 *     deployment's business (`lesson-media.ts`).
 *
 * `--dry-run` does steps 1 and 2 and prints what steps 3 and 4 would do.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, type ContentAssetKind } from "@prisma/client";
import { DEFAULT_CURRICULUM_CODE, STABLE_CODE_PATTERN } from "../../src/lib/curriculum/constants";
import { LESSON_MEDIA_KINDS, lessonMediaUrl } from "../../src/lib/curriculum/lesson-media";

type MediaKind = (typeof LESSON_MEDIA_KINDS)[number];

const MIME_BY_EXTENSION: Record<string, { mimeType: string; kinds: readonly MediaKind[] }> = {
  ".mp4": { mimeType: "video/mp4", kinds: ["video"] },
  ".m4v": { mimeType: "video/mp4", kinds: ["video"] },
  ".webm": { mimeType: "video/webm", kinds: ["video"] },
  ".jpg": { mimeType: "image/jpeg", kinds: ["image"] },
  ".jpeg": { mimeType: "image/jpeg", kinds: ["image"] },
  ".png": { mimeType: "image/png", kinds: ["image"] },
  ".webp": { mimeType: "image/webp", kinds: ["image"] },
  ".vtt": { mimeType: "text/vtt", kinds: ["subtitles"] },
};

const DEFAULT_ASSET_CODE: Record<MediaKind, string> = {
  video: "video",
  image: "poster",
  subtitles: "captions",
};

class UsageError extends Error {}

function flag(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return value;
}

/* ------------------------------------------------------------------ *
 * The length of an MP4, read from the file itself
 * ------------------------------------------------------------------ */

/**
 * `moov/mvhd` holds a timescale and a duration; their quotient is the length.
 *
 * Only box HEADERS are read on the way there — eight or sixteen bytes each — so
 * a file whose `moov` sits after two gigabytes of `mdat` costs a few seeks, not
 * a read of the video. Returns null for a file that is not laid out this way;
 * the caller then asks for `--duration-seconds` rather than guessing.
 */
export function readMp4DurationSeconds(file: string): number | null {
  const descriptor = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(descriptor).size;
    const header = Buffer.alloc(16);
    const boxAt = (offset: number) => {
      if (offset + 8 > size) return null;
      fs.readSync(descriptor, header, 0, 16, offset);
      let boxSize = header.readUInt32BE(0);
      const type = header.toString("latin1", 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        const large = header.readBigUInt64BE(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        boxSize = Number(large);
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (boxSize < headerSize || offset + boxSize > size) return null;
      return { type, start: offset + headerSize, end: offset + boxSize };
    };
    const find = (from: number, to: number, type: string) => {
      let offset = from;
      // A bounded walk: a file with more top-level boxes than this is not one
      // this function should be trusted to read.
      for (let guard = 0; guard < 10_000 && offset < to; guard += 1) {
        const box = boxAt(offset);
        if (!box) return null;
        if (box.type === type) return box;
        offset = box.end;
      }
      return null;
    };
    const moov = find(0, size, "moov");
    if (!moov) return null;
    const mvhd = find(moov.start, moov.end, "mvhd");
    if (!mvhd || mvhd.end - mvhd.start < 20) return null;
    const body = Buffer.alloc(Math.min(32, mvhd.end - mvhd.start));
    fs.readSync(descriptor, body, 0, body.length, mvhd.start);
    const version = body.readUInt8(0);
    let timescale: number;
    let duration: number;
    if (version === 1) {
      if (body.length < 32) return null;
      timescale = body.readUInt32BE(20);
      const wide = body.readBigUInt64BE(24);
      if (wide > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      duration = Number(wide);
    } else if (version === 0) {
      timescale = body.readUInt32BE(12);
      duration = body.readUInt32BE(16);
    } else {
      return null;
    }
    if (timescale <= 0 || duration <= 0) return null;
    const seconds = Math.round(duration / timescale);
    return seconds >= 1 && seconds <= 86_400 ? seconds : null;
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const levelArg = flag(argv, "--level");
  const fileArg = flag(argv, "--file");
  const mediaRootArg = flag(argv, "--media-root");
  const curriculumCode = flag(argv, "--curriculum-code") ?? DEFAULT_CURRICULUM_CODE;
  const locale = flag(argv, "--locale");
  if (!levelArg || !fileArg || !mediaRootArg) {
    throw new UsageError("--level, --file and --media-root are required");
  }
  if (locale !== null && !/^[a-z]{2}(-[a-z0-9]{2,8})?$/.test(locale)) {
    throw new UsageError("--locale must look like ru or pl");
  }

  const file = path.resolve(fileArg);
  const mediaRoot = path.resolve(mediaRootArg);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size <= 0) throw new UsageError(`${file} is not a non-empty file`);
  if (!fs.statSync(mediaRoot).isDirectory()) throw new UsageError(`${mediaRoot} is not a directory`);

  const extension = path.extname(file).toLowerCase();
  const known = MIME_BY_EXTENSION[extension];
  if (!known) {
    throw new UsageError(`unsupported file type ${extension || "(none)"}: ${Object.keys(MIME_BY_EXTENSION).join(" ")}`);
  }
  const kind = (flag(argv, "--kind") ?? known.kinds[0]) as MediaKind;
  if (!(LESSON_MEDIA_KINDS as readonly string[]).includes(kind) || !known.kinds.includes(kind)) {
    throw new UsageError(`a ${extension} file cannot be registered as ${kind}`);
  }
  const assetCode = flag(argv, "--asset-code") ?? DEFAULT_ASSET_CODE[kind];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetCode) || assetCode.length > 64) {
    throw new UsageError("--asset-code must be lowercase kebab, at most 64 characters");
  }

  let durationSeconds: number | null = null;
  if (kind === "video") {
    const declared = flag(argv, "--duration-seconds");
    if (declared !== null) {
      if (!/^[1-9]\d{0,4}$/.test(declared) || Number(declared) > 86_400) {
        throw new UsageError("--duration-seconds must be a whole number of seconds, 1…86400");
      }
      durationSeconds = Number(declared);
    } else if (known.mimeType === "video/mp4") {
      durationSeconds = readMp4DurationSeconds(file);
    }
    if (durationSeconds === null) {
      throw new UsageError("the video's length could not be read from the file; pass --duration-seconds");
    }
  }

  const prisma = new PrismaClient();
  try {
    const published = await prisma.curriculumVersion.findFirst({
      where: { code: curriculumCode, status: "published" },
      select: { id: true, versionNumber: true },
    });
    if (!published) throw new UsageError(`curriculum ${curriculumCode} has no published version`);
    const level = await prisma.levelDefinition.findFirst({
      where: {
        curriculumVersionId: published.id,
        ...(STABLE_CODE_PATTERN.test(levelArg)
          ? { stableCode: levelArg }
          : /^[1-9]\d{0,2}$/.test(levelArg)
            ? { levelNumber: Number(levelArg) }
            : { id: -1 }),
      },
      select: { levelNumber: true, stableCode: true, title: true, type: true },
    });
    if (!level) {
      throw new UsageError(`level ${levelArg} is not in ${curriculumCode} version ${published.versionNumber}`);
    }

    const checksum = await sha256Of(file);
    const storageKey = `lessons/${level.stableCode}/${checksum.slice(0, 16)}${extension}`;
    const destination = path.join(mediaRoot, storageKey);
    const existing = await prisma.lessonMediaAsset.findUnique({
      where: {
        curriculumCode_levelStableCode_assetCode: {
          curriculumCode,
          levelStableCode: level.stableCode,
          assetCode,
        },
      },
    });

    const plan = {
      mode: dryRun ? "dry-run" : "apply",
      curriculum: `${curriculumCode}@${published.versionNumber}`,
      level: { number: level.levelNumber, stableCode: level.stableCode, title: level.title },
      asset: { kind, assetCode, locale, mimeType: known.mimeType, sizeBytes: stat.size, durationSeconds, checksum },
      storageKey,
      address: lessonMediaUrl(storageKey),
      destination,
      replaces: existing
        ? { storageKey: existing.storageKey, keptOnDisk: path.join(mediaRoot, existing.storageKey) }
        : null,
    };

    if (dryRun) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) {
      // Same name means same first 16 hex of the hash; make sure it is the same file.
      if ((await sha256Of(destination)) !== checksum) {
        throw new Error(`${destination} exists with different content; nothing was changed`);
      }
    } else {
      // COPYFILE_EXCL: never overwrite. Written under a temporary name and
      // renamed, so a reader never opens half a video.
      const partial = `${destination}.partial-${process.pid}`;
      fs.copyFileSync(file, partial, fs.constants.COPYFILE_EXCL);
      fs.renameSync(partial, destination);
      fs.chmodSync(destination, 0o640);
    }

    const data = {
      kind: kind as ContentAssetKind,
      locale,
      storageKey,
      mimeType: known.mimeType,
      sizeBytes: stat.size,
      durationSeconds,
      checksum,
    };
    await prisma.lessonMediaAsset.upsert({
      where: {
        curriculumCode_levelStableCode_assetCode: {
          curriculumCode,
          levelStableCode: level.stableCode,
          assetCode,
        },
      },
      create: { curriculumCode, levelStableCode: level.stableCode, assetCode, ...data },
      update: data,
    });
    console.log(JSON.stringify({ ...plan, registered: true }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].endsWith("registerLessonMedia.ts")) {
  main().catch((error) => {
    console.error(error instanceof UsageError ? `usage: ${error.message}` : error);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  });
}
