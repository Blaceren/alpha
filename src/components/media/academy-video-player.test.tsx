import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AcademyVideoPlayer, printableMarkerLabels, type AcademyVideoPlayerHandle } from "./academy-video-player";

function setMedia(
  video: HTMLVideoElement,
  values: {
    duration?: number;
    currentTime?: number;
    videoWidth?: number;
    videoHeight?: number;
    error?: { code: number };
  },
) {
  if (values.duration !== undefined) {
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: values.duration,
    });
  }
  if (values.currentTime !== undefined) {
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: values.currentTime,
    });
  }
  if (values.videoWidth !== undefined) {
    Object.defineProperty(video, "videoWidth", {
      configurable: true,
      value: values.videoWidth,
    });
  }
  if (values.videoHeight !== undefined) {
    Object.defineProperty(video, "videoHeight", {
      configurable: true,
      value: values.videoHeight,
    });
  }
  if (values.error !== undefined) {
    Object.defineProperty(video, "error", {
      configurable: true,
      value: values.error,
    });
  }
}

const getVideo = () =>
  screen.getByTestId("academy-video-element") as HTMLVideoElement;
const getRegion = (title = "Урок") =>
  screen.getByRole("region", { name: `Видеоплеер: ${title}` });
const getTimeline = () => screen.getByRole("slider", { name: "Позиция видео" });

function mockTimelineRect(el: HTMLElement, left = 0, width = 200) {
  el.getBoundingClientRect = () =>
    ({ left, top: 0, width, height: 8, right: left + width, bottom: 8, x: left, y: 0, toJSON() {} }) as DOMRect;
}

