"use client";

/**
 * THE LESSON PLAYER — the stage of the lesson page (lesson hi-fi, DD-336).
 *
 * The picture is the stage: nothing sits on it while the lesson plays. Its
 * controls live in a bar UNDER the picture, so a screencast's lower edge — where
 * a trading terminal keeps its own timeline — is never covered. Only in full
 * screen does the bar float over the picture and step aside while it plays.
 *
 * THE LESSON LINE. The bar's timeline is the lesson's own line: the played part
 * lit, and on it the points where the answer to each question of the level's
 * test is taught. A point is a way into the video (press it, and the lesson
 * plays from there) and, after an attempt, it says whether that question was
 * answered right. The points are the page's to give; the player only draws them.
 *
 * DOCKED. When the stage scrolls away while the lesson plays — or the test asks
 * to rewatch a second — the player docks: in the corner of a wide screen, along
 * the top of a phone. The question stays where the learner left it.
 *
 * WHAT IT IS NOT. A progress owner: playing, pausing and finishing complete
 * nothing. The page may ask to be told where the learner is (`onPositionSave`)
 * to keep the reading position the Backend already owns.
 */

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
  X,
} from "lucide-react";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  SyntheticEvent,
} from "react";
import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { cn } from "@/lib/cn";
import { formatTimecode } from "@/lib/time/timecode";
import "./academy-video-player.css";

export interface AcademyVideoCaption {
  src: string;
  srcLang: string;
  label: string;
  default?: boolean;
}

/**
 * A point on the lesson line: where in the video something of the level is
 * taught. On a lesson page — the answer to one question of its test.
 */
export interface AcademyVideoMarker {
  id: string;
  seconds: number;
  /** Printed under the point; one or two characters («1»). */
  label: string;
  /** What a screen reader hears, and what the point's tooltip says. */
  description: string;
  /** After an attempt: whether this question was answered right. */
  state?: "neutral" | "right" | "wrong";
}

/**
 * What a page may ask of a mounted player.
 *
 * Every capability exists for one sentence of the product: a test's разбор says
 * «пересмотрите с 1:55», and the learner should see that second without losing
 * the question they were reading.
 */
export interface AcademyVideoPlayerHandle {
  /**
   * Move to `seconds` and, when asked, start playing from there.
   *
   * Safe before the file's metadata has arrived: the request is kept and
   * applied the moment the length is known. A second beyond the end lands just
   * before it rather than on the «просмотрен» screen.
   */
  seekTo: (seconds: number, options?: { play?: boolean }) => void;
  /** Bring the player into view and give it keyboard focus. */
  reveal: () => void;
  /**
   * Play from `seconds` where the learner is: a docking player docks (and keeps
   * `keepInView` clear of itself); one that cannot dock is brought into view.
   */
  playFrom: (seconds: number, options?: { markerId?: string; keepInView?: HTMLElement | null }) => void;
}

