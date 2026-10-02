"use client";

/**
 * The production lesson media surface (L2START-PLAYER-1).
 *
 * This is the ONLY place the real lesson page reaches the video player, and it
 * is deliberately the whole boundary between the two:
 *
 *   published lesson asset -> AcademyLessonMedia -> AcademyVideoPlayer
 *
 * WHAT IT DELIBERATELY DOES NOT IMPORT
 * Nothing from the QA board that used to live at `src/app/showcase/**`. It
 * existed so a human could point
 * the player at a file on their own machine while judging it; that produces a
 * `blob:` URL which lives only in one browser tab and would be a broken lesson
 * for everyone else. There is no file input here, no object URL, no upload, and
 * `src` can only ever be an address the Backend published: an https URL, or a
 * path under `/media/` on the Academy's own origin (`backend-dto.ts`).
 *
 * THE PLAYER IS NOT A PROGRESS OWNER
 * No playback callback is wired to anything. Playing, pausing, seeking,
 * finishing, replaying and failing all leave curriculum progress exactly as it
 * was — the level's own owner (a test, the learner's declaration, a report)
 * remains the only thing that completes it. If a durable "watched the video"
 * contract is ever approved, it gets its own owner on the Backend; it does not
 * get bolted onto an `onEnded` handler here.
 *
 * THE ONE THING IT LISTENS TO (2026-10-02)
 * A test's разбор may ask to rewatch from a second (`lesson-playback.ts`). The
 * player is brought into view and plays from there. That is navigation inside
 * a video, not progress.
 */
import { useEffect, useRef } from "react";
import {
  AcademyVideoPlayer,
  type AcademyVideoPlayerHandle,
} from "@/components/media/academy-video-player";
import type { AcademyLessonMedia } from "@/lib/curriculum/academy-view";
import { subscribeLessonRewatch } from "@/features/lesson-media/lesson-playback";
import "@/features/lesson-media/lesson-media.css";

export function LessonMedia({
  media,
  title,
  endedAction,
}: {
  media: AcademyLessonMedia | null;
  title: string;
  /** Where the lesson goes once the video has been watched to the end. */
  endedAction?: { label: string; href: string };
}) {
  const player = useRef<AcademyVideoPlayerHandle | null>(null);
  const hasMedia = media !== null;

  useEffect(() => {
    if (!hasMedia) return;
    return subscribeLessonRewatch(({ seconds }) => {
      player.current?.reveal();
      player.current?.seekTo(seconds, { play: true });
    });
  }, [hasMedia]);

  // A lesson without a video renders nothing at all here. The page says what is
  // happening in words; a disabled player frame would only imply a video exists
  // and is broken.
  if (!media) return null;

  return (
    <div className="lesson-media" data-media="ready">
      <AcademyVideoPlayer
        ref={player}
        src={media.src}
        poster={media.poster ?? undefined}
        title={title}
        endedAction={endedAction}
        captions={media.captions.map((track) => ({
          src: track.src,
          srcLang: track.srcLang,
          label: track.label,
        }))}
      />
    </div>
  );
}
