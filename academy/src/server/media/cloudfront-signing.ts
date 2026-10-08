/**
 * CLOUDFRONT SIGNED URLS (2026-10-07) — the Academy's own signer (SERVER-ONLY).
 *
 * A lesson's files on the CDN are private: CloudFront serves them only with a
 * signature the Academy makes with its private key, and only until the moment
 * the signature names. The Academy hands such a link to a learner the Backend
 * has let into the level — the same gate as always, one hop earlier.
 *
 * ONE SIGNATURE PER LESSON, NOT PER FILE. The policy's resource is the lesson's
 * folder with a wildcard, so the video, the poster and the captions of one
 * lesson share a signature, and a player that asks for a range again asks for
 * the same address (the expiry is quantised, below).
 *
 * THE FORMAT IS CLOUDFRONT'S, WRITTEN OUT HERE RATHER THAN TAKEN FROM A
 * PACKAGE. A custom policy is one JSON object with no spaces; the signature is
 * RSA over its bytes (SHA-1 by CloudFront's default, SHA-256 where the
 * distribution accepts it); both travel base64-encoded with CloudFront's own
 * three substitutions (`+` → `-`, `=` → `_`, `/` → `~`), under the query names
 * `Policy`, `Signature` and `Key-Pair-Id`. Nothing else is needed, so nothing
 * else is depended on.
 *
 *   https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-creating-signed-url-custom-policy.html
 */
import { createSign, type KeyObject } from "node:crypto";

export type CloudFrontSignatureAlgorithm = "sha1" | "sha256";

export type CloudFrontSigner = {
  readonly keyPairId: string;
  readonly privateKey: KeyObject;
  readonly algorithm: CloudFrontSignatureAlgorithm;
};

/** Signatures are made for a moment on this grid, so one playback keeps one address. */
export const EXPIRY_STEP_SECONDS = 300;

/** The custom policy for `resource` (wildcards allowed) until `expiresAt` (epoch seconds). */
export function cloudFrontPolicy(resource: string, expiresAt: number): string {
  // Key order and the absence of whitespace are part of what CloudFront reads.
  return JSON.stringify({
    Statement: [{ Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": expiresAt } } }],
  });
}

/** CloudFront's URL-safe base64: three substitutions, no percent-encoding. */
export function cloudFrontBase64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/=/g, "_").replace(/\//g, "~");
}

/** The moment a signature made now should expire: `ttlSeconds` on, rounded up to the grid. */
export function quantisedExpiry(nowMs: number, ttlSeconds: number): number {
  const nowSeconds = Math.floor(nowMs / 1000);
  return Math.ceil((nowSeconds + ttlSeconds) / EXPIRY_STEP_SECONDS) * EXPIRY_STEP_SECONDS;
}

export type SignedQuery = {
  readonly query: string;
  readonly expiresAt: number;
};

/** The query string that lets `resource` be fetched until `expiresAt`. */
export function signCloudFrontResource(signer: CloudFrontSigner, resource: string, expiresAt: number): SignedQuery {
  const policy = cloudFrontPolicy(resource, expiresAt);
  const sign = createSign(signer.algorithm === "sha256" ? "RSA-SHA256" : "RSA-SHA1");
  sign.update(policy, "utf8");
  sign.end();
  const signature = sign.sign(signer.privateKey);
  const parts = [
    `Policy=${cloudFrontBase64(Buffer.from(policy, "utf8"))}`,
    `Signature=${cloudFrontBase64(signature)}`,
    `Key-Pair-Id=${encodeURIComponent(signer.keyPairId)}`,
  ];
  if (signer.algorithm === "sha256") parts.push("Hash-Algorithm=SHA256");
  return { query: parts.join("&"), expiresAt };
}

/**
 * A signed address for one file of a lesson folder: the file's address with
 * the folder's signature. `folder` and `file` are already-safe path pieces
 * (the route checked them character by character).
 */
export function signedLessonFileUrl(
  signer: CloudFrontSigner,
  origin: string,
  folder: string,
  file: string,
  expiresAt: number,
): string {
  const { query } = signCloudFrontResource(signer, `${origin}/${folder}/*`, expiresAt);
  return `${origin}/${folder}/${file}?${query}`;
}
