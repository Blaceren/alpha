import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  cloudFrontBase64,
  cloudFrontPolicy,
  EXPIRY_STEP_SECONDS,
  quantisedExpiry,
  signCloudFrontResource,
  signedLessonFileUrl,
} from "@/server/media/cloudfront-signing";

/* The Academy's own CloudFront signer (2026-10-07). What CloudFront reads is a
   policy with no whitespace, an RSA signature over its bytes, and base64 with
   three substitutions — each is checked here against node's own verifier. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signer = { keyPairId: "K2JCJMDEHXQW5F", privateKey, algorithm: "sha1" as const };

function decodeCloudFront(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");
}

describe("the policy", () => {
  it("is CloudFront's custom policy, with no whitespace and the keys in its order", () => {
    expect(cloudFrontPolicy("https://d1.cloudfront.net/lessons/v2.l004.kak-chitat-grafik/*", 1_800_000_000)).toBe(
      '{"Statement":[{"Resource":"https://d1.cloudfront.net/lessons/v2.l004.kak-chitat-grafik/*","Condition":{"DateLessThan":{"AWS:EpochTime":1800000000}}}]}',
    );
  });

  it("encodes with CloudFront's three substitutions and nothing percent-encoded", () => {
    const encoded = cloudFrontBase64(Buffer.from([0xfb, 0xff, 0xbf, 0xfe]));
    expect(encoded).toMatch(/^[A-Za-z0-9~_-]+$/);
    expect(decodeCloudFront(encoded)).toEqual(Buffer.from([0xfb, 0xff, 0xbf, 0xfe]));
  });

  it("expires on a five-minute grid, so one playback keeps one address", () => {
    const now = Date.UTC(2026, 9, 7, 12, 1, 7);
    const expiry = quantisedExpiry(now, 6 * 3600);
    expect(expiry % EXPIRY_STEP_SECONDS).toBe(0);
    expect(expiry * 1000).toBeGreaterThanOrEqual(now + 6 * 3600 * 1000);
    expect(expiry * 1000 - (now + 6 * 3600 * 1000)).toBeLessThan(EXPIRY_STEP_SECONDS * 1000);
    expect(quantisedExpiry(now + 60_000, 6 * 3600)).toBe(expiry);
  });
});

describe("the signature", () => {
  it("is RSA-SHA1 over the policy's bytes, under the key pair id, and verifies with the public key", () => {
    const resource = "https://d1.cloudfront.net/lessons/v2.l004.kak-chitat-grafik/*";
    const { query, expiresAt } = signCloudFrontResource(signer, resource, 1_800_000_000);
    expect(expiresAt).toBe(1_800_000_000);
    const params = new URLSearchParams(query);
    expect([...params.keys()]).toEqual(["Policy", "Signature", "Key-Pair-Id"]);
    expect(params.get("Key-Pair-Id")).toBe("K2JCJMDEHXQW5F");
    const policy = decodeCloudFront(params.get("Policy") ?? "").toString("utf8");
    expect(policy).toBe(cloudFrontPolicy(resource, 1_800_000_000));
    const verify = createVerify("RSA-SHA1");
    verify.update(policy, "utf8");
    verify.end();
    expect(verify.verify(publicKey, decodeCloudFront(params.get("Signature") ?? ""))).toBe(true);
  });

  it("can be SHA-256, and then says so in the query", () => {
    const { query } = signCloudFrontResource({ ...signer, algorithm: "sha256" }, "https://d1.cloudfront.net/lessons/x/*", 1_800_000_000);
    const params = new URLSearchParams(query);
    expect(params.get("Hash-Algorithm")).toBe("SHA256");
    const verify = createVerify("RSA-SHA256");
    verify.update(decodeCloudFront(params.get("Policy") ?? ""));
    verify.end();
    expect(verify.verify(publicKey, decodeCloudFront(params.get("Signature") ?? ""))).toBe(true);
  });

  it("signs a lesson's folder once and addresses one file of it", () => {
    const url = signedLessonFileUrl(signer, "https://d1.cloudfront.net", "lessons/v2.l004.kak-chitat-grafik", "ba00944c6222a86b.mp4", 1_800_000_000);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://d1.cloudfront.net/lessons/v2.l004.kak-chitat-grafik/ba00944c6222a86b.mp4");
    const policy = decodeCloudFront(parsed.searchParams.get("Policy") ?? "").toString("utf8");
    expect(policy).toContain('"Resource":"https://d1.cloudfront.net/lessons/v2.l004.kak-chitat-grafik/*"');
    // The poster of the same lesson gets the same signature.
    const poster = new URL(signedLessonFileUrl(signer, "https://d1.cloudfront.net", "lessons/v2.l004.kak-chitat-grafik", "poster.jpg", 1_800_000_000));
    expect(poster.searchParams.get("Signature")).toBe(parsed.searchParams.get("Signature"));
  });
});
