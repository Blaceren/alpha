import fs from "node:fs";
import path from "node:path";
import { mediaDelivery, PUBLIC_FILM_CDN_FOLDER, type MediaDelivery } from "@/server/media/delivery";
import { resolveMediaRoot } from "@/server/media/lesson-media-file";

/**
 * THE FILM ON THE PUBLIC HOME (2026-10-04, owner: «оставляли место для плеера —
 * давай его туда поставим уже»).
 *
 * The film is not in the release: a video of minutes is far too large for a
 * build and would tie every swap of it to a deployment. It lives on the host,
 * in the media directory the lessons already use, under one fixed folder and
 * a handful of fixed names — so the page can say whether it exists, and a new
 * cut is a file copied in, not a release. Until a video is there, the hero
 * shows the film's cover with «Скоро».
 *
 *   <ATA_MEDIA_ROOT>/public/film/hero.mp4   the film (H.264); or hero.webm
 *   <ATA_MEDIA_ROOT>/public/film/hero.jpg   its poster (optional); or .webp / .png
 *   <ATA_MEDIA_ROOT>/public/film/hero.vtt   Russian captions (optional)
 *
 * ON THE CDN (2026-10-07, `ATA_MEDIA_DELIVERY=cdn`) the same names live under
 * `public/film/` of the bucket behind CloudFront, public. The page asks the CDN
 * whether each is there (a HEAD, remembered for a minute, fail-closed to «no
 * film») and links the CDN directly; the `?v=` is the object's ETag, so a new
 * cut is fetched afresh.
 */
export const PUBLIC_FILM_DIR = path.join("public", "film");

/** The only names the public film route will ever serve, and what they are. */
export const PUBLIC_FILM_FILES: Readonly<Record<string, string>> = {
  "hero.mp4": "video/mp4",
  "hero.webm": "video/webm",
  "hero.jpg": "image/jpeg",
  "hero.webp": "image/webp",
  "hero.png": "image/png",
  "hero.vtt": "text/vtt; charset=utf-8",
};

export type PublicFilmFile = { file: string; size: number; contentType: string; mtimeMs: number };

/**
 * One allowed file, proven to sit inside the media directory after links are
 * followed (the same second lock the lesson media have). Anything else — an
 * unknown name, no media directory, a link pointing out — is simply absent.
 */
export async function locatePublicFilmFile(
  name: string,
  root: string | null = resolveMediaRoot(),
): Promise<PublicFilmFile | null> {
  const contentType = Object.prototype.hasOwnProperty.call(PUBLIC_FILM_FILES, name)
    ? PUBLIC_FILM_FILES[name]
    : undefined;
  if (!contentType || !root) return null;
  try {
    const realRoot = await fs.promises.realpath(root);
    const real = await fs.promises.realpath(path.join(realRoot, PUBLIC_FILM_DIR, name));
    if (!real.startsWith(`${realRoot}${path.sep}`)) return null;
    const stat = await fs.promises.stat(real);
    if (!stat.isFile() || stat.size <= 0) return null;
    return { file: real, size: stat.size, contentType, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** What the hero needs to play the film, or null while there is none. */
export type PublicFilm = {
  src: string;
  poster: string | null;
  captions: string | null;
  /** Set when the film is loaded from another origin (the CDN): the `<video>` then carries `crossorigin`. */
  crossOrigin?: "anonymous";
};

/* The address carries the file's time, so a new cut copied over the old one is
   fetched afresh instead of from a browser's cache. */
const address = (name: string, found: PublicFilmFile) =>
  `/film/${name}?v=${Math.floor(found.mtimeMs).toString(36)}`;

const FILM_NAMES = ["hero.mp4", "hero.webm", "hero.jpg", "hero.webp", "hero.png", "hero.vtt"] as const;

export async function readPublicFilm(
  root: string | null = resolveMediaRoot(),
  delivery: MediaDelivery = mediaDelivery(),
): Promise<PublicFilm | null> {
  if (delivery.mode === "cdn") return readPublicFilmFromCdn(delivery.origin);
  if (!root) return null;
  const [mp4, webm, jpg, webp, png, vtt] = await Promise.all(FILM_NAMES.map((name) => locatePublicFilmFile(name, root)));
  const video = mp4 ? (["hero.mp4", mp4] as const) : webm ? (["hero.webm", webm] as const) : null;
  if (!video) return null;
  const poster = jpg ? address("hero.jpg", jpg) : webp ? address("hero.webp", webp) : png ? address("hero.png", png) : null;
  return {
    src: address(video[0], video[1]),
    poster,
    captions: vtt ? address("hero.vtt", vtt) : null,
  };
}

/* ------------------------------------------------------------- the CDN */

/** What the CDN said about one name, remembered for a minute. */
type CdnPresence = { version: string | null; until: number };

const CDN_PRESENCE_TTL_MS = 60_000;
const CDN_PROBE_TIMEOUT_MS = 3_000;
const cdnPresence = new Map<string, CdnPresence>();

/** The object's version for `?v=`: its ETag, else its Last-Modified, else nothing. */
function versionOf(headers: Headers): string {
  const etag = headers.get("etag")?.replace(/[^A-Za-z0-9]/g, "");
  if (etag) return etag.slice(0, 32);
  const modified = headers.get("last-modified");
  const ms = modified ? Date.parse(modified) : Number.NaN;
  return Number.isFinite(ms) ? Math.floor(ms).toString(36) : "";
}

/**
 * Is `name` on the CDN? One HEAD, fail-closed: a CDN that does not answer in
 * time, or answers anything but 200, is «not there» — and that too is
 * remembered for a minute, so an outage costs one request a minute, not one a
 * visit.
 */
async function probeCdn(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  const now = Date.now();
  const known = cdnPresence.get(url);
  if (known && known.until > now) return known.version;
  let version: string | null = null;
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(CDN_PROBE_TIMEOUT_MS),
    });
    if (response.ok) version = versionOf(response.headers);
  } catch {
    version = null;
  }
  cdnPresence.set(url, { version, until: now + CDN_PRESENCE_TTL_MS });
  return version;
}

export async function readPublicFilmFromCdn(origin: string, fetchImpl: typeof fetch = fetch): Promise<PublicFilm | null> {
  const base = `${origin}/${PUBLIC_FILM_CDN_FOLDER}`;
  const versions = await Promise.all(FILM_NAMES.map((name) => probeCdn(`${base}/${name}`, fetchImpl)));
  const found = Object.fromEntries(FILM_NAMES.map((name, index) => [name, versions[index] ?? null])) as Record<
    (typeof FILM_NAMES)[number],
    string | null
  >;
  const cdnAddress = (name: (typeof FILM_NAMES)[number]) => {
    const version = found[name];
    return version === null ? null : `${base}/${name}${version ? `?v=${version}` : ""}`;
  };
  const src = cdnAddress("hero.mp4") ?? cdnAddress("hero.webm");
  if (!src) return null;
  return {
    src,
    poster: cdnAddress("hero.jpg") ?? cdnAddress("hero.webp") ?? cdnAddress("hero.png"),
    captions: cdnAddress("hero.vtt"),
    crossOrigin: "anonymous",
  };
}

/** Test seam: forget what the CDN said. */
export function forgetCdnFilmPresence(): void {
  cdnPresence.clear();
}
