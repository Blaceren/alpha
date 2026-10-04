import fs from "node:fs";
import { Readable } from "node:stream";
import { parseRangeHeader } from "@/server/media/lesson-media-file";
import { locatePublicFilmFile } from "@/server/media/public-film";

/**
 * `/film/<name>` — the public home's film, its poster and its captions
 * (2026-10-04). Public by design: it is the first thing a visitor may watch.
 * Only the fixed names in `public-film.ts` are served, from one folder of the
 * media directory, with byte ranges so a player can seek; every other request
 * is not found.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_FOUND = () =>
  new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

async function serve(request: Request, params: Promise<{ name?: string }>, headOnly: boolean): Promise<Response> {
  const name = (await params).name ?? "";
  const located = await locatePublicFilmFile(name);
  if (!located) return NOT_FOUND();

  const headers = new Headers({
    "content-type": located.contentType,
    "accept-ranges": "bytes",
    // The page addresses the file with its time, so a new cut gets a new address.
    "cache-control": "public, max-age=3600",
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
  if (range.kind === "partial") headers.set("content-range", `bytes ${start}-${end}/${located.size}`);
  const status = range.kind === "partial" ? 206 : 200;
  if (headOnly) return new Response(null, { status, headers });

  const stream = fs.createReadStream(located.file, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
}

export function GET(request: Request, context: { params: Promise<{ name?: string }> }): Promise<Response> {
  return serve(request, context.params, false);
}

export function HEAD(request: Request, context: { params: Promise<{ name?: string }> }): Promise<Response> {
  return serve(request, context.params, true);
}
