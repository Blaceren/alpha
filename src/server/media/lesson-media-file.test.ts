/**
 * LESSON MEDIA — what `/media/…` may name, which file that is, which bytes.
 *
 * The route itself needs a session and a Backend; these are the parts that do
 * not, and they are where a mistake would hand out a file that is not lesson
 * media at all.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  locateLessonMediaFile,
  parseLessonMediaPath,
  parseRangeHeader,
  resolveMediaRoot,
} from "@/server/media/lesson-media-file";

describe("parseLessonMediaPath", () => {
  it("reads the registry's own address shape", () => {
    expect(parseLessonMediaPath(["lessons", "v2.l004.kak-chitat-grafik", "4d86121c0c7a1eee.mp4"])).toEqual({
      storageKey: "lessons/v2.l004.kak-chitat-grafik/4d86121c0c7a1eee.mp4",
      levelStableCode: "v2.l004.kak-chitat-grafik",
      contentType: "video/mp4",
    });
  });

  it("knows the media types a lesson has, and no others", () => {
    const type = (name: string) => parseLessonMediaPath(["lessons", "v2.l001.x", name])?.contentType ?? null;
    expect(type("a.webm")).toBe("video/webm");
    expect(type("a.m4v")).toBe("video/mp4");
    expect(type("a.JPG")).toBe("image/jpeg");
    expect(type("a.png")).toBe("image/png");
    expect(type("a.webp")).toBe("image/webp");
    expect(type("a.vtt")).toBe("text/vtt; charset=utf-8");
    for (const name of ["a.exe", "a.html", "a.svg", "a.js", "a.env", "a", "a.mp4.sh"]) {
      expect(type(name), name).toBeNull();
    }
  });

  it("refuses anything that is not exactly lessons/<level>/<file>", () => {
    for (const segments of [
      undefined,
      [],
      ["lessons"],
      ["lessons", "v2.l004.x"],
      ["lessons", "v2.l004.x", "deep", "a.mp4"],
      ["uploads", "v2.l004.x", "a.mp4"],
      ["lessons", "..", "a.mp4"],
      ["lessons", "v2.l004.x", ".."],
      ["lessons", "v2.l004.x", ".hidden.mp4"],
      ["lessons", "v2.l004.x", "a b.mp4"],
      ["lessons", "v2.l004.x", "a/b.mp4"],
      ["lessons", "v2.l004.x", "a\\b.mp4"],
      ["lessons", "V2.L004.X", "a.mp4"],
      ["lessons", "v2..l004", "a.mp4"],
      ["lessons", "v2.l004.x", `${"a".repeat(200)}.mp4`],
      ["lessons", "v2.l004.x", "a%2e%2e.mp4"],
    ] as Array<string[] | undefined>) {
      expect(parseLessonMediaPath(segments), JSON.stringify(segments)).toBeNull();
    }
  });
});

describe("resolveMediaRoot", () => {
  it("is null when nothing is configured — lessons then simply have no video here", () => {
    expect(resolveMediaRoot({})).toBeNull();
    expect(resolveMediaRoot({ ATA_MEDIA_ROOT: "  " })).toBeNull();
  });

  it("refuses a relative directory instead of resolving it against the working directory", () => {
    expect(resolveMediaRoot({ ATA_MEDIA_ROOT: "media" })).toBeNull();
    expect(resolveMediaRoot({ ATA_MEDIA_ROOT: "./media" })).toBeNull();
  });

  it("takes an absolute directory", () => {
    expect(resolveMediaRoot({ ATA_MEDIA_ROOT: "/srv/ata-data/media/" })).toBe("/srv/ata-data/media");
  });
});

describe("parseRangeHeader", () => {
  const SIZE = 1_000;

  it("offers the whole file when no range, or a range it will not honour, is asked", () => {
    for (const header of [null, "", "bytes=-", "items=0-10", "bytes=0-10,20-30", "bytes=a-b", "bytes 0-10"]) {
      expect(parseRangeHeader(header, SIZE), String(header)).toEqual({ kind: "whole" });
    }
  });

  it("reads a closed range, an open one and a suffix", () => {
    expect(parseRangeHeader("bytes=0-99", SIZE)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRangeHeader("bytes=500-", SIZE)).toEqual({ kind: "partial", start: 500, end: 999 });
    expect(parseRangeHeader("bytes=-100", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
    // A suffix longer than the file is the whole file, as a range.
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  it("clamps an end beyond the file and refuses a start beyond it", () => {
    expect(parseRangeHeader("bytes=900-5000", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
    expect(parseRangeHeader("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=50-10", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=99999999999999999999-", SIZE)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("locateLessonMediaFile", () => {
  let root = "";
  let outside = "";

  beforeAll(() => {
    // Two fresh directories per run, a few hundred bytes each; never reused and
    // never removed by this file.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-media-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "ata-media-outside-"));
    fs.mkdirSync(path.join(root, "lessons", "v2.l004.x"), { recursive: true });
    fs.writeFileSync(path.join(root, "lessons", "v2.l004.x", "aaaa.mp4"), Buffer.alloc(64, 1));
    fs.writeFileSync(path.join(root, "lessons", "v2.l004.x", "empty.mp4"), Buffer.alloc(0));
    fs.mkdirSync(path.join(root, "lessons", "v2.l004.x", "dir.mp4"));
    fs.writeFileSync(path.join(outside, "secret.mp4"), Buffer.alloc(32, 2));
    fs.symlinkSync(path.join(outside, "secret.mp4"), path.join(root, "lessons", "v2.l004.x", "link.mp4"));
  });

  const target = (name: string) => parseLessonMediaPath(["lessons", "v2.l004.x", name])!;

  it("finds a registered file and its size", async () => {
    const located = await locateLessonMediaFile(root, target("aaaa.mp4"));
    expect(located?.size).toBe(64);
    expect(located?.file.endsWith(path.join("lessons", "v2.l004.x", "aaaa.mp4"))).toBe(true);
  });

  it("does not find a missing file, an empty one or a directory", async () => {
    expect(await locateLessonMediaFile(root, target("nope.mp4"))).toBeNull();
    expect(await locateLessonMediaFile(root, target("empty.mp4"))).toBeNull();
    expect(await locateLessonMediaFile(root, target("dir.mp4"))).toBeNull();
  });

  it("does not follow a link out of the media root", async () => {
    expect(await locateLessonMediaFile(root, target("link.mp4"))).toBeNull();
  });

  it("does not find anything under a root that does not exist", async () => {
    expect(await locateLessonMediaFile(path.join(root, "absent"), target("aaaa.mp4"))).toBeNull();
  });
});
