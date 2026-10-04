/**
 * The public home's film (2026-10-04): a fixed set of names in one folder of
 * the media directory, found or absent — never anything else.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { locatePublicFilmFile, readPublicFilm, PUBLIC_FILM_DIR } from "@/server/media/public-film";

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
