import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademyVideoPlayer, type AcademyVideoPlayerHandle } from "./academy-video-player";

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

  it("auto-hides controls after inactivity and returns on interaction", () => {
    vi.useFakeTimers();
    render(<AcademyVideoPlayer src="/lesson.mp4" title="Урок" />);
    const region = getRegion();
    const video = getVideo();

    fireEvent.play(video);
    fireEvent.pointerDown(region);
    act(() => vi.advanceTimersByTime(2500));
    expect(region).not.toHaveClass("avp--controls-visible");

    fireEvent.pointerMove(region);
    expect(region).toHaveClass("avp--controls-visible");
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