describe("AcademyVideoPlayer", () => {
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const load = vi.fn();

  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    load.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("plays and pauses from the center control", async () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    render(
      <AcademyVideoPlayer src="/lesson.mp4" title="Урок" onPlay={onPlay} onPause={onPause} />,
    );
    const video = getVideo();
    setMedia(video, { duration: 120, currentTime: 0 });
    fireEvent.loadedMetadata(video);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Воспроизвести видео" }));
    });
    expect(play).toHaveBeenCalledOnce();

    fireEvent.play(video);
    expect(onPlay).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Пауза" }));
    expect(pause).toHaveBeenCalledOnce();
    fireEvent.pause(video);
    expect(onPause).toHaveBeenCalledOnce();
  });

  it("shows the real duration only after loadedmetadata", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    // Before metadata: unknown state.
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");
    expect(getTimeline()).toHaveAttribute("aria-disabled", "true");

    setMedia(video, { duration: 120, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText("2:00")).toBeInTheDocument();
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "120");
  });

  it("never treats NaN or Infinity as a valid duration", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();

    setMedia(video, { duration: Infinity });
    fireEvent.durationChange(video);
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");

    setMedia(video, { duration: NaN });
    fireEvent.durationChange(video);
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");
    expect(getTimeline()).toHaveAttribute("aria-disabled", "true");
  });

  it("resets duration, time and error when the source is replaced", () => {
    render(<AcademyVideoPlayer src="/a.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 40 });
    fireEvent.loadedMetadata(video);
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "100");
    setMedia(video, { error: { code: 3 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // A new src makes the browser fire emptied + loadstart.
    fireEvent.emptied(video);
    fireEvent.loadStart(video);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");

    setMedia(video, { duration: 45, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByText("0:45")).toBeInTheDocument();
  });

  it("seeks to the clicked position on the timeline", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    const timeline = getTimeline();
    mockTimelineRect(timeline, 0, 200);

    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 });
    expect(video.currentTime).toBe(50);
    fireEvent.pointerUp(timeline, { pointerId: 1 });
  });

  it("scrubs with pointer drag and clamps to the media range", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    const timeline = getTimeline();
    mockTimelineRect(timeline, 0, 200);

    fireEvent.pointerDown(timeline, { clientX: 40, pointerId: 1 });
    expect(video.currentTime).toBe(20);
    fireEvent.pointerMove(timeline, { clientX: 150, pointerId: 1 });
    expect(video.currentTime).toBe(75);
    // Past the ends clamps to 0..duration.
    fireEvent.pointerMove(timeline, { clientX: 999, pointerId: 1 });
    expect(video.currentTime).toBe(100);
    fireEvent.pointerMove(timeline, { clientX: -50, pointerId: 1 });
    expect(video.currentTime).toBe(0);
    fireEvent.pointerUp(timeline, { pointerId: 1 });
  });

  it("skips backward and forward by 10 seconds with clamping", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 50 });
    fireEvent.loadedMetadata(video);

    const backBtn = () =>
      screen.getAllByRole("button", { name: "Назад на 10 секунд" })[0]!;
    const forwardBtn = () =>
      screen.getAllByRole("button", { name: "Вперёд на 10 секунд" })[0]!;

    fireEvent.click(backBtn());
    expect(video.currentTime).toBe(40);
    fireEvent.click(forwardBtn());
    expect(video.currentTime).toBe(50);

    setMedia(video, { currentTime: 5 });
    fireEvent.click(backBtn());
    expect(video.currentTime).toBe(0);

    setMedia(video, { currentTime: 95 });
    fireEvent.click(forwardBtn());
    expect(video.currentTime).toBe(100);
  });

  it("disables skip controls until a valid duration is known", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    expect(screen.getAllByRole("button", { name: "Назад на 10 секунд" })[0]).toBeDisabled();
    const video = getVideo();
    setMedia(video, { duration: 60, currentTime: 0 });
    fireEvent.loadedMetadata(video);
    expect(screen.getAllByRole("button", { name: "Назад на 10 секунд" })[0]).toBeEnabled();
  });

  it("uses ArrowLeft/ArrowRight for ±10s only when the region is focused", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();
    setMedia(video, { duration: 100, currentTime: 30 });
    fireEvent.loadedMetadata(video);

    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(video.currentTime).toBe(40);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(30);

    // Arrows inside the range control must not trigger the ±10s shortcut.
    fireEvent.keyDown(screen.getByLabelText("Громкость"), { key: "ArrowRight" });
    expect(video.currentTime).toBe(30);
  });

  it("single click toggles play/pause on the video surface", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();

    fireEvent.click(region);
    act(() => vi.advanceTimersByTime(260));
    expect(play).toHaveBeenCalledOnce();
  });

  it("double click toggles fullscreen and cancels the single-click play", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(region, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    fireEvent.click(region);
    fireEvent.dblClick(region);
    act(() => vi.advanceTimersByTime(300));

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it("exits fullscreen on a second double click", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: region,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });

    fireEvent.dblClick(region);
    expect(exitFullscreen).toHaveBeenCalledOnce();

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  /* 2026-10-07, owner: «Не работает открытие видео на весь экран, в ПК версии
     все ок» — an iPhone has no element fullscreen; its video has its own. */
  describe("the full-screen button", () => {
    function setFullscreenEnabled(value: boolean | undefined) {
      Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value });
    }
    afterEach(() => setFullscreenEnabled(undefined));

    it("on an iPhone (no element fullscreen) opens the video in the system's own full-screen player", () => {
      const { container } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      const region = getRegion();
      const requestFullscreen = vi.fn(() => Promise.resolve());
      Object.defineProperty(region, "requestFullscreen", { configurable: true, value: requestFullscreen });
      const video = container.querySelector("video") as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      const webkitEnterFullscreen = vi.fn();
      Object.defineProperty(video, "webkitEnterFullscreen", { configurable: true, value: webkitEnterFullscreen });
      setFullscreenEnabled(false);

      fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));

      expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
      expect(requestFullscreen).not.toHaveBeenCalled();
    });

    it("where element fullscreen exists (a computer) puts the player's own frame on the screen", () => {
      const { container } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      const region = getRegion();
      const requestFullscreen = vi.fn(() => Promise.resolve());
      Object.defineProperty(region, "requestFullscreen", { configurable: true, value: requestFullscreen });
      const video = container.querySelector("video") as HTMLVideoElement;
      const webkitEnterFullscreen = vi.fn();
      Object.defineProperty(video, "webkitEnterFullscreen", { configurable: true, value: webkitEnterFullscreen });
      setFullscreenEnabled(true);

      fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));

      expect(requestFullscreen).toHaveBeenCalledOnce();
      expect(webkitEnterFullscreen).not.toHaveBeenCalled();
    });

    it("a system refusal leaves the controls working, with nothing thrown", () => {
      const { container } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      const video = container.querySelector("video") as HTMLVideoElement;
      Object.defineProperty(video, "webkitEnterFullscreen", {
        configurable: true,
        value: () => {
          throw new DOMException("not ready", "InvalidStateError");
        },
      });
      setFullscreenEnabled(false);
      expect(() => fireEvent.click(screen.getByRole("button", { name: "На весь экран" }))).not.toThrow();
      expect(screen.getByRole("button", { name: "На весь экран" })).toBeTruthy();
    });
  });

  it("does not toggle play when a control is clicked", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);

    fireEvent.click(screen.getByRole("button", { name: "Выключить звук" }));
    act(() => vi.advanceTimersByTime(300));
    expect(play).not.toHaveBeenCalled();
  });

  it("adapts the frame to the source aspect ratio", () => {
    render(<AcademyVideoPlayer src="/portrait.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    setMedia(video, { duration: 30, videoWidth: 1080, videoHeight: 1920 });
    fireEvent.loadedMetadata(video);
    expect(region).toHaveClass("avp--tall");
    expect(region.style.getPropertyValue("--avp-aspect-ratio")).toBe("0.5625");
  });

  it("keeps landscape video from being treated as portrait", () => {
    render(<AcademyVideoPlayer src="/wide.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    setMedia(video, { duration: 30, videoWidth: 1920, videoHeight: 1080 });
    fireEvent.loadedMetadata(video);
    expect(region).not.toHaveClass("avp--tall");
    expect(region.style.getPropertyValue("--avp-aspect-ratio")).toMatch(/^1\.77/);
  });

  it("clears a stale media error once the video can play again", () => {
    const onError = vi.fn();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" onError={onError} />);
    const video = getVideo();

    setMedia(video, { error: { code: 2 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("Видео не загрузилось");
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ code: 2 }));

    fireEvent.canPlay(video);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it("explains the failure differently for network vs codec errors", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const video = getVideo();

    setMedia(video, { error: { code: 2 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("Проблема с сетью");

    setMedia(video, { error: { code: 4 } });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("кодек");
  });

  it("mutes, unmutes and changes volume", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" initialVolume={0.7} />);
    const video = getVideo();

    fireEvent.click(screen.getByRole("button", { name: "Выключить звук" }));
    expect(video.muted).toBe(true);

    fireEvent.change(screen.getByLabelText("Громкость"), { target: { value: "0.35" } });
    expect(video.volume).toBe(0.35);
    expect(video.muted).toBe(false);
  });

  it("shows loading, ended and error states from native media events", () => {
    const onEnded = vi.fn();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" onEnded={onEnded} />);
    const video = getVideo();

    fireEvent.play(video);
    fireEvent.waiting(video);
    expect(screen.getByRole("status")).toHaveTextContent("Загружаем видео");

    fireEvent.canPlay(video);
    fireEvent.ended(video);
    expect(onEnded).toHaveBeenCalledOnce();
    expect(screen.getByText("Урок просмотрен")).toBeInTheDocument();
  });

  it("keeps the bar under the picture while it plays; only in full screen does it step aside", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    fireEvent.play(video);
    fireEvent.pointerDown(region);
    act(() => vi.advanceTimersByTime(2500));
    // On the page the bar is below the picture: nothing to hide.
    expect(region).toHaveClass("avp--controls-visible");

    // Full screen: the bar floats over the picture and steps aside while it plays.
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: region });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    fireEvent.pointerDown(region);
    act(() => vi.advanceTimersByTime(2500));
    expect(region).not.toHaveClass("avp--controls-visible");

    fireEvent.pointerMove(region);
    expect(region).toHaveClass("avp--controls-visible");
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  });

  /* ------------------------------------------------------------------ *
   * 2026-10-02 — the player is asked for a second, and reads what the
   * element already knew when React arrived.
   * ------------------------------------------------------------------ */

  describe("seekTo — «пересмотреть с 1:55»", () => {
    function mount() {
      const ref = createRef<AcademyVideoPlayerHandle>();
      render(<AcademyVideoPlayer ref={ref} src="/lesson.mp4" title="Урок" />);
      return { ref, video: getVideo() };
    }

    it("moves to the second and starts playing when asked to", () => {
      const { ref, video } = mount();
      setMedia(video, { duration: 500, currentTime: 0 });
      fireEvent.loadedMetadata(video);

      act(() => ref.current!.seekTo(115, { play: true }));

      expect(video.currentTime).toBe(115);
      expect(play).toHaveBeenCalledOnce();
      expect(getTimeline()).toHaveAttribute("aria-valuenow", "115");
      expect(getTimeline()).toHaveAttribute("aria-valuetext", "1:55 из 8:20");
    });

    it("only moves when not asked to play", () => {
      const { ref, video } = mount();
      setMedia(video, { duration: 500, currentTime: 0 });
      fireEvent.loadedMetadata(video);
      act(() => ref.current!.seekTo(220));
      expect(video.currentTime).toBe(220);
      expect(play).not.toHaveBeenCalled();
    });

    it("clamps: never before the start, never onto the «просмотрен» screen", () => {
      const { ref, video } = mount();
      setMedia(video, { duration: 500, currentTime: 100 });
      fireEvent.loadedMetadata(video);
      act(() => ref.current!.seekTo(-30));
      expect(video.currentTime).toBe(0);
      act(() => ref.current!.seekTo(9_999));
      expect(video.currentTime).toBe(499.75);
      act(() => ref.current!.seekTo(Number.NaN));
      expect(video.currentTime).toBe(0);
    });

    it("keeps a request made before the length is known, and lands it when it is", () => {
      const { ref, video } = mount();
      setMedia(video, { currentTime: 0 });

      act(() => ref.current!.seekTo(380, { play: true }));
      // Nothing can be sought yet…
      expect(video.currentTime).toBe(0);
      expect(play).not.toHaveBeenCalled();
      // …and the browser is asked for the file, since nothing had asked before.
      expect(load).toHaveBeenCalledOnce();

      setMedia(video, { duration: 500 });
      fireEvent.loadedMetadata(video);
      expect(video.currentTime).toBe(380);
      expect(play).toHaveBeenCalledOnce();

      // The request is spent: later metadata events do not replay it.
      video.currentTime = 12;
      fireEvent.durationChange(video);
      expect(video.currentTime).toBe(12);
    });

    it("a refused play leaves the player paused on the requested second", async () => {
      play.mockImplementationOnce(() => Promise.reject(new DOMException("NotAllowedError")));
      const { ref, video } = mount();
      setMedia(video, { duration: 500, currentTime: 0 });
      fireEvent.loadedMetadata(video);
      await act(async () => {
        ref.current!.seekTo(115, { play: true });
        await Promise.resolve();
      });
      expect(video.currentTime).toBe(115);
      expect(screen.getByRole("button", { name: "Воспроизвести" })).toBeInTheDocument();
    });

    it("reveal brings the player into view and gives it focus", () => {
      const { ref } = mount();
      const region = getRegion();
      const scrollIntoView = vi.fn();
      region.scrollIntoView = scrollIntoView;
      act(() => ref.current!.reveal());
      expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
      expect(region).toHaveFocus();
    });
  });

  describe("what the element already knows when React arrives", () => {
    /* The <video> is in the server's HTML: its metadata can be loaded, and its
       events gone, before the component hydrates. Simulated by making every
       media element report a loaded state from its first render. */
    function elementAlreadyLoaded(values: { duration: number; readyState: number; error?: { code: number } | null }) {
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(values.readyState);
      vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(values.duration);
      // The frame's size lives on the video element's own prototype.
      vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
      vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
      if (values.error !== undefined) {
        // jsdom does not implement `error`; it is defined for this test and
        // taken away again by the caller.
        Object.defineProperty(HTMLMediaElement.prototype, "error", { configurable: true, get: () => values.error });
      }
    }

    it("shows the length and enables the timeline without a single media event", () => {
      elementAlreadyLoaded({ duration: 500, readyState: 4 });
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      // No loadedmetadata, no durationchange: they fired before hydration.
      expect(screen.getByText("8:20")).toBeInTheDocument();
      expect(getTimeline()).toHaveAttribute("aria-valuemax", "500");
      expect(getTimeline()).toHaveAttribute("aria-disabled", "false");
      expect(screen.getAllByRole("button", { name: "Вперёд на 10 секунд" })[0]).toBeEnabled();
      expect(getRegion()).toHaveClass("avp--has-frame");
    });

    it("a file that failed before hydration shows the failure, not an endless empty player", () => {
      elementAlreadyLoaded({ duration: Number.NaN, readyState: 0, error: { code: 4 } });
      try {
        const onError = vi.fn();
        render(<AcademyVideoPlayer src="/missing.mp4" title="Урок" onError={onError} />);
        expect(screen.getByRole("alert")).toHaveTextContent("Видео не загрузилось");
        expect(onError).toHaveBeenCalledWith({ code: 4 });
      } finally {
        delete (HTMLMediaElement.prototype as { error?: unknown }).error;
      }
    });

    it("an element with nothing loaded yet is left exactly as before", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      expect(getTimeline()).toHaveAttribute("aria-valuemax", "0");
      expect(getTimeline()).toHaveAttribute("aria-disabled", "true");
      expect(getRegion()).not.toHaveClass("avp--has-frame");
    });
  });

  describe("the ended screen", () => {
    it("offers only the replay when the page gives it nowhere to go", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      fireEvent.ended(getVideo());
      expect(screen.getByRole("button", { name: "Смотреть снова" })).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("points at what the level asks next, and the replay steps back", () => {
      render(
        <AcademyVideoPlayer src="/lesson.mp4" title="Урок" endedAction={{ label: "Перейти к тесту", href: "#task" }} />,
      );
      fireEvent.ended(getVideo());
      expect(screen.getByRole("link", { name: "Перейти к тесту" })).toHaveAttribute("href", "#task");
      expect(screen.getByRole("button", { name: "Смотреть снова" })).toHaveClass("avp__ended-replay--quiet");
    });

    it("draws no lesson of its own before play: a missing poster is a plain frame", () => {
      const { container } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      expect(container.querySelector(".avp__poster--plain")).not.toBeNull();
      expect(container.querySelector(".avp__poster-copy, .avp__poster-route, .avp__poster-grid")).toBeNull();
      expect(container.textContent).not.toMatch(/Академия \/ Урок/);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Lesson hi-fi (DD-336): the lesson line, the offer to go on, the speed, the
 * reading position and the docked player.
 * -------------------------------------------------------------------------- */

describe("AcademyVideoPlayer — the lesson hi-fi", () => {
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  const load = vi.fn();

  beforeEach(() => {
    play.mockClear();
    pause.mockClear();
    load.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load);
    try {
      window.localStorage.clear();
    } catch {
      /* jsdom always has one */
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const MARKERS = [
    { id: "q1", seconds: 115, label: "1", description: "Вопрос 1 · ответ объясняют с 1:55" },
    { id: "q2", seconds: 190, label: "2", description: "Вопрос 2 · ответ объясняют с 3:10", state: "right" as const },
    { id: "q3", seconds: 320, label: "3", description: "Вопрос 3 · ответ объясняют с 5:20", state: "wrong" as const },
  ];

  function loaded(duration = 500, currentTime = 0) {
    const video = getVideo();
    setMedia(video, { duration, currentTime });
    fireEvent.loadedMetadata(video);
    return video;
  }

  describe("the lesson line", () => {
    it("puts each point where its answer is taught, and pressing one plays from there", () => {
      const { container } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" markers={MARKERS} />);
      // No length, no line: the points wait for the file.
      expect(screen.queryByRole("button", { name: /Вопрос 1/ })).toBeNull();
      const video = loaded();

      const first = screen.getByRole("button", { name: "Вопрос 1 · ответ объясняют с 1:55" });
      expect(first.closest("li")).toHaveStyle({ left: "23%" });
      fireEvent.click(first);
      expect(video.currentTime).toBe(115);
      expect(play).toHaveBeenCalledOnce();
      expect(first.closest("li")).toHaveAttribute("data-active", "true");

      const states = [...container.querySelectorAll(".avp__marker")].map((item) => item.getAttribute("data-state"));
      expect(states).toEqual(["neutral", "right", "wrong"]);
      expect(screen.getByRole("list", { name: "Где в видео объясняют ответы теста" })).toBeInTheDocument();
    });

    it("never places a point outside the video", () => {
      render(
        <AcademyVideoPlayer
          src="/lesson.mp4"
          title="Урок"
          markers={[...MARKERS, { id: "late", seconds: 9_000, label: "4", description: "Вопрос 4" }]}
        />,
      );
      loaded();
      expect(screen.queryByRole("button", { name: "Вопрос 4" })).toBeNull();
      expect(screen.getAllByRole("button", { name: /^Вопрос/ })).toHaveLength(3);
    });

    it("prints a number only where it does not touch its neighbour", () => {
      const markers = [
        { id: "a", seconds: 100 },
        { id: "b", seconds: 104 },
        { id: "c", seconds: 300 },
      ];
      // 600 px for 500 s: 100 s and 104 s are under 5 px apart.
      expect([...printableMarkerLabels(markers, 500, 600)]).toEqual(["a", "c"]);
      // Wide enough, every number fits.
      expect([...printableMarkerLabels(markers, 500, 4_000)]).toEqual(["a", "b", "c"]);
      expect(printableMarkerLabels(markers, Number.NaN, 600).size).toBe(0);
    });
  });

  describe("«Продолжить с …»", () => {
    it("offers the second the learner stopped at, and goes on from it", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" resumeFrom={222} />);
      const video = loaded();
      fireEvent.click(screen.getByRole("button", { name: "Продолжить с 3:42" }));
      expect(video.currentTime).toBe(222);
      expect(play).toHaveBeenCalledOnce();
    });

    it("can start over instead", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" resumeFrom={222} />);
      const video = loaded(500, 0);
      video.currentTime = 40;
      fireEvent.click(screen.getByRole("button", { name: "Смотреть с начала" }));
      expect(video.currentTime).toBe(0);
      expect(play).toHaveBeenCalledOnce();
    });

    it("offers nothing for a position at either end", () => {
      const { unmount } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" resumeFrom={3} />);
      loaded();
      expect(screen.queryByRole("button", { name: /Продолжить с/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Воспроизвести видео" })).toBeInTheDocument();
      unmount();
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" resumeFrom={498} />);
      loaded();
      expect(screen.queryByRole("button", { name: /Продолжить с/ })).toBeNull();
    });

    it("is gone once the lesson has started", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" resumeFrom={222} />);
      const video = loaded();
      fireEvent.play(video);
      fireEvent.pause(video);
      expect(screen.queryByRole("button", { name: /Продолжить с/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Продолжить видео" })).toBeInTheDocument();
    });
  });

  describe("speed", () => {
    it("is chosen from a short list, applied to the video and remembered", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      const video = loaded();
      fireEvent.click(screen.getByRole("button", { name: "Скорость: 1×" }));
      const menu = screen.getByRole("menu", { name: "Скорость воспроизведения" });
      expect(menu).toBeInTheDocument();
      expect(screen.getByRole("menuitemradio", { name: "1×" })).toHaveAttribute("aria-checked", "true");

      fireEvent.click(screen.getByRole("menuitemradio", { name: "1,5×" }));
      expect(video.playbackRate).toBe(1.5);
      expect(window.localStorage.getItem("ata.player.playbackRate")).toBe("1.5");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.getByRole("button", { name: "Скорость: 1,5×" })).toBeInTheDocument();
    });

    it("starts at the speed the viewer chose last time, and ignores a value it does not offer", () => {
      window.localStorage.setItem("ata.player.playbackRate", "1.25");
      const { unmount } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      expect(screen.getByRole("button", { name: "Скорость: 1,25×" })).toBeInTheDocument();
      unmount();
      window.localStorage.setItem("ata.player.playbackRate", "7");
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      expect(screen.getByRole("button", { name: "Скорость: 1×" })).toBeInTheDocument();
    });

    it("closes on Escape", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
      fireEvent.click(screen.getByRole("button", { name: "Скорость: 1×" }));
      fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "2×" }), { key: "Escape" });
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("the reading position", () => {
    it("is told where the learner paused and where they finished, never before the start", () => {
      const onPositionSave = vi.fn();
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" onPositionSave={onPositionSave} />);
      const video = loaded(500, 0);
      fireEvent.pause(video);
      expect(onPositionSave).not.toHaveBeenCalled();

      fireEvent.play(video);
      video.currentTime = 61.8;
      fireEvent.pause(video);
      expect(onPositionSave).toHaveBeenLastCalledWith(61);
      // The same second twice is said once.
      fireEvent.pause(video);
      expect(onPositionSave).toHaveBeenCalledTimes(1);

      fireEvent.ended(video);
      expect(onPositionSave).toHaveBeenLastCalledWith(500);
    });

    it("is told every fifteen seconds while the lesson plays", () => {
      vi.useFakeTimers();
      const onPositionSave = vi.fn();
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" onPositionSave={onPositionSave} />);
      const video = loaded(500, 0);
      fireEvent.play(video);
      video.currentTime = 20;
      act(() => vi.advanceTimersByTime(15_000));
      expect(onPositionSave).toHaveBeenLastCalledWith(20);
      video.currentTime = 35;
      act(() => vi.advanceTimersByTime(15_000));
      expect(onPositionSave).toHaveBeenLastCalledWith(35);
    });
  });

  describe("docked", () => {
    type Observed = { callback: IntersectionObserverCallback; element: Element | null };
    let observed: Observed;

    beforeEach(() => {
      observed = { callback: () => undefined, element: null };
      class FakeObserver {
        constructor(callback: IntersectionObserverCallback) {
          observed.callback = callback;
        }
        observe(element: Element) {
          observed.element = element;
        }
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      }
      vi.stubGlobal("IntersectionObserver", FakeObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stage(visible: boolean) {
      act(() => {
        observed.callback(
          [{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0, target: observed.element! } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    }

    it("docks while the lesson plays and its stage is off screen, and the place stays on the page", () => {
      const { container } = render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" dockable />);
      const video = loaded();
      stage(false);
      // Paused and off screen: nothing to keep in view.
      expect(getRegion()).not.toHaveClass("avp--docked");

      fireEvent.play(video);
      expect(getRegion()).toHaveClass("avp--docked");
      expect(container.querySelector(".avp-slot")).toHaveClass("avp-slot--away");

      stage(true);
      expect(getRegion()).not.toHaveClass("avp--docked");
    });

    it("closes: the lesson pauses and the player goes back to its place", () => {
      render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" dockable />);
      const video = loaded();
      stage(false);
      fireEvent.play(video);
      fireEvent.click(screen.getByRole("button", { name: "Закрыть мини-плеер" }));
      expect(pause).toHaveBeenCalled();
      fireEvent.pause(video);
      expect(getRegion()).not.toHaveClass("avp--docked");
    });

    it("a rewatch plays where the learner is: docked, not scrolled to", () => {
      const ref = createRef<AcademyVideoPlayerHandle>();
      render(<AcademyVideoPlayer ref={ref} src="/lesson.mp4" title="Урок" dockable markers={MARKERS} />);
      const video = loaded();
      stage(false);
      const scrollIntoView = vi.fn();
      getRegion().scrollIntoView = scrollIntoView;

      act(() => ref.current!.playFrom(115, { markerId: "q1" }));
      expect(video.currentTime).toBe(115);
      expect(play).toHaveBeenCalledOnce();
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(getRegion()).toHaveClass("avp--docked");
      expect(screen.getByRole("button", { name: "Вопрос 1 · ответ объясняют с 1:55" }).closest("li")).toHaveAttribute(
        "data-active",
        "true",
      );
    });

    it("a player that cannot dock is brought into view instead", () => {
      const ref = createRef<AcademyVideoPlayerHandle>();
      render(<AcademyVideoPlayer ref={ref} src="/lesson.mp4" title="Урок" />);
      const video = loaded();
      const scrollIntoView = vi.fn();
      getRegion().scrollIntoView = scrollIntoView;
      act(() => ref.current!.playFrom(190));
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(video.currentTime).toBe(190);
      expect(getRegion()).not.toHaveClass("avp--docked");
    });
  });

  it("J and L step ten seconds like the arrows", () => {
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const video = loaded(100, 30);
    fireEvent.keyDown(region, { key: "l" });
    expect(video.currentTime).toBe(40);
    fireEvent.keyDown(region, { key: "j" });
    expect(video.currentTime).toBe(30);
  });
});

/* Where the docked player goes (2026-10-03, the responsive pass). Measured in a
   browser at 19 sizes; the rules that hold it are pinned here. */
describe("the docked player's place", () => {
  const css = readFileSync(join(process.cwd(), "src/components/media/academy-video-player.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const block = (prelude: string) => {
    const i = css.indexOf(prelude);
    return i === -1 ? "" : css.slice(i, css.indexOf("\n}", i));
  };

  it("on a wide screen sits in the corner inside the gutter beside the 860px column, never over it", () => {
    expect(css).toMatch(/\.avp--docked\s*\{[^}]*width:\s*min\(380px,\s*calc\(50%\s*-\s*462px\)\)/);
  });

  it("below 1404px is a strip across the column under the floating bar", () => {
    const strip = block("@media (max-width: 1403px)");
    expect(strip).toContain("top: 80px");
    expect(strip).toContain("width: min(860px, calc(100% - 32px))");
    expect(strip).toContain("flex-direction: row");
  });

  it("keeps the full-width band only for a phone held upright", () => {
    expect(css).toContain("@media (max-width: 599px) and (min-height: 561px)");
    expect(block("@media (max-width: 599px) and (min-height: 561px)")).toContain("max-height: 30vh");
  });
});
