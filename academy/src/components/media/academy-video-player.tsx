"use client";

import {
  AlertTriangle,
  Captions,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import "./academy-video-player.css";

export interface AcademyVideoCaption {
  src: string;
  srcLang: string;
  label: string;
  default?: boolean;
}

export interface AcademyVideoPlayerProps {
  src: string;
  poster?: string;
  title: string;
  description?: string;
  captions?: AcademyVideoCaption[];
  autoPlay?: boolean;
  className?: string;
  /** "source" (default) adapts the frame to the file's real ratio; a string like "16 / 9" pins it. */
  aspectRatio?: "source" | string;
  /** How the frame is filled. "contain" (default) never distorts; "cover" crops to fill. */
  fit?: "contain" | "cover";
  /**
   * Showcase-only: render the synthetic branded pre-play graphic when no real
   * `poster` is supplied. Production lessons leave this false so a missing
   * poster shows a neutral frame, never a fake "Урок 18" placeholder.
   */
  demoPoster?: boolean;
  initialVolume?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onError?: (error: MediaError | null) => void;
}

const CONTROLS_HIDE_DELAY = 2400;
const SKIP_SECONDS = 10;
const SEEK_FEEDBACK_MS = 700;
const CLICK_DELAY_MS = 220;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isFiniteDuration(value: number) {
  return Number.isFinite(value) && value > 0;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    target.getAttribute("role") === "slider"
  );
}

/**
 * Self-contained "skip 10 seconds" glyph. The rotate arc reuses the exact
 * lucide RotateCcw/RotateCw geometry the rest of Academy uses; the "10" is drawn
 * as vector strokes (not SVG <text>) so it never depends on font loading, never
 * falls back to a system/monospace font, and shares the arc's line weight. The
 * digits are large and centred in the same 24-unit viewBox, so they read at the
 * real control size without zooming and scale with the button.
 */
function SkipTenIcon({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg
      className="avp__skip-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {direction === "back" ? (
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
      ) : (
        <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5" />
      )}
      {/* "10" as vector strokes — no <text>, no font dependency. */}
      <path d="M7.4 9.05 8.85 7.6V16.95M7.25 16.95h3.2" />
      <ellipse cx="14.15" cy="12.3" rx="2.75" ry="4.7" />
    </svg>
  );
}

