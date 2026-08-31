"use client";

/**
 * The production lesson media surface (L2START-PLAYER-1).
 *
 * This is the ONLY place the real lesson page reaches the video player, and it
 * is deliberately the whole boundary between the two:
 *
 *   published content asset -> AcademyLessonMedia -> AcademyVideoPlayer
 *
 * WHAT IT DELIBERATELY DOES NOT IMPORT
 * Nothing from the QA board that used to live at `src/app/showcase/**`. It
 * existed so a human could point
 * the player at a file on their own machine while judging it; that produces a
 * `blob:` URL which lives only in one browser tab and would be a broken lesson
 * for everyone else. There is no file input here, no object URL, no upload, and
 * `src` can only ever be an https URL the Backend published.
 *
 * THE PLAYER IS NOT A PROGRESS OWNER
 * No playback callback is wired to anything. Playing, pausing, seeking,
 * finishing, replaying and failing all leave curriculum progress exactly as it
 * was — the L2 assessment remains the level's only completion owner. If a
 * durable "watched the video" contract is ever approved, it gets its own owner
 * on the Backend; it does not get bolted onto an `onEnded` handler here.
 *
 * `demoPoster` is left false so a lesson with no published poster shows a plain
 * frame rather than a synthetic branded graphic.
 */
import { AcademyVideoPlayer } from "@/components/media/academy-video-player";
import type { AcademyLessonMedia } from "@/lib/curriculum/academy-view";
import "@/features/lesson-media/lesson-media.css";

export function LessonMedia({
  media,
  title,
}: {
  media: AcademyLessonMedia | null;
  title: string;
}) {
  // A text-only lesson renders nothing at all here. The page's existing
  // media-pending line says what is happening; a disabled player frame would
  // only imply a video exists and is broken.
  if (!media) return null;

  return (
    <div className="lesson-media" data-media="ready">
      <AcademyVideoPlayer
        src={media.src}
        poster={media.poster ?? undefined}
        title={title}
        captions={media.captions.map((track) => ({
          src: track.src,
          srcLang: track.srcLang,
          label: track.label,
        }))}
      />
    </div>
  );
}
