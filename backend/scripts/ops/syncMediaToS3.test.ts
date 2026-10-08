import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySync, cacheControlFor, listMediaFiles, planSync, type ObjectHead, type S3Like } from "./syncMediaToS3";

/* The media directory to the bucket (2026-10-07): same keys, nothing deleted, a
   lesson file never overwritten, the film replaced in place. */
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-media-sync-"));
  fs.mkdirSync(path.join(root, "lessons", "v2.l004.kak-chitat-grafik"), { recursive: true });
  fs.mkdirSync(path.join(root, "public", "film"), { recursive: true });
  fs.writeFileSync(path.join(root, "lessons", "v2.l004.kak-chitat-grafik", "aaaa.mp4"), "video-bytes");
  fs.writeFileSync(path.join(root, "lessons", "v2.l004.kak-chitat-grafik", "bbbb.vtt"), "WEBVTT");
  fs.writeFileSync(path.join(root, "lessons", "v2.l004.kak-chitat-grafik", "notes.txt"), "not media");
  fs.writeFileSync(path.join(root, "public", "film", "hero.webm"), "film-bytes");
  fs.mkdirSync(path.join(root, "elsewhere"), { recursive: true });
  fs.writeFileSync(path.join(root, "elsewhere", "x.mp4"), "not an area");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function fakeS3(objects: Record<string, ObjectHead>): S3Like & { puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    async head(key) {
      return objects[key] ?? null;
    },
    async put(input) {
      puts.push(`${input.key} ${input.contentType} ${input.cacheControl} sha256=${input.sha256.slice(0, 8)}`);
    },
  };
}

describe("listMediaFiles", () => {
  it("names only media files of the two areas, as forward-slash keys, in a stable order", () => {
    expect(listMediaFiles(root).map((f) => `${f.key}:${f.contentType}:${f.replace}`)).toEqual([
      "lessons/v2.l004.kak-chitat-grafik/aaaa.mp4:video/mp4:false",
      "lessons/v2.l004.kak-chitat-grafik/bbbb.vtt:text/vtt; charset=utf-8:false",
      "public/film/hero.webm:video/webm:true",
    ]);
    expect(listMediaFiles(root, "public").map((f) => f.key)).toEqual(["public/film/hero.webm"]);
  });
});

describe("planSync and applySync", () => {
  it("uploads what is missing, leaves what is identical, keeps a lesson file the bucket already has, replaces the film", async () => {
    const sameVtt = "5a2c5f2b52d7c2f08af3a0b0a4c1c1f0e5b7f4c36b2d4b8a7a0a6ff2e2b0e0d1";
    const s3 = fakeS3({
      "lessons/v2.l004.kak-chitat-grafik/bbbb.vtt": { size: 6, sha256: "different" },
      "public/film/hero.webm": { size: 3, sha256: "old" },
    });
    const plans = await planSync(root, s3);
    expect(plans.map((p) => `${p.key}=${p.action}`)).toEqual([
      "lessons/v2.l004.kak-chitat-grafik/aaaa.mp4=upload",
      "lessons/v2.l004.kak-chitat-grafik/bbbb.vtt=skip-exists",
      "public/film/hero.webm=replace",
    ]);
    const log: string[] = [];
    await applySync(plans, s3, (line) => log.push(line));
    expect(s3.puts).toEqual([
      expect.stringMatching(/^lessons\/v2\.l004\.kak-chitat-grafik\/aaaa\.mp4 video\/mp4 public, max-age=31536000, immutable sha256=/),
      expect.stringMatching(/^public\/film\/hero\.webm video\/webm public, max-age=300 sha256=/),
    ]);
    expect(log).toHaveLength(2);
    expect(sameVtt).toHaveLength(64);
  });

  it("skips a file the bucket holds with the same size and checksum", async () => {
    const first = await planSync(root, fakeS3({}));
    const mp4 = first.find((p) => p.key.endsWith("aaaa.mp4"))!;
    const again = await planSync(root, fakeS3({ [mp4.key]: { size: mp4.size, sha256: mp4.sha256 } }));
    expect(again.find((p) => p.key === mp4.key)?.action).toBe("skip-same");
  });

  it("gives a lesson file a year and the film five minutes of cache", () => {
    expect(cacheControlFor("lessons/x/y.mp4")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlFor("public/film/hero.mp4")).toBe("public, max-age=300");
  });
});
