/**
 * LESSON MEDIA (2026-10-02) — the files behind `/media/…` (SERVER-ONLY).
 *
 * The Backend's lesson media registry addresses a lesson's video, poster and
 * captions as `/media/lessons/<level stable code>/<sha256 prefix>.<ext>` — a
 * path on the Academy's own origin, never a host. This module is the part of
 * serving that path which needs no session and no network: what a request may
 * name, which file that is, and which bytes of it were asked for.
 *
 * WHY THE ACADEMY SERVES THEM AT ALL. On PREPROD the files live in a directory
 * on the application host. Serving them from the web server would need a new
 * location block and would hand a lesson to anyone holding its address; serving
 * them here keeps the one rule the product already has — a learner reads what
 * the Backend says they may read — and changes no server configuration. On PROD
 * the same addresses are expected to resolve to signed delivery; nothing in a
 * lesson row changes when that happens.
 *
 * EVERYTHING HERE FAILS TO "NOT FOUND". A name outside the shape below, a file
 * type that is not lesson media, a path that leaves the root through a link —
 * each is simply not a file this route has.
 */
import fs from "node:fs";
import path from "node:path";

/** `lessons/<stableCode>/<file>` — exactly three segments, each plainly named. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LEVEL_STABLE_CODE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const MAX_SEGMENT_LENGTH = 160;

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

export type LessonMediaTarget = {
  /** The registry's key, relative to the media root. */
  storageKey: string;
  /** The level whose lesson this file belongs to — the unit of access. */
  levelStableCode: string;
  contentType: string;
};

/** The route's path segments → the file they name, or null. */
export function parseLessonMediaPath(segments: readonly string[] | undefined): LessonMediaTarget | null {
  if (!segments || segments.length !== 3) return null;
  for (const segment of segments) {
    if (segment.length > MAX_SEGMENT_LENGTH || !SEGMENT.test(segment) || segment === "." || segment === "..") {
      return null;
    }
  }
  const [area, levelStableCode, fileName] = segments as [string, string, string];
  if (area !== "lessons") return null;
  if (!LEVEL_STABLE_CODE.test(levelStableCode)) return null;
  const contentType = CONTENT_TYPES[path.extname(fileName).toLowerCase()];
  if (!contentType) return null;
  return { storageKey: `${area}/${levelStableCode}/${fileName}`, levelStableCode, contentType };
}

/**
 * The directory lesson media is served from, or null when none is configured.
 *
 * Absent is a legal deployment: lessons then have no video on this host and
 * every `/media/…` request is not found. A relative value is refused rather
 * than resolved against whatever the working directory happens to be.
 */
export function resolveMediaRoot(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.ATA_MEDIA_ROOT?.trim();
  if (!raw || !path.isAbsolute(raw)) return null;
  return path.resolve(raw);
}

/**
 * Find the file, and prove it is inside the root AFTER links are followed.
 *
 * The name was already checked character by character; this is the second
 * lock, for the case the first cannot see — a link placed inside the media
 * directory that points out of it.
 */
export async function locateLessonMediaFile(
  root: string,
  target: LessonMediaTarget,
): Promise<{ file: string; size: number } | null> {
  try {
    const realRoot = await fs.promises.realpath(root);
    const real = await fs.promises.realpath(path.join(realRoot, target.storageKey));
    if (!real.startsWith(`${realRoot}${path.sep}`)) return null;
    const stat = await fs.promises.stat(real);
    if (!stat.isFile() || stat.size <= 0) return null;
    return { file: real, size: stat.size };
  } catch {
    return null;
  }
}

export type RangeRequest =
  | { kind: "whole" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * One `Range: bytes=…` header against a file of `size` bytes.
 *
 * A player seeks by asking for a byte range, so this is what makes «пересмотреть
 * с 6:20» land without downloading six minutes of video first. Only a single
 * range is honoured; a list of ranges, another unit or a malformed header is
 * ignored and the whole file is offered, which the specification allows and
 * every player handles.
 */
export function parseRangeHeader(header: string | null, size: number): RangeRequest {
  if (!header) return { kind: "whole" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "whole" };
  const [, rawStart, rawEnd] = match as unknown as [string, string, string];
  if (rawStart === "" && rawEnd === "") return { kind: "whole" };

  if (rawStart === "") {
    // `bytes=-N`: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= size) return { kind: "unsatisfiable" };
  if (rawEnd === "") return { kind: "partial", start, end: size - 1 };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}
