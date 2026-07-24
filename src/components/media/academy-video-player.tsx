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
  aspectRatio?: string;
  initialVolume?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onError?: (error: MediaError | null) => void;
}

const CONTROLS_HIDE_DELAY = 2400;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
    target instanceof HTMLButtonElement
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
  aspectRatio = "16 / 9",
  initialVolume = 0.8,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  onError,
}: AcademyVideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const keyboardFocusRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(() => clamp(initialVolume, 0, 1));
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(
    () => captions.findIndex((caption) => caption.default) >= 0,
  );

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearHideTimer();
    if (!playing) return;
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

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [muted, volume]);

  const updateCaptionTracks = useCallback((enabled: boolean) => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (const track of Array.from(tracks)) {
      track.mode = enabled ? "showing" : "hidden";
    }
  }, []);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || failed) return;

    revealControls();
    if (playing) {
      video.pause();
      return;
    }

    if (video.ended) video.currentTime = 0;
    setBuffering(true);
    try {
      await video.play();
    } catch {
      setBuffering(false);
    }
  }, [failed, playing, revealControls]);

  const retry = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setFailed(false);
    setEnded(false);
    setCurrentTime(0);
    video.load();
  }, []);

  const seekTo = useCallback(
    (nextTime: number) => {
      const video = videoRef.current;
      if (!video || !duration) return;
      const safeTime = clamp(nextTime, 0, duration);
      video.currentTime = safeTime;
      setCurrentTime(safeTime);
      setEnded(false);
      revealControls();
    },
    [duration, revealControls],
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

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    keyboardFocusRef.current = true;
    if (event.target !== event.currentTarget || isEditableTarget(event.target)) {
      return;
    }

    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekTo(currentTime - 5);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      seekTo(currentTime + 5);
    } else if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleMute();
    } else if (event.key.toLowerCase() === "f") {
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
    keyboardFocusRef.current = event.target instanceof HTMLElement
      ? event.target.matches(":focus-visible")
      : false;
    revealControls();
  };

  const handlePointerActivity = () => {
    keyboardFocusRef.current = false;
    revealControls();
  };

  const handlePlay = () => {
    startedRef.current = true;
    setStarted(true);
    setPlaying(true);
    setEnded(false);
    setBuffering(false);
    setControlsVisible(true);
    scheduleControlsHide();
    onPlay?.();
  };

  const handlePause = () => {
    setPlaying(false);
    setBuffering(false);
    setControlsVisible(true);
    clearHideTimer();
    onPause?.();
  };

  const handleEnded = () => {
    setPlaying(false);
    setBuffering(false);
    setEnded(true);
    setControlsVisible(true);
    clearHideTimer();
    onEnded?.();
  };

  const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setCurrentTime(video.currentTime);
    onTimeUpdate?.(video.currentTime, video.duration || duration);
  };

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const nextDuration = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(nextDuration);
    setCurrentTime(video.currentTime);
    setBuffering(false);
    setFailed(false);
    updateCaptionTracks(captionsOn);
  };

  const handleError = (event: SyntheticEvent<HTMLVideoElement>) => {
    setPlaying(false);
    setBuffering(false);
    setFailed(true);
    setControlsVisible(true);
    clearHideTimer();
    onError?.(event.currentTarget.error);
  };

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const style = {
    "--avp-aspect-ratio": aspectRatio,
    "--avp-progress": `${progress}%`,
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={cn(
        "avp",
        playing && "avp--playing",
        controlsVisible && "avp--controls-visible",
        failed && "avp--failed",
        className,
      )}
      style={style}
      role="region"
      aria-label={`Видеоплеер: ${title}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
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
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
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

      {!started && (
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
      )}

      <div className="avp__shade" aria-hidden="true" />

      {!failed && !buffering && !ended && !playing && (
        <button
          type="button"
          className="avp__hero-play"
          onClick={() => void togglePlay()}
          aria-label={started ? "Продолжить видео" : "Воспроизвести видео"}
        >
          <Play aria-hidden="true" fill="currentColor" />
        </button>
      )}

      {buffering && !failed && (
        <div className="avp__state avp__state--loading" role="status">
          <LoaderCircle className="avp__spinner" aria-hidden="true" />
          <span>Загружаем видео</span>
        </div>
      )}

      {failed && (
        <div className="avp__state avp__state--error" role="alert">
          <span className="avp__state-icon">
            <AlertTriangle aria-hidden="true" />
          </span>
          <div>
            <strong>Видео не загрузилось</strong>
            <span>Проверьте соединение и попробуйте ещё раз.</span>
          </div>
          <button type="button" onClick={retry}>
            Повторить
          </button>
        </div>
      )}

      {ended && !failed && (
        <div className="avp__state avp__state--ended" role="status">
          <span className="avp__eyebrow">Урок просмотрен</span>
          <strong>{title}</strong>
          <button type="button" onClick={() => void togglePlay()}>
            <RotateCcw aria-hidden="true" />
            Смотреть снова
          </button>
        </div>
      )}

      {!failed && (
        <div className="avp__controls">
          <label className="avp__timeline">
            <span className="avp__sr-only">Позиция видео</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => seekTo(Number(event.target.value))}
              aria-valuetext={`${formatTime(currentTime)} из ${formatTime(duration)}`}
            />
          </label>

          <div className="avp__control-row">
            <div className="avp__control-group">
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
              <p className="avp__time" aria-label={`${formatTime(currentTime)} из ${formatTime(duration)}`}>
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
