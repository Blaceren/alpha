/**
 * LESSON MEDIA (2026-10-02) — the video a lesson plays, read at request time.
 *
 * ============================ WHY THIS EXISTS ============================
 * A lesson's video used to have one possible home: a `ContentAsset` row of the
 * lesson's content version, carrying an absolute URL. A content version is
 * immutable once its curriculum is published, and a video is not — it is
 * produced after the lesson is written, re-cut, re-encoded and moved between
 * storages, and none of that changes what the lesson teaches. With only the
 * immutable home, attaching a video to a published lesson meant publishing a
 * new curriculum version and moving every learner to it.
 *
 * `LessonMediaAsset` is the operational home. One current file per
 * (curriculum, level stable code, asset code), replaced in place by
 * `scripts/ops/registerLessonMedia.ts`, and merged into the lesson here.
 *
 * ========================= WHAT THE LEARNER GETS =========================
 * The same `assets` array as before. A registry row becomes one entry in it,
 * indistinguishable in shape from a content asset, so no reader needs a second
 * code path. For a KIND the registry carries, the content version's own assets
 * of that kind are left out: the registry is the current truth for what it
 * holds, and two videos on one lesson would leave the player to guess.
 *
 * ============================= THE ADDRESS =============================
 * `storageKey` is a path under the deployment's media root, and the address
 * handed to the learner is `LESSON_MEDIA_PUBLIC_PREFIX/<storageKey>` — a path on
 * the Academy's own origin, never a host name. Where the bytes are actually
 * served from is the deployment's business: a directory on PREPROD, signed
 * delivery on PROD. No environment's host is ever stored in a row or built
 * here.
 *
 * The file name inside the key is its own SHA-256 prefix (see the registration
 * script), so an address cannot be guessed from a level number and a replaced
 * file gets a new address rather than a stale cache.
 *
 * ACCESS is decided before this module is reached: `resolveUserLevelContent`
 * returns a lesson only to a learner who may read that level, and the media
 * rows travel inside that answer and nowhere else.
 */
import type { ContentAssetKind, Prisma } from "@prisma/client";

/** The path prefix the Academy serves lesson media under. */
export const LESSON_MEDIA_PUBLIC_PREFIX = "/media";

/** Kinds the registry may hold. A lesson attachment or chart stays a content asset. */
export const LESSON_MEDIA_KINDS = ["video", "subtitles", "image"] as const satisfies readonly ContentAssetKind[];

export type LessonMediaEntry = {
  kind: ContentAssetKind;
  assetCode: string;
  locale: string | null;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  checksum: string | null;
  sortOrder: number;
};

type MediaReader = Pick<Prisma.TransactionClient, "lessonMediaAsset">;

/** `storageKey` → the address a learner's browser asks for. */
export function lessonMediaUrl(storageKey: string): string {
  return `${LESSON_MEDIA_PUBLIC_PREFIX}/${storageKey}`;
}

/**
 * The registry's current files for one lesson, for one locale.
 *
 * Locale-neutral rows plus the requested locale, the same rule the content
 * assets follow. Ordered video → image → subtitles so the entries are stable
 * between requests; `sortOrder` continues after the content version's own
 * assets (`sortOrderFrom`), which keeps every `sortOrder` in the answer unique.
 */
export async function loadLessonMedia(
  db: MediaReader,
  input: { curriculumCode: string; levelStableCode: string; locale: string; sortOrderFrom: number },
): Promise<LessonMediaEntry[]> {
  const rows = await db.lessonMediaAsset.findMany({
    where: {
      curriculumCode: input.curriculumCode,
      levelStableCode: input.levelStableCode,
      OR: [{ locale: null }, { locale: input.locale }],
    },
    orderBy: [{ assetCode: "asc" }, { id: "asc" }],
  });
  const kindOrder: Record<string, number> = { video: 0, image: 1, subtitles: 2 };
  return rows
    .filter((row) => (LESSON_MEDIA_KINDS as readonly string[]).includes(row.kind))
    .sort((left, right) => (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9))
    .map((row, index) => ({
      kind: row.kind,
      assetCode: row.assetCode,
      locale: row.locale,
      url: lessonMediaUrl(row.storageKey),
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      durationSeconds: row.durationSeconds,
      checksum: row.checksum,
      sortOrder: input.sortOrderFrom + index,
    }));
}

/**
 * The lesson's assets as the learner receives them: the content version's own,
 * minus every kind the registry carries, plus the registry's.
 */
export function mergeLessonMedia<T extends { kind: string }>(
  contentAssets: readonly T[],
  media: readonly LessonMediaEntry[],
): Array<T | LessonMediaEntry> {
  const registryKinds = new Set(media.map((entry) => entry.kind as string));
  return [...contentAssets.filter((asset) => !registryKinds.has(asset.kind)), ...media];
}

/** The duration the lesson's video actually has: the registry's when it holds one. */
export function effectiveVideoDurationSeconds(
  contentVideoDurationSeconds: number | null,
  media: readonly LessonMediaEntry[],
): number | null {
  const video = media.find((entry) => entry.kind === "video");
  return video?.durationSeconds ?? contentVideoDurationSeconds;
}