export interface AcademyVideoPlayerProps {
  src: string;
  poster?: string;
  title: string;
  captions?: AcademyVideoCaption[];
  autoPlay?: boolean;
  className?: string;
  /** "source" (default) adapts the frame to the file's real ratio; a string like "16 / 9" pins it. */
  aspectRatio?: "source" | string;
  /** How the frame is filled. "contain" (default) never distorts; "cover" crops to fill. */
  fit?: "contain" | "cover";
  /**
   * What to offer once the video has played to its end, beside «Смотреть
   * снова». A lesson with a test says «Перейти к тесту»; without it the ended
   * screen only offers the replay, as before.
   */
  endedAction?: { label: string; href: string };
  /** What the ended screen says above the title. A lesson's is «Урок просмотрен»; a film's is not a lesson. */
  endedEyebrow?: string;
  /** The points of the lesson line. */
  markers?: AcademyVideoMarker[];
  /** Where the learner stopped last time, in seconds; offered as «Продолжить с …». */
  resumeFrom?: number | null;
  /** Dock while the lesson plays and the stage is out of view. */
  dockable?: boolean;
  /** Told where the learner is: every 15 s of playing, on pause, at the end, when the page hides. */
  onPositionSave?: (seconds: number) => void;
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
const SAVE_EVERY_MS = 15_000;
/** A position this close to either end is not worth offering back. */
const RESUME_MARGIN_SECONDS = 5;
/** Two labels closer than this on the line would touch: the later one is not printed. */
const MARKER_LABEL_SPACING_PX = 22;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
/* Measured before paint in the browser; on the server there is nothing to measure. */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const RATE_STORAGE_KEY = "ata.player.playbackRate";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isFiniteDuration(value: number) {
  return Number.isFinite(value) && value > 0;
}

/** The clock is printed by the same function the test's «пересмотреть с …» uses. */
const formatTime = formatTimecode;

function formatRate(rate: number) {
  return `${String(rate).replace(".", ",")}×`;
}

function readStoredRate(): number {
  try {
    const raw = window.localStorage.getItem(RATE_STORAGE_KEY);
    const value = raw === null ? 1 : Number(raw);
    return (PLAYBACK_RATES as readonly number[]).includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

const RATE_EVENT = "ata:player-rate";

function storeRate(rate: number) {
  try {
    window.localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  } catch {
    /* A convenience only: a blocked store leaves the rate for this page. */
  }
  window.dispatchEvent(new Event(RATE_EVENT));
}

/** The viewer's remembered speed, as an external store: 1 on the server, the stored value in the browser. */
function subscribeRate(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(RATE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RATE_EVENT, onChange);
  };
}
const serverRate = () => 1;

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

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* THE NARROW BAR (owner 2026-10-07: «в плеере на моб нельзя регулировать
   громкость»). Up to this width the bar has no room for a slider beside the
   speaker, so the speaker opens the level in a small window above the bar —
   where the level can be set at all (see `probeVolumeAdjustable`). The same
   width the stylesheet folds the bar at. */
const NARROW_BAR_QUERY = "(max-width: 620px)";

function subscribeNarrowBar(callback: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(NARROW_BAR_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function readNarrowBar() {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW_BAR_QUERY).matches;
}

const serverNarrowBar = () => false;

/**
 * Whether this browser lets a page set the level at all. An iPhone (and an
 * iPad) does not: the level is the device's own buttons, `volume` reads 1
 * whatever is written to it, and a slider there would move nothing. Asked
 * once of a media element of this document, by writing a level and reading it
 * back; the restriction is the platform's, the same for every element. Read
 * through `useSyncExternalStore`, so the server's answer (yes) stands until
 * the page is hydrated and the browser's own replaces it without a mismatch.
 */
export function probeVolumeAdjustable(video: HTMLMediaElement): boolean {
  const before = video.volume;
  const trial = before === 0.5 ? 0.25 : 0.5;
  try {
    video.volume = trial;
    const adjustable = Math.abs(video.volume - trial) < 0.001;
    video.volume = before;
    return adjustable;
  } catch {
    return false;
  }
}

let volumeAdjustableCache: boolean | null = null;

function readVolumeAdjustable() {
  if (volumeAdjustableCache === null) {
    volumeAdjustableCache = probeVolumeAdjustable(document.createElement("video"));
  }
  return volumeAdjustableCache;
}

/** Test-only: forget the browser's answer, so a test can give another. */
export function resetVolumeAdjustableForTests() {
  volumeAdjustableCache = null;
}

const subscribeNever = () => () => undefined;
const serverVolumeAdjustable = () => true;

/**
 * Self-contained "skip 10 seconds" glyph. The rotate arc reuses the exact
 * lucide RotateCcw/RotateCw geometry the rest of Academy uses; the "10" is drawn
 * as vector strokes (not SVG <text>) so it never depends on font loading.
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
      <path d="M7.4 9.05 8.85 7.6V16.95M7.25 16.95h3.2" />
      <ellipse cx="14.15" cy="12.3" rx="2.75" ry="4.7" />
    </svg>
  );
}

/**
 * Which labels of the line can be printed without touching a neighbour.
 *
 * Walked left to right; a label that would sit closer than the spacing to the
 * last printed one is left to the point's tooltip and its accessible name.
 */
export function printableMarkerLabels(
  markers: ReadonlyArray<{ id: string; seconds: number }>,
  duration: number,
  widthPx: number,
): Set<string> {
  const printed = new Set<string>();
  if (!isFiniteDuration(duration) || widthPx <= 0) return printed;
  let lastX = Number.NEGATIVE_INFINITY;
  for (const marker of [...markers].sort((a, b) => a.seconds - b.seconds)) {
    const x = (clamp(marker.seconds, 0, duration) / duration) * widthPx;
    if (x - lastX >= MARKER_LABEL_SPACING_PX) {
      printed.add(marker.id);
      lastX = x;
    }
  }
  return printed;
}

export const AcademyVideoPlayer = forwardRef<AcademyVideoPlayerHandle, AcademyVideoPlayerProps>(
  function AcademyVideoPlayer(
    {
      src,
      poster,
      title,
      captions = [],
      autoPlay = false,
      className,
      aspectRatio = "source",
      fit = "contain",
      endedAction,
      endedEyebrow = "Урок просмотрен",
      markers = [],
      resumeFrom = null,
      dockable = false,
      onPositionSave,
      initialVolume = 0.8,
      onPlay,
      onPause,
      onEnded,
      onTimeUpdate,
      onError,
    }: AcademyVideoPlayerProps,
    ref,
  ) {
  const slotRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const rateButtonRef = useRef<HTMLButtonElement>(null);
  const rateMenuRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const keyboardFocusRef = useRef(false);
  const startedRef = useRef(false);
  const scrubbingRef = useRef(false);
  const errorRef = useRef<MediaError | null>(null);
  const onErrorRef = useRef(onError);
  const onPositionSaveRef = useRef(onPositionSave);
  const lastSavedRef = useRef<number | null>(null);
  /** A seek asked for before the file's length was known. */
  const pendingSeekRef = useRef<{ seconds: number; play: boolean } | null>(null);
  /** The element a rewatch came from; kept clear of the docked player. */
  const keepInViewRef = useRef<HTMLElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [videoRatio, setVideoRatio] = useState<number | null>(null);
  const [volume, setVolume] = useState(() => clamp(initialVolume, 0, 1));
  const [muted, setMuted] = useState(false);
  /** Whether a slider would move anything here (not on an iPhone). */
  const volumeAdjustable = useSyncExternalStore(subscribeNever, readVolumeAdjustable, serverVolumeAdjustable);
  /** The level's window on a narrow bar. */
  const [volumeOpen, setVolumeOpen] = useState(false);
  const narrowBar = useSyncExternalStore(subscribeNarrowBar, readNarrowBar, serverNarrowBar);
  const volumeRef = useRef<HTMLDivElement>(null);
  /** A tap that only brought the controls back in full screen is not a press on the picture. */
  const swallowClickRef = useRef(false);
  const controlsVisibleRef = useRef(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<{ seconds: number; ratio: number } | null>(null);
  const rate = useSyncExternalStore(subscribeRate, readStoredRate, serverRate);
  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const [lineWidth, setLineWidth] = useState(0);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [slotVisible, setSlotVisible] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** The stage's height the last time the player stood in it. */
  const slotHeightRef = useRef<number | null>(null);

  const [seekFeedback, setSeekFeedback] = useState<{
    dir: 1 | -1;
    id: number;
  } | null>(null);
  const [captionsOn, setCaptionsOn] = useState(
    () => captions.findIndex((caption) => caption.default) >= 0,
  );

  const seekable = isFiniteDuration(duration);
  const docked = dockable && !fullscreen && !failed && !slotVisible && (playing || pinned) && !dismissed;
  const resumeAt =
    resumeFrom !== null &&
    Number.isFinite(resumeFrom) &&
    resumeFrom >= RESUME_MARGIN_SECONDS &&
    (!seekable || resumeFrom < duration - RESUME_MARGIN_SECONDS)
      ? Math.floor(resumeFrom)
      : null;

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

  // Keep the latest callbacks without re-subscribing effects to them.
  useEffect(() => {
    onErrorRef.current = onError;
    onPositionSaveRef.current = onPositionSave;
  });

  const clearPlayWait = useCallback(() => {
    if (playWaitTimerRef.current) {
      clearTimeout(playWaitTimerRef.current);
      playWaitTimerRef.current = null;
    }
  }, []);

  // --- the reading position ------------------------------------------------
  const savePosition = useCallback((seconds?: number) => {
    const video = videoRef.current;
    const save = onPositionSaveRef.current;
    if (!save || !video || !startedRef.current) return;
    const value = Math.floor(seconds ?? video.currentTime);
    if (!Number.isFinite(value) || value < 0 || value === lastSavedRef.current) return;
    lastSavedRef.current = value;
    save(value);
  }, []);

  useEffect(() => {
    if (!playing) return;
    saveTimerRef.current = setInterval(() => savePosition(), SAVE_EVERY_MS);
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [playing, savePosition]);

  useEffect(() => {
    const handleHide = () => {
      if (document.visibilityState === "hidden") savePosition();
    };
    document.addEventListener("visibilitychange", handleHide);
    window.addEventListener("pagehide", handleHide);
    return () => {
      document.removeEventListener("visibilitychange", handleHide);
      window.removeEventListener("pagehide", handleHide);
    };
  }, [savePosition]);

  // --- controls autohide (full screen only: elsewhere the bar is under the picture)
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearHideTimer();
    if (!playing || !fullscreen || scrubbingRef.current) return;
    hideTimerRef.current = setTimeout(() => {
      const focusInside = rootRef.current?.contains(document.activeElement);
      if (!(keyboardFocusRef.current && focusInside)) setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  }, [clearHideTimer, fullscreen, playing]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  useEffect(() => {
    if (playing && fullscreen) scheduleControlsHide();
    else clearHideTimer();
  }, [clearHideTimer, fullscreen, playing, scheduleControlsHide]);

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

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  // The level's window closes on a press elsewhere, and goes with a wide bar.
  useEffect(() => {
    if (!volumeOpen) return;
    const handlePointer = (event: PointerEvent) => {
      if (volumeRef.current?.contains(event.target as Node | null)) return;
      setVolumeOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [volumeOpen]);

  // --- playback rate: remembered per viewer, applied to every file ---------
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
  }, [rate, src]);

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

  // --- the line's width decides which labels fit -------------------------
  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const measure = () => setLineWidth(line.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(line);
    return () => observer.disconnect();
  }, []);

  // --- docking: is the stage on screen? -----------------------------------
  useEffect(() => {
    const slot = slotRef.current;
    if (!dockable || !slot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        setSlotVisible(visible);
        // Back on the stage: whatever pinned the player there is spent.
        if (visible) setPinned(false);
      },
      { threshold: [0, 0.25, 0.5] },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, [dockable]);

  // The stage keeps its place while the player is away, so nothing jumps: its
  // height is read on every layout while the player is in it, and held while
  // the player is docked (by then the stage is empty and measures nothing).
  useBrowserLayoutEffect(() => {
    if (docked) return;
    const slot = slotRef.current;
    if (slot) slotHeightRef.current = slot.getBoundingClientRect().height;
  });
  useBrowserLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    slot.style.minHeight = docked && slotHeightRef.current ? `${slotHeightRef.current}px` : "";
  }, [docked]);

  // After docking, the question the learner came from must not sit under the player.
  useEffect(() => {
    if (!docked) return;
    const element = keepInViewRef.current;
    const root = rootRef.current;
    if (!element || !root) return;
    const frame = requestAnimationFrame(() => {
      const dock = root.getBoundingClientRect();
      const target = element.getBoundingClientRect();
      const overlapsX = target.left < dock.right && target.right > dock.left;
      const overlapsY = target.top < dock.bottom && target.bottom > dock.top;
      if (!overlapsX || !overlapsY) return;
      // The strip docks at the top (under the floating bar on a desktop), the
      // corner at the bottom: which way to move the question depends on which.
      const dockAtTop = dock.top < window.innerHeight / 2;
      const delta = dockAtTop ? target.top - dock.bottom - 16 : target.bottom - dock.top + 16;
      window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
    keepInViewRef.current = null;
    return () => cancelAnimationFrame(frame);
  }, [docked]);

  // --- unmount cleanup ----------------------------------------------------
  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (playWaitTimerRef.current) clearTimeout(playWaitTimerRef.current);
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // --- the speed menu closes on Escape and on a press elsewhere ------------
  useEffect(() => {
    if (!rateMenuOpen) return;
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (rateMenuRef.current?.contains(target) || rateButtonRef.current?.contains(target)) return;
      setRateMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [rateMenuOpen]);

  const updateCaptionTracks = useCallback((enabled: boolean) => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    for (const track of Array.from(tracks)) {
      track.mode = enabled ? "showing" : "hidden";
    }
  }, []);

  // --- playback control ---------------------------------------------------
  const startPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video || failed) return;
    if (video.ended) video.currentTime = 0;
    // Don't flash the spinner on an instant start: only reveal it if the
    // browser is still stalling a moment after the play request.
    clearPlayWait();
    playWaitTimerRef.current = setTimeout(() => setBuffering(true), 320);
    try {
      await video.play();
    } catch {
      clearPlayWait();
      setBuffering(false);
    }
  }, [clearPlayWait, failed]);

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video || failed) return;

    revealControls();
    if (playing) {
      video.pause();
      return;
    }
    setDismissed(false);
    await startPlayback();
  }, [failed, playing, revealControls, startPlayback]);

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

  const chooseRate = useCallback((nextRate: number) => {
    storeRate(nextRate);
    setRateMenuOpen(false);
    rateButtonRef.current?.focus();
  }, []);

  /* FULL SCREEN. Where the browser can put an element on the whole screen, the
     player's own frame goes there, with its controls. An iPhone cannot: Safari
     there has no element fullscreen, so the press did nothing (owner
     2026-10-07: «Не работает открытие видео на весь экран, в ПК версии все
     ок»). There the video itself opens in the system's own full-screen player —
     called straight from the press, with nothing awaited before it, which is
     what lets the system allow it. */
  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.();
      } catch {
        // Nothing to undo: the frame simply stays where it is.
      }
      return;
    }
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    const elementFullscreen = document.fullscreenEnabled === true && typeof root.requestFullscreen === "function";
    if (!elementFullscreen && typeof video?.webkitEnterFullscreen === "function") {
      try {
        video.webkitEnterFullscreen();
      } catch {
        // The system refused (no video loaded yet); the inline controls stay usable.
      }
      return;
    }
    try {
      await root.requestFullscreen?.();
    } catch {
      // Browsers can deny fullscreen without a user gesture; controls stay usable.
    }
  }, []);

  const closeDock = useCallback(() => {
    videoRef.current?.pause();
    setPinned(false);
    setDismissed(true);
  }, []);

  // --- seek on request (the page's «пересмотреть с …») --------------------
  const applySeek = useCallback((video: HTMLVideoElement, seconds: number, play: boolean) => {
    // Just short of the end: a request for the very last second must show that
    // second, not the «Урок просмотрен» screen.
    const limit = Math.max(0, video.duration - 0.25);
    const safeTime = clamp(Number.isFinite(seconds) ? seconds : 0, 0, limit);
    video.currentTime = safeTime;
    setCurrentTime(safeTime);
    setEnded(false);
    if (play) {
      // A browser may refuse to start playback it did not see a gesture for.
      // The player is then simply paused on the requested second.
      void video.play().catch(() => undefined);
    }
  }, []);

  const requestSeek = useCallback(
    (seconds: number, play: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      setControlsVisible(true);
      if (isFiniteDuration(video.duration)) {
        pendingSeekRef.current = null;
        applySeek(video, seconds, play);
        return;
      }
      pendingSeekRef.current = { seconds, play };
      // Nothing has asked the browser for this file yet (or it failed):
      // ask again, and the metadata handler finishes the job.
      if (video.readyState === 0) video.load();
    },
    [applySeek],
  );

  const reveal = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    root.focus({ preventScroll: true });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds, options) {
        requestSeek(seconds, options?.play ?? false);
      },
      reveal,
      playFrom(seconds, options) {
        setActiveMarkerId(options?.markerId ?? null);
        setDismissed(false);
        if (dockable) {
          keepInViewRef.current = options?.keepInView ?? null;
          setPinned(true);
        } else {
          reveal();
        }
        requestSeek(seconds, true);
      },
    }),
    [dockable, requestSeek, reveal],
  );

  // --- timeline seek (pointer + touch) ------------------------------------
  const ratioFromClientX = useCallback((clientX: number) => {
    const el = timelineRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const video = videoRef.current;
      const ratio = ratioFromClientX(clientX);
      if (!video || !seekable || ratio === null) return;
      const target = ratio * duration;
      video.currentTime = target;
      setCurrentTime(target);
      setEnded(false);
    },
    [duration, ratioFromClientX, seekable],
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
    if (scrubbingRef.current) {
      seekFromClientX(event.clientX);
      return;
    }
    if (event.pointerType === "mouse" && seekable) {
      const ratio = ratioFromClientX(event.clientX);
      if (ratio !== null) setHoverTime({ seconds: ratio * duration, ratio });
    }
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
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      return;
    }
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
    if (event.key === "Escape" && rateMenuOpen) {
      event.preventDefault();
      setRateMenuOpen(false);
      rateButtonRef.current?.focus();
      return;
    }
    if (event.key === "Escape" && volumeOpen) {
      event.preventDefault();
      setVolumeOpen(false);
      volumeRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      return;
    }
    if (event.target !== event.currentTarget || isEditableTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (event.key === " " || key === "k") {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === "ArrowLeft" || key === "j") {
      event.preventDefault();
      skipBy(-SKIP_SECONDS);
    } else if (event.key === "ArrowRight" || key === "l") {
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

  const handlePointerActivity = (event: ReactPointerEvent<HTMLDivElement>) => {
    keyboardFocusRef.current = false;
    /* In full screen on a phone, a tap while the controls have stepped aside
       brings them back and does nothing else — it does not pause the video
       (2026-10-07). A mouse moving does not get here as a press. */
    if (
      event.type === "pointerdown" &&
      event.pointerType === "touch" &&
      fullscreen &&
      playing &&
      !controlsVisibleRef.current
    ) {
      swallowClickRef.current = true;
    }
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
    savePosition();
    onPause?.();
  };

  const handleEnded = () => {
    setPlaying(false);
    setBuffering(false);
    clearPlayWait();
    setEnded(true);
    setControlsVisible(true);
    clearHideTimer();
    setPinned(false);
    const video = videoRef.current;
    if (video && isFiniteDuration(video.duration)) savePosition(video.duration);
    onEnded?.();
  };

  const readBuffered = (video: HTMLVideoElement) => {
    try {
      const ranges = video.buffered;
      if (!ranges || ranges.length === 0 || !isFiniteDuration(video.duration)) return;
      setBuffered(ranges.end(ranges.length - 1));
    } catch {
      /* Not every element reports its buffer; the line simply shows none. */
    }
  };

  const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!scrubbingRef.current && !playing) setCurrentTime(video.currentTime);
    readBuffered(video);
    onTimeUpdate?.(video.currentTime, video.duration || duration);
  };

  const syncFromElement = (video: HTMLVideoElement) => {
    setDuration(isFiniteDuration(video.duration) ? video.duration : 0);
    if (!scrubbingRef.current) setCurrentTime(video.currentTime);
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoRatio(video.videoWidth / video.videoHeight);
    }
    video.playbackRate = rate;
    clearError();
    updateCaptionTracks(captionsOn);
    // A seek that was asked for before the length was known lands now.
    const pending = pendingSeekRef.current;
    if (pending && isFiniteDuration(video.duration)) {
      pendingSeekRef.current = null;
      applySeek(video, pending.seconds, pending.play);
    }
  };

  const syncMetadata = (event: SyntheticEvent<HTMLVideoElement>) => syncFromElement(event.currentTarget);

  /**
   * WHAT THE ELEMENT ALREADY KNOWS WHEN REACT ARRIVES.
   *
   * The <video> is in the server's HTML, so the browser starts fetching it
   * before this component hydrates — and `loadedmetadata`, `durationchange`,
   * even `error`, can all have fired by the time the handlers above are
   * attached. They do not fire again. So on mount the element is read once, as
   * if its events had just arrived.
   */
  const syncFromElementRef = useRef(syncFromElement);
  useEffect(() => {
    syncFromElementRef.current = syncFromElement;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.error) {
      reportError(video.error);
      return;
    }
    if (video.readyState >= 1 /* HAVE_METADATA */) syncFromElementRef.current(video);
    if (video.readyState >= 2 /* HAVE_CURRENT_DATA */) setHasFrame(true);
    if (!video.paused && !video.ended) {
      // Autoplay began before hydration: the controls must say "playing".
      startedRef.current = true;
      setStarted(true);
      setPlaying(true);
    }
  }, [reportError]);

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
    lastSavedRef.current = null;
    setEnded(false);
    setBuffering(false);
    setHasFrame(false);
    clearPlayWait();
    setDuration(0);
    setCurrentTime(0);
    setBuffered(0);
    setVideoRatio(null);
    clearError();
  };

  const handleLoadStart = () => {
    setEnded(false);
    setHasFrame(false);
    clearPlayWait();
    setDuration(0);
    setCurrentTime(0);
    setBuffered(0);
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
  const bufferedShare = seekable ? clamp((buffered / duration) * 100, 0, 100) : 0;
  const isPortrait =
    aspectRatio === "source" && videoRatio !== null && videoRatio <= 1.05;
  const frameAspect =
    aspectRatio === "source"
      ? videoRatio && videoRatio > 0
        ? `${videoRatio}`
        : "16 / 9"
      : aspectRatio;

  const placedMarkers = useMemo(
    () =>
      seekable
        ? markers
            .filter((marker) => Number.isFinite(marker.seconds) && marker.seconds >= 0 && marker.seconds <= duration)
            .sort((a, b) => a.seconds - b.seconds)
        : [],
    [duration, markers, seekable],
  );
  const printedLabels = useMemo(
    () => printableMarkerLabels(placedMarkers, duration, lineWidth || 640),
    [duration, lineWidth, placedMarkers],
  );

  const style = {
    "--avp-aspect-ratio": frameAspect,
    "--avp-progress": `${progress}%`,
    "--avp-buffered": `${bufferedShare}%`,
    "--avp-fit": fit,
  } as CSSProperties;

  const errorDetail =
    errorCode === 2
      ? "Проблема с сетью. Проверьте соединение и попробуйте ещё раз."
      : errorCode === 3 || errorCode === 4
        ? "Формат или кодек видео не поддерживается этим браузером."
        : "Не удалось загрузить видео. Попробуйте ещё раз.";

  const showCenter = !failed && !buffering && !ended && !playing;
  const centerMainLabel = started ? "Продолжить видео" : "Воспроизвести видео";
  const showResume = !started && !failed && resumeAt !== null;

  return (
    <div
      ref={slotRef}
      className={cn("avp-slot", docked && "avp-slot--away")}
    >
      <div
        ref={rootRef}
        className={cn(
          "avp",
          playing && "avp--playing",
          /* Off full screen, or paused, the bar is simply there. */
          (controlsVisible || !fullscreen || !playing) && "avp--controls-visible",
          scrubbing && "avp--scrubbing",
          isPortrait && "avp--tall",
          hasFrame && "avp--has-frame",
          failed && "avp--failed",
          docked && "avp--docked",
          fullscreen && "avp--fullscreen",
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
        <div className="avp__screen">
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
            onProgress={(event) => readBuffered(event.currentTarget)}
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
                {/* A plain <img> is intentional: the poster is a background layer,
                    not a layout-driving next/image candidate. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="avp__poster-image" src={poster} alt="" />
              </div>
            ) : (
              // No poster: a plain frame. Nothing is drawn in a lesson's name.
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
              {showResume ? (
                <>
                  <button
                    type="button"
                    className="avp__resume"
                    onClick={() => {
                      setDismissed(false);
                      requestSeek(resumeAt, true);
                    }}
                  >
                    <Play aria-hidden="true" fill="currentColor" />
                    <span>Продолжить с {formatTime(resumeAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="avp__restart"
                    onClick={() => {
                      setDismissed(false);
                      requestSeek(0, true);
                    }}
                  >
                    Смотреть с начала
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="avp__center-btn avp__center-btn--main"
                  onClick={() => void togglePlay()}
                  aria-label={centerMainLabel}
                >
                  <Play aria-hidden="true" fill="currentColor" />
                </button>
              )}
            </div>
          )}

          {docked && (
            <button
              type="button"
              className="avp__dock-close"
              onClick={(event) => {
                event.stopPropagation();
                closeDock();
              }}
              aria-label="Закрыть мини-плеер"
              title="Закрыть мини-плеер"
            >
              <X aria-hidden="true" />
            </button>
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
              <span className="avp__eyebrow">{endedEyebrow}</span>
              <strong>{title}</strong>
              <div className="avp__ended-actions">
                {endedAction ? (
                  <Link className="avp__ended-next" href={endedAction.href}>
                    {endedAction.label}
                  </Link>
                ) : null}
                <button
                  type="button"
                  className={endedAction ? "avp__ended-replay avp__ended-replay--quiet" : "avp__ended-replay"}
                  onClick={() => void togglePlay()}
                >
                  <RotateCcw aria-hidden="true" />
                  Смотреть снова
                </button>
              </div>
            </div>
          )}
        </div>

        {!failed && (
          <div
            className="avp__bar"
            onClick={stopSurface}
            onDoubleClick={stopSurface}
          >
            <div ref={lineRef} className="avp__line" data-markers={placedMarkers.length}>
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
                onPointerLeave={() => setHoverTime(null)}
                onPointerUp={endScrub}
                onPointerCancel={endScrub}
                onKeyDown={handleTimelineKeyDown}
              >
                <div className="avp__timeline-track">
                  <div className="avp__timeline-buffer" />
                  <div className="avp__timeline-fill" />
                  <div className="avp__timeline-thumb" />
                </div>
                {hoverTime && !scrubbing ? (
                  <span className="avp__hover-time" style={{ left: `${hoverTime.ratio * 100}%` }} aria-hidden="true">
                    {formatTime(hoverTime.seconds)}
                  </span>
                ) : null}
              </div>

              {placedMarkers.length > 0 ? (
                <ol className="avp__markers" aria-label="Где в видео объясняют ответы теста">
                  {placedMarkers.map((marker) => {
                    const left = `${(marker.seconds / duration) * 100}%`;
                    return (
                      <li
                        key={marker.id}
                        className="avp__marker"
                        data-state={marker.state ?? "neutral"}
                        data-active={activeMarkerId === marker.id ? "true" : undefined}
                        style={{ left }}
                      >
                        <button
                          type="button"
                          className="avp__marker-point"
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveMarkerId(marker.id);
                            setDismissed(false);
                            requestSeek(marker.seconds, true);
                          }}
                          aria-label={marker.description}
                          title={marker.description}
                        >
                          <span className="avp__marker-dot" aria-hidden="true" />
                        </button>
                        {printedLabels.has(marker.id) ? (
                          <span className="avp__marker-label" aria-hidden="true">
                            {marker.label}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </div>

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
                <button
                  type="button"
                  className="avp__icon-button avp__icon-button--skip"
                  onClick={() => skipBy(-SKIP_SECONDS)}
                  disabled={!seekable}
                  aria-label="Назад на 10 секунд"
                  title="Назад 10 секунд (J)"
                >
                  <SkipTenIcon direction="back" />
                </button>
                <button
                  type="button"
                  className="avp__icon-button avp__icon-button--skip"
                  onClick={() => skipBy(SKIP_SECONDS)}
                  disabled={!seekable}
                  aria-label="Вперёд на 10 секунд"
                  title="Вперёд 10 секунд (L)"
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
                <div className="avp__rate">
                  <button
                    ref={rateButtonRef}
                    type="button"
                    className="avp__rate-button"
                    onClick={() => setRateMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={rateMenuOpen}
                    aria-label={`Скорость: ${formatRate(rate)}`}
                  >
                    {formatRate(rate)}
                  </button>
                  {rateMenuOpen ? (
                    <div ref={rateMenuRef} className="avp__rate-menu" role="menu" aria-label="Скорость воспроизведения">
                      {PLAYBACK_RATES.map((option) => (
                        <button
                          key={option}
                          type="button"
                          role="menuitemradio"
                          aria-checked={option === rate}
                          className="avp__rate-option"
                          onClick={() => chooseRate(option)}
                        >
                          {formatRate(option)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {captions.length > 0 && (
                  <button
                    type="button"
                    className="avp__icon-button avp__icon-button--captions"
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

                {/* THE SOUND, ON EVERY WIDTH (owner 2026-10-07: «в плеере на
                    моб нельзя регулировать громкость»). The speaker is always
                    in the bar. Beside it, where the bar is wide, the level; on
                    a narrow bar the speaker opens the level in a window above
                    the bar — where the level can be set at all. On an iPhone it
                    cannot (the device's own buttons set it), so there the
                    speaker only mutes and unmutes, and no slider that would
                    move nothing is drawn. */}
                <div
                  ref={volumeRef}
                  className={cn("avp__volume", volumeOpen && "avp__volume--open")}
                  data-volume-adjustable={volumeAdjustable ? "true" : "false"}
                >
                  <button
                    type="button"
                    className="avp__icon-button avp__icon-button--sound"
                    onClick={
                      narrowBar && volumeAdjustable
                        ? () => setVolumeOpen((open) => !open)
                        : () => {
                            setVolumeOpen(false);
                            toggleMute();
                          }
                    }
                    aria-label={
                      narrowBar && volumeAdjustable
                        ? "Громкость"
                        : muted || volume === 0
                          ? "Включить звук"
                          : "Выключить звук"
                    }
                    aria-pressed={narrowBar && volumeAdjustable ? undefined : muted || volume === 0}
                    aria-haspopup={narrowBar && volumeAdjustable ? "dialog" : undefined}
                    aria-expanded={narrowBar && volumeAdjustable ? volumeOpen : undefined}
                  >
                    {muted || volume === 0 ? (
                      <VolumeX aria-hidden="true" />
                    ) : (
                      <Volume2 aria-hidden="true" />
                    )}
                  </button>
                  {volumeAdjustable && !narrowBar ? (
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
                  ) : null}
                  {volumeAdjustable && narrowBar && volumeOpen ? (
                    <div className="avp__volume-pop" role="dialog" aria-label="Громкость">
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
                      <label className="avp__volume-slider avp__volume-slider--pop">
                        <span className="avp__sr-only">Уровень громкости</span>
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
                      <span className="avp__volume-value" aria-hidden="true">
                        {Math.round((muted ? 0 : volume) * 100)}%
                      </span>
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="avp__icon-button avp__icon-button--fullscreen"
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
    </div>
  );
  },
);
