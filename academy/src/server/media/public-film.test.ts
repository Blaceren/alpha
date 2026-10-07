/**
 * The public home's film (2026-10-04): a fixed set of names in one folder of
 * the media directory, found or absent — never anything else.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { forgetCdnFilmPresence, locatePublicFilmFile, readPublicFilm, readPublicFilmFromCdn, PUBLIC_FILM_DIR } from "@/server/media/public-film";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-film-"));
  fs.mkdirSync(path.join(root, PUBLIC_FILM_DIR), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});
const put = (name: string, bytes = "x") => fs.writeFileSync(path.join(root, PUBLIC_FILM_DIR, name), bytes);

describe("the public film", () => {
  it("is absent until a video is on the host", async () => {
    expect(await readPublicFilm(root)).toBeNull();
    put("hero.jpg");
    expect(await readPublicFilm(root)).toBeNull(); // a poster alone is not a film
    expect(await readPublicFilm(null)).toBeNull();
  });

  it("offers the video, its poster and captions, addressed with the file's time", async () => {
    put("hero.mp4", "video");
    put("hero.webp", "img");
    put("hero.vtt", "WEBVTT");
    const film = await readPublicFilm(root);
    expect(film?.src).toMatch(/^\/film\/hero\.mp4\?v=[0-9a-z]+$/);
    expect(film?.poster).toMatch(/^\/film\/hero\.webp\?v=/);
    expect(film?.captions).toMatch(/^\/film\/hero\.vtt\?v=/);
  });

  it("takes a webm when there is no mp4", async () => {
    put("hero.webm", "video");
    expect((await readPublicFilm(root))?.src).toMatch(/^\/film\/hero\.webm\?v=/);
  });

  it("serves only its own names, and refuses a link out of the media directory", async () => {
    put("hero.mp4", "video");
    expect(await locatePublicFilmFile("hero.mp4", root)).not.toBeNull();
    for (const name of ["../secret.txt", "hero.MP4", "other.mp4", "", "constructor", "__proto__", "hero.mp4/"]) {
      expect(await locatePublicFilmFile(name, root), name).toBeNull();
    }
    const outside = path.join(root, "outside.mp4");
    fs.writeFileSync(outside, "nope");
    fs.rmSync(path.join(root, PUBLIC_FILM_DIR, "hero.mp4"));
    fs.symlinkSync(outside, path.join(root, PUBLIC_FILM_DIR, "hero.mp4"));
    // The link resolves inside the root here (outside.mp4 sits in it), so it is served…
    expect(await locatePublicFilmFile("hero.mp4", root)).not.toBeNull();
    // …but one pointing outside the root is not.
    const away = fs.mkdtempSync(path.join(os.tmpdir(), "ata-away-"));
    fs.writeFileSync(path.join(away, "x.mp4"), "nope");
    fs.rmSync(path.join(root, PUBLIC_FILM_DIR, "hero.mp4"));
    fs.symlinkSync(path.join(away, "x.mp4"), path.join(root, PUBLIC_FILM_DIR, "hero.mp4"));
    expect(await locatePublicFilmFile("hero.mp4", root)).toBeNull();
    fs.rmSync(away, { recursive: true, force: true });
  });

  it("refuses an empty file", async () => {
    put("hero.mp4", "");
    expect(await locatePublicFilmFile("hero.mp4", root)).toBeNull();
  });
});

/* 2026-10-07: on the CDN the page asks CloudFront whether the film is there — a
   HEAD per name, remembered for a minute, fail-closed — and links it directly. */
describe("the public film on the CDN", () => {
  const ORIGIN = "https://d1abc.cloudfront.net";
  const head = (present: Record<string, string>) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const name = url.slice(url.lastIndexOf("/") + 1);
      if (init?.method !== "HEAD") throw new Error("not a HEAD");
      if (name in present) return new Response(null, { status: 200, headers: { etag: present[name]! } });
      return new Response(null, { status: 403 });
    }) as typeof fetch;

  beforeEach(() => forgetCdnFilmPresence());

  it("names the film, its poster and its captions on the CDN, versioned by their ETags, with CORS", async () => {
    const film = await readPublicFilmFromCdn(ORIGIN, head({ "hero.mp4": '"abc123"', "hero.jpg": '"p1"', "hero.vtt": 'W/"c9"' }));
    expect(film).toEqual({
      src: `${ORIGIN}/public/film/hero.mp4?v=abc123`,
      poster: `${ORIGIN}/public/film/hero.jpg?v=p1`,
      captions: `${ORIGIN}/public/film/hero.vtt?v=Wc9`,
      crossOrigin: "anonymous",
    });
  });

  it("takes the webm when there is no mp4, and says «no film» when there is neither", async () => {
    const webm = await readPublicFilmFromCdn(ORIGIN, head({ "hero.webm": '"w"' }));
    expect(webm?.src).toBe(`${ORIGIN}/public/film/hero.webm?v=w`);
    forgetCdnFilmPresence();
    expect(await readPublicFilmFromCdn(ORIGIN, head({ "hero.jpg": '"p"' }))).toBeNull();
  });

  it("is fail-closed: a CDN that errors or does not answer means no film, remembered for a minute", async () => {
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await readPublicFilmFromCdn(ORIGIN, failing)).toBeNull();
    expect(calls).toBe(6);
    expect(await readPublicFilmFromCdn(ORIGIN, failing)).toBeNull();
    expect(calls).toBe(6);
  });

  it("is what readPublicFilm answers in cdn delivery, whatever the media root holds", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = head({ "hero.mp4": '"m"' });
    try {
      const film = await readPublicFilm("/nowhere", { mode: "cdn", origin: ORIGIN, lessons: { kind: "public" } });
      expect(film?.src).toBe(`${ORIGIN}/public/film/hero.mp4?v=m`);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
