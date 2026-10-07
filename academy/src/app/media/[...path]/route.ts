import fs from "node:fs";
import { Readable } from "node:stream";
import {
  locateLessonMediaFile,
  parseLessonMediaPath,
  parseRangeHeader,
  resolveMediaRoot,
} from "@/server/media/lesson-media-file";
import { resolveLessonMediaAccess } from "@/server/media/lesson-media-access";
import { quantisedExpiry, signedLessonFileUrl } from "@/server/media/cloudfront-signing";
import { mediaDelivery } from "@/server/media/delivery";

/**
 * `/media/lessons/<level>/<file>` — a lesson's video, poster or captions.
 *
 * The address is the one the Backend's lesson media registry hands to a lesson
 * (see `server/media/lesson-media-file.ts` for why the Academy serves it). The
 * order of the checks is the order of what they cost and what they reveal:
 * the name, the permission, and only then the disk. A request that fails any of
 * them gets the same answer — not found — so the route says nothing about which
 * lessons have video to someone who may not watch them.
 *
 * ON THE CDN (2026-10-07, `ATA_MEDIA_DELIVERY=cdn`) the same address, after
 * the same two checks, answers a redirect to the file's SIGNED CloudFront
 * address instead of streaming it: the lesson row keeps its address, the
 * Backend keeps the one rule, and the bytes come from the edge. A player
 * follows the redirect for every range it asks for, so the signature is for the
 * lesson's folder and expires on a grid — one playback, one address.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

async function serve(
  request: Request,
  params: Promise<{ path?: string[] }>,
  headOnly: boolean,
): Promise<Response> {
  const delivery = mediaDelivery();
  const root = delivery.mode === "local" ? resolveMediaRoot() : null;
  if (delivery.mode === "local" && !root) return NOT_FOUND();

  const target = parseLessonMediaPath((await params).path);
  if (!target) return NOT_FOUND();

  if ((await resolveLessonMediaAccess(target.levelStableCode)) !== "allowed") return NOT_FOUND();

  if (delivery.mode === "cdn") {
    if (delivery.lessons.kind === "unconfigured") return NOT_FOUND();
    const folder = `lessons/${target.levelStableCode}`;
    const file = target.storageKey.slice(folder.length + 1);
    const location =
      delivery.lessons.kind === "signed"
        ? signedLessonFileUrl(
            delivery.lessons.signer,
            delivery.origin,
            folder,
            file,
            quantisedExpiry(Date.now(), delivery.lessons.ttlSeconds),
          )
        : `${delivery.origin}/${target.storageKey}`;
    return new Response(null, {
      status: 302,
      headers: {
        location,
        /* Decided for this learner, for this moment: never kept by anyone. */
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }

  const located = await locateLessonMediaFile(root as string, target);
  if (!located) return NOT_FOUND();

  const headers = new Headers({
    "content-type": target.contentType,
    "accept-ranges": "bytes",
    /* The name is the file's own hash, so the bytes behind an address never
       change; `private` because the answer was decided for this learner. */
    "cache-control": "private, max-age=3600",
    "content-disposition": "inline",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin",
  });

  const range = parseRangeHeader(request.headers.get("range"), located.size);
  if (range.kind === "unsatisfiable") {
    headers.set("content-range", `bytes */${located.size}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : located.size - 1;
  headers.set("content-length", String(end - start + 1));
  if (range.kind === "partial") {
    headers.set("content-range", `bytes ${start}-${end}/${located.size}`);
  }
  const status = range.kind === "partial" ? 206 : 200;
  if (headOnly) return new Response(null, { status, headers });

  const stream = fs.createReadStream(located.file, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}

export function GET(request: Request, context: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  return serve(request, context.params, false);
}

export function HEAD(request: Request, context: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  return serve(request, context.params, true);
}
