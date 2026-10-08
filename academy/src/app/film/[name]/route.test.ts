/** `/film/<name>` — the public film's files, with byte ranges; nothing else. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetMediaDeliveryForTests } from "@/server/media/delivery";
import { GET, HEAD } from "./route";

let root: string;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ATA_MEDIA_ROOT;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-film-route-"));
  fs.mkdirSync(path.join(root, "public", "film"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "film", "hero.mp4"), "0123456789");
  process.env.ATA_MEDIA_ROOT = root;
});
afterEach(() => {
  process.env.ATA_MEDIA_ROOT = saved;
  delete process.env.ATA_MEDIA_DELIVERY;
  delete process.env.ATA_MEDIA_CDN_ORIGIN;
  resetMediaDeliveryForTests();
  fs.rmSync(root, { recursive: true, force: true });
});
const call = (name: string, init?: RequestInit) =>
  GET(new Request(`http://academy.test/film/${name}`, init), { params: Promise.resolve({ name }) });

describe("/film/<name>", () => {
  it("serves the film whole, as video, cacheable", async () => {
    const res = await call("hero.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.text()).toBe("0123456789");
  });

  it("serves a range, so a player can seek", async () => {
    const res = await call("hero.mp4", { headers: { range: "bytes=2-5" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
    const bad = await call("hero.mp4", { headers: { range: "bytes=50-60" } });
    expect(bad.status).toBe(416);
  });

  it("answers a HEAD without a body", async () => {
    const res = await HEAD(new Request("http://academy.test/film/hero.mp4", { method: "HEAD" }), { params: Promise.resolve({ name: "hero.mp4" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.body).toBeNull();
  });

  it("is not found for anything that is not one of its names, or with no media directory", async () => {
    for (const name of ["hero.webm", "../hero.mp4", "anything.txt"]) {
      expect((await call(name)).status, name).toBe(404);
    }
    process.env.ATA_MEDIA_ROOT = "";
    expect((await call("hero.mp4")).status).toBe(404);
  });
});

/* 2026-10-07: on the CDN the film's names answer a redirect to their public address. */
describe("/film/<name> on the CDN", () => {
  it("redirects a known name to the CDN and refuses the rest, with no file on this host", async () => {
    process.env.ATA_MEDIA_DELIVERY = "cdn";
    process.env.ATA_MEDIA_CDN_ORIGIN = "https://d1abc.cloudfront.net";
    process.env.ATA_MEDIA_ROOT = "";
    resetMediaDeliveryForTests();
    const res = await call("hero.mp4");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://d1abc.cloudfront.net/public/film/hero.mp4");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect((await call("hero.vtt")).status).toBe(302);
    expect((await call("anything.txt")).status).toBe(404);
    expect((await call("../hero.mp4")).status).toBe(404);
  });
});
