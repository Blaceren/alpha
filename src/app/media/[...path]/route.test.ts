/**
 * `/media/lessons/<level>/<file>` on the CDN (2026-10-07): the same name and
 * permission checks, then a redirect to the file's signed CloudFront address
 * — never the bytes, and never a link for a learner the Backend refuses.
 */
import { createVerify, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined) }),
}));
const readLevelContent = vi.fn();
vi.mock("@/server/curriculum/server-read", () => ({
  readLevelContent: (...args: unknown[]) => readLevelContent(...args),
}));

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";
import { forgetLessonMediaAccess } from "@/server/media/lesson-media-access";
import { resetMediaDeliveryForTests } from "@/server/media/delivery";
import { GET, HEAD } from "./route";

const LEVEL = "v2.l004.kak-chitat-grafik";
const FILE = "ba00944c6222a86b.mp4";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

let root: string;
let keyFile: string;
const saved: Record<string, string | undefined> = {};
const KEYS = [
  "ATA_MEDIA_ROOT",
  "ATA_MEDIA_DELIVERY",
  "ATA_MEDIA_CDN_ORIGIN",
  "ATA_MEDIA_CDN_KEY_PAIR_ID",
  "ATA_MEDIA_CDN_PRIVATE_KEY_FILE",
  "ATA_MEDIA_CDN_LESSONS_PUBLIC",
];

beforeEach(() => {
  for (const key of KEYS) saved[key] = process.env[key];
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ata-media-route-"));
  fs.mkdirSync(path.join(root, "lessons", LEVEL), { recursive: true });
  fs.writeFileSync(path.join(root, "lessons", LEVEL, FILE), "0123456789");
  keyFile = path.join(root, "signing.pem");
  fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.ATA_MEDIA_ROOT = root;
  cookieJar.set(SESSION_COOKIE_NAME, "a-session");
  readLevelContent.mockReset().mockResolvedValue({ ok: true, content: {} });
  forgetLessonMediaAccess();
  resetMediaDeliveryForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetMediaDeliveryForTests();
  fs.rmSync(root, { recursive: true, force: true });
});

const cdn = (extra: Record<string, string> = {}) => {
  process.env.ATA_MEDIA_DELIVERY = "cdn";
  process.env.ATA_MEDIA_CDN_ORIGIN = "https://d1abc.cloudfront.net";
  process.env.ATA_MEDIA_CDN_KEY_PAIR_ID = "K2JCJMDEHXQW5F";
  process.env.ATA_MEDIA_CDN_PRIVATE_KEY_FILE = keyFile;
  Object.assign(process.env, extra);
  resetMediaDeliveryForTests();
};

const call = (segments: string[], init?: RequestInit) =>
  GET(new Request(`http://academy.test/media/${segments.join("/")}`, init), { params: Promise.resolve({ path: segments }) });

const decode = (value: string) => Buffer.from(value.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");

describe("/media on this host", () => {
  it("streams the file, as before", async () => {
    const res = await call(["lessons", LEVEL, FILE]);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("0123456789");
  });
});

describe("/media on the CDN", () => {
  it("redirects an admitted learner to the file's signed address, never caching the decision", async () => {
    cdn();
    const res = await call(["lessons", LEVEL, FILE]);
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe(`https://d1abc.cloudfront.net/lessons/${LEVEL}/${FILE}`);
    expect(location.searchParams.get("Key-Pair-Id")).toBe("K2JCJMDEHXQW5F");
    const policy = decode(location.searchParams.get("Policy") ?? "").toString("utf8");
    expect(policy).toContain(`"Resource":"https://d1abc.cloudfront.net/lessons/${LEVEL}/*"`);
    const expires = Number(/"AWS:EpochTime":(\d+)/.exec(policy)?.[1]);
    expect(expires * 1000).toBeGreaterThan(Date.now() + 5 * 3600 * 1000);
    const verify = createVerify("RSA-SHA1");
    verify.update(policy, "utf8");
    verify.end();
    expect(verify.verify(publicKey, decode(location.searchParams.get("Signature") ?? ""))).toBe(true);
    expect(res.body).toBeNull();
    // A HEAD is the same answer.
    const head = await HEAD(new Request(`http://academy.test/media/lessons/${LEVEL}/${FILE}`, { method: "HEAD" }), {
      params: Promise.resolve({ path: ["lessons", LEVEL, FILE] }),
    });
    expect(head.status).toBe(302);
  });

  it("asks the same permission first: a refused learner gets «not found», no link", async () => {
    cdn();
    readLevelContent.mockResolvedValue({ ok: false, reason: "locked" });
    const res = await call(["lessons", LEVEL, FILE]);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    cookieJar.clear();
    forgetLessonMediaAccess();
    expect((await call(["lessons", LEVEL, FILE])).status).toBe(404);
  });

  it("checks the name as before, and needs no file on this host", async () => {
    cdn();
    fs.rmSync(path.join(root, "lessons"), { recursive: true, force: true });
    expect((await call(["lessons", LEVEL, FILE])).status).toBe(302);
    expect((await call(["lessons", LEVEL, "..", FILE])).status).toBe(404);
    expect((await call(["other", LEVEL, FILE])).status).toBe(404);
    expect((await call(["lessons", LEVEL, "notes.txt"])).status).toBe(404);
  });

  it("serves no lesson without a usable key — not even a redirect", async () => {
    cdn({ ATA_MEDIA_CDN_PRIVATE_KEY_FILE: path.join(root, "missing.pem") });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetMediaDeliveryForTests();
    const res = await call(["lessons", LEVEL, FILE]);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    quiet.mockRestore();
  });

  it("redirects to the plain address only when lessons are declared public", async () => {
    cdn({ ATA_MEDIA_CDN_LESSONS_PUBLIC: "true" });
    const res = await call(["lessons", LEVEL, FILE]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://d1abc.cloudfront.net/lessons/${LEVEL}/${FILE}`);
  });
});
