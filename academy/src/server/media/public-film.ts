import fs from "node:fs";
import path from "node:path";
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
};

/* The address carries the file's time, so a new cut copied over the old one is
   fetched afresh instead of from a browser's cache. */
const address = (name: string, found: PublicFilmFile) =>
  `/film/${name}?v=${Math.floor(found.mtimeMs).toString(36)}`;

export async function readPublicFilm(root: string | null = resolveMediaRoot()): Promise<PublicFilm | null> {
  if (!root) return null;
  const names = ["hero.mp4", "hero.webm", "hero.jpg", "hero.webp", "hero.png", "hero.vtt"] as const;
  const [mp4, webm, jpg, webp, png, vtt] = await Promise.all(names.map((name) => locatePublicFilmFile(name, root)));
  const video = mp4 ? (["hero.mp4", mp4] as const) : webm ? (["hero.webm", webm] as const) : null;
  if (!video) return null;
  const poster = jpg ? address("hero.jpg", jpg) : webp ? address("hero.webp", webp) : png ? address("hero.png", png) : null;
  return {
    src: address(video[0], video[1]),
    poster,
    captions: vtt ? address("hero.vtt", vtt) : null,
  };
}
