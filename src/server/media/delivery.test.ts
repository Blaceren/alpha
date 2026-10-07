import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_URL_TTL_SECONDS, mediaIsCrossOrigin, parseCdnOrigin, resolveMediaDelivery } from "@/server/media/delivery";

/* Where this deployment serves media from (2026-10-07): a directory on the host,
   or Amazon S3 behind CloudFront — and in the second case never a lesson link
   that is open to the world unless the environment says so in as many words. */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const readKey = () => privateKey;

const CDN = {
  ATA_MEDIA_DELIVERY: "cdn",
  ATA_MEDIA_CDN_ORIGIN: "https://d1abc.cloudfront.net",
  ATA_MEDIA_CDN_KEY_PAIR_ID: "K2JCJMDEHXQW5F",
  ATA_MEDIA_CDN_PRIVATE_KEY_FILE: "/srv/ata/config/cdn-signing.pem",
};

afterEach(() => vi.restoreAllMocks());

describe("parseCdnOrigin", () => {
  it("takes an origin and nothing more", () => {
    expect(parseCdnOrigin("https://d1abc.cloudfront.net")).toBe("https://d1abc.cloudfront.net");
    expect(parseCdnOrigin("https://video.alfatrade.media/")).toBe("https://video.alfatrade.media");
    expect(parseCdnOrigin("http://127.0.0.1:3077")).toBe("http://127.0.0.1:3077");
    for (const bad of ["", "d1abc.cloudfront.net", "https://d1abc.cloudfront.net/lessons", "https://d1abc.cloudfront.net/?x=1", "ftp://x", "https://u:p@x.net"]) {
      expect(parseCdnOrigin(bad), bad).toBeNull();
    }
  });
});

describe("resolveMediaDelivery", () => {
  it("is local by default, and local when the CDN origin is missing or wrong", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(resolveMediaDelivery({}, readKey)).toEqual({ mode: "local" });
    expect(resolveMediaDelivery({ ATA_MEDIA_DELIVERY: "cdn" }, readKey)).toEqual({ mode: "local" });
    expect(resolveMediaDelivery({ ATA_MEDIA_DELIVERY: "cdn", ATA_MEDIA_CDN_ORIGIN: "nope" }, readKey)).toEqual({ mode: "local" });
    expect(quiet).toHaveBeenCalled();
  });

  it("signs lessons with the key the environment names, for six hours by default", () => {
    const delivery = resolveMediaDelivery(CDN, readKey);
    expect(delivery.mode).toBe("cdn");
    if (delivery.mode !== "cdn" || delivery.lessons.kind !== "signed") throw new Error("not signed");
    expect(delivery.origin).toBe("https://d1abc.cloudfront.net");
    expect(delivery.lessons.signer.keyPairId).toBe("K2JCJMDEHXQW5F");
    expect(delivery.lessons.signer.algorithm).toBe("sha1");
    expect(delivery.lessons.ttlSeconds).toBe(DEFAULT_URL_TTL_SECONDS);
    const tuned = resolveMediaDelivery({ ...CDN, ATA_MEDIA_CDN_URL_TTL_SECONDS: "3600", ATA_MEDIA_CDN_SIGNATURE: "sha256" }, readKey);
    if (tuned.mode !== "cdn" || tuned.lessons.kind !== "signed") throw new Error("not signed");
    expect(tuned.lessons.ttlSeconds).toBe(3600);
    expect(tuned.lessons.signer.algorithm).toBe("sha256");
    // A ttl out of range falls back to the default rather than to a surprise.
    const odd = resolveMediaDelivery({ ...CDN, ATA_MEDIA_CDN_URL_TTL_SECONDS: "5" }, readKey);
    if (odd.mode !== "cdn" || odd.lessons.kind !== "signed") throw new Error("not signed");
    expect(odd.lessons.ttlSeconds).toBe(DEFAULT_URL_TTL_SECONDS);
  });

  it("serves no lesson at all from the CDN without a usable key — never an open link by accident", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases: Array<[Record<string, string>, string]> = [
      [{ ...CDN, ATA_MEDIA_CDN_KEY_PAIR_ID: "" }, "key pair id"],
      [{ ...CDN, ATA_MEDIA_CDN_KEY_PAIR_ID: "k2-not-an-id" }, "key pair id"],
      [{ ...CDN, ATA_MEDIA_CDN_PRIVATE_KEY_FILE: "relative.pem" }, "absolute path"],
    ];
    for (const [env, reason] of cases) {
      const delivery = resolveMediaDelivery(env, readKey);
      expect(delivery.mode).toBe("cdn");
      if (delivery.mode !== "cdn") throw new Error("not cdn");
      expect(delivery.lessons.kind).toBe("unconfigured");
      if (delivery.lessons.kind === "unconfigured") expect(delivery.lessons.reason).toContain(reason);
    }
    const unreadable = resolveMediaDelivery(CDN, () => {
      throw new Error("ENOENT");
    });
    if (unreadable.mode !== "cdn") throw new Error("not cdn");
    expect(unreadable.lessons.kind).toBe("unconfigured");
    const notRsa = resolveMediaDelivery(CDN, () => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey);
    if (notRsa.mode !== "cdn") throw new Error("not cdn");
    expect(notRsa.lessons.kind).toBe("unconfigured");
    expect(quiet).toHaveBeenCalled();
  });

  it("serves lessons as plain CDN addresses only when told so in as many words", () => {
    const delivery = resolveMediaDelivery({ ATA_MEDIA_DELIVERY: "cdn", ATA_MEDIA_CDN_ORIGIN: CDN.ATA_MEDIA_CDN_ORIGIN, ATA_MEDIA_CDN_LESSONS_PUBLIC: "true" }, readKey);
    expect(delivery).toEqual({ mode: "cdn", origin: "https://d1abc.cloudfront.net", lessons: { kind: "public" } });
  });

  it("says when a <video> must ask with CORS", () => {
    expect(mediaIsCrossOrigin({ mode: "local" })).toBe(false);
    expect(mediaIsCrossOrigin(resolveMediaDelivery(CDN, readKey))).toBe(true);
  });
});
