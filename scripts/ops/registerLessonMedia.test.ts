import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMp4DurationSeconds } from "./registerLessonMedia";

function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

/** `mvhd`, version 0: four 32-bit fields after the version/flags word. */
function mvhd0(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return box("mvhd", body);
}

/** `mvhd`, version 1: 64-bit times, 32-bit timescale, 64-bit duration. */
function mvhd1(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(112);
  body.writeUInt8(1, 0);
  body.writeUInt32BE(timescale, 20);
  body.writeBigUInt64BE(BigInt(duration), 24);
  return box("mvhd", body);
}

function write(name: string, parts: Buffer[]): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ata-lesson-media-"));
  const file = path.join(directory, name);
  fs.writeFileSync(file, Buffer.concat(parts));
  return file;
}

const ftyp = box("ftyp", Buffer.from("isom0000isomiso2", "latin1"));

describe("readMp4DurationSeconds", () => {
  it("reads a version-0 header: duration over timescale", () => {
    const file = write("v0.mp4", [ftyp, box("moov", mvhd0(1_000, 612_400))]);
    expect(readMp4DurationSeconds(file)).toBe(612);
  });

  it("reads a version-1 header", () => {
    const file = write("v1.mp4", [ftyp, box("moov", mvhd1(90_000, 90_000 * 437))]);
    expect(readMp4DurationSeconds(file)).toBe(437);
  });

  it("finds `moov` behind the media data without reading the media data", () => {
    const mdat = box("mdat", Buffer.alloc(300_000, 7));
    const file = write("tail.mp4", [ftyp, mdat, box("moov", Buffer.concat([box("udta", Buffer.alloc(40)), mvhd0(600, 600 * 95)]))]);
    expect(readMp4DurationSeconds(file)).toBe(95);
  });

  it("answers null rather than a guess for a file it cannot read this way", () => {
    expect(readMp4DurationSeconds(write("empty.mp4", [ftyp]))).toBeNull();
    expect(readMp4DurationSeconds(write("zero.mp4", [ftyp, box("moov", mvhd0(1_000, 0))]))).toBeNull();
    expect(readMp4DurationSeconds(write("noise.mp4", [Buffer.from("not an mp4 at all, just text")]))).toBeNull();
    // A box that claims to be longer than the file.
    const lying = Buffer.alloc(16);
    lying.writeUInt32BE(4_000, 0);
    lying.write("moov", 4, "latin1");
    expect(readMp4DurationSeconds(write("lying.mp4", [ftyp, lying]))).toBeNull();
  });
});
