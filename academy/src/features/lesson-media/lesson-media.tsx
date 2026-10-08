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

/**
 * The lesson line's points: one per second of the video, not one per question.
 *
 * Two questions whose answers are taught at the same second share a point —
 * three dots on one spot would hide each other and their numbers. The shared
 * point says «2–4» and names every question in its description; it reads
 * «неверно» when any of them was answered wrongly, «верно» only when all were.
 */
export function lessonLineMarkers(
  markers: ReadonlyArray<{ questionNumber: number; seconds: number }>,
  verdicts: LessonVerdicts | null,
): { points: AcademyVideoMarker[]; pointOf: ReadonlyMap<number, string> } {
  const bySecond = new Map<number, number[]>();
  for (const marker of markers) {
    const numbers = bySecond.get(marker.seconds);
    if (numbers) numbers.push(marker.questionNumber);
    else bySecond.set(marker.seconds, [marker.questionNumber]);
  }
  const points: AcademyVideoMarker[] = [];
  const pointOf = new Map<number, string>();
  for (const [seconds, numbers] of bySecond) {
    numbers.sort((a, b) => a - b);
    const id = `q${numbers[0]}`;
    const said = numbers.map((n) => verdicts?.get(n));
    const state = said.some((v) => v === "wrong")
      ? "wrong"
      : said.length > 0 && said.every((v) => v === "right")
        ? "right"
        : "neutral";
    const verdictWord = state === "right" ? " · верно" : state === "wrong" ? " · неверно" : "";
    const consecutive = numbers.every((n, i) => i === 0 || n === numbers[i - 1]! + 1);
    const label =
      numbers.length === 1 ? String(numbers[0]) : consecutive ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(",");
    const description =
      numbers.length === 1
        ? `Вопрос ${numbers[0]}${verdictWord} · ответ объясняют с ${formatTimecode(seconds)}`
        : `Вопросы ${numbers.join(", ")}${verdictWord} · ответы объясняют с ${formatTimecode(seconds)}`;
    points.push({ id, seconds, label, description, state });
    for (const n of numbers) pointOf.set(n, id);
  }
  return { points, pointOf };
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
  const line = useMemo(() => lessonLineMarkers(media?.markers ?? [], verdicts), [media, verdicts]);
  const pointOfRef = useRef(line.pointOf);
  useEffect(() => {
    pointOfRef.current = line.pointOf;
  }, [line]);

  useEffect(() => {
    if (!hasMedia) return;
    return subscribeLessonRewatch(({ seconds, questionNumber, from }) => {
      player.current?.playFrom(seconds, {
        markerId: questionNumber === undefined ? undefined : pointOfRef.current.get(questionNumber),
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
        markers={line.points}
        resumeFrom={reading && reading.positionSeconds > 0 ? reading.positionSeconds : null}
        dockable
        crossOrigin={media.crossOrigin}
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