export function AcademyVideoPlayer({
  src,
  poster,
  title,
  description,
  captions = [],
  autoPlay = false,
  className,
  aspectRatio = "source",
  fit = "contain",
  demoPoster = false,
  initialVolume = 0.8,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onError,
}: AcademyVideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const keyboardFocusRef = useRef(false);
  const startedRef = useRef(false);
  const scrubbingRef = useRef(false);
  const errorRef = useRef<MediaError | null>(null);
  const onErrorRef = useRef(onError);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoRatio, setVideoRatio] = useState<number | null>(null);
  const [volume, setVolume] = useState(() => clamp(initialVolume, 0, 1));
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [seekFeedback, setSeekFeedback] = useState<{
    dir: 1 | -1;
    id: number;
  } | null>(null);
  const [captionsOn, setCaptionsOn] = useState(
    () => captions.findIndex((caption) => caption.default) >= 0,
  );

  const seekable = isFiniteDuration(duration);

  // --- error lifecycle (stale-error safe) ---------------------------------
  const clearError = useCallback(() => {
    setFailed(false);
    setBuffering(false);
    if (errorRef.current !== null) {
      errorRef.current = null;
      setErrorCode(null);
      onErrorRef.current?.(null);
    }
  }, []);

  const reportError = useCallback((error: MediaError | null) => {
    errorRef.current = error;
    setFailed(true);
    setBuffering(false);
    setErrorCode(error ? error.code : null);
    onErrorRef.current?.(error);
  }, []);

  // Keep the latest onError callback without re-subscribing effects to it.
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const clearPlayWait = useCallback(() => {
    if (playWaitTimerRef.current) {
      clearTimeout(playWaitTimerRef.current);
      playWaitTimerRef.current = null;
    }
  }, []);

  // --- controls autohide --------------------------------------------------
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearHideTimer();
    if (!playing || scrubbingRef.current) return;
    hideTimerRef.current = setTimeout(() => {
      const focusInside = rootRef.current?.contains(document.activeElement);
      if (!(keyboardFocusRef.current && focusInside)) setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  }, [clearHideTimer, playing]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  useEffect(() => {
    if (playing) scheduleControlsHide();
    else clearHideTimer();
  }, [clearHideTimer, playing, scheduleControlsHide]);

  // --- fullscreen sync ----------------------------------------------------
  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // --- volume/mute reflection --------------------------------------------
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  // --- smooth progress while playing (single rAF loop, no leaks) ----------
  useEffect(() => {
    if (!playing) return;
    const step = () => {
      const video = videoRef.current;
      if (video && !scrubbingRef.current) setCurrentTime(video.currentTime);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing]);

  // --- unmount cleanup ----------------------------------------------------
  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (playWaitTimerRef.current) clearTimeout(playWaitTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const updateCaptionTracks = useCallback((enabled: boolean) => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (const track of Array.from(tracks)) {
      track.mode = enabled ? "showing" : "hidden";
    }
  }, []);

  // --- playback control ---------------------------------------------------
  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || failed) return;

    revealControls();
    if (playing) {
      video.pause();
      return;
    }

    if (video.ended) video.currentTime = 0;
    // Don't flash the spinner on an instant start: only reveal it if the
    // browser is still stalling a moment after the play request. This removes
    // the visible "jump" when play/pause is toggled on an already-buffered file.
    clearPlayWait();
    playWaitTimerRef.current = setTimeout(() => setBuffering(true), 320);
    try {
      await video.play();
    } catch {
      clearPlayWait();
      setBuffering(false);
    }
  }, [clearPlayWait, failed, playing, revealControls]);

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    clearError();
    setEnded(false);
    setCurrentTime(0);
    video.load();
  }, [clearError]);

  const seekTo = useCallback(
    (nextTime: number) => {
      const video = videoRef.current;
      if (!video || !seekable) return;
      const safeTime = clamp(nextTime, 0, duration);
      video.currentTime = safeTime;
      setCurrentTime(safeTime);
      setEnded(false);
    },
    [duration, seekable],
  );

  const showSeekFeedback = useCallback((dir: 1 | -1) => {
    setSeekFeedback({ dir, id: Date.now() });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(
      () => setSeekFeedback(null),
      SEEK_FEEDBACK_MS,
    );
  }, []);

  const skipBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video || !seekable) return;
      const safeTime = clamp(video.currentTime + delta, 0, duration);
      video.currentTime = safeTime;
      setCurrentTime(safeTime);
      setEnded(false);
      showSeekFeedback(delta < 0 ? -1 : 1);
      revealControls();
    },
    [duration, revealControls, seekable, showSeekFeedback],
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
    revealControls();
  }, [revealControls]);

  const changeVolume = useCallback(
    (nextVolume: number) => {
      const video = videoRef.current;
      if (!video) return;
      const safeVolume = clamp(nextVolume, 0, 1);
      video.volume = safeVolume;
      video.muted = safeVolume === 0;
      setVolume(safeVolume);
      setMuted(safeVolume === 0);
      revealControls();
    },
    [revealControls],
  );

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else {
        await root.requestFullscreen?.();
      }
    } catch {
      // Browsers can deny fullscreen without a user gesture; controls stay usable.
    }
  }, []);

  // --- timeline seek (pointer + touch) ------------------------------------
  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = timelineRef.current;
      const video = videoRef.current;
      if (!el || !video || !seekable) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const target = ratio * duration;
      video.currentTime = target;
      setCurrentTime(target);
      setEnded(false);
    },
    [duration, seekable],
  );

  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!seekable) return;
    event.preventDefault();
    scrubbingRef.current = true;
    setScrubbing(true);
    timelineRef.current?.setPointerCapture?.(event.pointerId);
    seekFromClientX(event.clientX);
    revealControls();
  };

  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    seekFromClientX(event.clientX);
  };

  const endScrub = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setScrubbing(false);
    timelineRef.current?.releasePointerCapture?.(event.pointerId);
    scheduleControlsHide();
  };

  const handleTimelineKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!seekable) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(currentTime - 5);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(currentTime + 5);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTo(duration);
    }
  };

  // --- surface click (play/pause) vs double-click (fullscreen) ------------
  const cancelPendingClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };

  const handleSurfaceClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (scrubbingRef.current) return;
    // The second click of a double-click arrives before the dblclick event, so
    // use it (not just onDoubleClick) to cancel the pending single-click action.
    if (event.detail > 1) {
      cancelPendingClick();
      return;
    }
    if (clickTimerRef.current) return;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      void togglePlay();
    }, CLICK_DELAY_MS);
  };

  const handleSurfaceDoubleClick = () => {
    cancelPendingClick();
    void toggleFullscreen();
  };

  const stopSurface = (
    event: SyntheticEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
  ) => {
    event.stopPropagation();
  };

  // --- keyboard shortcuts (only when the region itself is focused) --------
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    keyboardFocusRef.current = true;
    if (event.target !== event.currentTarget || isEditableTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === " " || key === "k") {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      skipBy(-SKIP_SECONDS);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      skipBy(SKIP_SECONDS);
    } else if (key === "m") {
      event.preventDefault();
      toggleMute();
    } else if (key === "f") {
      event.preventDefault();
      void toggleFullscreen();
    }
  };

  const handleBlurCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      keyboardFocusRef.current = false;
      scheduleControlsHide();
    }
  };

  const handleFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    keyboardFocusRef.current =
      event.target instanceof HTMLElement
        ? event.target.matches(":focus-visible")
        : false;
    revealControls();
  };

  const handlePointerActivity = () => {
    keyboardFocusRef.current = false;
    revealControls();
  };

  // --- native media events ------------------------------------------------
  const handlePlay = () => {
    startedRef.current = true;
    setStarted(true);
    setPlaying(true);
    setEnded(false);
    setBuffering(false);
    setHasFrame(true);
    clearPlayWait();
    clearError();
    setControlsVisible(true);
    scheduleControlsHide();
    onPlay?.();
  };

  const handlePause = () => {
    setPlaying(false);
    setBuffering(false);
    clearPlayWait();
    setControlsVisible(true);
    clearHideTimer();
    onPause?.();
  };

  const handleEnded = () => {
    setPlaying(false);
    setBuffering(false);
    clearPlayWait();
    setEnded(true);
    setControlsVisible(true);
    clearHideTimer();
    onEnded?.();
  };

  const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!scrubbingRef.current && !playing) setCurrentTime(video.currentTime);
    onTimeUpdate?.(video.currentTime, video.duration || duration);
  };

  const syncMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setDuration(isFiniteDuration(video.duration) ? video.duration : 0);
    if (!scrubbingRef.current) setCurrentTime(video.currentTime);
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoRatio(video.videoWidth / video.videoHeight);
    }
    clearError();
    updateCaptionTracks(captionsOn);
  };

  // Once the first frame is decodable the video layer can fade in over the
  // poster instead of snapping from a black box.
  const handleLoadedData = (event: SyntheticEvent<HTMLVideoElement>) => {
    setHasFrame(true);
    syncMetadata(event);
  };

  // Changing src makes the browser fire emptied + loadstart; both fully reset
  // the media state so a previous file's duration/time/error never lingers.
  const handleEmptied = () => {
    setPlaying(false);
    setStarted(false);
    startedRef.current = false;
    setEnded(false);
    setBuffering(false);
    setHasFrame(false);
    clearPlayWait();
    setDuration(0);
    setCurrentTime(0);
    setVideoRatio(null);
    clearError();
  };

  const handleLoadStart = () => {
    setEnded(false);
    setHasFrame(false);
    clearPlayWait();
    setDuration(0);
    setCurrentTime(0);
    setVideoRatio(null);
    clearError();
  };

  const handleError = (event: SyntheticEvent<HTMLVideoElement>) => {
    setPlaying(false);
    setBuffering(false);
    clearPlayWait();
    setControlsVisible(true);
    clearHideTimer();
    reportError(event.currentTarget.error);
  };

  const progress = seekable ? clamp((currentTime / duration) * 100, 0, 100) : 0;
  const isPortrait =
    aspectRatio === "source" && videoRatio !== null && videoRatio <= 1.05;
  const frameAspect =
    aspectRatio === "source"
      ? videoRatio && videoRatio > 0
        ? `${videoRatio}`
        : "16 / 9"
      : aspectRatio;

  const style = {
    "--avp-aspect-ratio": frameAspect,
    "--avp-progress": `${progress}%`,
    "--avp-fit": fit,
  } as CSSProperties;

  const errorDetail =
    errorCode === 2
      ? "Проблема с сетью. Проверьте соединение и попробуйте ещё раз."
      : errorCode === 3 || errorCode === 4
        ? "Формат или кодек видео не поддерживается этим браузером."
        : "Не удалось загрузить видео. Попробуйте ещё раз.";

  const showCenter = !failed && !buffering && !ended && (!playing || controlsVisible);
  const centerMainLabel = playing
    ? "Поставить на паузу"
    : started
      ? "Продолжить видео"
      : "Воспроизвести видео";

  return (
    <div
      ref={rootRef}
      className={cn(
        "avp",
        playing && "avp--playing",
        controlsVisible && "avp--controls-visible",
        scrubbing && "avp--scrubbing",
        isPortrait && "avp--tall",
        hasFrame && "avp--has-frame",
        failed && "avp--failed",
        className,
      )}
      style={style}
      role="region"
      aria-label={`Видеоплеер: ${title}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={handleSurfaceClick}
      onDoubleClick={handleSurfaceDoubleClick}
      onPointerMove={handlePointerActivity}
      onPointerDown={handlePointerActivity}
      onMouseEnter={revealControls}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      <video
        ref={videoRef}
        className="avp__video"
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        autoPlay={autoPlay}
        controls={false}
        onPlay={handlePlay}
        onPause={handlePause}
        onWaiting={() => startedRef.current && setBuffering(true)}
        onPlaying={() => {
          clearPlayWait();
          setBuffering(false);
          setHasFrame(true);
          clearError();
        }}
        onCanPlay={() => {
          clearPlayWait();
          setBuffering(false);
          clearError();
        }}
        onEmptied={handleEmptied}
        onLoadStart={handleLoadStart}
        onLoadedMetadata={syncMetadata}
        onLoadedData={handleLoadedData}
        onDurationChange={syncMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onError={handleError}
        data-testid="academy-video-element"
      >
        {captions.map((caption) => (
          <track
            key={`${caption.srcLang}-${caption.label}`}
            kind="captions"
            src={caption.src}
            srcLang={caption.srcLang}
            label={caption.label}
            default={caption.default}
          />
        ))}
      </video>

      {!started &&
        (poster ? (
          <div className="avp__poster avp__poster--image" aria-hidden="true">
            {/* Real lesson preview: filled like the video (contain by default)
                so it never crops or distorts. A plain <img> is intentional — the
                poster is a blob:/arbitrary background layer, not a layout-driving
                next/image candidate, and must accept object URLs without remote
                config. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="avp__poster-image" src={poster} alt="" />
          </div>
        ) : demoPoster ? (
          // Showcase-only branded graphic — never a production fallback.
          <div className="avp__poster" aria-hidden="true">
            <div className="avp__poster-grid" />
            <div className="avp__poster-route">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="avp__poster-copy">
              <span>Академия / Урок 18</span>
              <strong>{title}</strong>
              {description && <p>{description}</p>}
            </div>
          </div>
        ) : (
          // Production default with no poster: a neutral frame, no fake lesson.
          <div className="avp__poster avp__poster--plain" aria-hidden="true" />
        ))}

      <div className="avp__shade" aria-hidden="true" />

      {seekFeedback && (
        <div
          key={seekFeedback.id}
          className={cn(
            "avp__seek-feedback",
            seekFeedback.dir < 0
              ? "avp__seek-feedback--back"
              : "avp__seek-feedback--forward",
          )}
          aria-hidden="true"
        >
          <span>{seekFeedback.dir < 0 ? "−10 секунд" : "+10 секунд"}</span>
        </div>
      )}

      {showCenter && (
        <div className="avp__center" onClick={stopSurface} onDoubleClick={stopSurface}>
          <button
            type="button"
            className="avp__center-btn avp__center-btn--skip"
            onClick={() => skipBy(-SKIP_SECONDS)}
            disabled={!seekable}
            aria-label="Назад на 10 секунд"
            title="Назад 10 секунд"
          >
            <SkipTenIcon direction="back" />
          </button>
          <button
            type="button"
            className="avp__center-btn avp__center-btn--main"
            onClick={() => void togglePlay()}
            aria-label={centerMainLabel}
          >
            {playing ? (
              <Pause aria-hidden="true" fill="currentColor" />
            ) : (
              <Play aria-hidden="true" fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className="avp__center-btn avp__center-btn--skip"
            onClick={() => skipBy(SKIP_SECONDS)}
            disabled={!seekable}
            aria-label="Вперёд на 10 секунд"
            title="Вперёд 10 секунд"
          >
            <SkipTenIcon direction="forward" />
          </button>
        </div>
      )}

      {buffering && !failed && (
        <div className="avp__state avp__state--loading" role="status">
          <LoaderCircle className="avp__spinner" aria-hidden="true" />
          <span>Загружаем видео</span>
        </div>
      )}

      {failed && (
        <div
          className="avp__state avp__state--error"
          role="alert"
          onClick={stopSurface}
          onDoubleClick={stopSurface}
        >
          <span className="avp__state-icon">
            <AlertTriangle aria-hidden="true" />
          </span>
          <div>
            <strong>Видео не загрузилось</strong>
            <span>{errorDetail}</span>
          </div>
          <button type="button" onClick={retry}>
            Повторить
          </button>
        </div>
      )}

      {ended && !failed && (
        <div
          className="avp__state avp__state--ended"
          role="status"
          onClick={stopSurface}
          onDoubleClick={stopSurface}
        >
          <span className="avp__eyebrow">Урок просмотрен</span>
          <strong>{title}</strong>
          <button type="button" onClick={() => void togglePlay()}>
            <RotateCcw aria-hidden="true" />
            Смотреть снова
          </button>
        </div>
      )}

      {!failed && (
        <div
          className="avp__controls"
          onClick={stopSurface}
          onDoubleClick={stopSurface}
        >
          <div
            ref={timelineRef}
            className="avp__timeline"
            role="slider"
            tabIndex={0}
            aria-label="Позиция видео"
            aria-valuemin={0}
            aria-valuemax={seekable ? Math.round(duration) : 0}
            aria-valuenow={seekable ? Math.round(currentTime) : 0}
            aria-valuetext={`${formatTime(currentTime)} из ${formatTime(duration)}`}
            aria-disabled={!seekable}
            onPointerDown={handleTimelinePointerDown}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onKeyDown={handleTimelineKeyDown}
          >
            <div className="avp__timeline-track">
              <div className="avp__timeline-fill" />
              <div className="avp__timeline-thumb" />
            </div>
          </div>

          <div className="avp__control-row">
            <div className="avp__control-group">
              <button
                type="button"
                className="avp__icon-button"
                onClick={() => skipBy(-SKIP_SECONDS)}
                disabled={!seekable}
                aria-label="Назад на 10 секунд"
                title="Назад 10 секунд"
              >
                <SkipTenIcon direction="back" />
              </button>
              <button
                type="button"
                className="avp__icon-button avp__icon-button--primary"
                onClick={() => void togglePlay()}
                aria-label={playing ? "Пауза" : "Воспроизвести"}
              >
                {playing ? (
                  <Pause aria-hidden="true" fill="currentColor" />
                ) : (
                  <Play aria-hidden="true" fill="currentColor" />
                )}
              </button>
              <button
                type="button"
                className="avp__icon-button"
                onClick={() => skipBy(SKIP_SECONDS)}
                disabled={!seekable}
                aria-label="Вперёд на 10 секунд"
                title="Вперёд 10 секунд"
              >
                <SkipTenIcon direction="forward" />
              </button>
              <p
                className="avp__time"
                aria-label={`${formatTime(currentTime)} из ${formatTime(duration)}`}
              >
                <span>{formatTime(currentTime)}</span>
                <span aria-hidden="true">/</span>
                <span>{formatTime(duration)}</span>
              </p>
            </div>

            <div className="avp__control-group avp__control-group--right">
              <div className="avp__volume">
                <button
                  type="button"
                  className="avp__icon-button"
                  onClick={toggleMute}
                  aria-label={muted || volume === 0 ? "Включить звук" : "Выключить звук"}
                  aria-pressed={muted || volume === 0}
                >
                  {muted || volume === 0 ? (
                    <VolumeX aria-hidden="true" />
                  ) : (
                    <Volume2 aria-hidden="true" />
                  )}
                </button>
                <label className="avp__volume-slider">
                  <span className="avp__sr-only">Громкость</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={muted ? 0 : volume}
                    onChange={(event) => changeVolume(Number(event.target.value))}
                    aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} процентов`}
                  />
                </label>
              </div>

              {captions.length > 0 && (
                <button
                  type="button"
                  className="avp__icon-button"
                  onClick={() => {
                    const nextValue = !captionsOn;
                    setCaptionsOn(nextValue);
                    updateCaptionTracks(nextValue);
                  }}
                  aria-label={captionsOn ? "Выключить субтитры" : "Включить субтитры"}
                  aria-pressed={captionsOn}
                >
                  <Captions aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                className="avp__icon-button"
                onClick={() => void toggleFullscreen()}
                aria-label={fullscreen ? "Выйти из полноэкранного режима" : "На весь экран"}
              >
                {fullscreen ? (
                  <Minimize2 aria-hidden="true" />
                ) : (
                  <Maximize2 aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <span className="avp__sr-only" aria-live="polite">
        {failed
          ? "Ошибка загрузки видео"
          : ended
            ? "Видео завершено"
            : buffering
              ? "Видео загружается"
              : playing
                ? "Видео воспроизводится"
                : "Видео на паузе"}
      </span>
    </div>
  );
}
