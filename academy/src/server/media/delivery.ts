/**
 * MEDIA DELIVERY (2026-10-07) — where a lesson's video and the public film are
 * served from (SERVER-ONLY).
 *
 * Two deployments, one set of addresses. A lesson row names its files as
 * `/media/lessons/<level>/<file>` and the film is `/film/<name>`, on the
 * Academy's own origin — nothing in a row knows a host. What answers those
 * addresses is this deployment's business:
 *
 *   local   the files are a directory on this host (`ATA_MEDIA_ROOT`); the
 *           routes read them and stream the bytes — PREPROD until now;
 *   cdn     the files are on Amazon S3 behind CloudFront (owner 2026-10-07:
 *           «подготовь продукт к работе с amazon cdn видео уроков и на главной
 *           лежат на нем»); the lesson route answers a learner the Backend
 *           admits with a redirect to a SIGNED CloudFront address, the film is
 *           a plain CloudFront address, and the Academy streams nothing.
 *
 * Keys, from the deployment's environment (academy.env):
 *
 *   ATA_MEDIA_DELIVERY                local (default) | cdn
 *   ATA_MEDIA_CDN_ORIGIN              https://dxxxxxxxx.cloudfront.net or the video host — no path, no slash
 *   ATA_MEDIA_CDN_KEY_PAIR_ID         the CloudFront public key id of the key group (K…)
 *   ATA_MEDIA_CDN_PRIVATE_KEY_FILE    the matching private key, PEM, readable by the service user only
 *   ATA_MEDIA_CDN_URL_TTL_SECONDS     how long a lesson link stays valid (default 21600 = 6 h)
 *   ATA_MEDIA_CDN_SIGNATURE           sha1 (CloudFront's default) | sha256
 *   ATA_MEDIA_CDN_LESSONS_PUBLIC      true ONLY while the distribution has no key group yet:
 *                                     lessons are then plain CloudFront addresses, guarded by nothing
 *                                     but their unguessable names. Never on PROD.
 *
 * FAIL CLOSED, ON THE LESSON SIDE. `cdn` without a usable key (and without the
 * explicit public flag) serves no lesson media at all — a learner gets «not
 * found», never a link that is open to the world. The film has no gate and
 * is simply public on the CDN.
 */
import { createPrivateKey, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CloudFrontSignatureAlgorithm, CloudFrontSigner } from "./cloudfront-signing";

export const DEFAULT_URL_TTL_SECONDS = 6 * 60 * 60;
const MIN_URL_TTL_SECONDS = 60;
const MAX_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export type LessonDelivery =
  | { readonly kind: "signed"; readonly signer: CloudFrontSigner; readonly ttlSeconds: number }
  | { readonly kind: "public" }
  /** `cdn` named, but no key and no explicit public flag: lessons are not served. */
  | { readonly kind: "unconfigured"; readonly reason: string };

export type MediaDelivery =
  | { readonly mode: "local" }
  | { readonly mode: "cdn"; readonly origin: string; readonly lessons: LessonDelivery };

type Env = Record<string, string | undefined>;

/** `https://host[:port]` — a scheme and a host, nothing after them. */
export function parseCdnOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || url.username || url.password) return null;
  return url.origin;
}

function parseTtl(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_URL_TTL_SECONDS;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < MIN_URL_TTL_SECONDS || seconds > MAX_URL_TTL_SECONDS) {
    return DEFAULT_URL_TTL_SECONDS;
  }
  return seconds;
}

function parseAlgorithm(raw: string | undefined): CloudFrontSignatureAlgorithm {
  return raw?.trim().toLowerCase() === "sha256" ? "sha256" : "sha1";
}

/** The key pair id CloudFront prints for a public key: letters and digits. */
const KEY_PAIR_ID = /^[A-Z0-9]{8,32}$/;

export type PrivateKeyReader = (file: string) => KeyObject;

/** Read a PEM private key from disk. Exported for the one place that stubs it (tests). */
export const readPrivateKeyFile: PrivateKeyReader = (file) =>
  createPrivateKey({ key: fs.readFileSync(file, "utf8"), format: "pem" });

function lessonDelivery(env: Env, readKey: PrivateKeyReader): LessonDelivery {
  if (env.ATA_MEDIA_CDN_LESSONS_PUBLIC?.trim() === "true") return { kind: "public" };
  const keyPairId = env.ATA_MEDIA_CDN_KEY_PAIR_ID?.trim() ?? "";
  const keyFile = env.ATA_MEDIA_CDN_PRIVATE_KEY_FILE?.trim() ?? "";
  if (!KEY_PAIR_ID.test(keyPairId)) return { kind: "unconfigured", reason: "ATA_MEDIA_CDN_KEY_PAIR_ID is not a key pair id" };
  if (!keyFile || !path.isAbsolute(keyFile)) return { kind: "unconfigured", reason: "ATA_MEDIA_CDN_PRIVATE_KEY_FILE is not an absolute path" };
  let privateKey: KeyObject;
  try {
    privateKey = readKey(keyFile);
  } catch {
    return { kind: "unconfigured", reason: "ATA_MEDIA_CDN_PRIVATE_KEY_FILE could not be read as a PEM private key" };
  }
  if (privateKey.asymmetricKeyType !== "rsa") return { kind: "unconfigured", reason: "the private key is not RSA" };
  return {
    kind: "signed",
    signer: { keyPairId, privateKey, algorithm: parseAlgorithm(env.ATA_MEDIA_CDN_SIGNATURE) },
    ttlSeconds: parseTtl(env.ATA_MEDIA_CDN_URL_TTL_SECONDS),
  };
}

/**
 * The delivery this environment describes. Pure apart from reading the key
 * file; the value is never cached here, so a test can describe any deployment.
 */
export function resolveMediaDelivery(env: Env, readKey: PrivateKeyReader = readPrivateKeyFile): MediaDelivery {
  const mode = env.ATA_MEDIA_DELIVERY?.trim().toLowerCase() ?? "local";
  if (mode !== "cdn") return { mode: "local" };
  const origin = parseCdnOrigin(env.ATA_MEDIA_CDN_ORIGIN);
  if (!origin) {
    console.error("[media] ATA_MEDIA_DELIVERY=cdn but ATA_MEDIA_CDN_ORIGIN is not an origin; media stays on this host");
    return { mode: "local" };
  }
  const lessons = lessonDelivery(env, readKey);
  if (lessons.kind === "unconfigured") {
    console.error(`[media] ATA_MEDIA_DELIVERY=cdn: lessons are not served — ${lessons.reason}`);
  }
  return { mode: "cdn", origin, lessons };
}

let cached: MediaDelivery | null = null;

/** The deployment's delivery, read once from the process environment. */
export function mediaDelivery(): MediaDelivery {
  if (cached === null) cached = resolveMediaDelivery(process.env);
  return cached;
}

/** Test seam: forget the cached delivery. */
export function resetMediaDeliveryForTests(): void {
  cached = null;
}

/** The folder of the public film on the CDN — the same path as under the media root. */
export const PUBLIC_FILM_CDN_FOLDER = "public/film";

/** Whether a browser loads this deployment's media from another origin (so a `<video>` needs `crossorigin`). */
export function mediaIsCrossOrigin(delivery: MediaDelivery = mediaDelivery()): boolean {
  return delivery.mode === "cdn";
}
