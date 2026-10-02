"use client";

/**
 * The production lesson media surface (L2START-PLAYER-1; lesson hi-fi, DD-336).
 *
 * This is the ONLY place the real lesson page reaches the video player, and it
 * is deliberately the whole boundary between the two:
 *
 *   published lesson asset -> AcademyLessonMedia -> AcademyVideoPlayer
 *
 * WHAT IT DELIBERATELY DOES NOT IMPORT
 * Nothing from the QA board that used to live at `src/app/showcase/**`. There is
 * no file input here, no object URL, no upload, and `src` can only ever be an
 * address the Backend published: an https URL, or a path under `/media/` on the
 * Academy's own origin (`backend-dto.ts`).
 *
 * THE PLAYER IS NOT A PROGRESS OWNER
 * Playing, pausing, seeking, finishing, replaying and failing complete nothing:
 * the level's own owner (a test, the learner's declaration, a report) remains
 * the only thing that completes it. What IS kept is where the learner stopped —
 * the reading position the Backend already owns on `UserLessonProgress` —
 * through the same lesson-progress command the reader uses, which writes that
 * row and nothing else and refuses unless the level is in progress. It is
 * offered back as «Продолжить с …».
 *
 * WHAT IT LISTENS TO (`lesson-playback.ts`)
 * A test's разбор asks to rewatch from a second: the player plays from there
 * where the learner is — docked, with the question kept in view. And the test
 * says how its last attempt went, so the points of the lesson line can say so.
 * That is navigation inside a video, not progress.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AcademyVideoPlayer,
  type AcademyVideoMarker,
  type AcademyVideoPlayerHandle,
} from "@/components/media/academy-video-player";
import type { AcademyLessonMedia } from "@/lib/curriculum/academy-view";
import { saveLessonReadingProgress } from "@/lib/curriculum/lesson-progress-client";
import { formatTimecode } from "@/lib/time/timecode";
import {
  subscribeLessonRewatch,
  subscribeLessonVerdicts,
  type LessonVerdicts,
} from "@/features/lesson-media/lesson-playback";
import "@/features/lesson-media/lesson-media.css";

/**
 * Where the learner stopped, and — only while the level is in progress — what
 * the next save of it must carry. `null` revision: nothing may be saved.
 */
export type LessonMediaReading = {
  positionSeconds: number;
  save: {
    revision: number;
    completedSections: readonly string[];
    activeSectionCode: string | null;
  } | null;
};

function markerDescription(questionNumber: number, seconds: number, verdict: "right" | "wrong" | undefined) {
  const said = verdict === "right" ? " · верно" : verdict === "wrong" ? " · неверно" : "";
  return `Вопрос ${questionNumber}${said} · ответ объясняют с ${formatTimecode(seconds)}`;
}

let saveSequence = 0;

export function LessonMedia({
  media,
  title,
  endedAction,
  levelCode,
  reading = null,
}: {
  media: AcademyLessonMedia | null;
  title: string;
  /** Where the lesson goes once the video has been watched to the end. */
  endedAction?: { label: string; href: string };
  /** The level this lesson belongs to: whose verdicts the line shows, where the position is saved. */
  levelCode?: string;
  /** Where the learner stopped last time, and whether it may be saved again. */
  reading?: LessonMediaReading | null;
}) {
  const player = useRef<AcademyVideoPlayerHandle | null>(null);
  const hasMedia = media !== null;
  const [verdicts, setVerdicts] = useState<LessonVerdicts | null>(null);

  useEffect(() => {
    if (!hasMedia) return;
    return subscribeLessonRewatch(({ seconds, questionNumber, from }) => {
      player.current?.playFrom(seconds, {
        markerId: questionNumber === undefined ? undefined : `q${questionNumber}`,
        keepInView: from ?? null,
      });
    });
  }, [hasMedia]);

  useEffect(() => {
    if (!hasMedia || !levelCode) return;
    return subscribeLessonVerdicts(levelCode, setVerdicts);
  }, [hasMedia, levelCode]);

  /* ------------------------------------------------- the reading position */
  const saveState = useRef({
    revision: reading?.save?.revision ?? 0,
    completedSections: reading?.save?.completedSections ?? [],
    activeSectionCode: reading?.save?.activeSectionCode ?? null,
    inFlight: false,
    next: null as number | null,
    stopped: reading?.save == null,
  });

  const savePosition = useCallback(
    async (seconds: number) => {
      const state = saveState.current;
      if (state.stopped || !levelCode) return;
      if (state.inFlight) {
        // One save at a time: the latest position waits for the one in flight.
        state.next = seconds;
        return;
      }
      state.inFlight = true;
      let position: number | null = seconds;
      while (position !== null && !state.stopped) {
        saveSequence += 1;
        const requestId = `lesson-position:${levelCode}:${Date.now()}:${saveSequence}`;
        const result = await saveLessonReadingProgress(
          levelCode,
          {
            expectedRevision: state.revision,
            completedSections: state.completedSections,
            activeSectionCode: state.activeSectionCode,
            playbackPositionSeconds: position,
          },
          requestId,
        );
        if (!result.ok) {
          // A save that did not land (the level was finished in another tab, a
          // stale revision, no network) stops the saving for this page: the
          // position stays what the Backend last accepted. Nothing is merged here.
          state.stopped = true;
          state.next = null;
          break;
        }
        state.revision = result.data.acceptedRevision;
        state.completedSections = result.data.completedSections;
        state.activeSectionCode = result.data.activeSectionCode;
        const next: number | null = state.next;
        state.next = null;
        position = next !== null && next !== position ? next : null;
      }
      state.inFlight = false;
    },
    [levelCode],
  );

  const playerMarkers = useMemo<AcademyVideoMarker[]>(
    () =>
      (media?.markers ?? []).map((marker) => {
        const verdict = verdicts?.get(marker.questionNumber);
        return {
          id: `q${marker.questionNumber}`,
          seconds: marker.seconds,
          label: String(marker.questionNumber),
          description: markerDescription(marker.questionNumber, marker.seconds, verdict),
          state: verdict ?? "neutral",
        };
      }),
    [media, verdicts],
  );

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
        markers={playerMarkers}
        resumeFrom={reading && reading.positionSeconds > 0 ? reading.positionSeconds : null}
        dockable
        onPositionSave={reading?.save && levelCode ? (seconds) => void savePosition(seconds) : undefined}
        captions={media.captions.map((track) => ({
          src: track.src,
          srcLang: track.srcLang,
          label: track.label,
        }))}
      />
    </div>
  );
}
