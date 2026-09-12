"use client";

import { formatDuration } from "@/features/lesson/model/lesson";
import type { MediaState } from "@/features/lesson/model/lesson-progress";
import type { LessonAction } from "@/features/lesson/hooks/use-lesson-experience";

/**
 * Player controls (Phase D2B).
 *
 * Native semantics only: real <button>s and a real <input type="range"> for the
 * timeline, so Space/Enter, arrow keys, Home/End and screen-reader value
 * reporting all work without custom hotkeys that would fight the browser.
 *
 * The timeline is the PLAYHEAD, not the watch gate: scrubbing it moves position
 * without crediting progress (see lesson-progress.ts).
 */
export function LessonMediaControls({
  media,
  captionsAvailable,
  dispatch,
}: {
  media: MediaState;
  captionsAvailable: boolean;
  dispatch: (a: LessonAction) => void;
}) {
  const playing = media.playback === "playing";

  return (
    <div className="lmc">
      {/* The visible word IS the accessible name (WCAG 2.5.3): no aria-label
          overriding it, and the text is never hidden at narrow widths. */}
      <button type="button" className="lmc-play" onClick={() => dispatch({ type: "toggle-play" })}>
        <span className="lmc-glyph" aria-hidden="true">
          {playing ? "❚❚" : "▶"}
        </span>
        <span className="lmc-playtext">{playing ? "Пауза" : "Смотреть"}</span>
      </button>

      <label className="lmc-seek">
        <span className="sr-only">Позиция видео</span>
        <input
          type="range"
          min={0}
          max={media.durationSeconds}
          step={1}
          value={Math.floor(media.currentPosition)}
          onChange={(e) => dispatch({ type: "seek", position: Number(e.target.value) })}
          aria-valuetext={`${formatDuration(media.currentPosition)} из ${formatDuration(media.durationSeconds)}`}
        />
      </label>

      <p className="lmc-time">
        <span className="lmc-now">{formatDuration(media.currentPosition)}</span>
        <span aria-hidden="true"> / </span>
        <span className="sr-only">из</span>
        <span className="lmc-dur">{formatDuration(media.durationSeconds)}</span>
      </p>

      {/* Words, not emoji: the volume glyph rendered differently per platform and
          read as "muted" even when it was not (D2B visual QA, finding 15). */}
      <button
        type="button"
        className="lmc-tog"
        onClick={() => dispatch({ type: "toggle-muted" })}
        aria-pressed={media.muted}
      >
        {media.muted ? "Без звука" : "Звук"}
      </button>

      {captionsAvailable && (
        <button
          type="button"
          className="lmc-tog lmc-cc"
          onClick={() => dispatch({ type: "toggle-captions" })}
          aria-pressed={media.captionsOn}
        >
          Субтитры
        </button>
      )}
    </div>
  );
}
